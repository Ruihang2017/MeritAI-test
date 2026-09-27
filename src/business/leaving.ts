import type { ClientTool } from "../engine/types";
import type { BusinessStore } from "./profile";
import { authoritiesFor, SOURCES as S, type ChecklistItem } from "./onboarding";

/**
 * The leaving checklist: what the owner must do when someone's employment ends
 * (final pay, records, certificates, apprentices). Code decides the items so none
 * is forgotten; every item links to the official page it comes from. Checked
 * against those pages on LEAVING_CHECKED_ON.
 */

export const LEAVING_CHECKED_ON = "2026-09-27";

export type LeavingReason = "resignation" | "dismissal" | "redundancy" | "end of fixed-term contract" | "other";
export const LEAVING_REASONS: LeavingReason[] = ["resignation", "dismissal", "redundancy", "end of fixed-term contract", "other"];

export type LeavingItem = Omit<ChecklistItem, "when"> & { when: "before the last day" | "final pay" | "after they leave" };

/**
 * `casual`: casuals have no paid annual or personal leave to pay out and no NES notice.
 * `smallBusiness`: fewer than 15 employees (null = unknown): a dismissal follows the Small Business Fair Dismissal Code.
 * (Fair Work, checked 2026-09-26.)
 */
export function leavingChecklist(opts: { reason: LeavingReason; apprentice: boolean; states: string[]; casual?: boolean; smallBusiness?: boolean | null; sponsored?: boolean }): LeavingItem[] {
  const items: LeavingItem[] = [];
  if (opts.reason === "dismissal" || opts.reason === "redundancy") {
    items.push({
      when: "before the last day",
      task: "Get advice before acting (the adviser in the business profile, an employment lawyer, an employer association, or the Fair Work Infoline 13 13 94), and follow a fair process.",
      why: "Dismissals and redundancies carry unfair dismissal and general protections risk; notice and redundancy pay rules apply.",
      source: S.finalPay,
    });
  }
  // Round 5 evaluation fixes (Fair Work, checked 2026-09-27).
  if (opts.reason === "dismissal") {
    items.push({
      when: "before the last day",
      task: "Unfair dismissal claims need at least 6 months of service (12 months with a small business employer, fewer than 15 employees), but general protections and discrimination claims can be made from the first day: never dismiss someone because of a protected attribute or for exercising a workplace right (e.g. a complaint or a question about their pay).",
      why: "A short time in the job lowers the unfair dismissal risk, not the general protections risk.",
      source: S.unfairDismissal,
    });
  }
  if (opts.reason === "redundancy") {
    items.push({
      when: "before the last day",
      task: "Make sure the redundancy is genuine: the job no longer needs to be done by anyone; you follow the consultation requirements in the award or agreement (talk with the employee about the change before deciding); and you consider whether they could reasonably be given another job in the business or an associated entity.",
      why: "If the redundancy isn't genuine, the employee may be able to claim unfair dismissal.",
      source: S.redundancy,
    });
  }
  if ((opts.reason === "dismissal" || opts.reason === "redundancy") && !opts.casual) {
    items.push({
      when: "before the last day",
      task: "Minimum notice under the NES, by continuous service: 1 year or less, 1 week; over 1 up to 3 years, 2 weeks; over 3 up to 5 years, 3 weeks; over 5 years, 4 weeks. Add 1 week if the employee is over 45 and has at least 2 years of service (if you don't know their age, say so; don't assume). The award, an agreement or the contract may require more. Pay in lieu of notice must equal what they would have earned over the notice period, including loadings, penalty rates and allowances.",
      why: "The NES sets the minimum; an employment contract can't give less.",
      source: S.dismissal,
    });
  }
  if (opts.reason === "resignation") {
    items.push({
      when: "before the last day",
      task: "An employer can't accept or reject a resignation: acknowledge it in writing with the last day. If you don't want them to work out their notice, either agree an earlier last day with them, or end the employment yourself and pay the rest of the notice. If they didn't give enough notice, you can withhold pay only if the award or agreement allows it (most awards: up to one week's wages, if they are 18 or over and it isn't unreasonable), and never from leave or other entitlements.",
      why: "The notice they must give comes from the award, an agreement or the contract.",
      source: S.resignation,
    });
  }
  if (opts.reason === "dismissal" && opts.smallBusiness !== false) {
    items.push({
      when: "before the last day",
      task: `${opts.smallBusiness ? "As a small business employer (fewer than 15 employees)" : "If the business has fewer than 15 employees"}, follow the Small Business Fair Dismissal Code: unless it is serious misconduct (e.g. theft, fraud, violence, a serious safety breach), give a valid reason, warn them (preferably in writing) that their job is at risk if there is no improvement, let them respond, and give them a reasonable chance to improve. Keep the evidence (written warnings, the Code checklist).`,
      why: "Following the Code makes a small business dismissal fair; skipping the warning is the usual reason it fails.",
      source: S.unfairDismissal,
    });
  }
  items.push(
    opts.casual
      ? {
          when: "before the last day",
          task: "Confirm the last day in writing. Casual employees don't get notice of termination under the NES; check the award or contract for any notice they must give or get.",
          why: "Casuals don't get most types of paid leave, notice or redundancy pay.",
          source: S.casual,
        }
      : {
          when: "before the last day",
          task: "Confirm the last day in writing, and the notice period (worked, or paid in lieu) under the award, contract and NES.",
          why: "Notice rules come from the NES, the award and the contract; payment in lieu has its own rules.",
          source: S.finalPay,
        },
    {
      when: "before the last day",
      task: "Arrange the return of property (keys, uniforms, equipment, vehicles) and remove system and building access on the last day.",
      why: "Protects the business; never hold back wages to force the return of property.",
      source: S.finalPay,
    },
    {
      when: "final pay",
      task: "Pay final pay on time: follow the award or enterprise agreement (most awards require it within 7 days after the last day); if neither sets a time, the Fair Work Act's rule of paying at least monthly applies. Pay as soon as possible; if the next pay run falls after the deadline, make an off-cycle payment.",
      why: "Late or short final pay is a common breach.",
      source: S.finalPay,
    },
    opts.casual
      ? {
          when: "final pay",
          task: "Include everything owed: pay for all hours worked to the last day, with the casual loading. Casuals have no paid annual leave or personal/carer's leave to pay out and no redundancy pay; long service leave may still be owed under state law.",
          why: "Casuals don't get most types of paid leave, notice or redundancy pay; state long service leave laws can cover casuals.",
          source: S.casual,
        }
      : {
          when: "final pay",
          task: "Include everything owed: wages to the last day, notice paid in lieu if you ended the employment (or the notice period) early (not for notice a resigning employee chose not to work), unused annual leave with annual leave loading (even if the award says loading is not paid on termination), long service leave if owed under state law, and redundancy pay if it applies. Unused personal/carer's leave is not paid out.",
          why: "These amounts are set by the NES, the award and state long service leave laws.",
          source: S.finalPay,
        },
    {
      when: "final pay",
      task: "Withhold tax correctly on termination payments and report them through payroll.",
      why: "The ATO sets how termination payments are taxed and reported.",
      source: S.atoLeaving,
    },
    {
      when: "final pay",
      task: "Pay the super guarantee owed on the final pay: under Payday Super (from 1 July 2026) it must reach their fund within 7 business days after the payday. Do not use the old quarterly due dates.",
      why: "Late super guarantee attracts the super guarantee charge.",
      source: S.paydaySuper,
    },
    {
      when: "after they leave",
      task: "Give a pay slip for the final pay, and keep the employee's time and wages records for 7 years.",
      why: "Record-keeping and pay slip rules continue after employment ends.",
      source: S.records,
    },
    ...(opts.sponsored
      ? [{
          when: "after they leave" as const,
          task: "You sponsor their visa: tell Home Affairs within 28 calendar days that their employment has ended (or is expected to end), with the 'Notification of sponsor changes' form in ImmiAccount.",
          why: "Notifying Home Affairs of changes within 28 days is a sponsor obligation; breaching sponsor obligations can bring sanctions.",
          source: S.sponsorObligations,
        }]
      : []),
    {
      when: "after they leave",
      task: "If Services Australia or the former employee asks, complete an Employment Separation Certificate.",
      why: "Services Australia may need it for the person's income support claim.",
      source: S.separation,
    },
  );
  if (opts.apprentice) {
    for (const a of authoritiesFor(opts.states)) {
      items.push({
        when: "before the last day",
        task: `Contact the state training authority (${a.title}) before the apprenticeship or traineeship ends: the training contract must be cancelled or completed under its rules, and ending it may need the authority's involvement.`,
        why: "The training contract is registered with the authority and has its own probation, cancellation and transfer rules.",
        source: a,
      });
    }
  }
  return items;
}

export function formatLeaving(items: LeavingItem[]): string {
  const order: LeavingItem["when"][] = ["before the last day", "final pay", "after they leave"];
  return order
    .flatMap((w) => {
      const group = items.filter((i) => i.when === w);
      return group.length ? [`${w[0].toUpperCase()}${w.slice(1)}:`, ...group.map((i) => `- ${i.task} Why: ${i.why} Source: ${i.source.title} ${i.source.url}`)] : [];
    })
    .join("\n");
}

/** The checklist as tool text, with instructions for presenting it. */
export function leavingText(opts: { reason: LeavingReason; apprentice: boolean; states: string[]; casual?: boolean; smallBusiness?: boolean | null; sponsored?: boolean }): string {
  return (
    `Leaving checklist (${opts.reason}${opts.casual ? ", casual" : ""}${opts.apprentice ? ", apprentice/trainee" : ""}; official sources checked ${LEAVING_CHECKED_ON}):\n${formatLeaving(leavingChecklist(opts))}\n\n` +
    "Tell the owner these steps in plain language, keeping every item and its source link. " +
    "State the final pay deadline in the answer itself: the award sets it, and most awards require final pay within 7 days of the last day; give that date if you know the last day, and say to confirm it in their award. Do not replace it with only 'check your award'. " +
    "Do not calculate the final pay amount: point to the Pay and Conditions Tool and the payroll system."
  );
}

/** Fewer than 15 employees (Fair Work's small business employer); null when the headcount is unknown. */
export const smallBusinessOf = (headcount: number | null) => (headcount === null ? null : headcount < 15);

export const isApprenticeRole = (role: string) => /apprentice|trainee/i.test(role);

export function leavingTools(business: () => BusinessStore): ClientTool[] {
  return [
    {
      name: "leaving_checklist",
      description:
        "Get the official checklist for when someone's employment ends (notice, final pay and what it includes, tax and super, records, separation certificate, apprentices), with verified links. " +
        "Call it whenever an employee resigns, is dismissed, is made redundant, or a fixed-term contract ends, and when the owner is considering ending someone's employment (e.g. after warnings, or someone who has stopped turning up). " +
        "If the owner did not say why they left, do not stop to ask: use the likely reason (resignation if they quit or 'finished up') or 'other', and say which one you assumed.",
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string", enum: LEAVING_REASONS },
          is_apprentice_or_trainee: { type: "boolean", description: "true if the owner or the register (role) says apprentice or trainee: the training contract has its own rules for ending it." },
          is_casual: { type: "boolean", description: "The person was a casual employee (casuals have no paid leave to pay out and no NES notice)." },
          is_sponsored_visa: { type: "boolean", description: "true if the business sponsors their visa (e.g. Skills in Demand / 482); false if not or unknown." },
        },
        required: ["reason", "is_apprentice_or_trainee", "is_casual", "is_sponsored_visa"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { reason?: string; is_apprentice_or_trainee?: boolean; is_casual?: boolean; is_sponsored_visa?: boolean };
        const reason = (LEAVING_REASONS as string[]).includes(String(a.reason)) ? (a.reason as LeavingReason) : "other";
        return {
          success: true,
          text: leavingText({ reason, apprentice: a.is_apprentice_or_trainee === true, casual: a.is_casual === true, sponsored: a.is_sponsored_visa === true, states: business().get().states, smallBusiness: smallBusinessOf(business().get().headcount) }),
          display: `leaving checklist: ${reason}`,
        };
      },
    },
  ];
}
