import { readFileSync, rmSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createAssistant, ROOT, type Assistant } from "../assistant";
import type { ReplyFormat } from "../basePrompt";
import { PendingConfirms } from "./confirms";
import { launchCommand, openablePath, spawnLauncher, type Launcher, type OpenResult } from "./launch";
import { stageUploads, type Upload } from "./uploads";
export type { Upload } from "./uploads";
export type { Launcher, OpenResult } from "./launch";
export type { ReplyFormat } from "../basePrompt";
import type { AccountStatus, Confirm, ConfirmRequest, EngineEvent, SessionInfo, TranscriptEntry } from "../engine/types";
import { userSection } from "../memory/context";
import { summarizeSession } from "../memory/summarize";
import type { Preference, SessionRecord, TaskNote } from "../memory/store";
import { attachToInbox, findDroppedPaths, importIntoJob, MAX_ATTACH_BYTES } from "../files/attach";
import { ensureFolders, jobDir, listJobs, validateFilesRoot, walk, type Folders } from "../files/folders";
import { listFolder, listInbox, type FolderEntry, type InboxEntry } from "../files/tools";
import { profileLines, type BusinessProfile } from "../business/profile";
import { listPolicies, type PolicyEntry } from "../business/policies";
import type { DocumentId, Employee } from "../business/register";
import { checkDocuments, checkEmployeeChanges, checkNewEmployee, fixedTermEndChanged, FIXED_TERM_OWNER_NOTE, type FormNote } from "../business/registerOps";
import { checkProfilePatch } from "../business/tools";
import { newStarterChecklist, type ChecklistItem, type EmploymentType } from "../business/onboarding";
import { isApprenticeRole, leavingChecklist, LEAVING_REASONS, smallBusinessOf, type LeavingItem, type LeavingReason } from "../business/leaving";
import { remindersFor, type Reminder } from "../business/reminders";
import { looksLikePayCalculation, PAY_GUARD_WARNING } from "../business/payGuard";
import { formatCriteria, ingestJob, jdFromFolder, proposeCriteria, purgeMissingJobs, screenJob, type IngestSummary, type Progress, type ScreenResult } from "../screening/pipeline";
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

/** A job's screening state for a UI: like ScreenResult, but the criteria may not exist yet. */
export type JobResults = Omit<ScreenResult, "rubric"> & { rubric: ScreenResult["rubric"] | null };

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
      // A yes/no needs a keyboard or a click; during voice mode it is declined and reported.
      if (this.voice) {
        this.voiceHandlers?.onConfirmSkipped(req);
        return false;
      }
      // Tracked, so stop(), close() and cancelPendingConfirms() can withdraw it.
      return this.confirms.ask(opts.ui.confirm, req);
    };
    this.confirm = confirm;
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
    if (opts.filesRoot) this.a.mem.updateSettings({ filesRoot: opts.filesRoot });
  }

  private readonly confirm: Confirm;
  private readonly progress: Progress;
  private readonly launcher: Launcher;

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

  /** The messages of the current conversation from its start (also after a resume), for a UI to show. No model call. */
  async conversation(): Promise<TranscriptEntry[]> {
    return this.session ? this.a.engine.readTranscript(this.session.threadId) : [];
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
    for (const s of old) await this.a.engine.deleteStoredSession(s.threadId);
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

  // ------------------------------------------------------------------ forms
  // Direct edits from a UI form. They use the same validation as the chat tools
  // (PII refusal, dates, duplicates); submitting the form is the owner's
  // confirmation, so there is no second yes/no, except for deleting.

  /** Adds an employee; returns the new starter checklist for them (from code, with official sources). */
  addEmployee(details: unknown, opts: { mayNeedVisaCheck?: boolean; apprentice?: boolean; constructionSite?: boolean } = {}): FormResult<{ employee: Employee; checklist: ChecklistItem[] }> {
    const c = checkNewEmployee(this.a.register(), details);
    if (!c.ok) return { ok: false, error: c.error };
    const employee = this.a.register().add(c.input);
    const p = this.a.business().get();
    const checklist = newStarterChecklist({
      employmentType: employee.employmentType as EmploymentType,
      // Unknown unless the form says otherwise: the visa check stays on the list.
      mayNeedVisaCheck: opts.mayNeedVisaCheck ?? true,
      smallBusiness: p.headcount === null ? null : p.headcount < 15,
      apprentice: opts.apprentice ?? isApprenticeRole(employee.role),
      constructionSite: opts.constructionSite ?? false,
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

  /** Everything a Files page lists: Inbox, Outbox, Policies (with titles) and jobs. */
  workspaceFiles(): {
    root: string;
    inbox: FolderEntry[];
    outbox: FolderEntry[];
    policies: (FolderEntry & { title: string; description: string })[];
    jobs: { job: string; files: number; criteria: string; path: string }[];
  } {
    const f = this.folders();
    const meta = new Map(listPolicies(f).map((p) => [p.id, p]));
    const policies = listFolder(f.policies).map((e) => ({ ...e, title: meta.get(e.name)?.title ?? e.name, description: meta.get(e.name)?.description ?? "" }));
    return { root: f.root, inbox: listFolder(f.inbox), outbox: listFolder(f.outbox), policies, jobs: this.jobs().map((j) => ({ ...j, path: jobDir(f, j.job) })) };
  }

  /** Opens a workspace file (or folder) with the system's default app, e.g. a saved report. */
  openFile(path: string): Promise<OpenResult> {
    return this.launch("open", path);
  }

  /** Shows a workspace file in the file manager (Explorer / Finder; the folder on Linux). */
  revealFile(path: string): Promise<OpenResult> {
    return this.launch("reveal", path);
  }

  private async launch(action: "open" | "reveal", path: string): Promise<OpenResult> {
    const p = openablePath(this.folders(), path);
    if (!p.ok) return p;
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
    return this.folders();
  }

  /** True when the workspace is the default folder (the user never chose one). */
  workspaceIsDefault(): boolean {
    return !this.a.mem.settings().filesRoot;
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

  /**
   * A new job from a form (a browser UI: bytes, no paths): the JD is saved as
   * "Job description.<ext>" so screening finds it, applications go in "applications/".
   * Submitting the form is the owner's OK, so no import question is asked.
   */
  async importJobFiles(job: string, jd: Upload | null, applications: Upload[]): Promise<{ job: string; summary: IngestSummary; refused: { name: string; reason: string }[] }> {
    const uploads: Upload[] = [
      ...(jd ? [{ name: jd.name, data: jd.data, relPath: `job/Job description${extname(jd.name).toLowerCase()}` }] : []),
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
    if (!rubric || !rubric.confirmed) {
      const ingest = await ingestJob(cat, this.folders(), job, () => {});
      return { job, rubric: rubric ?? null, ingest, evaluatedThisRun: 0, failed: [], remaining: ingest.applications, ranked: [] };
    }
    return screenJob(this.a.engine, cat, this.folders(), job, { limit: 0 });
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
