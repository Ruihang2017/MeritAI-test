import type { Reminder } from "../../src/business/reminders";
import type { SessionFrom } from "../../src/memory/store";

/**
 * A page button that asks MeritAI. It opens the side panel (design: Dock*) and either
 * sends at once or, for a request that needs the owner's words, fills the box and waits.
 */
export interface Ask {
  text: string;
  /** The thing it is about: the same key continues the current conversation, another starts a new one. */
  from: SessionFrom;
  draft?: boolean;
  mode?: "setup";
  skill?: string;
  attachments?: string[];
}

export const fromJob = (job: string): SessionFrom => ({ page: "hiring", key: `job:${job}`, label: job, job });
export const fromEmployee = (id: number, name: string): SessionFrom => ({ page: "staff", key: `employee:${id}`, label: name, employeeId: id });
export const fromFile = (name: string): SessionFrom => ({ page: "files", key: `file:${name}`, label: name });
export const FROM_PROFILE: SessionFrom = { page: "profile", key: "profile", label: "Business profile" };
/** An Attention card: about its employee when it has one (same topic as asking from Staff), else the business. */
export const fromReminder = (r: Reminder): SessionFrom =>
  r.employeeId !== null ? { page: "staff", key: `employee:${r.employeeId}`, label: r.title, employeeId: r.employeeId } : { page: "profile", key: `reminder:${r.title}`, label: r.title };

const PAGE: Record<SessionFrom["page"], string> = { hiring: "Hiring", staff: "Staff", files: "Files", profile: "Profile & policies" };
/** "Hiring · Team leader". */
export const fromText = (f: SessionFrom) => `${PAGE[f.page]} · ${f.label}`;

/** What the side panel's buttons report back to a page: the request running now and those waiting. */
export interface Asking {
  running: string | null;
  queued: string[];
}
