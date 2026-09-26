import type { ClientTool } from "../engine/types";
import type { BusinessStore } from "./profile";
import { DOCUMENTS, outstandingDocuments, type DocumentId, type Employee, type Register } from "./register";
import { isApprenticeRole } from "./leaving";

/**
 * Compliance reminders (plan P3), worked out by code from the employee register,
 * the business profile and a few general rules. Shown at startup, with /reminders,
 * and to the model through get_reminders. No background process: a local CLI
 * cannot notify when it is closed, so reminders appear when it starts.
 *
 * The rules were checked against the linked official pages on RULES_CHECKED_ON.
 */

export const RULES_CHECKED_ON = "2026-09-25";
/** Reminders due within this many days (and everything overdue) are shown. */
export const HORIZON_DAYS = 30;

export interface Reminder {
  /** YYYY-MM-DD: when to act. */
  due: string;
  overdue: boolean;
  title: string;
  detail: string;
  employeeId: number | null;
  source: { title: string; url: string } | null;
}

const SRC = {
  ceis: { title: "Fair Work: Casual Employment Information Statement", url: "https://www.fairwork.gov.au/employment-conditions/information-statements/casual-employment-information-statement" },
  choice: { title: "Fair Work: Becoming a permanent employee", url: "https://www.fairwork.gov.au/starting-employment/types-of-employees/casual-employees/becoming-a-permanent-employee" },
  wages: { title: "Fair Work: Minimum wages", url: "https://www.fairwork.gov.au/pay-and-wages/minimum-wages" },
  fixedTerm: { title: "Fair Work: Fixed term contract employees", url: "https://www.fairwork.gov.au/starting-employment/types-of-employees/fixed-term-contract-employees" },
  vevo: { title: "Home Affairs: VEVO", url: "https://www.homeaffairs.gov.au/Busi/visas-and-migration/visa-entitlement-verification-online-(vevo)" },
  probation: { title: "Fair Work: Probation", url: "https://www.fairwork.gov.au/starting-employment/probation" },
  superChoice: { title: "ATO: Offer employees a choice of super fund", url: "https://www.ato.gov.au/businesses-and-organisations/super-for-employers/setting-up-super-for-your-business/offer-employees-a-choice-of-super-fund" },
};

// ---- date helpers (calendar dates as YYYY-MM-DD, UTC arithmetic)
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => fmt(new Date(toDate(s).getTime() + n * 86_400_000));
export function addMonths(s: string, n: number): string {
  const d = toDate(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return fmt(d);
}
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);

/** When a casual must be given the CEIS again (after the first one at the start). */
export function ceisDueDates(startDate: string, smallBusiness: boolean, until: string): string[] {
  const out: string[] = [];
  if (smallBusiness) {
    out.push(addMonths(startDate, 12));
  } else {
    out.push(addMonths(startDate, 6), addMonths(startDate, 12));
    for (let m = 24; addMonths(startDate, m) <= until; m += 12) out.push(addMonths(startDate, m));
  }
  return out.filter((d) => d <= until);
}

/** When each starting document is due, for someone who starts on `startDate` (YYYY-MM-DD). */
export function documentTiming(startDate: string): Record<DocumentId, string> {
  return {
    contract: "before they start",
    fwis: "before, or as soon as possible after, they start",
    ceis: "before, or as soon as possible after, they start",
    ftcis: "when you enter into the contract (usually when it is signed)",
    tfn: "when they start (it tells you how much tax to withhold)",
    super_choice: `within 28 days of starting, by ${addDays(startDate, 28)}`,
    vevo: "before they start work",
    induction: "on their first day",
  };
}

export function computeReminders(opts: {
  employees: Employee[];
  /** Headcount from the business profile; null if unknown. */
  headcount: number | null;
  payrollSystem?: string | null;
  today: string;
  horizonDays?: number;
}): Reminder[] {
  const { today } = opts;
  const horizon = addDays(today, opts.horizonDays ?? HORIZON_DAYS);
  // Unknown headcount: use the larger-employer rules, which remind earlier.
  const small = opts.headcount !== null && opts.headcount < 15;
  const out: Reminder[] = [];
  const push = (r: Omit<Reminder, "overdue">) => out.push({ ...r, overdue: r.due < today });
  const inWindow = (due: string, graceDays: number) => due <= horizon && daysBetween(due, today) <= graceDays;

  for (const e of opts.employees.filter((x) => x.status === "active")) {
    const who = `${e.name} (${e.role})`;

    // Starting documents not recorded yet.
    const missing = outstandingDocuments(e);
    if (missing.length && e.startDate <= horizon) {
      // Each item with its own timing, so a recorded item is never reported and nothing looks overdue early.
      const superDue = addDays(e.startDate, 28);
      const timing = documentTiming(e.startDate);
      const superOnly = missing.every((d) => d === "super_choice");
      push({
        due: superOnly ? superDue : e.startDate,
        title: `Starting paperwork not recorded in the register for ${who}`,
        detail: `Only these are not recorded (they may already be done; if so, record them): ${missing.map((d) => `${DOCUMENTS[d]} (${timing[d]})`).join("; ")}. Everything else is recorded.`,
        employeeId: e.id,
        source: superOnly ? SRC.superChoice : null,
      });
    }

    if (e.probationEnd && inWindow(addDays(e.probationEnd, -14), 21)) {
      const apprentice = isApprenticeRole(e.role);
      push({
        due: addDays(e.probationEnd, -14),
        title: `Probation ends ${e.probationEnd}: ${who}`,
        detail: apprentice
          ? "An apprentice's or trainee's probation follows their training contract and the state training authority's rules: check with the authority before extending or ending it, then confirm the outcome in writing."
          : "Probation is set by the business, not by law, so this is not a legal deadline; good practice is to hold the review and confirm the outcome in writing before the end date. Employment usually continues if nothing is done.",
        employeeId: e.id,
        source: SRC.probation,
      });
    }

    if (e.visaExpiry && inWindow(addDays(e.visaExpiry, -30), 60)) {
      push({
        due: addDays(e.visaExpiry, -30),
        title: `Visa / work rights expire ${e.visaExpiry}: ${who}`,
        detail: "Check their current work rights in VEVO before the expiry and keep a record. They cannot keep working without valid work rights.",
        employeeId: e.id,
        source: SRC.vevo,
      });
    }

    if (e.employmentType === "fixed-term" && e.endDate && inWindow(addDays(e.endDate, -28), 35)) {
      push({
        due: addDays(e.endDate, -28),
        title: `Fixed-term contract ends ${e.endDate}: ${who}`,
        detail: "Decide whether to renew (check the limits on fixed-term renewals) or end it as planned (final pay, handover).",
        employeeId: e.id,
        source: SRC.fixedTerm,
      });
    }

    if (e.employmentType === "casual") {
      const lastCeis = e.documents.find((d) => d.id === "ceis")?.date ?? null;
      for (const due of ceisDueDates(e.startDate, small, horizon)) {
        const done = lastCeis !== null && lastCeis >= due;
        if (!done && inWindow(due, 60)) {
          push({
            due,
            title: `Give the Casual Employment Information Statement again: ${who}`,
            detail: `Due after ${Math.round(daysBetween(e.startDate, due) / 30.44)} months of employment (${small ? "small business employer: after 12 months" : "15+ employees: after 6 and 12 months, then every 12 months"}). Record it in the register when given.`,
            employeeId: e.id,
            source: SRC.ceis,
          });
        }
      }
      const choice = addMonths(e.startDate, small ? 12 : 6);
      if (inWindow(choice, 14)) {
        push({
          due: choice,
          title: `${who} can ask to become permanent from ${choice}`,
          detail: `After ${small ? "12" : "6"} months a casual can give written notice to change to full-time or part-time (employee choice pathway). If they do, you must respond in writing within 21 days, and can refuse only for set reasons.`,
          employeeId: e.id,
          source: SRC.choice,
        });
      }
    }
  }

  // Annual wage review: new minimum wages and award rates from the first full pay period on or after 1 July.
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const due = `${y}-06-15`;
    if (inWindow(due, 30)) {
      push({
        due,
        title: `New minimum wages and award rates from 1 July ${y}`,
        detail: `Most changes start from the first full pay period on or after 1 July. Check the new rates for your awards and update pay${opts.payrollSystem ? ` in ${opts.payrollSystem}` : ""}.`,
        employeeId: null,
        source: SRC.wages,
      });
    }
  }

  return out.sort((a, b) => a.due.localeCompare(b.due));
}

export function formatReminders(rs: Reminder[], today: string): string {
  if (!rs.length) return `Nothing due in the next ${HORIZON_DAYS} days.`;
  return rs
    .map((r) => `- ${r.overdue ? `OVERDUE (was due ${r.due})` : r.due === today ? "TODAY" : `by ${r.due}`}: ${r.title}. ${r.detail}${r.source ? ` Source: ${r.source.title} ${r.source.url}` : ""}`)
    .join("\n");
}

export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function remindersFor(register: Register, business: BusinessStore, today = todayLocal()): Reminder[] {
  const p = business.get();
  return computeReminders({ employees: register.list(), headcount: p.headcount, payrollSystem: p.payrollSystem, today });
}

export function reminderTools(opts: { register: () => Register; business: () => BusinessStore }): ClientTool[] {
  return [
    {
      name: "get_reminders",
      description:
        "Get the business's compliance reminders due in the next 30 days or overdue (starting paperwork, probation ends, visa expiries, fixed-term contract ends, casual information statements and permanent-employment rights, annual wage changes). Use when the owner asks what they need to do, or about deadlines.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handle: async () => {
        const today = todayLocal();
        const rs = remindersFor(opts.register(), opts.business(), today);
        return {
          success: true,
          text: `Today is ${today}. Reminders (rules checked ${RULES_CHECKED_ON}):\n${formatReminders(rs, today)}\n\nPresent them in plain language, overdue first, with what to do, each item's deadline or timing and date as listed, and the source links. Offer to draft anything needed (e.g. a probation outcome letter).`,
          display: `reminders: ${rs.length}`,
        };
      },
    },
  ];
}
