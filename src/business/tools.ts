import type { ClientTool } from "../engine/types";
import { AU_STATES, EMPLOYMENT_TYPES, BusinessStore, describeChanges, normalisePatch } from "./profile";
import { findPii } from "../memory/store";

const nullableString = (description: string) => ({ type: ["string", "null"], description });

/** JSON Schema for a profile patch: every field optional; include only what changes. */
const PATCH_SCHEMA = {
  type: "object",
  properties: {
    legalName: nullableString("Registered business / company name."),
    tradingName: nullableString("Trading name, if different."),
    abn: nullableString("ABN, 11 digits."),
    industry: nullableString("What the business does, in the owner's words (e.g. 'café with catering', 'residential plumbing')."),
    states: { type: "array", items: { type: "string", enum: [...AU_STATES] }, description: "States/territories where staff work." },
    address: nullableString("Business address (for letters and contracts)."),
    headcount: { type: ["integer", "null"], description: "Number of employees (approximate is fine)." },
    employmentTypes: { type: "array", items: { type: "string", enum: [...EMPLOYMENT_TYPES] } },
    awards: { type: "array", items: { type: "string" }, description: "Awards the owner says apply, as named (or 'unsure')." },
    payFrequency: { type: ["string", "null"], enum: ["weekly", "fortnightly", "monthly", null] },
    payrollSystem: nullableString("e.g. Xero, MYOB, KeyPay, spreadsheet."),
    benefitsAndRules: { type: "array", items: { type: "string" }, description: "The FULL list of benefits and own rules (replaces the old list), one short line each." },
    signer: nullableString("Who signs letters and contracts, e.g. 'Jane Smith, Owner'."),
    adviser: {
      type: ["object", "null"],
      properties: {
        kind: { type: "string", enum: ["hr-adviser", "employment-lawyer", "employer-association", "accountant", "none"] },
        name: { type: ["string", "null"] },
        contact: { type: ["string", "null"] },
      },
      required: ["kind", "name", "contact"],
      additionalProperties: false,
    },
    hasEap: { type: ["boolean", "null"], description: "Whether the business has an Employee Assistance Program." },
    notes: nullableString("Anything else relevant, one or two sentences."),
  },
  additionalProperties: false,
};

/**
 * update_business_profile: the only way the model changes the profile. Every
 * change is shown to the owner and saved only after they confirm.
 */
export function businessTools(opts: { store: () => BusinessStore; confirm: (question: string) => Promise<boolean> }): ClientTool[] {
  return [
    {
      name: "update_business_profile",
      description:
        "Save facts about this business to its profile (setup interview, or when the owner tells you something changed). " +
        "Include only the fields to set or change. The app shows the changes to the owner and asks [y/n] itself, so call it directly without asking in the chat first. " +
        "Business facts only; never employee or candidate personal details.",
      inputSchema: {
        type: "object",
        properties: { changes: PATCH_SCHEMA },
        required: ["changes"],
        additionalProperties: false,
      },
      handle: async (args) => {
        let patch;
        try {
          patch = normalisePatch((args as { changes?: unknown } | null)?.changes);
        } catch (e) {
          return { success: false, text: `Not saved: ${(e as Error).message}. Fix the value and try again.` };
        }
        const store = opts.store();
        const lines = describeChanges(store.get(), patch);
        if (!lines.length) return { success: true, text: "Nothing changed: the profile already has these values." };
        // Business contact details are fine; a TFN or date of birth never belongs here.
        // (The ABN is excluded: its digits look like a TFN to the pattern.)
        const { abn: _abn, ...rest } = patch;
        const pii = findPii(JSON.stringify(rest));
        if (pii === "tax file number" || pii === "date of birth") {
          return { success: false, text: `Not saved: looks like personal data (${pii}). The profile holds business facts only.` };
        }
        const ok = await opts.confirm(`Save to the business profile?\n  ${lines.join("\n  ")}\n`);
        if (!ok) return { success: true, text: "The owner did not confirm; nothing was saved. Ask what to correct.", display: "profile: not saved" };
        store.update(patch);
        return { success: true, text: `Saved to the business profile: ${lines.join("; ")}.`, display: `profile saved (${lines.length} change(s))` };
      },
    },
  ];
}
