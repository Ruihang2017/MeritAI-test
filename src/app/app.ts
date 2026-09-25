import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createAssistant, ROOT, type Assistant } from "../assistant";
import type { AccountStatus, Confirm, ConfirmRequest, EngineEvent, SessionInfo } from "../engine/types";
import { userSection } from "../memory/context";
import { summarizeSession } from "../memory/summarize";
import type { Preference, SessionRecord, TaskNote } from "../memory/store";
import { attachToInbox, findDroppedPaths, importIntoJob } from "../files/attach";
import { ensureFolders, jobDir, listJobs, validateFilesRoot, walk, type Folders } from "../files/folders";
import { listInbox, type InboxEntry } from "../files/tools";
import { profileLines, type BusinessProfile } from "../business/profile";
import { listPolicies, type PolicyEntry } from "../business/policies";
import type { Employee } from "../business/register";
import { remindersFor, type Reminder } from "../business/reminders";
import { looksLikePayCalculation, PAY_GUARD_WARNING } from "../business/payGuard";
import { formatCriteria, ingestJob, jdFromFolder, proposeCriteria, purgeMissingJobs, screenJob, type IngestSummary, type Progress } from "../screening/pipeline";
import { chatSummary, saveReports } from "../screening/report";
import { LiveSession } from "../voice/liveSession";
import { VoiceBridge } from "../voice/bridge";
import { Microphone, Speaker, ffmpegAvailable, listMicrophones } from "../voice/audio";

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
export type AppEvent = EngineEvent | { type: "warning"; code: "pay_calculation"; message: string };

export type AttachOutcome =
  | { path: string; kind: "attached"; name: string; reused: boolean; image: boolean }
  | { path: string; kind: "imported"; job: string; summary: IngestSummary }
  | { path: string; kind: "not-imported" }
  | { path: string; kind: "refused"; reason: string }
  | { path: string; kind: "error"; message: string };

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

export class AssistantApp {
  readonly userId: string;
  private readonly a: Assistant;
  private session: SessionInfo | null = null;
  /** The current conversation is in the user's history once it has a message. */
  private recorded = false;
  private pending: { notes: string[]; images: string[] } = { notes: [], images: [] };
  private voice: VoiceController | null = null;
  private voiceHandlers: VoiceHandlers | null = null;

  constructor(opts: {
    userId: string;
    ui: AppUI;
    serviceTier?: string;
    codexBasePrompt?: boolean;
    /** Defaults to <repo>/memory. */
    memoryRoot?: string;
    /** Business workspace chosen by the host application (not validated like /files set). */
    filesRoot?: string;
    clientVersion?: string;
  }) {
    this.userId = opts.userId;
    const confirm: Confirm = async (req) => {
      // A yes/no needs a keyboard or a click; during voice mode it is declined and reported.
      if (this.voice) {
        this.voiceHandlers?.onConfirmSkipped(req);
        return false;
      }
      return opts.ui.confirm(req);
    };
    this.confirm = confirm;
    this.a = createAssistant({
      userId: opts.userId,
      confirm,
      serviceTier: opts.serviceTier,
      codexBasePrompt: opts.codexBasePrompt,
      memoryRoot: opts.memoryRoot,
      clientVersion: opts.clientVersion,
      onLog: opts.ui.log,
      onProgress: opts.ui.progress,
    });
    this.progress = opts.ui.progress ?? (() => {});
    if (opts.filesRoot) this.a.mem.updateSettings({ filesRoot: opts.filesRoot });
  }

  private readonly confirm: Confirm;
  private readonly progress: Progress;

  // ------------------------------------------------------------------ account and session

  async start(): Promise<AccountStatus> {
    await this.a.engine.start();
    return this.a.engine.account();
  }

  login(onPrompt: (message: string) => void): Promise<void> {
    return this.a.engine.login(onPrompt);
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

  /** Saves notes from the current conversation, then starts a new one. */
  async newConversation(): Promise<TaskNote[] | null> {
    const notes = await this.saveNotes();
    this.session = await this.a.engine.newSession();
    this.recorded = false;
    return notes;
  }

  /** This user's earlier conversations that are still stored (newest first, at most 15). */
  async history(): Promise<SessionRecord[]> {
    const stored = new Set((await this.a.engine.listStoredSessions()).map((s) => s.threadId));
    return this.a.mem.sessions().filter((s) => stored.has(s.threadId)).slice(0, 15);
  }

  /** Continues an earlier conversation with this user's current memory. */
  async resume(record: SessionRecord): Promise<{ notes: TaskNote[] | null; alreadyOpen: boolean }> {
    if (record.threadId === this.session?.threadId) return { notes: null, alreadyOpen: true };
    const notes = await this.saveNotes();
    // The stored thread keeps its original instructions; send the current memory with the next message.
    const update = `<memory_update>\nThis conversation is being resumed. Current memory (overrides anything older in this conversation):\n\n${userSection(this.a.mem)}\n</memory_update>`;
    this.session = await this.a.engine.resumeSession(record.threadId, update);
    this.recorded = true;
    return { notes, alreadyOpen: false };
  }

  /** Saves notes and shuts the engine down. */
  async close(): Promise<TaskNote[] | null> {
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
    for (const s of old) await this.a.engine.deleteStoredSession(s.threadId);
    this.a.mem.dropSessions(new Set(old.map((s) => s.threadId)));
    return old.length;
  }

  // ------------------------------------------------------------------ conversation

  isBusy(): boolean {
    return this.a.engine.isBusy();
  }

  /** Stops the reply in progress. */
  stop(): Promise<void> {
    return this.a.engine.interrupt();
  }

  /**
   * One assistant turn. Pending attachments go with it. `title` is what the user
   * typed (used for the history), when it differs from `text`.
   */
  async *send(text: string, opts: { skill?: string; title?: string } = {}): AsyncIterable<AppEvent> {
    this.recordSession(opts.title ?? text);
    const message = [...this.pending.notes, text].filter(Boolean).join(" ");
    const images = this.pending.images;
    this.pending = { notes: [], images: [] };
    yield* this.withGuards(this.a.engine.send(message, { skill: opts.skill, images }));
  }

  /** Adds app-level checks to a turn's events (the pay calculation backstop). */
  private async *withGuards(events: AsyncIterable<EngineEvent>): AsyncIterable<AppEvent> {
    for await (const ev of events) {
      yield ev;
      if (ev.type === "text_done" && looksLikePayCalculation(ev.text)) yield { type: "warning", code: "pay_calculation", message: PAY_GUARD_WARNING };
    }
  }

  private recordSession(title: string): void {
    if (this.recorded || !this.session) return;
    this.a.mem.recordSession({ threadId: this.session.threadId, title: title.slice(0, 60), startedAt: new Date().toISOString() });
    this.recorded = true;
  }

  /** The business setup interview (a skill-driven turn). */
  setup(): AsyncIterable<AppEvent> {
    return this.send(SETUP_PROMPT, { skill: "business-setup", title: "/setup" });
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
  hasPendingAttachments(): boolean {
    return this.pending.notes.length > 0;
  }

  /**
   * Attaches dropped files (copied into the Inbox, never overwriting) and offers to
   * import dropped folders as jobs. They go with the next message.
   */
  async attach(paths: string[]): Promise<AttachOutcome[]> {
    const out: AttachOutcome[] = [];
    const forbidden = [this.a.paths.codexHome, this.a.paths.memoryRoot, join(this.a.paths.projectRoot, "src")];
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

  profile(): { exists: boolean; profile: BusinessProfile; lines: string[]; path: string; policiesDir: string; policies: PolicyEntry[] } {
    const b = this.a.business();
    const p = b.get();
    return { exists: b.exists(), profile: p, lines: profileLines(p), path: b.path, policiesDir: this.folders().policies, policies: listPolicies(this.folders()) };
  }

  staff(includeLeft = false): Employee[] {
    return this.a.register().list({ includeLeft });
  }

  reminders(): Reminder[] {
    return remindersFor(this.a.register(), this.a.business());
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

  /** Moves this user's business workspace (validated: no system or assistant folders). */
  setFilesRoot(path: string): Folders {
    const root = validateFilesRoot(path, this.a.paths);
    ensureFolders(root);
    this.a.mem.updateSettings({ filesRoot: root });
    return this.folders();
  }

  resetFilesRoot(): Folders {
    this.a.mem.updateSettings({ filesRoot: undefined });
    return this.folders();
  }

  jobs(): { job: string; files: number; criteria: string }[] {
    const f = this.folders();
    const jobs = listJobs(f);
    purgeMissingJobs(this.a.catalog(), jobs);
    return jobs.map((j) => {
      const r = this.a.catalog().latestRubric(j);
      return { job: j, files: walk(jobDir(f, j)).files.length, criteria: r ? `v${r.version}${r.confirmed ? " confirmed" : " not confirmed"}` : "none" };
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

  setMicrophone(device: string): void {
    this.a.mem.updateSettings({ micDevice: device });
  }

  /**
   * Starts voice mode (GPT-Live with client delegation to this assistant). `audio`
   * defaults to the local microphone and speaker via ffmpeg/ffplay; a UI can pass its own.
   * Throws with a user-facing reason if voice cannot start.
   */
  async startVoice(h: VoiceHandlers, audio?: VoiceAudio): Promise<VoiceController> {
    if (this.voice) throw new Error("voice is already on");
    try {
      process.loadEnvFile(join(ROOT, ".env"));
    } catch {
      /* no .env: checked below */
    }
    const apiKey = process.env.VOICE_OPENAI_API_KEY;
    if (!apiKey) throw new Error("voice needs VOICE_OPENAI_API_KEY in .env (see .env.example)");
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
    const live = new LiveSession({
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
    };
    let stopReason = "stopped";

    live.on("audio", (pcm) => sink.play(pcm));
    live.on("usage", (s) => (seconds = s));
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
      if (stopping) {
        h.onEnded({ reason: stopReason, byUser: true, billedSeconds: seconds });
      } else {
        teardown();
        h.onEnded({ reason, byUser: false, billedSeconds: seconds });
      }
    });
    new VoiceBridge(live, engine, {
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
