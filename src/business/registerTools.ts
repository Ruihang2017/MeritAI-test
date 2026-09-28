import type { ClientTool, Confirm, ToolOutcome } from "../engine/types";
import { DOCUMENTS, employeeLine, outstandingDocuments, type Employee, type Register } from "./register";
import { documentTiming } from "./reminders";
import { checkDocuments, checkEmployeeChanges, checkNewEmployee, fixedTermEndChanged } from "./registerOps";
import type { BusinessStore } from "./profile";
import { isApprenticeRole, leavingText } from "./leaving";
import { startDateHolidayNote } from "./publicHolidays";
import { longDate } from "./weekdayGuard";
import { todayIso } from "../clock";

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

/** The length of a fixed-term contract from its start to the new end date, against the 2-year limit (round 5 evaluation: say it for this person, not only the rule). */
export function fixedTermSpan(start: string, end: string): string {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const months = (ye - ys) * 12 + (me - ms) - (de < ds ? 1 : 0);
  const span = `In the reply, state the limits themselves in plain words (at most 2 years in total, at most one extension or renewal) and this figure; never only "it must comply with the fixed-term limits". From the start date (${start}) to the new end date (${end}) is about ${months} months.`;
  return months >= 24
    ? `${span} That is 2 years or more: over the fixed-term limit unless an exception applies. Tell the owner, and to get advice before agreeing to it.`
    : `${span} That is within the 2-year limit only if there were no earlier contracts or extensions for this role. Tell the owner this counts as the one extension allowed: if the contract was already extended or renewed once, another extension isn't allowed unless an exception applies. Steps: 1. check earlier contracts and extensions; 2. put the extension in writing (a new contract also needs the FTCIS); 3. offer to draft the letter.`;
}

/** A hire from a job, for add_employee's hiredFrom (the jobs and candidates live in the screening catalog). */
export interface HireLink {
  find(job: string, candidate: string): { ok: true; file: string; name: string } | { ok: false; error: string };
  link(job: string, file: string, employeeId: number): string;
  /** Open jobs with a candidate of this name (to suggest linking a hire the owner didn't mention). */
  jobsWith(name: string): string[];
}

export function registerTools(opts: { register: () => Register; business: () => BusinessStore; confirm: Confirm; hires?: HireLink }): ClientTool[] {
  const { confirm } = opts;

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
        // Each "not recorded yet" item comes with when it is due, so an answer about paperwork can give the deadline.
        const line = (e: Employee) => {
          const missing = outstandingDocuments(e);
          const timing = documentTiming(e.startDate);
          return `- ${employeeLine(e)}${missing.length && e.status === "active" ? `\n  when due: ${missing.map((d) => `${DOCUMENTS[d]}: ${timing[d]}`).join("; ")}` : ""}`;
        };
        return {
          success: true,
          text: `Employee register (personal data: use only what the task needs):\n${list.map(line).join("\n")}\n\nWhen you report paperwork that is not recorded yet, give each item's due timing and date from "when due".`,
          display: `register: ${list.length} employee(s)`,
        };
      },
    },
    {
      name: "add_employee",
      description:
        "Add a new employee to the register (after an offer is accepted or when the owner lists their staff). Call it directly: the app shows the details to the owner and asks [y/n] itself, so do not ask for confirmation in the chat first. Work details only. " +
        "When they were hired from a job on the Hiring page (a candidate who accepted an offer), pass hiredFrom with the job and the candidate (list_candidates shows them), so the job counts the hire, as Add to Staff on the Hiring page does.",
      inputSchema: {
        type: "object",
        properties: {
          ...EMPLOYEE_FIELDS,
          hiredFrom: {
            type: ["object", "null"],
            description: "The job and candidate they were hired from, or null.",
            properties: { job: { type: "string", description: "Job folder name, as list_jobs shows it." }, candidate: { type: "string", description: "Candidate name or application file, as list_candidates shows it." } },
            required: ["job", "candidate"],
            additionalProperties: false,
          },
        },
        required: ["name", "role", "employmentType", "startDate", "endDate", "award", "classification", "probationEnd", "visaExpiry", "notes", "hiredFrom"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const { hiredFrom, ...details } = (args ?? {}) as Record<string, unknown> & { hiredFrom?: { job?: string; candidate?: string } | null };
        let hire: { job: string; file: string; name: string } | null = null;
        if (hiredFrom && opts.hires) {
          const f = opts.hires.find(String(hiredFrom.job ?? ""), String(hiredFrom.candidate ?? ""));
          if (!f.ok) return fail(`Not saved: ${f.error}.`);
          hire = { job: String(hiredFrom.job), file: f.file, name: f.name };
        }
        // Not said, but their name is a candidate of exactly one open job: the same question offers the link
        // (one question for one hire, as Add to Staff does; the owner sees it before saying yes).
        if (!hire && !hiredFrom && opts.hires && typeof details.name === "string") {
          const jobs = opts.hires.jobsWith(details.name);
          if (jobs.length === 1) {
            const f = opts.hires.find(jobs[0], details.name);
            if (f.ok) hire = { job: jobs[0], file: f.file, name: f.name };
          }
        }
        const c = checkNewEmployee(opts.register(), details);
        if (!c.ok) {
          const dup = c.duplicate;
          return fail(dup ? `Not saved: "${dup.name}" is already in the register as [${dup.id}]. Use update_employee to change their details, or ask the owner if this is a different person.` : `Not saved: ${c.error}.`);
        }
        const e = c.input;
        const items = hire ? [...c.lines, `Hired from: ${hire.job} (${hire.name}'s application)`] : c.lines;
        if (!(await confirm({ kind: "register", title: "Add to the employee register?", items, ...(hire ? { about: { kind: "job" as const, job: hire.job } } : {}) }))) return { success: true, text: "The owner did not confirm; nothing was saved.", display: "register: not saved" };
        const saved = opts.register().add(e);
        let note = "";
        if (hire && opts.hires) {
          try {
            note = `\n\nHired from "${hire.job}": ${opts.hires.link(hire.job, hire.file, saved.id)}`;
          } catch (err) {
            note = `\n\nThe hire couldn't be linked to "${hire.job}" (${(err as Error).message}); the employee is saved.`;
          }
        } else if (opts.hires) {
          const jobs = opts.hires.jobsWith(saved.name);
          if (jobs.length) note = `\n\n${saved.name} is also a candidate for: ${jobs.join(", ")}. If they were hired from that job, call record_hire so the job counts the hire.`;
        }
        // A first day still to come that is a public holiday (round 6 evaluation).
        const upcoming = saved.startDate && saved.startDate >= todayIso() ? saved.startDate : null;
        const holiday = upcoming ? startDateHolidayNote(upcoming, opts.business().get().states) : null;
        if (holiday) note += `\n\n${holiday}`;
        // The weekday from code (round 6: the model called a Tuesday a Monday).
        if (upcoming) note += `\n\nFirst day: ${longDate(upcoming)}. Use this weekday as it is.`;
        return { success: true, text: `Added: ${employeeLine(saved)}${note}`, display: `register: added [${saved.id}] ${saved.name}` };
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
        const c = checkEmployeeChanges(opts.register(), current.id, a.changes);
        if (!c.ok) return fail(c.error === "nothing to change" ? "Nothing to change." : `Not saved: ${c.error}.`);
        const changes = c.changes;
        if (!(await confirm({ kind: "register", title: `Update ${current.name} in the employee register?`, items: c.lines, about: { kind: "employee", id: current.id, name: current.name } }))) return { success: true, text: "The owner did not confirm; nothing was saved.", display: "register: not saved" };
        const saved = opts.register().update(current.id, changes);
        // Code-added guidance for changes that carry legal obligations (found missing in the evaluation).
        const notes: string[] = [];
        if (changes.status === "left" && current.status !== "left") {
          notes.push(leavingText({ reason: "other", apprentice: isApprenticeRole(saved.role), casual: saved.employmentType === "casual", states: opts.business().get().states }));
          notes.push("If you know why they left (resignation, dismissal, redundancy, end of contract), call leaving_checklist with that reason for the specific steps.");
        }
        if (fixedTermEndChanged(current, saved, changes)) {
          notes.push(FIXED_TERM_NOTE);
          if (saved.endDate) notes.push(fixedTermSpan(saved.startDate, saved.endDate));
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
        const c = checkDocuments(opts.register(), current.id, a.documents, a.date);
        if (!c.ok) return fail(c.error);
        const docs = c.docs;
        if (!(await confirm({ kind: "register", title: `Record for ${current.name} (${a.date})?`, items: c.lines, about: { kind: "employee", id: current.id, name: current.name } }))) {
          return { success: true, text: "The owner did not confirm; nothing was saved.", display: "register: not saved" };
        }
        const saved = opts.register().recordDocuments(current.id, docs, String(a.date));
        // Round 5 evaluation (2026-09-27): the reply stopped at "recorded" and missed an unchecked visa.
        const left = outstandingDocuments(saved);
        const next = left.length
          ? `\n\nStill not recorded for ${saved.name}: ${left.map((d) => DOCUMENTS[d]).join("; ")}. Tell the owner, in the reply, what is still outstanding.${
              left.includes("vevo") && saved.visaExpiry ? ` Their right to work has not been checked in VEVO (visa or work rights expire ${saved.visaExpiry}): tell the owner to check it in VEVO before their next shift and keep the result.` : ""
            }`
          : `\n\nAll starting documents are now recorded for ${saved.name}.`;
        return { success: true, text: `Recorded. ${employeeLine(saved)}${next}`, display: `register: ${docs.length} item(s) recorded for ${saved.name}` };
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
        if (!(await confirm({ kind: "register", title: `Delete ${current.name} and all their records from the register? This cannot be undone.`, destructive: true, about: { kind: "employee", id: current.id, name: current.name } }))) {
          return { success: true, text: "The owner did not confirm; nothing was deleted.", display: "register: not deleted" };
        }
        opts.register().remove(current.id);
        return { success: true, text: `Deleted ${current.name} from the register.`, display: `register: deleted ${current.name}` };
      },
    },
  ];
}
