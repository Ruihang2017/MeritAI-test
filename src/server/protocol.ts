/**
 * The messages between the browser UI (web/) and the local server (src/server/).
 * One WebSocket; the UI sends requests and the server answers them, and the
 * server pushes events (reply streaming, confirmation questions, progress).
 * Type-only: the web app imports these types, never server code.
 */
import type { AppEvent, AttachOutcome, ChecklistItem, FormNote, FormResult, LeavingItem, LeavingReason, JobResults, ScreenOutcome, StaffOverviewRow } from "../app/app";
import type { IngestSummary } from "../screening/pipeline";
import type { DocumentId, Employee } from "../business/register";
import type { ConfirmRequest } from "../engine/types";
import type { Reminder } from "../business/reminders";
import type { Preference, SessionRecord, TaskNote } from "../memory/store";
import type { BusinessProfile } from "../business/profile";

/** Everything the UI can call. Anything else is refused by the server. */
export interface Methods {
  /** Snapshot for the shell (app bar, nav, first run). */
  state: { params: void; result: ShellState };
  /** Starts a reply; its events arrive as `turn` events with the turnId the UI chose (so no event can arrive before the UI knows the id). One at a time. */
  send: { params: { text: string; skill?: string; turnId: string; mode?: "setup" }; result: { turnId: string } };
  /** Stops the running reply (also withdraws open questions). */
  stop: { params: void; result: null };
  answerConfirm: { params: { id: string; yes: boolean }; result: { ok: boolean } };
  newConversation: { params: void; result: null };
  history: { params: void; result: SessionRecord[] };
  resume: { params: { threadId: string }; result: { alreadyOpen: boolean } };
  /** Messages of the current conversation from its start (after a resume or a page reload). */
  transcript: { params: void; result: { role: "user" | "assistant"; text: string }[] };
  reminders: { params: void; result: Reminder[] };
  skills: { params: void; result: { name: string; description: string }[] };
  /** Files chosen or dropped in the browser (base64), copied to the Inbox or offered as a job import. */
  attach: { params: { files: (UploadFile & { relPath?: string })[] }; result: AttachOutcome[] };
  // ---- staff (M2): the register forms; submitting is the confirmation, delete asks again (destructive)
  staff: { params: { includeLeft: boolean }; result: StaffRow[] };
  addEmployee: { params: { details: EmployeeFields; mayNeedVisaCheck: boolean; apprentice: boolean; constructionSite: boolean }; result: FormResult<{ employee: Employee; checklist: ChecklistItem[] }> };
  updateEmployee: { params: { id: number; changes: Partial<EmployeeFields> }; result: FormResult<{ employee: Employee; notes: FormNote[] }> };
  recordDocuments: { params: { id: number; documents: DocumentId[]; date: string }; result: FormResult<{ employee: Employee }> };
  markLeft: { params: { id: number; leftDate: string; reason: LeavingReason }; result: FormResult<{ employee: Employee; checklist: LeavingItem[] }> };
  removeEmployee: { params: { id: number }; result: FormResult<{ removed: boolean }> };
  // ---- hiring (M3): screening runs in the app; criteria are confirmed through a `confirm` dialog; progress arrives as events
  jobs: { params: void; result: { job: string; files: number; criteria: string }[] };
  createJob: { params: { job: string; jd: UploadFile | null; applications: UploadFile[] }; result: { job: string; summary: IngestSummary; refused: { name: string; reason: string }[] } };
  screen: { params: { job: string }; result: ScreenOutcome };
  screenResults: { params: { job: string }; result: JobResults };
  report: { params: { job: string; format: "docx" | "xlsx" | "both" }; result: string[] };
  // ---- files, profile, memory, settings (M3/M4)
  files: { params: void; result: WorkspaceFiles };
  profile: { params: void; result: { exists: boolean; profile: BusinessProfile; smallBusiness: boolean | null; policies: { id: string; title: string; description: string }[] } };
  updateProfile: { params: { changes: Partial<BusinessProfile> }; result: FormResult<{ profile: BusinessProfile }> };
  memories: { params: void; result: { preferences: Preference[]; notes: TaskNote[] } };
  forget: { params: { id: string }; result: { forgotten: boolean } };
  settings: { params: void; result: Settings };
  setTier: { params: { tier: "fast" | "standard" }; result: Settings };
  setWorkspace: { params: { path: string | null }; result: Settings };
  /** Starts the ChatGPT sign-in; the code arrives as a `login` event, the result when it finishes. */
  login: { params: void; result: { ok: boolean; error?: string } };
  openFile: { params: { path: string }; result: { ok: true } | { ok: false; error: string } };
  revealFile: { params: { path: string }; result: { ok: true } | { ok: false; error: string } };
}
export type Method = keyof Methods;

export interface ShellState {
  account: { loggedIn: boolean; description: string };
  engine: "codex" | "fake";
  business: { name: string; needsSetup: boolean };
  /** The workspace folder name (full path in `workspacePath`). */
  workspace: string;
  workspacePath: string;
  busy: boolean;
  tier: string | null;
  hasConversation: boolean;
  /** The current conversation's title, when it has one. */
  title: string | null;
  /** Overdue and this-week counts for the Attention button and badges. */
  attention: { overdue: number; soon: number };
  /** Set when the last reply hit the ChatGPT plan usage limit (cleared by the next reply that works). */
  usageLimit: { resetAt: string | null } | null;
  /** Open questions (after a reconnect the UI shows them again). */
  confirms: { id: string; req: ConfirmRequest }[];
}

/** A file sent from the browser (base64). */
export interface UploadFile {
  name: string;
  base64: string;
}

export interface FileRow {
  name: string;
  path: string;
  size: number;
  modified: string;
  readable: boolean;
}

export interface WorkspaceFiles {
  root: string;
  inbox: FileRow[];
  outbox: FileRow[];
  policies: (FileRow & { title: string; description: string })[];
  jobs: { job: string; files: number; criteria: string; path: string }[];
}

export interface Settings {
  account: { loggedIn: boolean; description: string };
  engine: "codex" | "fake";
  model: string | null;
  tier: "fast" | "standard";
  workspace: string;
  /** True when the workspace is the default folder (not one the user chose). */
  workspaceIsDefault: boolean;
}

/** The work details a form can set (the register refuses personal data such as TFN or date of birth). */
export interface EmployeeFields {
  name: string;
  role: string;
  employmentType: "full-time" | "part-time" | "casual" | "fixed-term";
  startDate: string;
  endDate?: string | null;
  award?: string | null;
  classification?: string | null;
  probationEnd?: string | null;
  visaExpiry?: string | null;
  notes?: string | null;
}

/** An employee with what the Staff page shows next to them (worked out in the app layer). */
export type StaffRow = StaffOverviewRow;

export type ClientMessage ={ [M in Method]: { id: number; method: M; params: Methods[M]["params"] } }[Method];

export type ServerEvent =
  | { event: "turn"; turnId: string; ev: AppEvent }
  /** The reply ended (after its turn_end), or failed before it started. */
  | { event: "turnDone"; turnId: string; error?: string }
  | { event: "confirm"; id: string; req: ConfirmRequest }
  | { event: "confirmWithdrawn"; id: string }
  | { event: "progress"; message: string }
  /** Sign-in: open `url` and enter `code` (parsed from the engine prompt; `message` is the full text). */
  | { event: "login"; url: string | null; code: string | null; message: string };

export type ServerMessage = { id: number; result: unknown } | { id: number; error: string } | ServerEvent;
