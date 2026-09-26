import { DOCUMENTS, normaliseEmployee, type DocumentId, type Employee, type EmployeeInput, type Register } from "./register";

/**
 * Validation shared by the register tools (chat: validate, ask [y/n], save) and
 * the application layer's forms (validate, save: submitting the form is the
 * confirmation). Both paths use the same rules, so a form cannot store what the
 * tools would refuse.
 */
export type Checked<T> = ({ ok: true } & T) | { ok: false; error: string; duplicate?: Employee };

/** One line per field that will be set, for confirmations and receipts. */
/** Plain labels for the owner (confirmations, receipts): "Last day" rather than leftDate. */
const LABELS: Record<string, string> = {
  name: "Name",
  role: "Role",
  employmentType: "Employment type",
  startDate: "Start date",
  endDate: "Contract end date",
  award: "Award",
  classification: "Classification",
  probationEnd: "Probation ends",
  visaExpiry: "Visa or work rights expire",
  status: "Status",
  leftDate: "Last day",
  notes: "Notes",
};

/** One line per field; with `current`, a change shows "old → new". */
export const describeFields = (o: Record<string, unknown>, current?: Record<string, unknown>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const now = v === null ? "(cleared)" : String(v);
      const was = current?.[k];
      return `${LABELS[k] ?? k}: ${was !== undefined && was !== null && String(was) !== now ? `${String(was)} → ${now}` : now}`;
    });

export function checkNewEmployee(register: Register, raw: unknown): Checked<{ input: EmployeeInput; lines: string[] }> {
  let input: EmployeeInput;
  try {
    input = normaliseEmployee(raw, true);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const dup = register.list().find((x) => x.name.toLowerCase() === input.name!.toLowerCase());
  if (dup) return { ok: false, error: `"${dup.name}" is already in the register as [${dup.id}]`, duplicate: dup };
  return { ok: true, input, lines: describeFields(input) };
}

export function checkEmployeeChanges(register: Register, id: number, raw: unknown): Checked<{ current: Employee; changes: EmployeeInput; lines: string[] }> {
  const current = register.get(Number(id));
  if (!current) return { ok: false, error: `no employee with id ${id}` };
  let changes: EmployeeInput;
  try {
    changes = normaliseEmployee(raw, false);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!Object.keys(changes).length) return { ok: false, error: "nothing to change" };
  return { ok: true, current, changes, lines: describeFields(changes, current as unknown as Record<string, unknown>) };
}

export function checkDocuments(register: Register, id: number, documents: unknown, date: unknown): Checked<{ current: Employee; docs: DocumentId[]; date: string; lines: string[] }> {
  const current = register.get(Number(id));
  if (!current) return { ok: false, error: `no employee with id ${id}` };
  const docs = (Array.isArray(documents) ? documents : []).filter((d): d is DocumentId => typeof d === "string" && d in DOCUMENTS);
  if (!docs.length) return { ok: false, error: `documents must be some of: ${Object.keys(DOCUMENTS).join(", ")}` };
  const on = String(date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on))) return { ok: false, error: "date must be YYYY-MM-DD" };
  return { ok: true, current, docs, date: on, lines: docs.map((d) => DOCUMENTS[d]) };
}

/** A fixed-term end date changed: the limits on extensions apply. */
export const fixedTermEndChanged = (current: Employee, saved: Employee, changes: EmployeeInput) =>
  saved.employmentType === "fixed-term" && changes.endDate !== undefined && changes.endDate !== current.endDate;

/** A note from code shown with a form's receipt (the chat tools give the model their own wording). */
export interface FormNote {
  text: string;
  source: { title: string; url: string };
}

/** Shown when a fixed-term end date changes (Fair Work, checked 2026-09-26; same rules as FIXED_TERM_NOTE). */
export const FIXED_TERM_OWNER_NOTE: FormNote = {
  text:
    "Fixed-term contracts made on or after 6 December 2023 (unless an exception applies) can't run longer than 2 years including extensions, and can't be extended or renewed more than once. " +
    "Check any earlier contracts or extensions for this person, and put the extension in writing (a new contract also needs a Fixed Term Contract Information Statement).",
  source: { title: "Fair Work: Fixed term contract employees", url: "https://www.fairwork.gov.au/starting-employment/types-of-employees/fixed-term-contract-employees" },
};
