/**
 * The messages between the browser UI (web/) and the local server (src/server/).
 * One WebSocket; the UI sends requests and the server answers them, and the
 * server pushes events (reply streaming, confirmation questions, progress).
 * Type-only: the web app imports these types, never server code.
 */
import type { AppEvent, AttachOutcome, ChecklistItem, FormNote, FormResult, LeavingItem, LeavingReason, JobResults, JobSummary, ScreenOutcome, StaffOverviewRow } from "../app/app";
import type { IngestSummary } from "../screening/pipeline";
import type { Rubric } from "../screening/catalog";
import type { DocumentId, Employee } from "../business/register";
import type { ConfirmRequest } from "../engine/types";
import type { Reminder } from "../business/reminders";
import type { Preference, SessionFrom, SessionRecord, TaskNote } from "../memory/store";
import type { BusinessProfile } from "../business/profile";
import type { VoiceKeyStatus } from "../voice/keyStore";
import type { EntityChange } from "../changes";
import type { VoiceUsageSummary } from "../voice/usage";

/** Everything the UI can call. Anything else is refused by the server. */
export interface Methods {
  /** Snapshot for the shell (app bar, nav, first run). */
  state: { params: void; result: ShellState };
  /** Starts a reply; its events arrive as `turn` events with the turnId the UI chose (so no event can arrive before the UI knows the id). One at a time. */
  send: { params: { text: string; skill?: string; turnId: string; mode?: "setup"; from?: SessionFrom }; result: { turnId: string } };
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
  /** Takes a file back off the next message (it stays in the Inbox). */
  detach: { params: { name: string }; result: { detached: boolean } };
  // ---- staff (M2): the register forms; submitting is the confirmation, delete asks again (destructive)
  staff: { params: { includeLeft: boolean }; result: StaffRow[] };
  addEmployee: { params: { details: EmployeeFields; mayNeedVisaCheck: boolean; apprentice: boolean; constructionSite: boolean; hireFrom?: { job: string; file: string } }; result: FormResult<{ employee: Employee; checklist: ChecklistItem[] }> };
  updateEmployee: { params: { id: number; changes: Partial<EmployeeFields> }; result: FormResult<{ employee: Employee; notes: FormNote[] }> };
  recordDocuments: { params: { id: number; documents: DocumentId[]; date: string }; result: FormResult<{ employee: Employee }> };
  markLeft: { params: { id: number; leftDate: string; reason: LeavingReason }; result: FormResult<{ employee: Employee; checklist: LeavingItem[] }> };
  removeEmployee: { params: { id: number }; result: FormResult<{ removed: boolean }> };
  // ---- hiring (M3): screening runs in the app; criteria are confirmed through a `confirm` dialog; progress arrives as events
  jobs: { params: void; result: JobSummary[] };
  /** Drafts criteria from the job's JD (a model call); the page then asks the owner to confirm them. */
  draftCriteria: { params: { job: string }; result: { status: "no-jd" } | { status: "drafted"; rubric: Rubric } };
  confirmCriteria: { params: { job: string; version: number }; result: { ok: true } };
  /** The owner's decision on a screened candidate (null clears it). */
  decide: { params: { job: string; file: string; decision: "shortlist" | "not" | null }; result: { ok: true } };
  /** Every screened candidate without a decision → Not this time. */
  decideRest: { params: { job: string }; result: { marked: number } };
  /** How many people the job is for (1 to 99). */
  setOpenings: { params: { job: string; openings: number }; result: { ok: true } };
  /** A closed job keeps everything, read-only, until reopened. */
  closeJob: { params: { job: string }; result: { ok: true } };
  reopenJob: { params: { job: string }; result: { ok: true } };
  /** A new open job with a copy of the JD and the criteria (no applications, decisions or hires). */
  duplicateJob: { params: { job: string; name: string; openings: number }; result: { job: string } };
  createJob: { params: { job: string; jd: UploadFile | null; applications: UploadFile[]; openings?: number }; result: { job: string; summary: IngestSummary; refused: { name: string; reason: string }[] } };
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
  /** The voice API key: only whether one is kept and its last 4 characters; the key itself never comes back. */
  voiceKey: { params: void; result: VoiceKeyStatus };
  /** Checks the key with OpenAI and keeps it encrypted on this computer. */
  setVoiceKey: { params: { key: string }; result: { ok: true; status: VoiceKeyStatus } | { ok: false; error: string } };
  removeVoiceKey: { params: void; result: VoiceKeyStatus };
  /** Voice in the browser: the page sends its microphone (PCM16 mono 24 kHz, base64, about 100 ms a message) and plays the `voiceAudio` events. Only the page that started it. */
  /** Testers' feedback: "Was this helpful?" on a reply (kept on this computer), and "Send feedback" (a file in the workspace's Feedback folder). */
  rateReply: { params: { rating: "up" | "down"; reasons: string[]; note: string; question: string; answer: string }; result: null };
  feedbackSummary: { params: void; result: { up: number; down: number } };
  exportFeedback: { params: { note: string; ratings: boolean; conversation: boolean; technical: boolean }; result: { path: string } };
  /** First run: the sample business (synthetic Wattle Lane Cleaning) in its own folder, seeded once, as the workspace. */
  useSampleBusiness: { params: void; result: Settings };
  /** Voice use on this computer (estimated US$: today, this month, all time) and the monthly limit. */
  voiceUsage: { params: void; result: VoiceUsageSummary };
  setVoiceLimit: { params: { usd: number | null }; result: VoiceUsageSummary };
  voiceStart: { params: void; result: { started: true } };
  voiceAudio: { params: { pcm: string }; result: null };
  voiceStop: { params: void; result: null };
  /** Starts the ChatGPT sign-in; the code arrives as a `login` event, the result when it finishes. */
  login: { params: void; result: { ok: boolean; error?: string } };
  openFile: { params: { path: string }; result: { ok: true } | { ok: false; error: string } };
  revealFile: { params: { path: string }; result: { ok: true } | { ok: false; error: string } };
  /** Connections that are coming (Connections page): which ones the owner wants, kept for the feedback file. */
  connections: { params: void; result: { wanted: string[] } };
  wantConnection: { params: { name: string; want: boolean }; result: { wanted: string[] } };
  /** An email draft (.eml) the adviser saved: what the chat's email card shows. */
  emailDraft: { params: { path: string }; result: { ok: true; to: string[]; cc: string[]; subject: string; attachments: string[]; preview: string } | { ok: false; error: string } };
}
export type Method = keyof Methods;

export interface ShellState {
  account: { loggedIn: boolean; description: string };
  engine: "codex" | "fake";
  /** The demo workspace with the design's sample data (the app bar shows "Sample data"). */
  sampleData: boolean;
  /** The sample business chosen at first run (not the demo mode): the owner can switch to their own business. */
  sampleSwitch: boolean;
  /** The app's today (YYYY-MM-DD): the demo runs on the design's date, so the UI's "Today" follows it. */
  today: string;
  /** When the reminder rules were last checked against the official pages (YYYY-MM-DD). */
  rulesChecked: string;
  business: { name: string; needsSetup: boolean };
  /** The workspace folder name (full path in `workspacePath`). */
  workspace: string;
  workspacePath: string;
  busy: boolean;
  /** The reply running now (after a page reload the UI follows it again). */
  turnId: string | null;
  /** Another operation running now (screening, an import, ...), as words. */
  operation: string | null;
  tier: string | null;
  hasConversation: boolean;
  /** The current conversation's title, when it has one. */
  title: string | null;
  /** The current conversation's thread, and the page it was started from (the side panel's "From …"). */
  threadId: string | null;
  from: SessionFrom | null;
  /** Voice needs an OpenAI API key (Settings); without one the microphone is off. */
  voice: { keySet: boolean; on: boolean };
  /** Overdue and this-week counts for the Attention button and badges. */
  attention: { overdue: number; soon: number };
  /** Set when the last reply hit the ChatGPT plan usage limit (cleared by the next reply that works). */
  usageLimit: { resetAt: string | null } | null;
  /** Files attached for the next message. */
  attachments: string[];
  /** Links to these sites (and their subdomains) are shown as official sources; other links are not clickable. */
  officialDomains: string[];
  /** Open questions (after a reconnect the UI shows them again); turnId null = not part of a reply (a dialog). */
  confirms: { id: string; req: ConfirmRequest; turnId: string | null }[];
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
  outbox: (FileRow & { draft: boolean })[];
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
  | { event: "confirm"; id: string; req: ConfirmRequest; turnId: string | null }
  /** Answered (in any tab): other tabs close it. */
  | { event: "confirmAnswered"; id: string; yes: boolean }
  | { event: "confirmWithdrawn"; id: string }
  | { event: "progress"; message: string }
  /**
   * Something in the business's data changed (src/changes.ts): by the adviser (in the reply `turnId`,
   * or voice) or by the owner with a form. Pages showing it refresh; the adviser's changes are marked.
   */
  | { event: "changed"; change: EntityChange; by: "adviser" | "you"; turnId: string | null }
  /** Sign-in: open `url` and enter `code` (parsed from the engine prompt; `message` is the full text). */
  | { event: "login"; url: string | null; code: string | null; message: string }
  | VoiceEvent
  /** Voice audio to play, only to the page that started voice (PCM16 mono 24 kHz, base64). */
  | { event: "voiceAudio"; pcm: string };

/** Voice in the browser (the startVoice handlers). A spoken request's reply arrives as `turn` events with its turnId. */
export type VoiceEvent =
  | { event: "voice"; kind: "request"; text: string; mode: "new" | "steer"; turnId: string }
  | { event: "voice"; kind: "said"; text: string }
  | { event: "voice"; kind: "skipped"; req: ConfirmRequest; turnId: string | null }
  | { event: "voice"; kind: "error"; message: string }
  | { event: "voice"; kind: "ended"; reason: string; byUser: boolean; billedSeconds: number };

export type ServerMessage = { id: number; result: unknown } | { id: number; error: string } | ServerEvent;
