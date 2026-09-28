import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { createAssistant, ROOT, type Assistant } from "../assistant";
import type { ReplyFormat } from "../basePrompt";
import { allCodexHomes } from "../engine/codexHome";
import { now } from "../clock";
import { PendingConfirms } from "./confirms";
import { launchCommand, openablePath, spawnLauncher, type Launcher, type OpenResult } from "./launch";
import { stageUploads, type Upload } from "./uploads";
export type { Upload } from "./uploads";
export type { Launcher, OpenResult } from "./launch";
export type { ReplyFormat } from "../basePrompt";
import type { AccountStatus, Confirm, ConfirmRequest, EngineEvent, SessionInfo, TranscriptEntry } from "../engine/types";
import { userSection } from "../memory/context";
import { summarizeSession } from "../memory/summarize";
import type { Preference, SessionFrom, SessionRecord, TaskNote } from "../memory/store";
import { attachToInbox, findDroppedPaths, importIntoJob, MAX_ATTACH_BYTES } from "../files/attach";
import { checkJobId, defaultFilesRoot, ensureFolders, jobDir, listJobs, sanitizeStem, validateFilesRoot, walk, type Folders } from "../files/folders";
import type { Decision, Rubric } from "../screening/catalog";
import { listFolder, listInbox, type FolderEntry, type InboxEntry } from "../files/tools";
import { profileLines, type BusinessProfile } from "../business/profile";
import { listPolicies, type PolicyEntry } from "../business/policies";
import { DOCUMENTS, expectedDocuments, type DocumentId, type Employee } from "../business/register";
import { checkDocuments, checkEmployeeChanges, checkNewEmployee, fixedTermEndChanged, FIXED_TERM_OWNER_NOTE, type FormNote } from "../business/registerOps";
import { checkProfilePatch } from "../business/tools";
import { newStarterChecklist, type ChecklistItem, type EmploymentType } from "../business/onboarding";
import { isApprenticeRole, leavingChecklist, LEAVING_REASONS, smallBusinessOf, type LeavingItem, type LeavingReason } from "../business/leaving";
import { documentTiming, nextKeyDate, remindersFor, todayLocal, type Reminder } from "../business/reminders";
import { looksLikePayCalculation, PAY_GUARD_WARNING } from "../business/payGuard";
import { formatCriteria, ingestJob, jdFromFolder, JD_NAME, proposeCriteria, purgeMissingJobs, screenJob, type IngestSummary, type Progress, type ScreenResult } from "../screening/pipeline";
import { chatSummary, saveReports } from "../screening/report";
import { LiveSession, type LiveLike } from "../voice/liveSession";
import { VoiceBridge } from "../voice/bridge";
import { Microphone, Speaker, ffmpegAvailable, listMicrophones } from "../voice/audio";
import { extractText } from "../files/parse";
import { checkWithOpenAI, keyFormatProblem, VoiceKeyStore, type VoiceKeyStatus } from "../voice/keyStore";
import { FakeLiveSession } from "../voice/fakeLive";
import { usdFor, VoiceUsage, type VoiceUsageSummary } from "../voice/usage";
import { FeedbackLog, RATING_REASONS, feedbackEmail, writeFeedbackFile } from "./feedback";
import { createJobWithJd, linkHire } from "../business/hiring";
import { INDUSTRIES, industriesFor, JOB_TEMPLATES, type IndustryId, type JobTemplate } from "../business/jobTemplates";
import { turnKey, type ChangeSink, type EntityChange } from "../changes";
import { EMAIL_RE, buildEml, readEml } from "../files/email";
import { LANGUAGE_ZH } from "../assistant";

/**
 * The application layer: everything a user interface needs, with no terminal code.
 * src/cli.ts is one front end over it; a desktop or web UI would be another.
 *
 * The UI supplies callbacks (confirmations, progress) and renders the returned data
 * and events. Business rules stay in the core modules; the session flows that used to
 * live in the CLI (notes on /new, resume with fresh memory, drag and drop, screening,
 * voice) live here, so every front end behaves the same.
 */

/** Stored conversations older than this are deleted when a session opens. */
export const SESSION_RETENTION_DAYS = 30;
/** Voice mode stops by itself after this much silence (no speech from the user or the voice, assistant idle). */
export const VOICE_IDLE_SECONDS = Number(process.env.FX_VOICE_IDLE_SECONDS ?? 60);

/** User-facing tier names → app-server service tier ids. */
export const TIERS: Record<string, string> = { fast: "priority", priority: "priority", standard: "default", default: "default" };
export const tierLabel = (id: string | null) => (id === "priority" ? "fast" : "standard");

const SETUP_PROMPT = "Start the business setup interview. Ask in English unless I answer in another language.";

export interface AppUI {
  /** Yes/no questions before the assistant changes something (profile, register, memory, imports, criteria). */
  confirm: Confirm;
  /** Progress of long-running work (screening, imports). */
  progress?: Progress;
  /** Engine log lines (debug only). */
  log?: (line: string) => void;
}

/** Events of one assistant turn: the engine's events plus app-level warnings. */
export type AppEvent =
  | EngineEvent
  | { type: "warning"; code: "pay_calculation"; message: string }
  /** The ChatGPT plan's usage ran out (from the engine's error text); `resetAt` when it says, as it said it (e.g. "Sep 27th, 2026 2:43 AM"). */
  | { type: "usage_limit"; resetAt: string | null };

/** Recognises Codex's usage-limit error and the reset time in it. */
export function usageLimit(message: string): { resetAt: string | null } | null {
  if (!/usage limit/i.test(message)) return null;
  return { resetAt: /try again (?:at|in) ([^.]+?)\.?$/i.exec(message.trim())?.[1]?.trim() ?? null };
}

/** Result of a form submission: saved (with `lines` for the receipt) or refused with a reason to show next to the form. */
export type FormResult<T> = ({ ok: true; lines: string[] } & T) | { ok: false; error: string };
export type { FormNote } from "../business/registerOps";
export type { ChecklistItem } from "../business/onboarding";
export type { LeavingItem, LeavingReason } from "../business/leaving";

export type AttachOutcome =
  | { path: string; kind: "attached"; name: string; reused: boolean; image: boolean }
  | { path: string; kind: "imported"; job: string; summary: IngestSummary }
  | { path: string; kind: "not-imported" }
  | { path: string; kind: "refused"; reason: string }
  | { path: string; kind: "error"; message: string };

/** "Soon" for reminders shown as counts and tones (the Attention button's "this week", the Staff page's amber). */
export const SOON_DAYS = 7;

/** An employee with what a Staff page shows next to them. */
export type StaffOverviewRow = Employee & {
  /** The person's next key date (overdue paperwork, start, last day, probation or contract end, visa expiry), or when they left. */
  next: { text: string; due: string; tone: "red" | "amber" | "n" } | null;
  /** Starting documents expected for them, recorded or not (with when each is due). */
  documentsExpected: { id: DocumentId; label: string; timing: string; recorded: string | null }[];
};

/** "Probation ends 2026-10-02: Leo Tran (Cleaner)" → "Probation ends 2026-10-02" (the row already shows the name). */
export function withoutName(title: string, name: string): string {
  const i = title.indexOf(name);
  if (i <= 0) return title;
  return (title.slice(0, i).replace(/(:|\s+for)\s*$/, "") + title.slice(i + name.length).replace(/^\s*\([^)]*\)/, "")).trim();
}

const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** A job on the Hiring page: where it is (no JD yet, criteria to confirm, ready, screened) and its counts. */
export interface JobSummary {
  job: string;
  /** All files in the job folder (JD included). */
  files: number;
  /** "v2 confirmed", "v1 not confirmed" or "none". */
  criteria: string;
  /** The job description file, if there is one. */
  jd: string | null;
  applications: number;
  /** Applications screened against the confirmed criteria. */
  screened: number;
  /** The job folder. */
  path: string;
  /** "decided": everyone screened has a decision (Shortlist or Not this time); "filled": as many hired as the job is for. */
  stage: "needs-jd" | "criteria" | "ready" | "screened" | "decided" | "filled";
  /** How many people the job is for, and how many were hired from it. */
  openings: number;
  hired: number;
  closedAt: string | null;
  /** Screened candidates shortlisted, and screened ones without a decision yet. */
  shortlisted: number;
  undecided: number;
}

/** File types the Open button may start (documents and images). */
const OPENABLE = [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".md", ".txt", ".rtf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".eml"];

/** A job's screening state for a UI: like ScreenResult, but the criteria may not exist yet. */
export type JobResults = Omit<ScreenResult, "rubric"> & {
  rubric: ScreenResult["rubric"] | null;
  /** Every file in the job folder but the JD, with what screening makes of it. */
  files: { file: string; status: "application" | "unreadable" | "duplicate"; reason: string | null }[];
  /** The owner's decisions on screened candidates (by file): Shortlist or Not this time. */
  decisions: { file: string; decision: Decision; decidedAt: string }[];
  /** Candidates hired from this job (added to Staff from the Hiring page), with their employee record. */
  hires: { file: string; employeeId: number; name: string; startDate: string; hiredAt: string }[];
  openings: number;
  /** When the job was closed (null: open). A closed job is read-only until reopened. */
  closedAt: string | null;
};

export type ScreenOutcome =
  | { status: "no-jd"; job: string }
  | { status: "not-confirmed"; job: string; criteria: string }
  | { status: "done"; job: string; summary: string };

export interface VoiceHandlers {
  /** A spoken request was sent to the assistant ("steer": added to the running task). */
  onRequest(text: string, mode: "new" | "steer"): void;
  /** Events of the assistant's turn for a spoken request. */
  onEvent(ev: AppEvent): void;
  /** A sentence the voice said on its own (small talk). */
  onSaid(text: string): void;
  /** A confirmation was needed but cannot be answered by voice; it was declined. */
  onConfirmSkipped(req: ConfirmRequest): void;
  onError(message: string): void;
  /** Voice ended: by stop() (byUser), idle timeout, or the session closing. */
  onEnded(info: { reason: string; byUser: boolean; billedSeconds: number }): void;
}

export interface VoiceAudio {
  source: { on(ev: "chunk", f: (pcm: Buffer) => void): unknown; on(ev: "error", f: (m: string) => void): unknown; start(): void; stop(): void };
  sink: { start(): void; play(pcm: Buffer): void; stop(): void };
}

export interface VoiceController {
  device: string;
  stop(reason?: string): void;
}

/** What a reply changed and saved (kept for the conversation). */
export interface TurnExtras {
  changes: EntityChange[];
  files: string[];
}

/** In a workspace's .assistant/: marks the sample business (synthetic data) and the day it is written for. */
const SAMPLE_MARKER = "sample.json";

export class AssistantApp {
  readonly userId: string;
  private readonly a: Assistant;
  private session: SessionInfo | null = null;
  /** The current conversation is in the user's history once it has a message. */
  private recorded = false;
  private pending: { notes: string[]; images: string[] } = { notes: [], images: [] };
  private voice: VoiceController | null = null;
  private readonly engineKind: "codex" | "fake";
  private voiceHandlers: VoiceHandlers | null = null;
  /** Voice with a screen (a UI): questions wait on screen instead of being declined. */
  private voiceOnScreen = false;
  private voiceBridge: VoiceBridge | null = null;
  private readonly confirms = new PendingConfirms();

  constructor(opts: {
    userId: string;
    ui: AppUI;
    serviceTier?: string;
    codexBasePrompt?: boolean;
    /** Reply formatting: "plain" (default, a terminal) or "markdown" (a UI that renders it). */
    format?: ReplyFormat;
    /** Defaults to <repo>/memory. */
    memoryRoot?: string;
    /** Business workspace chosen by the host application (not validated like /files set). */
    filesRoot?: string;
    clientVersion?: string;
    /** Starts the system's open / reveal command (openFile, revealFile); tests pass a fake. */
    launcher?: Launcher;
    /** "fake": scripted replies with the real tools (UI work without the model). */
    engine?: "codex" | "fake";
  }) {
    this.userId = opts.userId;
    this.launcher = opts.launcher ?? spawnLauncher;
    const confirm: Confirm = async (req) => {
      // A yes/no needs a keyboard or a click. In a terminal's voice mode it is declined and reported; a UI
      // with a screen shows it and waits (a click, or a spoken "yes": answerSpoken), and the voice asks for it.
      if (this.voice && !this.voiceOnScreen) {
        this.voiceHandlers?.onConfirmSkipped(req);
        return false;
      }
      if (this.voice) this.voiceBridge?.say(`A change needs the owner's OK before it is saved: ${req.title}. Ask them, in a few words, to check it on the screen and say yes, or press Yes, save.${req.destructive ? " Deleting needs a press on the screen; saying yes is not enough." : ""}`);
      // Tracked, so stop(), close() and cancelPendingConfirms() can withdraw it.
      return this.confirms.ask(opts.ui.confirm, req);
    };
    this.confirm = confirm;
    this.engineKind = opts.engine ?? "codex";
    this.a = createAssistant({
      userId: opts.userId,
      confirm,
      serviceTier: opts.serviceTier,
      codexBasePrompt: opts.codexBasePrompt,
      format: opts.format,
      memoryRoot: opts.memoryRoot,
      clientVersion: opts.clientVersion,
      engine: opts.engine,
      onLog: opts.ui.log,
      onProgress: opts.ui.progress,
    });
    this.progress = opts.ui.progress ?? (() => {});
    this.onLog = opts.ui.log;
    if (opts.filesRoot) this.a.mem.updateSettings({ filesRoot: opts.filesRoot });
  }

  private readonly confirm: Confirm;
  private readonly progress: Progress;
  private readonly onLog?: (line: string) => void;
  private readonly launcher: Launcher;

  // ------------------------------------------------------------------ account and session

  async start(): Promise<AccountStatus> {
    this.applySampleClock();
    await this.a.engine.start();
    return this.a.engine.account();
  }

  login(onPrompt: (message: string) => void): Promise<void> {
    return this.a.engine.login(onPrompt);
  }

  /** Cancels a sign-in still waiting for the owner (their login() call then fails with LOGIN_CANCELLED). */
  cancelLogin(): Promise<boolean> {
    return this.a.engine.cancelLogin();
  }

  account(): Promise<AccountStatus> {
    return this.a.engine.account();
  }

  /** Retention cleanup, then a new conversation. Returns how many old conversations were deleted. */
  async openSession(): Promise<{ session: SessionInfo; deletedOld: number }> {
    const deletedOld = await this.cleanupOldSessions();
    this.session = await this.a.engine.newSession();
    this.recorded = false;
    return { session: this.session, deletedOld };
  }

  sessionInfo(): SessionInfo | null {
    return this.session;
  }

  /** Whether the current conversation has any user message (so notes can be saved). */
  hasConversation(): boolean {
    return this.a.engine.transcript().some((m) => m.role === "user");
  }

  /** Memory write mechanism 4: work notes from the conversation that is ending (null: nothing to summarise). */
  async saveNotes(): Promise<TaskNote[] | null> {
    if (!this.hasConversation()) return null;
    return summarizeSession(this.a.engine, this.a.mem);
  }

  /**
   * Saves notes from the current conversation, then starts a new one. `notes: "background"`
   * (a UI switching often) starts at once and summarises the old conversation afterwards
   * (a model call of several seconds); "wait" (the CLI) returns the notes saved.
   */
  async newConversation(opts: { notes?: "wait" | "background" } = {}): Promise<TaskNote[] | null> {
    const old = this.hasConversation() ? this.a.engine.transcript() : null;
    const notes = opts.notes === "background" ? null : await this.saveNotes();
    this.session = await this.a.engine.newSession();
    this.recorded = false;
    if (opts.notes === "background" && old) this.notesInBackground(old);
    return notes;
  }

  private notesInBackground(transcript: TranscriptEntry[]): void {
    summarizeSession(this.a.engine, this.a.mem, transcript).catch((e: Error) => this.onLog?.(`[notes] not saved: ${e.message}`));
  }

  /** This user's earlier conversations that are still stored (newest first, at most 15). */
  async history(): Promise<SessionRecord[]> {
    const stored = new Set((await this.a.engine.listStoredSessions()).map((s) => s.threadId));
    return this.a.mem.sessions().filter((s) => stored.has(s.threadId)).slice(0, 15);
  }

  /** The messages of the current conversation from its start (also after a resume), for a UI to show. No model call. */
  async conversation(): Promise<TranscriptEntry[]> {
    return this.session ? this.a.engine.readTranscript(this.session.threadId) : [];
  }

  /** Continues an earlier conversation with this user's current memory. */
  async resume(record: SessionRecord, opts: { notes?: "wait" | "background" } = {}): Promise<{ notes: TaskNote[] | null; alreadyOpen: boolean }> {
    if (record.threadId === this.session?.threadId) return { notes: null, alreadyOpen: true };
    const old = this.hasConversation() ? this.a.engine.transcript() : null;
    const notes = opts.notes === "background" ? null : await this.saveNotes();
    // The stored thread keeps its original instructions; send the current memory with the next message.
    const update = `<memory_update>\nThis conversation is being resumed. Current memory (overrides anything older in this conversation):\n\n${userSection(this.a.mem)}\n</memory_update>`;
    this.session = await this.a.engine.resumeSession(record.threadId, update);
    this.recorded = true;
    if (opts.notes === "background" && old) this.notesInBackground(old);
    return { notes, alreadyOpen: false };
  }

  /** Saves notes and shuts the engine down. */
  async close(): Promise<TaskNote[] | null> {
    this.cancelPendingConfirms();
    this.voice?.stop();
    let notes: TaskNote[] | null = null;
    try {
      notes = await this.saveNotes();
    } finally {
      await this.a.engine.close();
    }
    return notes;
  }

  private async cleanupOldSessions(): Promise<number> {
    const cutoff = Date.now() - SESSION_RETENTION_DAYS * 86_400_000;
    const old = (await this.a.engine.listStoredSessions()).filter((s) => s.updatedAt.getTime() < cutoff);
    for (const s of old) {
      await this.a.engine.deleteStoredSession(s.threadId);
      rmSync(this.extrasFile(s.threadId), { force: true });
    }
    this.a.mem.dropSessions(new Set(old.map((s) => s.threadId)));
    return old.length;
  }

  // ------------------------------------------------------------------ conversation

  isBusy(): boolean {
    return this.a.engine.isBusy();
  }

  /** Stops the reply in progress; its open confirmations are declined. */
  stop(): Promise<void> {
    this.cancelPendingConfirms();
    return this.a.engine.interrupt();
  }

  /** Confirmations waiting for an answer (a reconnecting UI shows them again, with the same id). */
  pendingConfirms(): { id: string; req: ConfirmRequest }[] {
    return this.confirms.list();
  }

  /** Withdraws open confirmations (e.g. the UI disconnected); each counts as declined. Returns how many. */
  cancelPendingConfirms(): number {
    return this.confirms.cancelAll();
  }

  /**
   * One assistant turn. Pending attachments go with it. `title` is what the user
   * typed (used for the history), when it differs from `text`; `from` is the page a
   * new conversation was started from (kept with it in the history).
   */
  async *send(text: string, opts: { skill?: string; title?: string; from?: SessionFrom } = {}): AsyncIterable<AppEvent> {
    this.recordSession(opts.title ?? text, opts.from);
    // A language changed in Settings reaches a conversation already open with its next message.
    const lang = this.languageNote ? [`[reply language: ${this.a.mem.settings().language === "zh" ? LANGUAGE_ZH : "English from now on (documents too)."}]`] : [];
    this.languageNote = false;
    const message = [...this.pending.notes, ...lang, text].filter(Boolean).join(" ");
    const images = this.pending.images;
    this.pending = { notes: [], images: [] };
    yield* this.withGuards(this.a.engine.send(message, { skill: opts.skill, images }));
  }

  /** Adds app-level checks to a turn's events (the pay calculation backstop). */
  private async *withGuards(events: AsyncIterable<EngineEvent>): AsyncIterable<AppEvent> {
    for await (const ev of events) {
      yield ev;
      if (ev.type === "text_done" && looksLikePayCalculation(ev.text)) yield { type: "warning", code: "pay_calculation", message: PAY_GUARD_WARNING };
      if (ev.type === "error") {
        const limit = usageLimit(ev.message);
        if (limit) yield { type: "usage_limit", resetAt: limit.resetAt };
      }
    }
  }

  private recordSession(title: string, from?: SessionFrom): void {
    if (this.recorded || !this.session) return;
    this.a.mem.recordSession({ threadId: this.session.threadId, title: title.slice(0, 60), startedAt: now().toISOString(), ...(from ? { from } : {}) });
    this.recorded = true;
  }

  /** The business setup interview (a skill-driven turn). */
  setup(from?: SessionFrom): AsyncIterable<AppEvent> {
    return this.send(SETUP_PROMPT, { skill: "business-setup", title: "/setup", ...(from ? { from } : {}) });
  }

  /** Saves a preference through the model, so preferences that break the HR principles are refused. */
  remember(text: string): AsyncIterable<AppEvent> {
    return this.send(`Remember this for future conversations: ${text}`, { title: `/remember ${text}` });
  }

  skills() {
    return this.a.engine.listSkills();
  }

  /** A skill by exact name or unique prefix. */
  resolveSkill(prefix: string): { skill: string } | { ambiguous: string[] } | null {
    const matches = this.skills().filter((s) => s.name.startsWith(prefix));
    const exact = matches.find((s) => s.name === prefix);
    if (exact) return { skill: exact.name };
    if (matches.length === 1) return { skill: matches[0].name };
    return matches.length ? { ambiguous: matches.map((s) => s.name) } : null;
  }

  setTier(name: string): string | null {
    const id = TIERS[name.toLowerCase()];
    if (!id) return null;
    this.a.engine.setServiceTier(id);
    return tierLabel(id);
  }

  // ------------------------------------------------------------------ attachments (drag and drop)

  /** Attachments waiting for the next message. */
  /** Names of the files attached for the next message (a UI shows them as chips). */
  pendingAttachments(): string[] {
    return this.pending.notes.flatMap((n) => {
      const m = /^\[attached: "([^"]+)"/.exec(n);
      return m ? [m[1]] : [];
    });
  }

  /** Takes a file back off the next message (the file stays in the Inbox). */
  detach(name: string): boolean {
    const before = this.pending.notes.length;
    this.pending.notes = this.pending.notes.filter((n) => !n.startsWith(`[attached: "${name}"`));
    this.pending.images = this.pending.images.filter((p) => basename(p) !== name);
    return this.pending.notes.length < before;
  }

  hasPendingAttachments(): boolean {
    return this.pending.notes.length > 0;
  }

  /**
   * Attaches dropped files (copied into the Inbox, never overwriting) and offers to
   * import dropped folders as jobs. They go with the next message.
   */
  async attach(paths: string[]): Promise<AttachOutcome[]> {
    const out: AttachOutcome[] = [];
    const forbidden = [...allCodexHomes(this.a.paths.projectRoot), this.a.paths.memoryRoot, join(this.a.paths.projectRoot, "src")];
    for (const path of paths) {
      const r = attachToInbox(this.folders(), path, forbidden);
      if (r.kind === "file") {
        this.pending.notes.push(`[attached: "${r.name}" (in the Inbox${r.image ? "; image shown to you" : ""})]`);
        if (r.image) this.pending.images.push(r.path);
        out.push({ path, kind: "attached", name: r.name, reused: r.reused, image: r.image });
      } else if (r.kind === "refused") {
        out.push({ path, kind: "refused", reason: r.reason });
      } else if (await this.confirm({ kind: "folder-import", title: `Import the folder "${basename(r.source)}" as a job, to screen the resumes in it?` })) {
        try {
          const { job, summary } = await importIntoJob(this.folders(), this.a.catalog(), r.source, null, this.progress);
          this.pending.notes.push(`[imported folder as job "${job}" (${summary.applications} application file(s))]`);
          out.push({ path, kind: "imported", job, summary });
        } catch (e) {
          out.push({ path, kind: "error", message: (e as Error).message });
        }
      } else {
        out.push({ path, kind: "not-imported" });
      }
    }
    return out;
  }

  /**
   * Attaches uploaded bytes (a browser UI has no paths): the same as dropping files or
   * folders. Files without a folder in `relPath` go to the Inbox; files of a dropped folder
   * are staged in a temporary folder with their structure, offered as a job import, and the
   * staging folder is deleted. One outcome per loose file, per top-level folder and per
   * refused upload (unsafe path, too large), in upload order; `path` is the uploaded name.
   */
  async attachBytes(files: Upload[]): Promise<AttachOutcome[]> {
    const staged = stageUploads(files, MAX_ATTACH_BYTES);
    try {
      const out: { index: number; outcome: AttachOutcome }[] = staged.refused.map((r) => ({ index: r.index, outcome: { path: r.label, kind: "refused", reason: r.reason } }));
      for (const group of [staged.files, staged.folders]) {
        const outcomes = await this.attach(group.map((g) => g.path));
        group.forEach((g, i) => out.push({ index: g.index, outcome: { ...outcomes[i], path: g.label } }));
      }
      return out.sort((x, y) => x.index - y.index).map((x) => x.outcome);
    } finally {
      rmSync(staged.dir, { recursive: true, force: true });
    }
  }

  /**
   * For terminals, where a dropped file arrives as its path in the typed line: attaches
   * the paths it finds and returns the rest of the message (empty if there was none).
   */
  async takeDroppedPaths(line: string): Promise<{ text: string; outcomes: AttachOutcome[] }> {
    const dropped = findDroppedPaths(line);
    if (!dropped.length) return { text: line, outcomes: [] };
    let text = line;
    for (const d of dropped) text = text.replace(d.raw, "");
    return { text: text.replace(/\s+/g, " ").trim(), outcomes: await this.attach(dropped.map((d) => d.path)) };
  }

  // ------------------------------------------------------------------ business

  needsSetup(): boolean {
    return !this.a.business().exists();
  }

  profile(): { exists: boolean; profile: BusinessProfile; lines: string[]; path: string; policiesDir: string; policies: PolicyEntry[]; smallBusiness: boolean | null } {
    const b = this.a.business();
    const p = b.get();
    return { exists: b.exists(), profile: p, lines: profileLines(p), path: b.path, policiesDir: this.folders().policies, policies: listPolicies(this.folders()), smallBusiness: smallBusinessOf(p.headcount) };
  }

  staff(includeLeft = false): Employee[] {
    return this.a.register().list({ includeLeft });
  }

  reminders(): Reminder[] {
    return remindersFor(this.a.register(), this.a.business());
  }

  /** Overdue reminders and those due within SOON_DAYS (the Attention button and badges). */
  attentionSummary(): { overdue: number; soon: number } {
    const rs = this.reminders();
    const soon = addDaysIso(todayLocal(), SOON_DAYS);
    return { overdue: rs.filter((r) => r.overdue).length, soon: rs.filter((r) => !r.overdue && r.due <= soon).length };
  }

  /** The register for a Staff page: each person's next reminder and their starting documents with timing. */
  staffOverview(includeLeft = false): StaffOverviewRow[] {
    const today = todayLocal();
    return this.staff(includeLeft).map((e) => {
      const next = nextKeyDate(e, today, SOON_DAYS);
      const done = new Map(e.documents.map((d) => [d.id, d.date]));
      const timing = documentTiming(e.startDate);
      return { ...e, next, documentsExpected: expectedDocuments(e).map((id) => ({ id, label: DOCUMENTS[id], timing: timing[id], recorded: done.get(id) ?? null })) };
    });
  }

  // ------------------------------------------------------------------ forms
  // Direct edits from a UI form. They use the same validation as the chat tools
  // (PII refusal, dates, duplicates); submitting the form is the owner's
  // confirmation, so there is no second yes/no, except for deleting.

  /** Adds an employee; returns the new starter checklist for them (from code, with official sources). */
  addEmployee(details: unknown, opts: { mayNeedVisaCheck?: boolean; apprentice?: boolean; constructionSite?: boolean; hireFrom?: { job: string; file: string } } = {}): FormResult<{ employee: Employee; checklist: ChecklistItem[] }> {
    const c = checkNewEmployee(this.a.register(), details);
    if (!c.ok) return { ok: false, error: c.error };
    const employee = this.a.register().add(c.input);
    if (opts.hireFrom) {
      // The employee is saved either way; a hire that can't be linked is only logged.
      try {
        this.recordHire(opts.hireFrom.job, opts.hireFrom.file, employee.id);
      } catch (e) {
        this.onLog?.(`[hire] not recorded: ${(e as Error).message}`);
      }
    }
    const p = this.a.business().get();
    const checklist = newStarterChecklist({
      employmentType: employee.employmentType as EmploymentType,
      // Unknown unless the form says otherwise: the visa check stays on the list.
      mayNeedVisaCheck: opts.mayNeedVisaCheck ?? true,
      smallBusiness: p.headcount === null ? null : p.headcount < 15,
      apprentice: opts.apprentice ?? isApprenticeRole(employee.role),
      constructionSite: opts.constructionSite ?? false,
      firstEmployee: this.staff(true).length === 1 && (p.headcount === null || p.headcount <= 1),
      states: p.states,
    });
    return { ok: true, employee, lines: c.lines, checklist };
  }

  /** Changes work details. Leaving goes through markLeft (it returns the leaving checklist). */
  updateEmployee(id: number, changes: unknown): FormResult<{ employee: Employee; notes: FormNote[] }> {
    if (changes && typeof changes === "object" && (changes as { status?: unknown }).status === "left") return { ok: false, error: "use markLeft to record that someone left" };
    const c = checkEmployeeChanges(this.a.register(), id, changes);
    if (!c.ok) return { ok: false, error: c.error };
    const employee = this.a.register().update(c.current.id, c.changes);
    const notes = fixedTermEndChanged(c.current, employee, c.changes) ? [FIXED_TERM_OWNER_NOTE] : [];
    return { ok: true, employee, lines: c.lines, notes };
  }

  /** Records starting documents given or completed on one date (YYYY-MM-DD). */
  recordDocuments(id: number, documents: DocumentId[], date: string): FormResult<{ employee: Employee }> {
    const c = checkDocuments(this.a.register(), id, documents, date);
    if (!c.ok) return { ok: false, error: c.error };
    return { ok: true, employee: this.a.register().recordDocuments(c.current.id, c.docs, c.date), lines: c.lines };
  }

  /** Marks someone as left and returns the leaving checklist for the reason (from code, with official sources). */
  markLeft(id: number, leftDate: string, reason: LeavingReason): FormResult<{ employee: Employee; checklist: LeavingItem[] }> {
    if (!LEAVING_REASONS.includes(reason)) return { ok: false, error: `reason must be one of: ${LEAVING_REASONS.join(", ")}` };
    const c = checkEmployeeChanges(this.a.register(), id, { status: "left", leftDate });
    if (!c.ok) return { ok: false, error: c.error };
    if (!c.changes.leftDate) return { ok: false, error: "leftDate is required (YYYY-MM-DD)" };
    const employee = this.a.register().update(c.current.id, c.changes);
    const p = this.a.business().get();
    const checklist = leavingChecklist({ reason, apprentice: isApprenticeRole(employee.role), casual: employee.employmentType === "casual", states: p.states, smallBusiness: smallBusinessOf(p.headcount) });
    return { ok: true, employee, lines: c.lines, checklist };
  }

  /** Deletes an employee and their records after the destructive confirmation (the same one the chat tool shows). */
  async removeEmployee(id: number): Promise<FormResult<{ removed: boolean }>> {
    const current = this.a.register().get(Number(id));
    if (!current) return { ok: false, error: `no employee with id ${id}` };
    const yes = await this.confirm({ kind: "register", title: `Delete ${current.name} and all their records from the register? This cannot be undone.`, destructive: true });
    if (yes) this.a.register().remove(current.id);
    return { ok: true, removed: yes, lines: yes ? [`deleted: ${current.name}`] : [] };
  }

  /** Saves business profile fields (only those given). `lines` is empty when nothing changed. */
  updateProfile(changes: unknown): FormResult<{ profile: BusinessProfile }> {
    const b = this.a.business();
    const c = checkProfilePatch(b, changes);
    if (!c.ok) return { ok: false, error: c.error };
    const profile = c.lines.length ? b.update(c.patch) : b.get();
    return { ok: true, profile, lines: c.lines };
  }

  // ------------------------------------------------------------------ memory

  memories(): { preferences: Preference[]; notes: TaskNote[] } {
    return { preferences: this.a.mem.preferences(), notes: this.a.mem.tasks() };
  }

  forget(id: string): Preference | TaskNote | null {
    return this.a.mem.forget(id);
  }

  // ------------------------------------------------------------------ files and jobs

  folders(): Folders {
    return this.a.folders();
  }

  files(): { folders: Folders; inbox: InboxEntry[] } {
    const f = this.folders();
    return { folders: f, inbox: listInbox(f) };
  }

  /** Everything a Files page lists: Inbox, Outbox (drafts marked), Policies (with titles) and jobs. */
  async workspaceFiles(): Promise<{
    root: string;
    inbox: FolderEntry[];
    outbox: (FolderEntry & { draft: boolean })[];
    policies: (FolderEntry & { title: string; description: string })[];
    jobs: { job: string; files: number; criteria: string; path: string }[];
  }> {
    const f = this.folders();
    const meta = new Map(listPolicies(f).map((p) => [p.id, p]));
    const policies = listFolder(f.policies).map((e) => ({ ...e, title: meta.get(e.name)?.title ?? e.name, description: meta.get(e.name)?.description ?? "" }));
    const outbox = await Promise.all(listFolder(f.outbox).map(async (e) => ({ ...e, draft: await this.isDraft(e.path, e.modified, e.readable) })));
    return { root: f.root, inbox: listFolder(f.inbox), outbox, policies, jobs: this.jobs() };
  }

  private readonly drafts = new Map<string, boolean>();

  /** Whether a saved document starts with the DRAFT line (decision letters do); cached per file version. */
  private async isDraft(path: string, modified: string, readable: boolean): Promise<boolean> {
    if (!readable) return false;
    const key = `${path}|${modified}`;
    let draft = this.drafts.get(key);
    if (draft === undefined) {
      const text = await extractText(path).then((r) => r.text, () => "");
      draft = /^\s*(\*\*)?DRAFT\b/.test(text);
      this.drafts.set(key, draft);
    }
    return draft;
  }

  /** Opens a workspace file (or folder) with the system's default app, e.g. a saved report. */
  openFile(path: string): Promise<OpenResult> {
    return this.launch("open", path);
  }

  /** An email draft this app saved (.eml in the workspace): recipients, subject, attachments, the start of the text. */
  emailDraft(path: string): { ok: true; to: string[]; cc: string[]; subject: string; attachments: string[]; preview: string } | { ok: false; error: string } {
    const p = openablePath(this.folders(), path);
    if (!p.ok) return p;
    if (extname(p.path).toLowerCase() !== ".eml") return { ok: false, error: "not an email draft" };
    return { ok: true, ...readEml(readFileSync(p.path, "utf8")) };
  }

  /** Shows a workspace file in the file manager (Explorer / Finder; the folder on Linux). */
  revealFile(path: string): Promise<OpenResult> {
    return this.launch("reveal", path);
  }

  private async launch(action: "open" | "reveal", path: string): Promise<OpenResult> {
    const p = openablePath(this.folders(), path);
    if (!p.ok) return p;
    // "Open" runs the file's default program: only documents, images and folders, never
    // shortcuts or programs that ended up in the workspace (e.g. inside an imported job folder).
    if (action === "open" && statSync(p.path).isFile() && !OPENABLE.includes(extname(p.path).toLowerCase())) {
      return { ok: false, error: "For safety, only documents and images open from MeritAI. Use Show in folder for other files." };
    }
    try {
      await this.launcher(launchCommand(action, p.path));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `could not ${action} the file: ${(e as Error).message}` };
    }
  }

  /** Moves this user's business workspace (validated: no system or assistant folders). */
  setFilesRoot(path: string): Folders {
    const root = validateFilesRoot(path, this.a.paths);
    ensureFolders(root);
    this.a.mem.updateSettings({ filesRoot: root });
    this.applySampleClock();
    return this.folders();
  }

  // --- testers' feedback (src/app/feedback.ts)

  private feedbackLog(): FeedbackLog {
    return new FeedbackLog(join(this.a.mem.dir, "feedback.jsonl"));
  }

  /** "Was this helpful?" on a reply: kept on this computer until the owner sends a feedback file. */
  async rateReply(r: { rating: "up" | "down"; reasons: string[]; note: string; question: string; answer: string }): Promise<void> {
    const threadId = this.session?.threadId ?? null;
    const title = threadId ? ((await this.history()).find((s) => s.threadId === threadId)?.title ?? null) : null;
    this.feedbackLog().add({ at: now().toISOString(), ...r, reasons: r.reasons.filter((x) => (RATING_REASONS as readonly string[]).includes(x)), conversation: title, threadId });
  }

  // --- connections that are coming (the Connections page): what the owner would use first

  private wantedFile(): string {
    return join(this.a.mem.dir, "connections-wanted.json");
  }

  wantedConnections(): string[] {
    try {
      const v = JSON.parse(readFileSync(this.wantedFile(), "utf8")) as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  wantConnection(name: string, want: boolean): string[] {
    const cur = this.wantedConnections().filter((x) => x !== name);
    const next = want ? [...cur, name] : cur;
    writeFileSync(this.wantedFile(), JSON.stringify(next, null, 2) + "\n");
    return next;
  }

  feedbackSummary(): { up: number; down: number; name: string } {
    const all = this.feedbackLog().all();
    return { up: all.filter((r) => r.rating === "up").length, down: all.filter((r) => r.rating === "down").length, name: this.a.mem.settings().feedbackName ?? "" };
  }

  /** "Send feedback": one file in the workspace's Feedback folder, with what the owner chose to include. */
  async exportFeedback(opts: { note: string; ratings: boolean; conversation: boolean; technical: Record<string, unknown> | null; name?: string; version?: string }): Promise<string> {
    // The tester's name is optional and remembered on this computer (settings, not memory).
    const name = (opts.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (opts.name !== undefined) this.a.mem.updateSettings({ feedbackName: name || undefined });
    const threadId = this.session?.threadId ?? null;
    const title = threadId ? ((await this.history()).find((s) => s.threadId === threadId)?.title ?? null) : null;
    const content = {
      kind: "MeritAI feedback",
      ...(name ? { from: name } : {}),
      ...(opts.version ? { version: opts.version } : {}),
      savedAt: new Date().toISOString(),
      note: opts.note,
      ...(opts.ratings ? { ratings: this.feedbackLog().all() } : {}),
      // Which coming connections the tester would use first (the Connections page's "I want this").
      ...(this.wantedConnections().length ? { wantedConnections: this.wantedConnections() } : {}),
      ...(opts.conversation && threadId ? { conversation: { title, messages: await this.conversation() } } : {}),
      ...(opts.technical ? { technical: opts.technical } : {}),
    };
    return writeFeedbackFile(this.folders().root, new Date(), content);
  }

  /**
   * "Email it to the MeritAI team": an email draft (.eml beside the file) to the address the app
   * comes with, the feedback file attached, opened in the tester's email app. Nothing is sent here.
   */
  async emailFeedback(path: string, o: { to: string; version: string }): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const p = openablePath(this.folders(), path);
    if (!p.ok) return p;
    const dir = join(this.folders().root, "Feedback");
    if (!existsSync(dir) || dirname(p.path) !== realpathSync(dir) || extname(p.path).toLowerCase() !== ".json") return { ok: false, error: "not a feedback file" };
    if (!EMAIL_RE.test(o.to)) return { ok: false, error: "this version of MeritAI has no address for the MeritAI team: send the file yourself (Show in folder)" };
    const eml = p.path.replace(/\.json$/i, ".eml");
    const name = this.a.mem.settings().feedbackName ?? null;
    writeFileSync(eml, buildEml(feedbackEmail({ to: o.to, file: p.path, data: readFileSync(p.path), version: o.version, when: new Date(), name })));
    const opened = await this.openFile(eml);
    return opened.ok ? { ok: true, path: eml } : opened;
  }

  // --- the sample business (first run: "Try it with a sample business")

  /** Where memory is kept (the sample business is seeded beside it without touching it). */
  memoryRoot(): string {
    return this.a.paths.memoryRoot;
  }

  /** Its own folder, beside the default workspace: "<default> (sample)". */
  sampleRoot(): string {
    const d = defaultFilesRoot(this.a.paths.projectRoot);
    return join(dirname(d), `${basename(d)} (sample)`);
  }

  /** The current workspace is the sample business (a marker written when it was seeded); its day, or null. */
  sampleDay(): string | null {
    try {
      const m = JSON.parse(readFileSync(join(this.folders().data, SAMPLE_MARKER), "utf8")) as { today?: string };
      return typeof m.today === "string" ? m.today : null;
    } catch {
      return null;
    }
  }

  /** Marks a seeded folder as the sample business, dated `today` (the day its data is written for). */
  static markSample(filesRoot: string, today: string): void {
    writeFileSync(join(ensureFolders(filesRoot).data, SAMPLE_MARKER), JSON.stringify({ synthetic: true, today }, null, 2) + "\n");
  }

  /** In the sample business the app runs on its day, so its reminders read as intended; elsewhere on the real date. */
  private applySampleClock(): void {
    const day = this.sampleDay();
    if (day) {
      if (!process.env.FX_TODAY) this.sampleClock = true;
      if (this.sampleClock) process.env.FX_TODAY = day;
    } else if (this.sampleClock) {
      delete process.env.FX_TODAY;
      this.sampleClock = false;
    }
  }
  private sampleClock = false;

  /** True when the workspace is the default folder (the user never chose one). */
  workspaceIsDefault(): boolean {
    return !this.a.mem.settings().filesRoot;
  }

  resetFilesRoot(): Folders {
    this.a.mem.updateSettings({ filesRoot: undefined });
    this.applySampleClock();
    return this.folders();
  }

  jobs(): JobSummary[] {
    const f = this.folders();
    const cat = this.a.catalog();
    const jobs = listJobs(f);
    purgeMissingJobs(cat, jobs);
    return jobs.map((j) => {
      const r = cat.latestRubric(j);
      const files = walk(jobDir(f, j)).files;
      const jd = files.find((x) => !x.rel.includes("/") && JD_NAME.test(x.rel))?.rel ?? null;
      const ok = cat.applications(j).filter((a) => a.status === "ok");
      const evaluated = r?.confirmed ? ok.filter((a) => cat.getEvaluation(a.hash, j, r.version)) : [];
      const screened = evaluated.length;
      const decisions = cat.decisions(j);
      const shortlisted = evaluated.filter((a) => decisions.get(a.hash)?.decision === "shortlist").length;
      const undecided = evaluated.filter((a) => !decisions.has(a.hash)).length;
      const applications = files.length - (jd ? 1 : 0);
      const allDecided = screened > 0 && undecided === 0 && evaluated.length === ok.length;
      const { openings, closedAt } = cat.jobSettings(j);
      const hired = this.liveHires(j).size;
      const stage: JobSummary["stage"] = !jd && !r ? "needs-jd" : !r?.confirmed ? "criteria" : hired >= openings ? "filled" : allDecided ? "decided" : screened ? "screened" : "ready";
      return { job: j, files: files.length, criteria: r ? `v${r.version}${r.confirmed ? " confirmed" : " not confirmed"}` : "none", jd, applications, screened, shortlisted, undecided, stage, path: jobDir(f, j), openings, hired, closedAt };
    });
  }

  /** Copies a folder (or file) into Jobs/<job> without overwriting, and catalogues it. */
  importJob(path: string, job: string | null): Promise<{ job: string; summary: IngestSummary }> {
    return importIntoJob(this.folders(), this.a.catalog(), path, job, this.progress);
  }

  /**
   * The deterministic screening flow: ingest, draft criteria from the JD file if needed,
   * ask the user to confirm them, then screen new resumes. Results in chat form; no file.
   */
  async screen(job: string): Promise<ScreenOutcome> {
    if (listJobs(this.folders()).includes(job)) this.assertOpen(job);
    const cat = this.a.catalog();
    const s = await ingestJob(cat, this.folders(), job, this.progress);
    let r = cat.latestRubric(job);
    if (!r || !r.confirmed) {
      if (!r) {
        const jd = await jdFromFolder(this.folders(), job, s.jdFiles);
        if (!jd) return { status: "no-jd", job };
        this.progress(`drafting criteria from ${jd.source}...`);
        r = await proposeCriteria(this.a.engine, cat, job, jd.text);
      }
      const criteria = formatCriteria(r);
      if (!(await this.confirm({ kind: "criteria", title: "Use these criteria for screening?", items: criteria.split("\n") }))) {
        return { status: "not-confirmed", job, criteria };
      }
      cat.confirmRubric(job, r.version);
    }
    const result = await screenJob(this.a.engine, cat, this.folders(), job, { onProgress: this.progress });
    return { status: "done", job, summary: chatSummary(result) };
  }

  /**
   * A new job from a form (a browser UI: bytes, no paths): the JD is saved as
   * "<job> JD.<ext>" so screening finds it, applications go in "applications/".
   * Submitting the form is the owner's OK, so no import question is asked.
   */
  async importJobFiles(job: string, jd: Upload | null, applications: Upload[], opts: { openings?: number } = {}): Promise<{ job: string; summary: IngestSummary; refused: { name: string; reason: string }[] }> {
    const exists = listJobs(this.folders()).includes(job);
    if (exists) this.assertOpen(job);
    const result = await this.importJobFilesInto(job, jd, applications);
    if (!exists && listJobs(this.folders()).includes(result.job)) {
      this.setOpenings(result.job, opts.openings ?? 1);
      this.a.catalog().notify({ ref: { kind: "job", job: result.job }, action: "created", summary: `${result.job} created` });
    }
    return result;
  }

  private async importJobFilesInto(job: string, jd: Upload | null, applications: Upload[]): Promise<{ job: string; summary: IngestSummary; refused: { name: string; reason: string }[] }> {
    const uploads: Upload[] = [
      ...(jd ? [{ name: jd.name, data: jd.data, relPath: `job/${sanitizeStem(job)} JD${extname(jd.name).toLowerCase()}` }] : []),
      ...applications.map((a) => ({ name: a.name, data: a.data, relPath: `job/applications/${a.name}` })),
    ];
    if (!uploads.length) throw new Error("add a job description or at least one application");
    const staged = stageUploads(uploads, MAX_ATTACH_BYTES);
    try {
      const refused = staged.refused.map((r) => ({ name: r.label.replace(/^job\/(applications\/)?/, ""), reason: r.reason }));
      if (!staged.folders.length) return { job, summary: { job, applications: 0, newApplications: 0, unreadable: [], duplicates: [], jdFiles: [], truncated: false }, refused };
      const r = await this.importJob(staged.folders[0].path, job);
      return { ...r, refused };
    } finally {
      rmSync(staged.dir, { recursive: true, force: true });
    }
  }

  /**
   * The current screening state of a job (no new evaluations): the ingest summary, the
   * criteria (null before any are drafted; possibly not confirmed yet), ranked candidates.
   */
  async screenResults(job: string): Promise<JobResults> {
    const cat = this.a.catalog();
    const rubric = cat.latestRubric(job);
    const files = () =>
      cat.applications(job).map((a) => ({
        file: a.sourceRef,
        status: a.status === "unreadable" ? ("unreadable" as const) : a.status === "duplicate" ? ("duplicate" as const) : ("application" as const),
        reason: a.status === "unreadable" ? a.error : a.status === "duplicate" ? `the same file as ${a.duplicateOf}` : null,
      }));
    const { openings, closedAt } = cat.jobSettings(job);
    const hires = () => {
      const fileOf = new Map(cat.applications(job).filter((a) => a.status === "ok").map((a) => [a.hash, a.sourceRef]));
      return [...this.liveHires(job)].flatMap(([hash, h]) => {
        const e = this.a.register().get(h.employeeId);
        const file = fileOf.get(hash);
        return e && file ? [{ file, employeeId: e.id, name: e.name, startDate: e.startDate, hiredAt: h.hiredAt }] : [];
      }).sort((a, b) => a.hiredAt.localeCompare(b.hiredAt));
    };
    if (!rubric || !rubric.confirmed) {
      const ingest = await ingestJob(cat, this.folders(), job, () => {});
      return { job, rubric: rubric ?? null, ingest, evaluatedThisRun: 0, failed: [], remaining: ingest.applications, ranked: [], files: files(), decisions: [], hires: hires(), openings, closedAt };
    }
    const result = await screenJob(this.a.engine, cat, this.folders(), job, { limit: 0 });
    const byFile = new Map(cat.applications(job).map((a) => [a.sourceRef, a.hash]));
    const decided = cat.decisions(job);
    const decisions = result.ranked.flatMap((c) => {
      const d = decided.get(byFile.get(c.file) ?? "");
      return d ? [{ file: c.file, decision: d.decision, decidedAt: d.decidedAt }] : [];
    });
    return { ...result, files: files(), decisions, hires: hires(), openings, closedAt };
  }

  /** Starting points for a new job: the role templates, and the industries that fit the business (src/business/jobTemplates.ts). */
  jobTemplates(): { industries: { id: IndustryId; name: string }[]; templates: JobTemplate[]; suggested: IndustryId[]; business: string | null; location: string | null } {
    const p = this.a.business().get();
    return {
      industries: INDUSTRIES.map((i) => ({ id: i.id, name: i.name })),
      templates: JOB_TEMPLATES,
      suggested: industriesFor(p.industry),
      business: p.tradingName ?? p.legalName,
      location: p.states.length === 1 ? p.states[0] : null,
    };
  }

  /** A new job from the New job form's template: its folder, people to hire, and the job description it built. */
  async createJobFromText(job: string, openings: number, jd: string): Promise<{ job: string }> {
    const r = await createJobWithJd(this.folders(), this.a.catalog(), job, openings, jd);
    return { job: r.job };
  }

  /** Hires whose employee is still in the register (deleting the employee undoes the hire). */
  private liveHires(job: string): Map<string, { employeeId: number; hiredAt: string }> {
    const cat = this.a.catalog();
    const all = cat.hires(job);
    for (const [hash, h] of all) {
      if (!this.a.register().get(h.employeeId)) {
        cat.removeHire(job, hash);
        all.delete(hash);
      }
    }
    return all;
  }

  /** A closed job is read-only: screening, criteria and decisions need it reopened first. */
  private assertOpen(job: string): void {
    if (this.a.catalog().jobSettings(job).closedAt) throw new Error(`"${job}" is closed. Reopen it first.`);
  }

  /** How many people the job is for (1 to 99). */
  setOpenings(job: string, openings: number): void {
    jobDir(this.folders(), job);
    if (!Number.isInteger(openings) || openings < 1 || openings > 99) throw new Error("people to hire must be a whole number from 1 to 99");
    this.a.catalog().setOpenings(job, openings);
  }

  /** Closes a job (everything is kept, read-only) or reopens it. */
  setJobClosed(job: string, closed: boolean): void {
    jobDir(this.folders(), job);
    this.a.catalog().setClosed(job, closed);
  }

  /**
   * A new open job for the same role: a copy of the job description (named "<new job> JD") and
   * of the latest criteria (still confirmed if they were). Applications, decisions and hires
   * are not copied.
   */
  duplicateJob(job: string, name: string, openings: number): { job: string } {
    const f = this.folders();
    const from = jobDir(f, job);
    const to = checkJobId(name);
    if (listJobs(f).some((j) => j.toLowerCase() === to.toLowerCase())) throw new Error(`there is already a job called "${to}"`);
    mkdirSync(join(f.jobs, to));
    const jd = walk(from).files.find((x) => !x.rel.includes("/") && JD_NAME.test(x.rel));
    if (jd) copyFileSync(jd.abs, join(f.jobs, to, `${to} JD${extname(jd.rel).toLowerCase()}`));
    const cat = this.a.catalog();
    const r = cat.latestRubric(job);
    if (r) {
      const copy = cat.saveRubric(to, r.role, r.criteria, r.jdHash);
      if (r.confirmed) cat.confirmRubric(to, copy.version);
    }
    this.setOpenings(to, openings);
    cat.notify({ ref: { kind: "job", job: to }, action: "created", summary: `${to} created (a copy of ${job})` });
    return { job: to };
  }

  /**
   * Records a hire: the screened candidate `file` of `job` became employee `employeeId`
   * (the Staff form opened from the Hiring page). It also shortlists them.
   */
  recordHire(job: string, file: string, employeeId: number): void {
    // The same step as the adviser's add_employee with hiredFrom (src/business/hiring.ts).
    linkHire(this.a.catalog(), this.a.register(), job, file, employeeId);
  }

  /** Every write to the register, jobs, profile and saved files, from a form or the adviser (src/changes.ts). */
  onChange(f: ChangeSink): () => void {
    return this.a.changes.on(f);
  }

  /**
   * The owner's decision on a screened candidate: "shortlist", "not" (Not this time), or null
   * to clear it. Stored with the job's screening data, by file content. Only for candidates
   * screened against the current criteria.
   */
  decide(job: string, file: string, decision: Decision | null): void {
    this.assertOpen(job);
    const cat = this.a.catalog();
    const r = cat.latestRubric(job);
    const app = cat.applications(job).find((a) => a.sourceRef === file && a.status === "ok");
    if (!app || !r?.confirmed || !cat.getEvaluation(app.hash, job, r.version)) throw new Error(`"${file}" isn't a screened application of "${job}"`);
    if (this.liveHires(job).has(app.hash)) throw new Error("this candidate was hired; remove them from Staff to undo the hire");
    cat.setDecision(job, app.hash, decision);
  }

  /** Marks every screened candidate without a decision "Not this time". Returns how many. */
  decideRest(job: string): number {
    this.assertOpen(job);
    const cat = this.a.catalog();
    const r = cat.latestRubric(job);
    if (!r?.confirmed) return 0;
    const decided = cat.decisions(job);
    const rest = cat.applications(job).filter((a) => a.status === "ok" && cat.getEvaluation(a.hash, job, r.version) && !decided.has(a.hash));
    for (const a of rest) cat.setDecision(job, a.hash, "not");
    return rest.length;
  }

  /**
   * Drafts screening criteria from the job's JD (a model call) without asking to confirm them;
   * a UI shows them for the owner's OK (confirmCriteria). Keeps criteria already drafted.
   */
  async draftCriteria(job: string): Promise<{ status: "no-jd" } | { status: "drafted"; rubric: Rubric }> {
    this.assertOpen(job);
    const cat = this.a.catalog();
    const existing = cat.latestRubric(job);
    if (existing) return { status: "drafted", rubric: existing };
    const s = await ingestJob(cat, this.folders(), job, this.progress);
    const jd = await jdFromFolder(this.folders(), job, s.jdFiles);
    if (!jd) return { status: "no-jd" };
    this.progress(`drafting criteria from ${jd.source}...`);
    return { status: "drafted", rubric: await proposeCriteria(this.a.engine, cat, job, jd.text) };
  }

  /** The owner's OK to the job's latest criteria (the screening form's "Yes"). */
  confirmCriteria(job: string, version: number): void {
    this.assertOpen(job);
    const r = this.a.catalog().latestRubric(job);
    if (!r || r.version !== version) throw new Error("these criteria have changed; look at them again");
    this.a.catalog().confirmRubric(job, version);
  }

  /** Saves a screening report from existing results to the Outbox; returns the file paths. */
  async report(job: string, format: "docx" | "xlsx" | "both"): Promise<string[]> {
    const result = await screenJob(this.a.engine, this.a.catalog(), this.folders(), job, { limit: 0 });
    if (!result.ranked.length) throw new Error(`no screening results for "${job}" yet; screen it first`);
    this.progress("writing the report...");
    return (await saveReports(this.a.engine, this.folders(), result, format)).map((f) => join(this.folders().outbox, f));
  }

  // ------------------------------------------------------------------ voice

  voiceActive(): boolean {
    return this.voice !== null;
  }

  microphones(): { devices: string[]; current: string | undefined } {
    const devices = listMicrophones();
    return { devices, current: this.a.mem.settings().micDevice ?? devices[0] };
  }

  // --- the voice API key (Settings): see src/voice/keyStore.ts

  private keyStore(): VoiceKeyStore {
    return new VoiceKeyStore(join(this.a.mem.dir, "voice-key.json"));
  }

  /** VOICE_OPENAI_API_KEY from .env: the developer setup, used when no key is saved. */
  private envVoiceKey(): string | undefined {
    try {
      process.loadEnvFile(join(ROOT, ".env"));
    } catch {
      /* no .env */
    }
    return process.env.VOICE_OPENAI_API_KEY || undefined;
  }

  voiceKeyStatus(): VoiceKeyStatus {
    // The demo engine's voice is a stand-in that needs no key.
    if (this.engineKind === "fake") return { set: true, last4: null, checkedAt: null, source: "demo" };
    return this.keyStore().status(this.envVoiceKey());
  }

  /** Checks the key with OpenAI, then keeps it encrypted on this computer. Errors are for the owner to read; none quotes the key. */
  async setVoiceKey(key: string, check: (key: string) => Promise<"ok" | "rejected" | "unreachable"> = checkWithOpenAI): Promise<{ ok: true; status: VoiceKeyStatus } | { ok: false; error: string }> {
    const k = key.trim();
    const problem = keyFormatProblem(k);
    if (problem) return { ok: false, error: problem };
    const r = await check(k);
    if (r === "rejected") return { ok: false, error: "OpenAI didn't accept this key. Check that you copied all of it and that it hasn't been deleted." };
    if (r === "unreachable") return { ok: false, error: "Couldn't reach OpenAI to check the key. Check the internet connection and try again." };
    await this.keyStore().save(k, now().toISOString());
    return { ok: true, status: this.voiceKeyStatus() };
  }

  removeVoiceKey(): VoiceKeyStatus {
    this.keyStore().remove();
    return this.voiceKeyStatus();
  }

  // --- voice usage (Settings): see src/voice/usage.ts

  private usageLog(): VoiceUsage {
    return new VoiceUsage(join(this.a.mem.dir, "voice-usage.jsonl"));
  }

  /** Today, this month and all time on this computer (estimated US$), and the monthly limit. */
  voiceUsage(): VoiceUsageSummary {
    return this.usageLog().summary(this.a.mem.settings().voiceMonthlyLimitUsd ?? null);
  }

  /** The monthly limit in US$ (null: none). */
  setVoiceLimit(usd: number | null): VoiceUsageSummary {
    if (usd !== null && (!Number.isFinite(usd) || usd <= 0 || usd > 10_000)) throw new Error("the limit must be an amount above 0 (US$), or empty for none");
    this.a.mem.updateSettings({ voiceMonthlyLimitUsd: usd === null ? undefined : Math.round(usd * 100) / 100 });
    return this.voiceUsage();
  }

  // --- what each reply changed and saved, kept per conversation (a resumed or reloaded one shows its cards again)

  private extrasFile(threadId: string): string {
    return join(this.a.mem.dir, "turns", `${threadId.replace(/[^\w-]/g, "")}.json`);
  }

  /** Keeps a change or saved files for the reply to `userText` in the current conversation. */
  noteTurnExtra(userText: string, extra: { change?: EntityChange; files?: string[] }): void {
    const threadId = this.session?.threadId;
    const key = turnKey(userText);
    if (!threadId || !key) return;
    const file = this.extrasFile(threadId);
    let all: Record<string, TurnExtras> = {};
    try {
      all = JSON.parse(readFileSync(file, "utf8")) as Record<string, TurnExtras>;
    } catch {
      /* first one */
    }
    const cur = all[key] ?? { changes: [], files: [] };
    if (extra.change) cur.changes.push(extra.change);
    for (const f of extra.files ?? []) if (!cur.files.includes(f)) cur.files.push(f);
    all[key] = cur;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(all));
  }

  /** The current conversation's kept changes and files, by the owner's message (turnKey). */
  turnExtras(): Record<string, TurnExtras> {
    const threadId = this.session?.threadId;
    if (!threadId) return {};
    try {
      return JSON.parse(readFileSync(this.extrasFile(threadId), "utf8")) as Record<string, TurnExtras>;
    } catch {
      return {};
    }
  }

  // --- the owner's language (Settings): the app and the adviser's replies; documents stay in English

  language(): "en" | "zh" {
    return this.a.mem.settings().language ?? "en";
  }

  setLanguage(lang: "en" | "zh"): "en" | "zh" {
    if (lang === this.language()) return lang;
    this.a.mem.updateSettings({ language: lang === "en" ? undefined : lang });
    // New conversations get it in their instructions; the open one with its next message.
    this.languageNote = this.session !== null;
    return lang;
  }
  private languageNote = false;

  setMicrophone(device: string): void {
    this.a.mem.updateSettings({ micDevice: device });
  }

  /**
   * Starts voice mode (GPT-Live with client delegation to this assistant). `audio`
   * defaults to the local microphone and speaker via ffmpeg/ffplay; a UI can pass its own.
   * Throws with a user-facing reason if voice cannot start.
   */
  /**
   * A short spoken answer to the latest question waiting on screen during voice: "yes" (save) or
   * "no". Never for a destructive one (deleting needs a press). Returns whether it answered one.
   */
  answerSpoken(text: string): boolean {
    if (!this.voice || !this.voiceOnScreen) return false;
    const t = text.trim().toLowerCase().replace(/[.!,]+$/g, "");
    if (!t || t.split(/\s+/).length > 6) return false;
    const yes = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|save it|save|please do|confirm|confirmed|correct|that's right|that's correct)\b/.test(t);
    const no = /^(no|nope|don't|do not|cancel|not now|leave it|don't save)\b/.test(t);
    if (yes === no) return false;
    const open = this.confirms.list().filter((c) => !c.req.destructive);
    const last = open[open.length - 1];
    return last ? this.confirms.answer(last.id, yes) : false;
  }

  async startVoice(h: VoiceHandlers, audio?: VoiceAudio, opts: { confirmOnScreen?: boolean } = {}): Promise<VoiceController> {
    if (this.voice) throw new Error("voice is already on");
    // The demo engine uses a stand-in voice (src/voice/fakeLive.ts): no key, no cost.
    const fake = this.engineKind === "fake";
    const apiKey = fake ? "" : ((await this.keyStore().load()) ?? this.envVoiceKey() ?? "");
    if (!fake && !apiKey) throw new Error("voice needs an OpenAI API key: add it in Settings, or VOICE_OPENAI_API_KEY in .env (see .env.example)");
    // The monthly limit (Settings): no new call once this month's estimate reaches it; a call stops when it does.
    const limit = fake ? null : (this.a.mem.settings().voiceMonthlyLimitUsd ?? null);
    const usedThisMonth = limit === null ? 0 : this.usageLog().monthUsd();
    if (limit !== null && usedThisMonth >= limit) throw new Error(`this month's voice use (about US$${usedThisMonth.toFixed(2)}) has reached your monthly limit of US$${limit.toFixed(2)}. Change the limit in Settings`);
    let device = "custom audio";
    if (!audio) {
      if (!ffmpegAvailable()) throw new Error("voice needs ffmpeg and ffplay on PATH");
      const mic = this.microphones().current;
      if (!mic) throw new Error("no microphone found; /voice device lists devices");
      device = mic;
      audio = { source: new Microphone(mic), sink: new Speaker() };
    }
    const { source, sink } = audio;
    const engine = this.a.engine;
    const live: LiveLike = fake
      ? new FakeLiveSession()
      : new LiveSession({
          apiKey,
          model: process.env.VOICE_MODEL || "gpt-live-1",
          voice: process.env.VOICE_NAME || "gleam",
          instructions: readFileSync(join(ROOT, "prompts/voice.md"), "utf8"),
        });

    let said = "";
    let seconds = 0;
    let stopping = false;
    let lastActivity = Date.now();
    const idleTimer = setInterval(() => {
      if (engine.isBusy()) lastActivity = Date.now();
      else if (Date.now() - lastActivity > VOICE_IDLE_SECONDS * 1000) controller.stop(`no one spoke for ${VOICE_IDLE_SECONDS}s`);
    }, 2000);
    const teardown = () => {
      clearInterval(idleTimer);
      source.stop();
      sink.stop();
      this.voice = null;
      this.voiceHandlers = null;
      this.voiceBridge = null;
      this.voiceOnScreen = false;
    };
    let stopReason = "stopped";

    live.on("audio", (pcm) => sink.play(pcm));
    live.on("usage", (s) => {
      seconds = s;
      if (limit !== null && usedThisMonth + usdFor(s) >= limit) controller.stop(`it reached your monthly voice limit (US$${limit.toFixed(2)})`);
    });
    // Each call's billed seconds are kept for Settings (the demo's stand-in voice costs nothing).
    const record = () => {
      if (!fake) this.usageLog().add(seconds);
    };
    live.on("inputTranscript", () => (lastActivity = Date.now()));
    live.on("outputTranscript", (d) => {
      lastActivity = Date.now();
      said += d.text;
      if (/[.!?。！？]\s*$/.test(said) && !engine.isBusy()) {
        h.onSaid(said.trim());
        said = "";
      }
    });
    live.on("error", (m) => h.onError(m));
    live.once("closed", (reason) => {
      record();
      if (stopping) {
        h.onEnded({ reason: stopReason, byUser: true, billedSeconds: seconds });
      } else {
        teardown();
        h.onEnded({ reason, byUser: false, billedSeconds: seconds });
      }
    });
    this.voiceOnScreen = opts.confirmOnScreen === true;
    this.voiceBridge = new VoiceBridge(live, engine, {
      answer: (text) => this.answerSpoken(text),
      onRequest: (text, mode) => {
        said = "";
        this.recordSession(text);
        h.onRequest(text, mode);
      },
      onEvent: (ev) => {
        h.onEvent(ev);
        if (ev.type === "text_done" && looksLikePayCalculation(ev.text)) h.onEvent({ type: "warning", code: "pay_calculation", message: PAY_GUARD_WARNING });
      },
      onError: (m) => h.onError(m),
    });

    const controller: VoiceController = {
      device,
      stop: (reason?: string) => {
        if (stopping) return;
        stopping = true;
        stopReason = reason ?? "stopped";
        teardown();
        live.close(); // onEnded fires when the session confirms it closed (with the billed seconds)
      },
    };
    this.voiceHandlers = h;
    try {
      await live.start();
    } catch (e) {
      clearInterval(idleTimer);
      this.voiceHandlers = null;
      throw new Error(`could not start voice: ${(e as Error).message}`);
    }
    sink.start();
    source.on("chunk", (c: Buffer) => live.appendAudio(c));
    source.on("error", (m: string) => h.onError(m));
    source.start();
    this.voice = controller;
    return controller;
  }
}
