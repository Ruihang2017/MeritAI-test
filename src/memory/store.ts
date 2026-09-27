import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { now as clockNow } from "../clock";

/**
 * Per-user long-term memory, stored as JSONL under memory/users/<user>/.
 * - preferences: durable user preferences (explicit /remember or confirmed proposals)
 * - tasks: work-in-progress notes from end-of-session summaries; expire automatically
 * - sessions: this user's conversations (thread ids), for /history and /resume
 */

export interface Preference {
  id: string;
  text: string;
  source: "explicit" | "proposed";
  createdAt: string;
}

export interface TaskNote {
  id: string;
  text: string;
  createdAt: string;
  expiresAt: string;
}

export interface SessionRecord {
  threadId: string;
  title: string;
  startedAt: string;
  /** The page it was started from (a button in the UI's side panel), e.g. Hiring · Team leader. */
  from?: SessionFrom;
}

/** Where a conversation started: a page and the thing on it (a job, an employee, a file). */
export interface SessionFrom {
  page: "hiring" | "staff" | "files" | "profile";
  /** Same key = same topic: the side panel continues that conversation instead of starting a new one. */
  key: string;
  label: string;
  job?: string;
  employeeId?: number;
}

/** Per-user settings (not memory the model sees). */
export interface UserSettings {
  /** Root folder for Inbox/Outbox; absent = the default (<project>/files). */
  filesRoot?: string;
  /** DirectShow microphone name for voice mode; absent = the first one found. */
  micDevice?: string;
}

export const TASK_TTL_DAYS = 30;
export const MAX_PREFERENCES = 20;
export const MAX_MEMORY_TEXT = 300;

/**
 * Personal data that must never be written to memory. A backstop behind the
 * model instructions, not a complete PII detector.
 */
const PII_PATTERNS: [string, RegExp][] = [
  ["email address", /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ["phone number", /(\+?61|0)[\s-]?[2-478](?:[\s-]?\d){8}\b/],
  ["tax file number", /\bTFN\b|\b\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/i],
  ["date of birth", /\b(DOB|date of birth)\b/i],
];

export function findPii(text: string): string | null {
  for (const [label, re] of PII_PATTERNS) if (re.test(text)) return label;
  return null;
}

const newId = (prefix: string) => `${prefix}-${randomBytes(2).toString("hex")}`;

class JsonlFile<T> {
  constructor(private readonly path: string) {}

  read(): T[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as T];
        } catch {
          return [];
        }
      });
  }

  write(items: T[]): void {
    writeFileSync(this.path, items.map((i) => JSON.stringify(i)).join("\n") + (items.length ? "\n" : ""));
  }

  append(item: T): void {
    appendFileSync(this.path, JSON.stringify(item) + "\n");
  }
}

export class UserMemory {
  private prefs: JsonlFile<Preference>;
  private tasksFile: JsonlFile<TaskNote>;
  private sessionsFile: JsonlFile<SessionRecord>;
  private settingsPath: string;

  constructor(
    root: string,
    readonly userId: string,
  ) {
    const dir = join(root, "users", userId);
    mkdirSync(dir, { recursive: true });
    this.settingsPath = join(dir, "settings.json");
    this.prefs = new JsonlFile(join(dir, "preferences.jsonl"));
    this.tasksFile = new JsonlFile(join(dir, "tasks.jsonl"));
    this.sessionsFile = new JsonlFile(join(dir, "sessions.jsonl"));
  }

  // --- settings ---

  settings(): UserSettings {
    if (!existsSync(this.settingsPath)) return {};
    try {
      return JSON.parse(readFileSync(this.settingsPath, "utf8")) as UserSettings;
    } catch {
      return {};
    }
  }

  updateSettings(patch: Partial<UserSettings>): UserSettings {
    const next = { ...this.settings(), ...patch };
    for (const k of Object.keys(next) as (keyof UserSettings)[]) if (next[k] === undefined) delete next[k];
    writeFileSync(this.settingsPath, JSON.stringify(next, null, 2) + "\n");
    return next;
  }

  // --- preferences ---

  preferences(): Preference[] {
    return this.prefs.read();
  }

  /** Adds a preference, optionally replacing an existing one. Throws with a user-facing reason if rejected. */
  addPreference(text: string, source: Preference["source"], replaces?: string | null): Preference {
    const clean = text.trim();
    if (!clean) throw new Error("empty preference");
    if (clean.length > MAX_MEMORY_TEXT) throw new Error(`too long (max ${MAX_MEMORY_TEXT} characters)`);
    const pii = findPii(clean);
    if (pii) throw new Error(`contains personal data (${pii}); memory must not store personal data`);

    let items = this.prefs.read();
    if (replaces) items = items.filter((p) => p.id !== replaces);
    if (items.length >= MAX_PREFERENCES) throw new Error(`too many preferences (max ${MAX_PREFERENCES}); forget one first`);
    const pref: Preference = { id: newId("p"), text: clean, source, createdAt: clockNow().toISOString() };
    this.prefs.write([...items, pref]);
    return pref;
  }

  // --- tasks ---

  /** Unexpired task notes, newest first. Expired ones are purged on read. */
  tasks(now = clockNow()): TaskNote[] {
    const all = this.tasksFile.read();
    const live = all.filter((t) => new Date(t.expiresAt) > now);
    if (live.length !== all.length) this.tasksFile.write(live);
    return live.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  addTask(text: string, replaces?: string | null): TaskNote | null {
    const clean = text.trim().slice(0, MAX_MEMORY_TEXT);
    if (!clean || findPii(clean)) return null;
    let items = this.tasks();
    if (replaces) items = items.filter((t) => t.id !== replaces);
    const now = clockNow();
    const note: TaskNote = {
      id: newId("t"),
      text: clean,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TASK_TTL_DAYS * 86_400_000).toISOString(),
    };
    this.tasksFile.write([...items, note]);
    return note;
  }

  // --- shared ---

  /** Removes a preference or task by id. Returns what was removed, if anything. */
  forget(id: string): Preference | TaskNote | null {
    const prefs = this.prefs.read();
    const p = prefs.find((x) => x.id === id);
    if (p) {
      this.prefs.write(prefs.filter((x) => x.id !== id));
      return p;
    }
    const tasks = this.tasks();
    const t = tasks.find((x) => x.id === id);
    if (t) {
      this.tasksFile.write(tasks.filter((x) => x.id !== id));
      return t;
    }
    return null;
  }

  // --- sessions ---

  sessions(): SessionRecord[] {
    return this.sessionsFile.read().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  recordSession(s: SessionRecord): void {
    if (this.sessionsFile.read().some((x) => x.threadId === s.threadId)) return;
    this.sessionsFile.append(s);
  }

  dropSessions(threadIds: Set<string>): void {
    const all = this.sessionsFile.read();
    const kept = all.filter((s) => !threadIds.has(s.threadId));
    if (kept.length !== all.length) this.sessionsFile.write(kept);
  }
}
