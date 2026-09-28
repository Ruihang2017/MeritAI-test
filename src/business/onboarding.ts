import type { ClientTool } from "../engine/types";
import type { BusinessStore } from "./profile";
import { startDateHolidayNote } from "./publicHolidays";
import { longDate } from "./weekdayGuard";

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

export const CHECKED_ON = "2026-09-27";

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
  // Round 5 evaluation fixes (2026-09-27): first-employer registrations, workers compensation, TFN payer steps, working holiday makers.
  paygRegister: { title: "business.gov.au: Register for PAYG withholding", url: "https://business.gov.au/registrations/register-for-taxes/register-for-pay-as-you-go-payg-withholding" },
  stp: { title: "ATO: What is Single Touch Payroll", url: "https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/single-touch-payroll/what-is-stp" },
  workersComp: { title: "business.gov.au: Workers compensation insurance", url: "https://business.gov.au/risk-management/insurance/types-of-business-insurance" },
  tfnPayer: { title: "ATO: TFN declaration, payer information and obligations", url: "https://www.ato.gov.au/forms-and-instructions/tfn-declaration/payer-information-and-obligations" },
  dismissal: { title: "Fair Work: Dismissal (notice periods)", url: "https://www.fairwork.gov.au/ending-employment/dismissal" },
  redundancy: { title: "Fair Work: Redundancy (genuine redundancy)", url: "https://www.fairwork.gov.au/ending-employment/redundancy" },
  redundancyPay: { title: "Fair Work: Redundancy pay and entitlements", url: "https://www.fairwork.gov.au/ending-employment/redundancy/redundancy-pay-and-entitlements" },
  resignation: { title: "Fair Work: Resignation", url: "https://www.fairwork.gov.au/ending-employment/resignation" },
  annualised: { title: "Fair Work: Annualised wage arrangements", url: "https://www.fairwork.gov.au/pay-and-wages/minimum-wages/annualised-salaries" },
  whm: { title: "ATO: Working holiday makers", url: "https://www.ato.gov.au/individuals-and-families/coming-to-australia-or-going-overseas/coming-to-australia/working-holiday-makers" },
  // Round 6 evaluation fix (Home Affairs, checked 2026-09-28): condition 8547.
  whm6: { title: "Home Affairs: Permission to work longer than 6 months with one employer (condition 8547)", url: "https://immi.homeaffairs.gov.au/visas/already-have-a-visa/check-visa-details-and-conditions/waivers-and-permissions/work-longer-than-6-months" },
  // Round 6 onboarding details (checked 2026-09-28): contracts can be verbal, training is paid, minimum hours per award, casual to permanent, visa holders' rights.
  aboutContracts: { title: "Fair Work: About employment contracts", url: "https://www.fairwork.gov.au/employment-conditions/employment-contracts/about-employment-contracts" },
  unpaidWork: { title: "Fair Work: Unpaid work (training)", url: "https://www.fairwork.gov.au/starting-employment/unpaid-work" },
  hoursOfWork: { title: "Fair Work: Hours of work", url: "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters/hours-of-work" },
  casualPermanent: { title: "Fair Work: Becoming a permanent employee", url: "https://www.fairwork.gov.au/starting-employment/types-of-employees/casual-employees/becoming-a-permanent-employee" },
  workRights: { title: "Home Affairs: Workers rights and visa reporting protections", url: "https://immi.homeaffairs.gov.au/visas/working-in-australia/work-rights-and-exploitation" },
  // An employee based in another state (checked 2026-09-29).
  publicHolidays: { title: "Fair Work: Public holidays", url: "https://www.fairwork.gov.au/employment-conditions/public-holidays" },
  lsl: { title: "Fair Work: Long service leave", url: "https://www.fairwork.gov.au/leave/long-service-leave" },
};

/** Long service leave agencies by state, as Fair Work's "Long service leave" page lists them (checked 2026-09-29). */
export const LSL_AGENCIES: Record<string, string> = {
  ACT: "WorkSafe ACT",
  NSW: "NSW Industrial Relations",
  NT: "NT Government",
  QLD: "Queensland Industrial Relations",
  SA: "SafeWork SA",
  TAS: "WorkSafe Tasmania",
  VIC: "Workforce Inspectorate Victoria",
  WA: "Department of Local Government, Industry Regulation and Safety (WA)",
};
export const STATE_CODES = Object.keys(LSL_AGENCIES);
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
  /** The business's first employee (or payroll isn't set up yet): the employer registrations come first. */
  firstEmployee?: boolean;
  /** On a Working Holiday (417) or Work and Holiday (462) visa. */
  workingHolidayMaker?: boolean;
  /** The state or territory where they are based for work, when it isn't one of the business's `states`. */
  workState?: string | null;
}): ChecklistItem[] {
  const { employmentType: type } = opts;
  const items: ChecklistItem[] = [];
  const known = opts.states ?? [];
  // Where they are based, when it matters: outside the business's state(s), or one of several (round 6, onb-08: a Sydney
  // employee of a business in VIC and NSW got no NSW items). A one-state business in its own state: nothing to add.
  const ws = opts.workState && STATE_CODES.includes(opts.workState) && known.length ? opts.workState : null;
  const outside = ws !== null && !known.includes(ws);
  const based = ws !== null && (outside || known.length > 1) ? ws : null;
  const bizIn = `the business is in ${known.join(", ")}`;
  if (opts.firstEmployee) {
    items.push(
      {
        when: "before start",
        task: "Register for PAYG withholding with the ATO (online, or through your tax or BAS agent) before the first pay you withhold tax from.",
        why: "You must be registered before you make the first payment you withhold tax from.",
        source: S.paygRegister,
      },
      {
        when: "before start",
        task: "Set up payroll software that reports through Single Touch Payroll (STP Phase 2): you report each employee's pay, tax withheld and super to the ATO each time you pay them.",
        why: "STP reporting is mandatory for employers, including those new to employing.",
        source: S.stp,
      },
    );
  }
  items.push({
    when: "before start",
    task: based
      ? `Make sure you have workers compensation insurance that covers them before they start (from an authorised insurer; the rules are set by each state's or territory's regulator). They will be based in ${based} (${bizIn}): ask your insurer or the ${based} regulator which scheme covers them and whether your cover includes ${based}.`
      : "Make sure you have workers compensation insurance that covers them before they start (from an authorised insurer; the rules are set by your state or territory regulator). If they will work in another state, for example from home, ask your insurer or that state's regulator which scheme covers them.",
    why: "Employers must have workers compensation insurance for their employees; the laws vary between states and territories.",
    source: S.workersComp,
  });
  if (based) {
    items.push(
      {
        when: "before start",
        task: `They will be based in ${based} (${bizIn}): they get ${based}'s public holidays (where they are based for work), so roster and pay them for those${outside ? `, not ${known.join(", ")}'s` : ""}.`,
        why: "An employee is entitled to the public holidays where they are based for work.",
        source: S.publicHolidays,
      },
      {
        when: "ongoing",
        task: `Long service leave comes from state and territory laws, which differ (for example in how long they must work first, and casuals in some states). Ask which state's law covers someone based in ${based} (${bizIn}): ${[based, ...known].filter((s, i, all) => all.indexOf(s) === i && LSL_AGENCIES[s]).map((s) => LSL_AGENCIES[s]).join(" or ")}. Don't state the entitlement until then.`,
        why: "Most employees' long service leave comes from the long service leave law of a state or territory, and the laws differ.",
        source: S.lsl,
      },
    );
  }
  items.push(
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
        `Put the offer in writing and have a written employment contract signed. This is good practice, not a general legal requirement: a contract can be written or verbal (${S.aboutContracts.title} ${S.aboutContracts.url}), but writing avoids disputes, and some things must be in writing, such as a part-time employee's agreed hours under many awards. For award-covered employees paid hourly or weekly, the government's free Employment Contract Tool builds a compliant contract.`,
      why: "A contract cannot give less than the award or NES; a written contract shows what was agreed.",
      source: S.contractTool,
    },
  );
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
      task: "Ask whether they are an Australian citizen or permanent resident; VEVO is for visa holders (a New Zealand citizen usually holds a Special Category visa, checked in VEVO too). For a visa holder, check their right to work and any visa conditions (e.g. work hour limits) in VEVO, with their permission, and save the VEVO result (PDF) as your record. Roster them within their visa conditions.",
      why: "Employing someone without work rights, or in breach of their visa conditions, is an offence.",
      source: S.vevo,
    }, {
      when: "before start",
      task: "Pay and treat a visa holder like anyone else: the same minimum pay and workplace rights, whatever their citizenship or visa. You may check their passport, but never take it from them.",
      why: "Workers have the same basic workplace rights regardless of citizenship or visa; it is illegal for an employer to take a worker's passport.",
      source: S.workRights,
    });
  }
  if (opts.workingHolidayMaker) {
    items.push({
      when: "before start",
      task: "They are a working holiday maker (visa subclass 417 or 462): register with the ATO as an employer of working holiday makers before you pay them, and withhold tax at the working holiday maker rates.",
      why: "If you are not registered as a working holiday maker employer, you must withhold tax at the higher foreign resident rates.",
      source: S.whm,
    });
    items.push({
      when: "before start",
      task: "Working holiday makers can generally work for any one employer for at most 6 months (visa condition 8547), counting earlier work for your business. Check VEVO for the condition, note when the 6 months end, and don't keep them on past that unless their work falls under an exemption or Home Affairs has given permission.",
      why: "Working past the limit breaches their visa condition.",
      source: S.whm6,
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
    }, {
      when: "on or before day one",
      task: "Check the award's minimum hours for each shift (the minimum engagement): many awards pay a casual for at least a set number of hours each time they work, so a short induction or training shift may still be paid for that minimum. Don't state the number; the award or the Pay and Conditions Tool gives it.",
      why: "Minimum hours of work differ between awards.",
      source: S.hoursOfWork,
    }, {
      when: "ongoing",
      task: `Casual to permanent: you can offer permanent work at any time. Under the NES employee choice pathway, a casual can give written notice after ${opts.smallBusiness === true ? "12 months (small business employer)" : opts.smallBusiness === false ? "6 months" : "6 months (12 with a small business employer)"} if they believe they no longer meet the casual definition; you must consult them and answer in writing within 21 days, and can refuse only on the grounds the law sets (casual_to_permanent has the details).`,
      why: "The pathway is part of the NES; a refusal outside the set grounds can lead to a dispute.",
      source: S.casualPermanent,
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
      task:
        "Ask the new employee to complete a TFN declaration: they fill in their part, online through ATO online services (they give you the printed summary) or on the paper form. You then enter their tax details in your payroll and keep the form or summary securely in your records. If you report through STP, you don't send it to the ATO; only with a paper form and no STP-enabled software do you complete Section B (the payer's part) and post it to the ATO within 14 days.",
      why: "You need it to work out how much tax to withhold. If they have applied for a TFN and don't give it to you within 28 days, you must withhold at the top rate.",
      source: S.tfnPayer,
    },
    {
      when: "first weeks",
      task:
        "Give the Superannuation standard choice form, with your default fund's details in Section C, within 28 days of their start date. The 28 days is your deadline to give the form, not theirs to choose. Give them information only: you can't recommend a fund unless you are licensed to give financial advice. Keep the completed form or their ATO online summary for 5 years. (For an employee on a temporary visa the form is optional, but they can still choose a fund.)",
      why: "Offering a choice of fund is a legal requirement; not offering it, or not paying to their chosen fund, can mean the super guarantee charge with a choice loading.",
      source: S.superChoice,
    },
    {
      when: "first weeks",
      task: "If they haven't chosen a fund by the time their first contribution is due, pay to their stapled super fund: request it through ATO online services (you can once they accept the offer). Only if the ATO says they have none, pay to your default fund.",
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
      when: "on or before day one",
      task: "Pay them for the induction and any training, like any other hours of work.",
      why: "Training an employee does as part of their job is time worked and must be paid.",
      source: S.unpaidWork,
    },
    {
      when: "ongoing",
      task: "Keep time and wages records, and give a pay slip within one working day of each payday.",
      why: "Both are legal requirements for every employee.",
      source: S.payslips,
    },
    {
      when: "ongoing",
      task: "Pay super so it reaches the fund within 7 business days after each payday. For a new employee the first contribution has longer: it must reach the fund within 20 business days after the first payday you pay them on (then 7 business days for the next paydays).",
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
            description: "true unless the user said the person is an Australian citizen or permanent resident. A New Zealand citizen counts as true: they usually hold a Special Category visa, checked in VEVO like any visa.",
          },
          is_apprentice_or_trainee: { type: "boolean", description: "true for an apprentice or trainee (training contract)." },
          works_on_construction_sites: { type: "boolean", description: "true if they will do construction work on a construction site (building, plumbing, electrical, landscaping construction...)." },
          first_employee: { type: "boolean", description: "true if this is the business's first employee, or the owner hasn't set up payroll (PAYG withholding, STP) yet; false if it already pays employees." },
          working_holiday_maker: { type: "boolean", description: "true if they are on a Working Holiday (417) or Work and Holiday (462) visa, e.g. a backpacker." },
          start_date: {
            type: ["string", "null"],
            description:
              "Their first day (YYYY-MM-DD) if known, else null. The checklist gives its weekday (use that, don't work it out) and says if it is a public holiday where they are based. If the owner gave only a relative date (\"in 2 weeks\"), pass the date you worked out and say in the reply that it is assumed.",
          },
          work_state: {
            type: ["string", "null"],
            enum: [...STATE_CODES, null],
            description:
              "The state or territory where they will be based for work, from any place the owner mentions: \"working remotely from Sydney\" → NSW, \"based in Brisbane\" → QLD, \"from home in Geelong\" → VIC. Fill it whenever a place is mentioned, even the business's own state; null only if no place was said. It sets their public holidays, long service leave and workers compensation.",
          },
        },
        required: ["employment_type", "may_need_visa_check", "is_apprentice_or_trainee", "works_on_construction_sites", "first_employee", "working_holiday_maker", "start_date", "work_state"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { employment_type?: string; may_need_visa_check?: boolean; is_apprentice_or_trainee?: boolean; works_on_construction_sites?: boolean; first_employee?: boolean; working_holiday_maker?: boolean; start_date?: string | null; work_state?: string | null };
        const type = a.employment_type as EmploymentType;
        if (!["full-time", "part-time", "casual", "fixed-term"].includes(type)) return { success: false, text: "employment_type must be full-time, part-time, casual or fixed-term." };
        const p = business().get();
        const items = newStarterChecklist({
          employmentType: type,
          mayNeedVisaCheck: a.may_need_visa_check !== false,
          smallBusiness: p.headcount === null ? null : p.headcount < 15,
          apprentice: a.is_apprentice_or_trainee === true,
          constructionSite: a.works_on_construction_sites === true,
          firstEmployee: a.first_employee === true,
          workingHolidayMaker: a.working_holiday_maker === true,
          states: p.states,
          workState: a.work_state ?? null,
        });
        // Public holidays where they are based for work: their state if the owner named one.
        const ws = a.work_state && STATE_CODES.includes(a.work_state) ? a.work_state : null;
        const holiday = startDateHolidayNote(a.start_date, ws ? [ws] : p.states);
        const day = longDate(a.start_date);
        const first = day ? `First day: ${day} (${a.start_date}). Use this weekday as it is; if the owner didn't give the exact date, say it is assumed and ask them to confirm it.\n` : "";
        return {
          success: true,
          text:
            first +
            (holiday ? `${holiday}\n\n` : first ? "\n" : "") +
            `New starter checklist (${type}; official sources checked ${CHECKED_ON}):\n${formatChecklist(items)}\n\n` +
            "Present it as a practical checklist in plain language, grouped by timing, keeping every item and its source link. Add the business's own steps from its profile or policies where relevant. " +
            "Pay rates and super percentages are not included on purpose: use search_official_sources or the Pay and Conditions Tool for figures.",
          display: `checklist: ${type}`,
        };
      },
    },
  ];
}
