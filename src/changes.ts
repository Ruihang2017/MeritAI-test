/**
 * What changed in the business's data, whoever changed it (a form or the adviser): the
 * employee register, jobs and candidates, the business profile, saved files. The stores
 * report their writes here; a UI refreshes the pages that show them, marks what the adviser
 * changed and shows it under the reply that changed it (owner, 2026-09-27: the conversation
 * and the pages stay in step).
 */

/** The thing that changed. */
export type EntityRef =
  | { kind: "employee"; id: number; name: string }
  | { kind: "job"; job: string }
  | { kind: "candidate"; job: string; file: string; name: string }
  | { kind: "profile" }
  | { kind: "file"; path: string; name: string };

export type ChangeAction =
  /** employee */
  | "added"
  | "updated"
  | "left"
  | "documents"
  | "removed"
  /** candidate */
  | "shortlisted"
  | "not"
  | "cleared"
  | "hired"
  /** job */
  | "created"
  | "criteria-drafted"
  | "criteria-confirmed"
  | "screened"
  | "applications"
  | "openings"
  | "closed"
  | "reopened"
  /** file */
  | "saved";

export interface EntityChange {
  ref: EntityRef;
  action: ChangeAction;
  /** One line for people, e.g. "Hannah Cole added" or "Team leader: 1 of 2 hired". */
  summary: string;
}

export type ChangeSink = (c: EntityChange) => void;

/** A stable key for the thing (changes to the same thing are grouped by it). */
export function refKey(r: EntityRef): string {
  switch (r.kind) {
    case "employee":
      return `employee:${r.id}`;
    case "job":
      return `job:${r.job}`;
    case "candidate":
      return `candidate:${r.job}:${r.file}`;
    case "profile":
      return "profile";
    case "file":
      return `file:${r.path}`;
  }
}

/**
 * The key of a reply in a stored conversation: the owner's message as the chat shows it (without
 * the app's bracketed notes). Its "What changed" and saved files are kept under it, so a resumed
 * or reloaded conversation shows them again.
 */
export function turnKey(userText: string): string {
  return userText.replace(/\[(attached|imported folder as job|reply language)[^\]]*\]\s*/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** A list of listeners (one per assistant). */
export class Changes {
  private readonly listeners = new Set<ChangeSink>();
  readonly emit: ChangeSink = (c) => {
    for (const f of this.listeners) {
      try {
        f(c);
      } catch {
        /* a listener's error never breaks a save */
      }
    }
  };
  on(f: ChangeSink): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
}
