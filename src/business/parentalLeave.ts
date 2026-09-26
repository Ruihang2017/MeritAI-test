import type { ClientTool } from "../engine/types";
import type { ChecklistItem } from "./onboarding";

/**
 * The parental leave checklist: what the owner must do when an employee (or their
 * partner) is expecting or adopting a child, is on parental leave, asks to extend
 * it, or comes back. Code decides the items so none is forgotten (the model once
 * left out the 12 months of unpaid leave and who pays Parental Leave Pay); every
 * item links to the official page it comes from. Checked against those pages on
 * PARENTAL_CHECKED_ON. The dated rules (flexible days, Parental Leave Pay weeks)
 * change on 1 July: re-check them then.
 */

export const PARENTAL_CHECKED_ON = "2026-09-26";

const FW = "https://www.fairwork.gov.au/leave/parental-leave";
const SA = "https://www.servicesaustralia.gov.au";
const P = {
  applying: { title: "Fair Work: Applying for parental leave", url: `${FW}/before-parental-leave/applying-for-parental-leave` },
  types: { title: "Fair Work: Types of parental leave", url: `${FW}/before-parental-leave/types-of-parental-leave` },
  pregnant: { title: "Fair Work: Entitlements while pregnant", url: `${FW}/before-parental-leave/entitlements-while-pregnant` },
  extending: { title: "Fair Work: Extending parental leave", url: `${FW}/during-parental-leave/extending-parental-leave` },
  kit: { title: "Fair Work: Keeping in touch days", url: `${FW}/during-parental-leave/keeping-in-touch-days` },
  accruing: { title: "Fair Work: Accruing and taking other leave during parental leave", url: `${FW}/during-parental-leave/accruing-and-taking-other-leave-during-parental-leave` },
  payment: { title: "Fair Work: Payment during parental leave", url: `${FW}/during-parental-leave/payment-during-parental-leave` },
  returning: { title: "Fair Work: Returning to work from parental leave", url: `${FW}/after-parental-leave/returning-to-work-from-parental-leave` },
  factSheet: { title: "Fair Work: Parental leave and related entitlements (fact sheet)", url: "https://www.fairwork.gov.au/tools-and-resources/fact-sheets/minimum-workplace-entitlements/parental-leave-and-related-entitlements" },
  discrimination: { title: "Fair Work: Protection from discrimination at work", url: "https://www.fairwork.gov.au/employment-conditions/protections-at-work/protection-from-discrimination-at-work" },
  plpProviding: { title: "Services Australia: Providing Parental Leave Pay as an employer", url: `${SA}/providing-parental-leave-pay-employer?context=23121` },
  plpDetermination: { title: "Services Australia: Respond to an Employer Determination", url: `${SA}/how-to-respond-to-employer-determination-for-paid-parental-leave-scheme?context=23121` },
  plpRegister: { title: "Services Australia: Register for the Paid Parental Leave scheme", url: `${SA}/how-to-register-for-paid-parental-leave-scheme-for-employers?context=23121` },
};
export const PARENTAL_URLS = Object.values(P).map((s) => s.url);

export type ParentalItem = Omit<ChecklistItem, "when"> & { when: "now" | "before the leave" | "during the leave" | "coming back" };

export interface ParentalOptions {
  /** The employee is the pregnant (birth) parent: safe job, no safe job leave, unpaid special parental leave. */
  birthParent: boolean;
  casual: boolean;
  /** Start of employment and the expected birth or adoption date (YYYY-MM-DD), when known. */
  startDate?: string | null;
  expectedDate?: string | null;
  /** Today (YYYY-MM-DD), used when the expected date is unknown. */
  today: string;
}

const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const minusMonths = (d: string, m: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() - m);
  return x.toISOString().slice(0, 10);
};

/** 12 months of service by the expected date (or today): true, false, or null when the start date is unknown. */
export function serviceEligible(o: Pick<ParentalOptions, "startDate" | "expectedDate" | "today">): boolean | null {
  if (!isDate(o.startDate)) return null;
  const by = isDate(o.expectedDate) ? o.expectedDate : o.today;
  return o.startDate <= minusMonths(by, 12);
}

export function parentalChecklist(o: ParentalOptions): ParentalItem[] {
  const eligible = serviceEligible(o);
  const by = isDate(o.expectedDate) ? `by the expected date (${o.expectedDate})` : "by the time the leave starts";
  const service =
    eligible === true
      ? `They have 12 months of service ${by} (started ${o.startDate}), so the service requirement is met${o.casual ? " if the work was regular and systematic and they reasonably expected it to continue" : ""}.`
      : eligible === false
        ? `They started ${o.startDate}, so they will NOT have 12 months of service ${by}: no unpaid parental leave under the NES yet (check the award, contract and the business's own policy). Safe job rights, discrimination protection and government Parental Leave Pay (claimed from Services Australia) still apply.`
        : "Check their start date: they need at least 12 months of service before the expected birth or adoption.";
  const items: ParentalItem[] = [
    {
      when: "now",
      task: "Do not cut their hours, change their job to their disadvantage, replace them or treat them differently because of the pregnancy, the coming child or family responsibilities. Plan cover instead, and talk with them about their plans.",
      why: "Pregnancy, family or carer's responsibilities and breastfeeding are protected: acting on them is unlawful discrimination and adverse action.",
      source: P.discrimination,
    },
  ];
  if (o.birthParent) {
    items.push({
      when: "now",
      task: "If their job has risks during the pregnancy, move them to a safe job. If there is no safe job, they take no safe job leave (paid at base pay if they are eligible for unpaid parental leave and gave the notice and evidence; otherwise unpaid). Unpaid special parental leave covers a pregnancy-related illness, or a pregnancy loss after 12 weeks (other than a stillbirth).",
      why: "All pregnant employees, including casuals, have the right to a safe job, even if they are not eligible for parental leave.",
      source: P.pregnant,
    });
  }
  items.push(
    {
      when: "now",
      task: `Check eligibility for unpaid parental leave: at least 12 months of service${o.casual ? "; as a casual, regular and systematic work for at least 12 months and a reasonable expectation of continuing work" : ""}. ${service}`,
      why: "Unpaid parental leave under the NES needs 12 months of service before the birth, the adoption or the start of the leave.",
      source: P.applying,
    },
    {
      when: "before the leave",
      task: "Ask for their notice in writing: at least 10 weeks before the leave starts (or as soon as possible), with the start and end dates; they confirm the dates at least 4 weeks before. You may ask for evidence of the expected date (e.g. a medical certificate).",
      why: "The NES sets the notice and evidence; the dates let you plan cover (a fixed-term contract for the cover is common).",
      source: P.applying,
    },
    {
      when: "before the leave",
      task: "Explain the entitlement: up to 12 months of unpaid parental leave, and they can request up to 12 more. Part of the 12 months can be taken as flexible days (up to 130 days for a child born or adopted from 1 July 2026) until the child's second birthday. A non-birthing parent has the same 12 months, within 24 months of the birth; each parent's leave does not reduce the other's.",
      why: "These are NES minimums; the business's own paid parental leave policy comes on top.",
      source: P.types,
    },
    {
      when: "before the leave",
      task: "Government Parental Leave Pay: up to 26 weeks per family for a child born or adopted from 1 July 2026, funded by the government. The employee claims it from Services Australia. If you receive an Employer Determination (usually an employee with you 12 months or more), accept it or ask for a review within 14 days, register for the scheme (PRODA, then Business Hub), and pay it through your normal pay cycle with the government's funds.",
      why: "Employers must provide Parental Leave Pay to eligible long-term employees in their pay cycle; the government pays the money to the employer first.",
      source: P.plpDetermination,
    },
    {
      when: "before the leave",
      task: "Super on Parental Leave Pay (child born or adopted from 1 July 2025) is paid by the ATO to the employee's fund; you don't calculate or pay it. Only certain deductions (e.g. tax withholding) can come out of Parental Leave Pay.",
      why: "Services Australia's rules for employers who provide Parental Leave Pay.",
      source: P.plpProviding,
    },
    {
      when: "during the leave",
      task: "Keep them informed about any decision that significantly affects the status, pay or location of their job, and give them a chance to discuss it. Up to 10 keeping in touch days can be agreed (paid as normal work); none in the 14 days after the birth.",
      why: "The NES requires consultation while they are away; keeping in touch days are optional and by agreement.",
      source: P.kit,
    },
    {
      when: "during the leave",
      task: "Paid leave does not usually accrue during unpaid parental leave (keeping in touch days and paid leave taken are exceptions; long service leave depends on the state).",
      why: "Get the payroll settings right for the leave period.",
      source: P.accruing,
    },
    {
      when: "during the leave",
      task: "Extensions. Within the first 12 months: if they planned less than 12 months, they can extend up to a total of 12 months by written notice at least 4 weeks before their current end date (no approval needed; any further change within the 12 months needs agreement). Beyond 12 months: they can request up to 12 more months (in writing, at least 4 weeks before the first 12 months end; within 24 months of the birth); answer in writing within 21 days. You can refuse only after discussing it and genuinely trying to agree, considering the consequences for them, and on reasonable business grounds; a refusal must give the reasons, any other period you would agree to, and the Fair Work Commission dispute process. Get advice before refusing.",
      why: "The NES sets the process; a refusal without it can be taken to the Fair Work Commission.",
      source: P.extending,
    },
    {
      when: "coming back",
      task: "They return to the job they had before the leave (or their pre-pregnancy job if they moved to a safe job or reduced hours), even if someone else is doing it. If that job no longer exists, offer the available job they are qualified and suited for that is nearest in pay and status.",
      why: "The return to work guarantee under the NES.",
      source: P.returning,
    },
    {
      when: "coming back",
      task: "Breastfeeding is protected: talk with them about breaks and a private, clean place to express milk (not a toilet) that works for the business.",
      why: "Refusing reasonable arrangements can be discrimination because of breastfeeding.",
      source: P.discrimination,
    },
  );
  if (eligible === false) {
    // Not NES unpaid parental leave: its notice, 12 months, keeping in touch, extension and return guarantee don't apply as such.
    const nesOnly = [P.types, P.kit, P.accruing, P.extending, P.returning];
    const kept = items.filter((i) => !nesOnly.includes(i.source) && !(i.source === P.applying && i.when === "before the leave"));
    kept.splice(kept.findIndex((i) => i.when !== "now"), 0, {
      when: "before the leave",
      task: "Any leave they take is by agreement or under the business's own policy, not NES unpaid parental leave, so the NES notice, extension and return-to-work rules don't apply as such. Agree the leave in writing (dates, keeping in touch, the return date and role), follow the policy, and treat them fairly and the same as anyone else.",
      why: "The NES entitlement needs 12 months of service; the protections against discrimination and adverse action apply regardless.",
      source: P.applying,
    });
    return kept;
  }
  return items;
}

export function formatParental(items: ParentalItem[]): string {
  const order: ParentalItem["when"][] = ["now", "before the leave", "during the leave", "coming back"];
  return order
    .flatMap((w) => {
      const group = items.filter((i) => i.when === w);
      return group.length ? [`${w[0].toUpperCase()}${w.slice(1)}:`, ...group.map((i) => `- ${i.task} Why: ${i.why} Source: ${i.source.title} ${i.source.url}`)] : [];
    })
    .join("\n");
}

/** The checklist as tool text, with instructions for presenting it. */
export function parentalText(o: ParentalOptions): string {
  const e = serviceEligible(o);
  const headline =
    e === false
      ? "Start with this: they are NOT eligible for unpaid parental leave under the NES (less than 12 months of service). Do not present NES rights (the 12 months, extension requests, the 21-day reply, the return to work guarantee) as applying to them.\n"
      : e === null
        ? "Their eligibility is unknown (no start date): say that NES unpaid parental leave needs 12 months of service, and check it before relying on the NES items.\n"
        : "";
  return (
    headline +
    `Parental leave checklist (${o.birthParent ? "pregnant employee" : "employee whose partner is having or adopting a child, or adopting"}${o.casual ? ", casual" : ""}; official sources checked ${PARENTAL_CHECKED_ON}):\n${formatParental(parentalChecklist(o))}\n\n` +
    "Answer the owner's actual question first, then give the items that matter now, in plain language, keeping each item's source link; mention the later stages briefly. " +
    "Add the business's own paid parental leave from its policies (read_policy) or profile on top of these; never say the NES minimum is all they get if the business offers more. " +
    "Keep health details out of letters and the register. Do not calculate any pay amount."
  );
}

export function parentalLeaveTools(today: () => string): ClientTool[] {
  return [
    {
      name: "parental_leave_checklist",
      description:
        "Get the official checklist for parental leave (pregnancy at work, eligibility, notice, unpaid leave and flexible days, government Parental Leave Pay and the employer's part in it, keeping in touch, extension requests, return to work), with verified links. " +
        "Call it whenever an employee or their partner is pregnant, having or adopting a child, is on or asks to extend parental leave, or is coming back from it.",
      inputSchema: {
        type: "object",
        properties: {
          is_birth_parent: { type: "boolean", description: "true if the employee is the one who is pregnant." },
          is_casual: { type: "boolean" },
          start_date: { type: ["string", "null"], description: "The employee's start date (YYYY-MM-DD) from the register, or null if unknown." },
          expected_date: { type: ["string", "null"], description: "Expected or actual birth or adoption date (YYYY-MM-DD; for someone already on leave, the birth date), or null if unknown. Eligibility is 12 months of service by this date." },
        },
        required: ["is_birth_parent", "is_casual", "start_date", "expected_date"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { is_birth_parent?: boolean; is_casual?: boolean; start_date?: string | null; expected_date?: string | null };
        const o: ParentalOptions = { birthParent: a.is_birth_parent === true, casual: a.is_casual === true, startDate: a.start_date ?? null, expectedDate: a.expected_date ?? null, today: today() };
        const e = serviceEligible(o);
        return { success: true, text: parentalText(o), display: `parental leave checklist${o.birthParent ? ": pregnant employee" : ""}; 12 months' service: ${e === null ? "unknown" : e ? "yes" : "no"}` };
      },
    },
  ];
}
