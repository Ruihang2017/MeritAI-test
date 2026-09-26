import type { ClientTool } from "../engine/types";
import type { BusinessStore } from "./profile";

/**
 * The new-starter compliance checklist (plan P1). Code, not the model, decides
 * which legal items apply, so none is forgotten (e.g. the CEIS for a casual).
 * The model personalises it (dates, who does what) and drafts the documents.
 *
 * Every item comes from an official page; the URLs and wording were checked
 * against those pages on CHECKED_ON. Re-check them when rules change (e.g. the
 * 1 July annual changes). URLs returned by this tool count as verified for the
 * unverified-link guard.
 */

export const CHECKED_ON = "2026-09-26";

export type EmploymentType = "full-time" | "part-time" | "casual" | "fixed-term";

export interface ChecklistItem {
  when: "before start" | "on or before day one" | "first weeks" | "ongoing";
  task: string;
  /** One line: why (the legal requirement or risk). */
  why: string;
  source: { title: string; url: string };
}

const S = {
  hiring: { title: "business.gov.au: Hiring employees", url: "https://www.business.gov.au/people/hiring/hiring-employees" },
  findAward: { title: "Fair Work: Find my award", url: "https://calculate.fairwork.gov.au/findyouraward" },
  pact: { title: "Fair Work: Pay and Conditions Tool", url: "https://calculate.fairwork.gov.au/" },
  contractTool: { title: "business.gov.au: Employment Contract Tool", url: "https://employ.business.gov.au/" },
  fixedTerm: { title: "Fair Work: Fixed term contract employees", url: "https://www.fairwork.gov.au/starting-employment/types-of-employees/fixed-term-contract-employees" },
  vevo: { title: "Home Affairs: VEVO for organisations (checking work rights)", url: "https://immi.homeaffairs.gov.au/visas/already-have-a-visa/check-visa-details-and-conditions/check-conditions-online/for-organisations" },
  sponsorObligations: { title: "Home Affairs: Sponsor obligations (notify changes within 28 days)", url: "https://immi.homeaffairs.gov.au/visas/employing-and-sponsoring-someone/existing-sponsors/standard-business-accredited-obligations" },
  fwis: { title: "Fair Work: Fair Work Information Statement", url: "https://www.fairwork.gov.au/employment-conditions/information-statements/fair-work-information-statement" },
  ceis: { title: "Fair Work: Casual Employment Information Statement", url: "https://www.fairwork.gov.au/employment-conditions/information-statements/casual-employment-information-statement" },
  ftcis: { title: "Fair Work: Fixed Term Contract Information Statement", url: "https://www.fairwork.gov.au/employment-conditions/information-statements/fixed-term-contract-information-statement" },
  tfn: { title: "ATO: TFN declaration", url: "https://www.ato.gov.au/forms-and-instructions/tfn-declaration" },
  superChoice: { title: "ATO: Offer employees a choice of super fund", url: "https://www.ato.gov.au/businesses-and-organisations/super-for-employers/setting-up-super-for-your-business/offer-employees-a-choice-of-super-fund" },
  stapled: { title: "ATO: Stapled super funds for employers", url: "https://www.ato.gov.au/businesses-and-organisations/super-for-employers/setting-up-super-for-your-business/offer-employees-a-choice-of-super-fund/stapled-super-funds-for-employers" },
  fwHiring: { title: "Fair Work: Hiring employees", url: "https://www.fairwork.gov.au/starting-employment/hiring-employees" },
  payslips: { title: "Fair Work: Pay slips", url: "https://www.fairwork.gov.au/pay-and-wages/paying-wages/pay-slips" },
  records: { title: "Fair Work: Record-keeping", url: "https://www.fairwork.gov.au/pay-and-wages/paying-wages/record-keeping" },
  probation: { title: "Fair Work: Probation", url: "https://www.fairwork.gov.au/starting-employment/probation" },
  apprentices: { title: "Fair Work: Apprentices and trainees", url: "https://www.fairwork.gov.au/starting-employment/types-of-employees/apprentices-and-trainees" },
  finalPay: { title: "Fair Work: Final pay", url: "https://www.fairwork.gov.au/ending-employment/final-pay" },
  atoLeaving: { title: "ATO: When a worker leaves your business", url: "https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/engaging-a-worker/when-a-worker-leaves-your-business" },
  separation: { title: "Services Australia: Employment Separation Certificates for employers", url: "https://www.servicesaustralia.gov.au/employment-separation-certificates-for-employers" },
  casual: { title: "Fair Work: Casual employees", url: "https://www.fairwork.gov.au/starting-employment/types-of-employees/casual-employees" },
  paydaySuper: { title: "ATO: Payment deadlines for Payday Super", url: "https://www.ato.gov.au/businesses-and-organisations/super-for-employers/paying-super-on-payday/payment-deadlines-for-payday-super" },
  unfairDismissal: { title: "Fair Work: Unfair dismissal (Small Business Fair Dismissal Code)", url: "https://www.fairwork.gov.au/ending-employment/help-with-termination/unfair-dismissal" },
  apprenticeSupport: { title: "DEWR: Apprenticeship support (Apprentice Connect Australia Providers)", url: "https://www.dewr.gov.au/australian-apprenticeships/apprenticeship-support" },
  apprenticeEntitlements: { title: "Fair Work: Apprentices (training time, fees and textbooks)", url: "https://www.fairwork.gov.au/starting-employment/types-of-employees/apprentices-and-trainees/apprentices" },
  whiteCard: { title: "Safe Work Australia: Working on a construction site (White Card)", url: "https://www.safeworkaustralia.gov.au/safety-topic/industry-and-business/construction/working-construction-site" },
};
export { S as SOURCES };

/**
 * State and territory training authorities for apprentices and trainees, as listed on
 * Fair Work's "Apprentices and trainees" page (checked 2026-09-26).
 */
export const TRAINING_AUTHORITIES: Record<string, { title: string; url: string }> = {
  ACT: { title: "Skills Canberra, (02) 6205 8555", url: "https://www.act.gov.au/skills" },
  NSW: { title: "Skills NSW, 13 28 11", url: "https://skills.education.nsw.gov.au/" },
  NT: { title: "NT Department of Industry, Tourism and Trade, (08) 8935 7707", url: "https://nt.gov.au/employ/apprenticeships-and-traineeships" },
  QLD: { title: "Queensland Department of Trade, Employment and Training, 1800 210 210", url: "https://dtet.qld.gov.au/training/apprentices" },
  SA: { title: "SA Skills Commission, 1800 006 488", url: "https://skillscommission.sa.gov.au/" },
  TAS: { title: "Skills Tasmania, 1800 655 846", url: "https://www.skills.tas.gov.au/learners" },
  VIC: { title: "Apprenticeships Victoria, 13 18 23", url: "https://www.apprenticeships.vic.gov.au/" },
  WA: { title: "Apprenticeship Office WA, 13 19 54", url: "https://www.dtwd.wa.gov.au/apprenticeship-office" },
};

/** The training authorities for the business's states (all of them if unknown). */
export function authoritiesFor(states: string[]): { title: string; url: string }[] {
  const known = states.filter((s) => TRAINING_AUTHORITIES[s]);
  return (known.length ? known : Object.keys(TRAINING_AUTHORITIES)).map((s) => ({ ...TRAINING_AUTHORITIES[s], title: `${s}: ${TRAINING_AUTHORITIES[s].title}` }));
}

/** Every official URL this module can return (for tests and docs). */
export const CHECKLIST_URLS = [...Object.values(S), ...Object.values(TRAINING_AUTHORITIES)].map((s) => s.url);

export function newStarterChecklist(opts: {
  employmentType: EmploymentType;
  /** True if the new starter is not an Australian citizen or permanent resident, or it is unknown. */
  mayNeedVisaCheck: boolean;
  /** Fewer than 15 employees (Fair Work's small business employer); null if unknown. */
  smallBusiness: boolean | null;
  /** An apprentice or trainee (a training contract registered with the state training authority). */
  apprentice?: boolean;
  /** States where the business employs staff (for the training authority). */
  states?: string[];
  /** They will do construction work on a construction site (a White Card is needed first). */
  constructionSite?: boolean;
}): ChecklistItem[] {
  const { employmentType: type } = opts;
  const items: ChecklistItem[] = [
    {
      when: "before start",
      task: "Confirm which award covers the role and the classification level, then the minimum pay rate, penalties and allowances.",
      why: "Pay can never be below the award and the NES; underpayment is the most common small business breach.",
      source: S.findAward,
    },
    {
      when: "before start",
      task: "Work out the pay for the role with the Pay and Conditions Tool (use the award, level and employment type).",
      why: "It gives the current minimum rates, including penalty rates and casual loading.",
      source: S.pact,
    },
    {
      when: "before start",
      task:
        "Put the offer in writing and have a written employment contract signed. For award-covered employees paid hourly or weekly, the government's free Employment Contract Tool builds a compliant contract.",
      why: "A contract cannot give less than the award or NES; a written contract avoids disputes about what was agreed.",
      source: S.contractTool,
    },
  ];
  if (type === "fixed-term") {
    items.push({
      when: "before start",
      task: "Check the fixed-term rules: limits on the length of the contract and how many times it can be renewed.",
      why: "Fixed-term contracts that break the limits are not allowed.",
      source: S.fixedTerm,
    });
  }
  if (type === "part-time") {
    items.push({
      when: "before start",
      task: "Agree the regular hours and days in writing (many awards require a written part-time hours agreement).",
      why: "Part-time employees need predictable, agreed hours; the award sets the details.",
      source: S.fwHiring,
    });
  }
  if (opts.apprentice) {
    items.push({
      when: "before start",
      task: "Contact an Apprentice Connect Australia Provider (free, government-funded): they organise the training contract with you and the apprentice, lodge it with the state training authority for registration, and explain the employer incentives.",
      why: "The Provider is the first point of contact for employers taking on an apprentice or trainee.",
      source: S.apprenticeSupport,
    });
    for (const a of authoritiesFor(opts.states ?? [])) {
      items.push({
        when: "before start",
        task: `Sign the training contract with the apprentice or trainee and have it registered with the state training authority (${a.title}) within its time frame (e.g. in Victoria and Queensland it must be signed within 14 days of starting); arrange the training with a registered training organisation (e.g. TAFE).`,
        why: "Apprenticeships and traineeships must be registered with the state or territory training authority; the training contract sets rights and obligations, including its own probation and cancellation rules. Apprentice pay rates come from the award.",
        source: a,
      });
    }
    items.push({
      when: "first weeks",
      task: "Pay for training: time at trade school or TAFE is paid time and counts as ordinary hours. Many awards also require reimbursing the training fees and textbooks: check the award.",
      why: "Apprentice pay rates apply only with a registered training contract, and the award's apprentice entitlements come on top.",
      source: S.apprenticeEntitlements,
    });
    items.push({
      when: "before start",
      task: "Read Fair Work's guidance for apprentices and trainees (pay, training time, and what happens when the apprenticeship ends).",
      why: "Apprentices are usually full-time or part-time employees with extra rules on top of the award.",
      source: S.apprentices,
    });
  }
  if (opts.constructionSite) {
    items.push({
      when: "before start",
      task: "Check they hold a White Card (general construction induction); if not, they complete the course before their first day on a construction site.",
      why: "Workers must have a White Card before they start working on a construction site; it is recognised Australia-wide.",
      source: S.whiteCard,
    });
  }
  if (opts.mayNeedVisaCheck) {
    items.push({
      when: "before start",
      task: "Check the person's right to work and any visa conditions (e.g. work hour limits) in VEVO, with their permission, and save the VEVO result (PDF) as your record. Roster them within their visa conditions.",
      why: "Employing someone without work rights, or in breach of their visa conditions, is an offence.",
      source: S.vevo,
    });
  }
  items.push({
    when: "on or before day one",
    task: "Give the Fair Work Information Statement (FWIS).",
    why: "Every new employee must get it before, or as soon as possible after, they start.",
    source: S.fwis,
  });
  if (type === "casual") {
    const later =
      opts.smallBusiness === true
        ? "Give it again after 12 months of employment (small business employer, fewer than 15 employees)."
        : opts.smallBusiness === false
          ? "Give it again after 6 and 12 months of employment, then every 12 months (15 or more employees)."
          : "Give it again later: after 12 months for a small business employer (fewer than 15 employees); otherwise after 6 and 12 months, then every 12 months.";
    items.push({
      when: "on or before day one",
      task: `Give the Casual Employment Information Statement (CEIS) at the same time as the FWIS. ${later}`,
      why: "Required for every casual employee; it explains casual employment and the pathway to permanent work.",
      source: S.ceis,
    }, {
      when: "on or before day one",
      task: "Know what casuals get: a casual loading instead of paid annual and personal leave, but under the NES they still get 10 days' paid family and domestic violence leave a year, 2 days' unpaid carer's leave and 2 days' unpaid compassionate leave per occasion, and unpaid community service leave; long service leave depends on state law. Contracts and leave decisions must not leave these out.",
      why: "These NES entitlements apply to casual employees too.",
      source: S.casual,
    });
  }
  if (type === "fixed-term") {
    items.push({
      when: "before start",
      task: "Give the Fixed Term Contract Information Statement (FTCIS) when you enter into the fixed-term contract (usually when it is signed).",
      why: "Required when an employee enters a new fixed-term contract.",
      source: S.ftcis,
    });
  }
  items.push(
    {
      when: "on or before day one",
      task: "Ask the new employee to complete a TFN declaration.",
      why: "You need it to work out how much tax to withhold from their pay.",
      source: S.tfn,
    },
    {
      when: "first weeks",
      task:
        "Give the Superannuation standard choice form (with your default fund filled in) within 28 days of the start date. If they do not choose a fund, request their stapled super fund details from the ATO before paying any super.",
      why: "Choice of fund is a legal requirement; paying into the wrong fund does not count.",
      source: S.superChoice,
    },
    {
      when: "first weeks",
      task: "If needed, request the employee's stapled super fund through ATO online services (you can do this once they accept the offer).",
      why: "Without a chosen fund, super must go to the stapled fund, or to your default fund only if the ATO says there is none.",
      source: S.stapled,
    },
    {
      when: "on or before day one",
      task: "Run an induction: workplace safety (WHS) for the site and tasks, your expectations and rules, who to ask for help.",
      why: "Recommended by Fair Work; WHS laws also require you to give workers the information and training they need to work safely.",
      source: S.fwHiring,
    },
    {
      when: "ongoing",
      task: "Keep time and wages records, and give a pay slip within one working day of each payday.",
      why: "Both are legal requirements for every employee.",
      source: S.payslips,
    },
    {
      when: "ongoing",
      task: "Pay super so it reaches the fund within 7 business days after each payday (20 business days for the first contribution for a new employee).",
      why: "Payday Super applies from 1 July 2026; the old quarterly due dates no longer apply.",
      source: S.paydaySuper,
    },
    {
      when: "ongoing",
      task: "If you use a probation period, diarise check-ins and the end date, and confirm the outcome in writing before it ends.",
      why: "Probation is set by the employer (often 3 to 6 months); NES entitlements still apply during it.",
      source: S.probation,
    },
  );
  return items;
}

export function formatChecklist(items: ChecklistItem[]): string {
  const order: ChecklistItem["when"][] = ["before start", "on or before day one", "first weeks", "ongoing"];
  const lines: string[] = [];
  for (const w of order) {
    const group = items.filter((i) => i.when === w);
    if (!group.length) continue;
    lines.push(`${w[0].toUpperCase()}${w.slice(1)}:`);
    for (const i of group) lines.push(`- ${i.task} Why: ${i.why} Source: ${i.source.title} ${i.source.url}`);
  }
  return lines.join("\n");
}

export function onboardingTools(business: () => BusinessStore): ClientTool[] {
  return [
    {
      name: "pay_check_tools",
      description:
        "Get the official Fair Work tools for checking awards and pay (Find my award, the Pay and Conditions Tool) and the Fair Work Infoline, with verified links. Call it when the owner asks which award applies or what to pay.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handle: async () => ({
        success: true,
        text:
          `Official tools (checked ${CHECKED_ON}):\n` +
          `- ${S.findAward.title}: ${S.findAward.url} (answer questions about the business and the work to find the award)\n` +
          `- ${S.pact.title}: ${S.pact.url} (choose the award, classification and employment type to get base rates, penalties, overtime, casual loading and allowances)\n` +
          `- Fair Work Infoline: 13 13 94 (free advice; see ${S.fwHiring.url})\n\n` +
          "Do not calculate what is owed for specific hours or shifts, and do not total up pay, even if the owner asks: a wrong total becomes an underpayment. " +
          "Give the rates the official sources returned (with the date), list what applies (e.g. weekend penalty, casual loading, allowances), and have the owner enter the hours in the Pay and Conditions Tool.",
        display: "pay tools",
      }),
    },
    {
      name: "new_starter_checklist",
      description:
        "Get the official compliance checklist for hiring a new employee (documents to give, tax and super, right to work, pay, records), for one employment type, with verified official links. " +
        "Call it whenever the user is hiring or onboarding someone, or drafting an offer or employment contract.",
      inputSchema: {
        type: "object",
        properties: {
          employment_type: { type: "string", enum: ["full-time", "part-time", "casual", "fixed-term"] },
          may_need_visa_check: {
            type: "boolean",
            description: "true unless the user said the person is an Australian citizen or permanent resident.",
          },
          is_apprentice_or_trainee: { type: "boolean", description: "true for an apprentice or trainee (training contract)." },
          works_on_construction_sites: { type: "boolean", description: "true if they will do construction work on a construction site (building, plumbing, electrical, landscaping construction...)." },
        },
        required: ["employment_type", "may_need_visa_check", "is_apprentice_or_trainee", "works_on_construction_sites"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { employment_type?: string; may_need_visa_check?: boolean; is_apprentice_or_trainee?: boolean; works_on_construction_sites?: boolean };
        const type = a.employment_type as EmploymentType;
        if (!["full-time", "part-time", "casual", "fixed-term"].includes(type)) return { success: false, text: "employment_type must be full-time, part-time, casual or fixed-term." };
        const p = business().get();
        const items = newStarterChecklist({
          employmentType: type,
          mayNeedVisaCheck: a.may_need_visa_check !== false,
          smallBusiness: p.headcount === null ? null : p.headcount < 15,
          apprentice: a.is_apprentice_or_trainee === true,
          constructionSite: a.works_on_construction_sites === true,
          states: p.states,
        });
        return {
          success: true,
          text:
            `New starter checklist (${type}; official sources checked ${CHECKED_ON}):\n${formatChecklist(items)}\n\n` +
            "Present it as a practical checklist in plain language, grouped by timing, keeping every item and its source link. Add the business's own steps from its profile or policies where relevant. " +
            "Pay rates and super percentages are not included on purpose: use search_official_sources or the Pay and Conditions Tool for figures.",
          display: `checklist: ${type}`,
        };
      },
    },
  ];
}
