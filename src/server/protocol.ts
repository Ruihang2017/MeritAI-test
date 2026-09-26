/**
 * The messages between the browser UI (web/) and the local server (src/server/).
 * One WebSocket; the UI sends requests and the server answers them, and the
 * server pushes events (reply streaming, confirmation questions, progress).
 * Type-only: the web app imports these types, never server code.
 */
import type { AppEvent, AttachOutcome, ChecklistItem, FormNote, FormResult, LeavingItem, LeavingReason } from "../app/app";
import type { DocumentId, Employee } from "../business/register";
import type { ConfirmRequest } from "../engine/types";
import type { Reminder } from "../business/reminders";
import type { SessionRecord } from "../memory/store";

/** Everything the UI can call. Anything else is refused by the server. */
export interface Methods {
  /** Snapshot for the shell (app bar, nav, first run). */
  state: { params: void; result: ShellState };
  /** Starts a reply; its events arrive as `turn` events with the turnId the UI chose (so no event can arrive before the UI knows the id). One at a time. */
  send: { params: { text: string; skill?: string; turnId: string }; result: { turnId: string } };
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
  attach: { params: { files: { name: string; base64: string; relPath?: string }[] }; result: AttachOutcome[] };
  // ---- staff (M2): the register forms; submitting is the confirmation, delete asks again (destructive)
  staff: { params: { includeLeft: boolean }; result: StaffRow[] };
  addEmployee: { params: { details: EmployeeFields; mayNeedVisaCheck: boolean; apprentice: boolean; constructionSite: boolean }; result: FormResult<{ employee: Employee; checklist: ChecklistItem[] }> };
  updateEmployee: { params: { id: number; changes: Partial<EmployeeFields> }; result: FormResult<{ employee: Employee; notes: FormNote[] }> };
  recordDocuments: { params: { id: number; documents: DocumentId[]; date: string }; result: FormResult<{ employee: Employee }> };
  markLeft: { params: { id: number; leftDate: string; reason: LeavingReason }; result: FormResult<{ employee: Employee; checklist: LeavingItem[] }> };
  removeEmployee: { params: { id: number }; result: FormResult<{ removed: boolean }> };
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
  /** Open questions (after a reconnect the UI shows them again). */
  confirms: { id: string; req: ConfirmRequest }[];
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

/** An employee with what the Staff page shows next to them. */
export type StaffRow = Employee & {
  /** The earliest reminder for this person (or their last day once they left). */
  next: { text: string; due: string; tone: "red" | "amber" | "n" } | null;
  /** Starting documents expected for them, recorded or not (with when each is due). */
  documentsExpected: { id: DocumentId; label: string; timing: string; recorded: string | null }[];
};

export type ClientMessage ={ [M in Method]: { id: number; method: M; params: Methods[M]["params"] } }[Method];

export type ServerEvent =
  | { event: "turn"; turnId: string; ev: AppEvent }
  /** The reply ended (after its turn_end), or failed before it started. */
  | { event: "turnDone"; turnId: string; error?: string }
  | { event: "confirm"; id: string; req: ConfirmRequest }
  | { event: "confirmWithdrawn"; id: string }
  | { event: "progress"; message: string };

export type ServerMessage = { id: number; result: unknown } | { id: number; error: string } | ServerEvent;
