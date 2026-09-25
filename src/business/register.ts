import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { findPii } from "../memory/store";
import { EMPLOYMENT_TYPES } from "./profile";

/**
 * The lightweight employee register (plan P2): who works here, on what terms,
 * and which starting documents they have received. One SQLite file per business
 * workspace (<root>/.assistant/register.sqlite), never reachable through a file tool.
 *
 * It holds employees' personal data, so it keeps only what the reminders and
 * checklists need. Never: TFN, bank details, home address, date of birth, health.
 * Removing an employee deletes their rows. Not encrypted in the POC.
 */

/** Starting documents and steps the register tracks (from the new starter checklist). */
export const DOCUMENTS = {
  contract: "Written contract signed",
  fwis: "Fair Work Information Statement given",
  ceis: "Casual Employment Information Statement given",
  ftcis: "Fixed Term Contract Information Statement given",
  tfn: "TFN declaration completed",
  super_choice: "Super choice form given",
  vevo: "Right to work (VEVO) checked",
  induction: "Induction (incl. WHS) done",
} as const;
export type DocumentId = keyof typeof DOCUMENTS;

export interface Employee {
  id: number;
  name: string;
  role: string;
  employmentType: string;
  startDate: string;
  /** Fixed-term contracts: the end date. */
  endDate: string | null;
  award: string | null;
  classification: string | null;
  probationEnd: string | null;
  /** Only when the person works on a visa: when it (or their work rights) expires. */
  visaExpiry: string | null;
  status: "active" | "left";
  leftDate: string | null;
  notes: string | null;
  documents: { id: DocumentId; date: string }[];
}

export type EmployeeInput = Partial<Omit<Employee, "id" | "documents" | "status" | "leftDate">> & { status?: "active" | "left"; leftDate?: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 200;

/** Personal data the register must never hold, beyond what findPii catches. */
const FORBIDDEN = /\b(tfn|tax file|bsb|bank account|account number|date of birth|dob|born on|home address|medical|diagnos\w*|illness|disabilit\w*|pregnan\w*)\b/i;

const text = (v: unknown, field: string, required = false): string | null => {
  if (v === null || v === undefined || String(v).trim() === "") {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > MAX_TEXT) throw new Error(`${field} is too long (max ${MAX_TEXT} characters)`);
  const pii = findPii(s);
  if (pii || FORBIDDEN.test(s)) throw new Error(`${field} looks like sensitive personal data (${pii ?? "not allowed in the register"}); the register only keeps work details`);
  return s;
};
const date = (v: unknown, field: string, required = false): string | null => {
  if (v === null || v === undefined || v === "") {
    if (required) throw new Error(`${field} is required (YYYY-MM-DD)`);
    return null;
  }
  const s = String(v).trim();
  if (!DATE.test(s) || Number.isNaN(Date.parse(s))) throw new Error(`${field} must be a date as YYYY-MM-DD`);
  return s;
};

/** Validates a new or changed employee. Throws with a user-facing reason. */
export function normaliseEmployee(raw: unknown, isNew: boolean): EmployeeInput {
  if (!raw || typeof raw !== "object") throw new Error("the employee details must be an object");
  const r = raw as Record<string, unknown>;
  const out: EmployeeInput = {};
  const known = ["name", "role", "employmentType", "startDate", "endDate", "award", "classification", "probationEnd", "visaExpiry", "notes", "status", "leftDate"];
  for (const k of Object.keys(r)) if (!known.includes(k)) throw new Error(`unknown field "${k}"`);
  if (isNew || "name" in r) out.name = text(r.name, "name", true)!;
  if (isNew || "role" in r) out.role = text(r.role, "role", true)!;
  if (isNew || "employmentType" in r) {
    const t = String(r.employmentType ?? "").toLowerCase();
    if (!(EMPLOYMENT_TYPES as readonly string[]).includes(t)) throw new Error(`employmentType must be one of ${EMPLOYMENT_TYPES.join(", ")}`);
    out.employmentType = t;
  }
  if (isNew || "startDate" in r) out.startDate = date(r.startDate, "startDate", true)!;
  for (const k of ["endDate", "probationEnd", "visaExpiry", "leftDate"] as const) if (k in r) out[k] = date(r[k], k);
  for (const k of ["award", "classification", "notes"] as const) if (k in r) out[k] = text(r[k], k);
  if ("status" in r) {
    if (r.status !== "active" && r.status !== "left") throw new Error('status must be "active" or "left"');
    out.status = r.status;
  }
  return out;
}

const COLS: Record<string, string> = {
  name: "name",
  role: "role",
  employmentType: "employment_type",
  startDate: "start_date",
  endDate: "end_date",
  award: "award",
  classification: "classification",
  probationEnd: "probation_end",
  visaExpiry: "visa_expiry",
  status: "status",
  leftDate: "left_date",
  notes: "notes",
};

type Row = Record<string, string | number | null>;

export class Register {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(join(dataDir, "register.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, role TEXT NOT NULL, employment_type TEXT NOT NULL,
        start_date TEXT NOT NULL, end_date TEXT, award TEXT, classification TEXT,
        probation_end TEXT, visa_expiry TEXT,
        status TEXT NOT NULL DEFAULT 'active', left_date TEXT, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        doc TEXT NOT NULL, done_on TEXT NOT NULL,
        PRIMARY KEY (employee_id, doc));
    `);
  }

  close(): void {
    this.db.close();
  }

  private toEmployee(r: Row): Employee {
    const docs = this.db.prepare("SELECT doc, done_on FROM documents WHERE employee_id = ? ORDER BY done_on").all(r.id) as Row[];
    return {
      id: Number(r.id),
      name: String(r.name),
      role: String(r.role),
      employmentType: String(r.employment_type),
      startDate: String(r.start_date),
      endDate: (r.end_date as string) ?? null,
      award: (r.award as string) ?? null,
      classification: (r.classification as string) ?? null,
      probationEnd: (r.probation_end as string) ?? null,
      visaExpiry: (r.visa_expiry as string) ?? null,
      status: r.status === "left" ? "left" : "active",
      leftDate: (r.left_date as string) ?? null,
      notes: (r.notes as string) ?? null,
      documents: docs.map((d) => ({ id: d.doc as DocumentId, date: String(d.done_on) })),
    };
  }

  list(opts: { includeLeft?: boolean } = {}): Employee[] {
    const rows = this.db
      .prepare(`SELECT * FROM employees ${opts.includeLeft ? "" : "WHERE status = 'active'"} ORDER BY status, start_date, name`)
      .all() as Row[];
    return rows.map((r) => this.toEmployee(r));
  }

  get(id: number): Employee | null {
    const r = this.db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toEmployee(r) : null;
  }

  add(e: EmployeeInput): Employee {
    const now = new Date().toISOString();
    const keys = Object.keys(e).filter((k) => COLS[k]);
    const r = this.db
      .prepare(`INSERT INTO employees (${keys.map((k) => COLS[k]).join(", ")}, created_at, updated_at) VALUES (${keys.map(() => "?").join(", ")}, ?, ?)`)
      .run(...keys.map((k) => (e as Record<string, string | null>)[k] ?? null), now, now);
    return this.get(Number(r.lastInsertRowid))!;
  }

  update(id: number, changes: EmployeeInput): Employee {
    const keys = Object.keys(changes).filter((k) => COLS[k]);
    if (!this.get(id)) throw new Error(`no employee with id ${id}`);
    if (keys.length) {
      this.db
        .prepare(`UPDATE employees SET ${keys.map((k) => `${COLS[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
        .run(...keys.map((k) => (changes as Record<string, string | null>)[k] ?? null), new Date().toISOString(), id);
    }
    return this.get(id)!;
  }

  recordDocuments(id: number, docs: DocumentId[], on: string): Employee {
    if (!this.get(id)) throw new Error(`no employee with id ${id}`);
    const st = this.db.prepare("INSERT INTO documents (employee_id, doc, done_on) VALUES (?, ?, ?) ON CONFLICT (employee_id, doc) DO UPDATE SET done_on = excluded.done_on");
    for (const d of docs) st.run(id, d, on);
    return this.get(id)!;
  }

  /** Deletes the employee and their document records. */
  remove(id: number): Employee | null {
    const e = this.get(id);
    if (e) this.db.prepare("DELETE FROM employees WHERE id = ?").run(id);
    return e;
  }
}

/** The starting documents an employee of this type should have (for "outstanding" lists and reminders). */
export function expectedDocuments(e: Pick<Employee, "employmentType" | "visaExpiry">): DocumentId[] {
  const docs: DocumentId[] = ["contract", "fwis", "tfn", "super_choice", "induction"];
  if (e.employmentType === "casual") docs.push("ceis");
  if (e.employmentType === "fixed-term") docs.push("ftcis");
  if (e.visaExpiry) docs.push("vevo");
  return docs;
}

export function outstandingDocuments(e: Employee): DocumentId[] {
  const done = new Set(e.documents.map((d) => d.id));
  return expectedDocuments(e).filter((d) => !done.has(d));
}

/** One line per employee, for the model and for /staff. */
export function employeeLine(e: Employee): string {
  const parts = [
    `[${e.id}] ${e.name}`,
    e.role,
    e.employmentType,
    `started ${e.startDate}`,
    e.endDate ? `contract ends ${e.endDate}` : null,
    e.award ? `award: ${e.award}${e.classification ? `, ${e.classification}` : ""}` : null,
    e.probationEnd ? `probation ends ${e.probationEnd}` : null,
    e.visaExpiry ? `visa/work rights expire ${e.visaExpiry}` : null,
    e.status === "left" ? `LEFT ${e.leftDate ?? ""}`.trim() : null,
  ].filter(Boolean);
  const missing = e.status === "active" ? outstandingDocuments(e) : [];
  // "Not recorded" rather than "missing": it may be done and just not recorded yet.
  const recorded = e.documents.length ? ` | recorded: ${e.documents.map((d) => `${DOCUMENTS[d.id]} (${d.date})`).join("; ")}` : "";
  const notRecorded = missing.length ? ` | not recorded yet: ${missing.map((d) => DOCUMENTS[d]).join("; ")}` : e.status === "active" ? " | starting documents: all recorded" : "";
  return `${parts.join(" | ")}${recorded}${notRecorded}${e.notes ? ` | notes: ${e.notes}` : ""}`;
}
