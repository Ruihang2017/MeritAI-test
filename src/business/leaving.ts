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

type LeavingItem = Omit<ChecklistItem, "when"> & { when: "before the last day" | "final pay" | "after they leave" };

export function leavingChecklist(opts: { reason: LeavingReason; apprentice: boolean; states: string[] }): LeavingItem[] {
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
    {
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
      task: "Pay final pay on time: follow the award or enterprise agreement (most awards require it within 7 days after the last day); if neither sets a time, the Fair Work Act's rule of paying at least monthly applies. Best practice: as soon as possible, e.g. the next pay run.",
      why: "Late or short final pay is a common breach.",
      source: S.finalPay,
    },
    {
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
export function leavingText(opts: { reason: LeavingReason; apprentice: boolean; states: string[] }): string {
  return (
    `Leaving checklist (${opts.reason}${opts.apprentice ? ", apprentice/trainee" : ""}; official sources checked ${LEAVING_CHECKED_ON}):\n${formatLeaving(leavingChecklist(opts))}\n\n` +
    "Tell the owner these steps in plain language, keeping every item and its source link. Do not calculate the final pay amount: point to the Pay and Conditions Tool and the payroll system."
  );
}

export const isApprenticeRole = (role: string) => /apprentice|trainee/i.test(role);

export function leavingTools(business: () => BusinessStore): ClientTool[] {
  return [
    {
      name: "leaving_checklist",
      description:
        "Get the official checklist for when someone's employment ends (notice, final pay and what it includes, tax and super, records, separation certificate, apprentices), with verified links. " +
        "Call it whenever an employee resigns, is dismissed, is made redundant, or a fixed-term contract ends.",
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string", enum: LEAVING_REASONS },
          is_apprentice_or_trainee: { type: "boolean" },
        },
        required: ["reason", "is_apprentice_or_trainee"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { reason?: string; is_apprentice_or_trainee?: boolean };
        const reason = (LEAVING_REASONS as string[]).includes(String(a.reason)) ? (a.reason as LeavingReason) : "other";
        return {
          success: true,
          text: leavingText({ reason, apprentice: a.is_apprentice_or_trainee === true, states: business().get().states }),
          display: `leaving checklist: ${reason}`,
        };
      },
    },
  ];
}
