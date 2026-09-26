import type { ClientTool } from "../engine/types";
import type { BusinessStore } from "./profile";
import { authoritiesFor, SOURCES as S, type ChecklistItem } from "./onboarding";

/**
 * The leaving checklist: what the owner must do when someone's employment ends
 * (final pay, records, certificates, apprentices). Code decides the items so none
 * is forgotten; every item links to the official page it comes from. Checked
 * against those pages on LEAVING_CHECKED_ON.
 */

export const LEAVING_CHECKED_ON = "2026-09-26";

export type LeavingReason = "resignation" | "dismissal" | "redundancy" | "end of fixed-term contract" | "other";
export const LEAVING_REASONS: LeavingReason[] = ["resignation", "dismissal", "redundancy", "end of fixed-term contract", "other"];

export type LeavingItem = Omit<ChecklistItem, "when"> & { when: "before the last day" | "final pay" | "after they leave" };

/** `casual`: casuals have no paid annual or personal leave to pay out and no NES notice (Fair Work, checked 2026-09-26). */
export function leavingChecklist(opts: { reason: LeavingReason; apprentice: boolean; states: string[]; casual?: boolean }): LeavingItem[] {
  const items: LeavingItem[] = [];
  if (opts.reason === "dismissal" || opts.reason === "redundancy") {
    items.push({
      when: "before the last day",
      task: "Get advice before acting (the adviser in the business profile, an employment lawyer, an employer association, or the Fair Work Infoline 13 13 94), and follow a fair process.",
      why: "Dismissals and redundancies carry unfair dismissal and general protections risk; notice and redundancy pay rules apply.",
      source: S.finalPay,
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
          task: "Include everything owed: wages to the last day, any notice paid in lieu, unused annual leave with annual leave loading (even if the award says loading is not paid on termination), long service leave if owed under state law, and redundancy pay if it applies. Unused personal/carer's leave is not paid out.",
          why: "These amounts are set by the NES, the award and state long service leave laws.",
          source: S.finalPay,
        },
    {
      when: "final pay",
      task: "Withhold tax correctly on termination payments, report them through payroll, and pay the super owed on the final pay.",
      why: "The ATO sets how termination payments are taxed and reported.",
      source: S.atoLeaving,
    },
    {
      when: "after they leave",
      task: "Give a pay slip for the final pay, and keep the employee's time and wages records for 7 years.",
      why: "Record-keeping and pay slip rules continue after employment ends.",
      source: S.records,
    },
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
export function leavingText(opts: { reason: LeavingReason; apprentice: boolean; states: string[]; casual?: boolean }): string {
  return (
    `Leaving checklist (${opts.reason}${opts.casual ? ", casual" : ""}${opts.apprentice ? ", apprentice/trainee" : ""}; official sources checked ${LEAVING_CHECKED_ON}):\n${formatLeaving(leavingChecklist(opts))}\n\n` +
    "Tell the owner these steps in plain language, keeping every item and its source link. " +
    "State the final pay deadline in the answer itself: the award sets it, and most awards require final pay within 7 days of the last day; give that date if you know the last day, and say to confirm it in their award. Do not replace it with only 'check your award'. " +
    "Do not calculate the final pay amount: point to the Pay and Conditions Tool and the payroll system."
  );
}

export const isApprenticeRole = (role: string) => /apprentice|trainee/i.test(role);

export function leavingTools(business: () => BusinessStore): ClientTool[] {
  return [
    {
      name: "leaving_checklist",
      description:
        "Get the official checklist for when someone's employment ends (notice, final pay and what it includes, tax and super, records, separation certificate, apprentices), with verified links. " +
        "Call it whenever an employee resigns, is dismissed, is made redundant, or a fixed-term contract ends. " +
        "If the owner did not say why they left, do not stop to ask: use the likely reason (resignation if they quit or 'finished up') or 'other', and say which one you assumed.",
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string", enum: LEAVING_REASONS },
          is_apprentice_or_trainee: { type: "boolean" },
          is_casual: { type: "boolean", description: "The person was a casual employee (casuals have no paid leave to pay out and no NES notice)." },
        },
        required: ["reason", "is_apprentice_or_trainee", "is_casual"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { reason?: string; is_apprentice_or_trainee?: boolean; is_casual?: boolean };
        const reason = (LEAVING_REASONS as string[]).includes(String(a.reason)) ? (a.reason as LeavingReason) : "other";
        return {
          success: true,
          text: leavingText({ reason, apprentice: a.is_apprentice_or_trainee === true, casual: a.is_casual === true, states: business().get().states }),
          display: `leaving checklist: ${reason}`,
        };
      },
    },
  ];
}
