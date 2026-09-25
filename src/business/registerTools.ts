import type { ClientTool, Confirm, ToolOutcome } from "../engine/types";
import { DOCUMENTS, employeeLine, normaliseEmployee, type DocumentId, type Register } from "./register";
import type { BusinessStore } from "./profile";
import { isApprenticeRole, leavingText } from "./leaving";

const dateProp = (description: string) => ({ type: ["string", "null"], description: `${description} (YYYY-MM-DD)` });

const EMPLOYEE_FIELDS = {
  name: { type: "string", description: "The name the business uses for them (first name and surname)." },
  role: { type: "string" },
  employmentType: { type: "string", enum: ["full-time", "part-time", "casual", "fixed-term"] },
  startDate: dateProp("First day of work"),
  endDate: dateProp("Fixed-term contracts only: the end date"),
  award: { type: ["string", "null"], description: "The award, if known." },
  classification: { type: ["string", "null"], description: "The award classification level, if known." },
  probationEnd: dateProp("End of probation, if the business uses probation"),
  visaExpiry: dateProp("Only if they work on a visa: when the visa or their work rights expire"),
  notes: { type: ["string", "null"], description: "Short work-related note. Never health, family, TFN, bank or address details." },
};

const fail = (text: string): ToolOutcome => ({ success: false, text });

/**
 * Employee register tools. Every write shows what will change and needs the
 * owner's [y/n]; nothing is saved without it.
 */
/** Fixed-term limits (Fair Work, checked 2026-09-26), added when a fixed-term end date changes. */
export const FIXED_TERM_NOTE =
  "Fixed-term rules to tell the owner (contracts made on or after 6 December 2023, unless an exception applies): a fixed-term contract cannot run longer than 2 years including extensions or renewals, and cannot be extended or renewed more than once; there are also limits on consecutive contracts. " +
  "Check any earlier contracts or extensions for this person before agreeing, and put the extension in writing (a new contract also needs a Fixed Term Contract Information Statement). Offer to draft the extension letter. " +
  "Source: Fair Work: Fixed term contract employees https://www.fairwork.gov.au/starting-employment/types-of-employees/fixed-term-contract-employees";

export function registerTools(opts: { register: () => Register; business: () => BusinessStore; confirm: Confirm }): ClientTool[] {
  const { confirm } = opts;
  const describe = (o: Record<string, unknown>) =>
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${v === null ? "(cleared)" : String(v)}`);

  return [
    {
      name: "list_employees",
      description: "List the business's employee register: id, role, employment type, key dates and outstanding starting documents. Use it before changing an employee, and when the owner asks about their staff.",
      inputSchema: {
        type: "object",
        properties: { include_left: { type: "boolean", description: "Also list people who have left." } },
        required: ["include_left"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const list = opts.register().list({ includeLeft: (args as { include_left?: boolean })?.include_left === true });
        if (!list.length) return { success: true, text: "The employee register is empty.", display: "register: empty" };
        return {
          success: true,
          text: `Employee register (personal data: use only what the task needs):\n${list.map((e) => `- ${employeeLine(e)}`).join("\n")}`,
          display: `register: ${list.length} employee(s)`,
        };
      },
    },
    {
      name: "add_employee",
      description:
        "Add a new employee to the register (after an offer is accepted or when the owner lists their staff). Call it directly: the app shows the details to the owner and asks [y/n] itself, so do not ask for confirmation in the chat first. Work details only.",
      inputSchema: {
        type: "object",
        properties: EMPLOYEE_FIELDS,
        required: ["name", "role", "employmentType", "startDate", "endDate", "award", "classification", "probationEnd", "visaExpiry", "notes"],
        additionalProperties: false,
      },
      handle: async (args) => {
        let e;
        try {
          e = normaliseEmployee(args, true);
        } catch (err) {
          return fail(`Not saved: ${(err as Error).message}.`);
        }
        const dup = opts.register().list().find((x) => x.name.toLowerCase() === e.name!.toLowerCase());
        if (dup) return fail(`Not saved: "${dup.name}" is already in the register as [${dup.id}]. Use update_employee to change their details, or ask the owner if this is a different person.`);
        if (!(await confirm({ kind: "register", title: "Add to the employee register?", items: describe(e) }))) return { success: true, text: "The owner did not confirm; nothing was saved.", display: "register: not saved" };
        const saved = opts.register().add(e);
        return { success: true, text: `Added: ${employeeLine(saved)}`, display: `register: added [${saved.id}] ${saved.name}` };
      },
    },
    {
      name: "update_employee",
      description: "Change an employee's details in the register (e.g. new role, probation end, visa expiry, or that they left: status 'left' with leftDate). Include only the fields that change. Call it directly: the app asks the owner [y/n] itself.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "integer" },
          changes: {
            type: "object",
            properties: {
              ...EMPLOYEE_FIELDS,
              status: { type: "string", enum: ["active", "left"] },
              leftDate: dateProp("Last day of employment"),
            },
            additionalProperties: false,
          },
        },
        required: ["id", "changes"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { id?: number; changes?: unknown };
        const current = opts.register().get(Number(a.id));
        if (!current) return fail(`No employee with id ${a.id}. Call list_employees first.`);
        let changes;
        try {
          changes = normaliseEmployee(a.changes, false);
        } catch (err) {
          return fail(`Not saved: ${(err as Error).message}.`);
        }
        if (!Object.keys(changes).length) return fail("Nothing to change.");
        if (!(await confirm({ kind: "register", title: `Update ${current.name} in the employee register?`, items: describe(changes) }))) return { success: true, text: "The owner did not confirm; nothing was saved.", display: "register: not saved" };
        const saved = opts.register().update(current.id, changes);
        // Code-added guidance for changes that carry legal obligations (found missing in the evaluation).
        const notes: string[] = [];
        if (changes.status === "left" && current.status !== "left") {
          notes.push(leavingText({ reason: "other", apprentice: isApprenticeRole(saved.role), states: opts.business().get().states }));
          notes.push("If you know why they left (resignation, dismissal, redundancy, end of contract), call leaving_checklist with that reason for the specific steps.");
        }
        if (saved.employmentType === "fixed-term" && changes.endDate !== undefined && changes.endDate !== current.endDate) {
          notes.push(FIXED_TERM_NOTE);
        }
        return {
          success: true,
          text: `Updated: ${employeeLine(saved)}${notes.length ? `\n\n${notes.join("\n\n")}` : ""}`,
          display: `register: updated [${saved.id}] ${saved.name}`,
        };
      },
    },
    {
      name: "record_documents",
      description: "Record that starting documents or steps were done for an employee (e.g. FWIS given, TFN declaration completed). Call it directly: the app asks the owner [y/n] itself.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "integer" },
          documents: { type: "array", items: { type: "string", enum: Object.keys(DOCUMENTS) }, minItems: 1 },
          date: { type: "string", description: "When it was done (YYYY-MM-DD); today if the owner did not say." },
        },
        required: ["id", "documents", "date"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { id?: number; documents?: string[]; date?: string };
        const current = opts.register().get(Number(a.id));
        if (!current) return fail(`No employee with id ${a.id}. Call list_employees first.`);
        const docs = (a.documents ?? []).filter((d): d is DocumentId => d in DOCUMENTS);
        if (!docs.length) return fail(`documents must be some of: ${Object.keys(DOCUMENTS).join(", ")}`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date))) return fail("date must be YYYY-MM-DD");
        if (!(await confirm({ kind: "register", title: `Record for ${current.name} (${a.date})?`, items: docs.map((d) => DOCUMENTS[d]) }))) {
          return { success: true, text: "The owner did not confirm; nothing was saved.", display: "register: not saved" };
        }
        const saved = opts.register().recordDocuments(current.id, docs, String(a.date));
        return { success: true, text: `Recorded. ${employeeLine(saved)}`, display: `register: ${docs.length} item(s) recorded for ${saved.name}` };
      },
    },
    {
      name: "remove_employee",
      description:
        "Delete an employee and their records from the register completely (e.g. added by mistake, or the owner wants a former employee's data removed). For someone who left, prefer update_employee with status 'left' unless the owner asks to delete. Call it directly: the app asks the owner [y/n] itself.",
      inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
      handle: async (args) => {
        const current = opts.register().get(Number((args as { id?: number }).id));
        if (!current) return fail("No such employee. Call list_employees first.");
        if (!(await confirm({ kind: "register", title: `Delete ${current.name} and all their records from the register? This cannot be undone.`, destructive: true }))) {
          return { success: true, text: "The owner did not confirm; nothing was deleted.", display: "register: not deleted" };
        }
        opts.register().remove(current.id);
        return { success: true, text: `Deleted ${current.name} from the register.`, display: `register: deleted ${current.name}` };
      },
    },
  ];
}
