import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { now } from "../clock";

/**
 * The business profile: one per business workspace (files root), stored as
 * <root>/.assistant/business.json. It replaces hard-coded company knowledge:
 * the setup interview fills it, later chat edits update it (always after the
 * owner confirms), and it is rendered into every new session's instructions.
 *
 * Business facts only (the business's own name, ABN, address and contact are
 * fine); never employee or candidate personal data.
 */

export const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;
export const EMPLOYMENT_TYPES = ["full-time", "part-time", "casual", "fixed-term"] as const;

export interface Adviser {
  /** "none" = no adviser; the assistant then refers to the Fair Work Infoline or an employment lawyer. */
  kind: "hr-adviser" | "employment-lawyer" | "employer-association" | "accountant" | "none";
  name: string | null;
  contact: string | null;
}

export interface BusinessProfile {
  legalName: string | null;
  tradingName: string | null;
  abn: string | null;
  /** What the business does, in the owner's words. */
  industry: string | null;
  /** States / territories where employees work. */
  states: string[];
  address: string | null;
  headcount: number | null;
  employmentTypes: string[];
  /** Awards the owner says apply, as they named them (P4 helps work them out). "unsure" is allowed. */
  awards: string[];
  payFrequency: "weekly" | "fortnightly" | "monthly" | null;
  payrollSystem: string | null;
  /** Benefits and the business's own rules, short lines (e.g. "Staff meal discount 50%"). */
  benefitsAndRules: string[];
  /** Who signs letters and contracts, e.g. "Jane Smith, Owner". */
  signer: string | null;
  adviser: Adviser | null;
  /** Whether the business has an Employee Assistance Program. */
  hasEap: boolean | null;
  notes: string | null;
  updatedAt: string | null;
}

export const EMPTY_PROFILE: BusinessProfile = {
  legalName: null,
  tradingName: null,
  abn: null,
  industry: null,
  states: [],
  address: null,
  headcount: null,
  employmentTypes: [],
  awards: [],
  payFrequency: null,
  payrollSystem: null,
  benefitsAndRules: [],
  signer: null,
  adviser: null,
  hasEap: null,
  notes: null,
  updatedAt: null,
};

export type ProfilePatch = Partial<Omit<BusinessProfile, "updatedAt">>;

const FIELD_LABELS: Record<keyof Omit<BusinessProfile, "updatedAt">, string> = {
  legalName: "Legal name",
  tradingName: "Trading name",
  abn: "ABN",
  industry: "What the business does",
  states: "States where staff work",
  address: "Business address",
  headcount: "Number of employees",
  employmentTypes: "Employment types",
  awards: "Awards (as the owner named them)",
  payFrequency: "Pay frequency",
  payrollSystem: "Payroll system",
  benefitsAndRules: "Benefits and own rules",
  signer: "Signs letters and contracts",
  adviser: "HR / legal adviser",
  hasEap: "Employee Assistance Program",
  notes: "Other notes",
};

const MAX_TEXT = 300;
const MAX_LIST = 20;

const str = (v: unknown, field: string): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > MAX_TEXT) throw new Error(`${field} is too long (max ${MAX_TEXT} characters)`);
  return s;
};
const list = (v: unknown, field: string): string[] => {
  if (!Array.isArray(v)) throw new Error(`${field} must be a list`);
  if (v.length > MAX_LIST) throw new Error(`${field}: at most ${MAX_LIST} items`);
  return v.map((x) => str(x, field)).filter((x): x is string => !!x);
};

/** Validates and normalises a patch from the model. Throws with a user-facing reason. */
export function normalisePatch(raw: unknown): ProfilePatch {
  if (!raw || typeof raw !== "object") throw new Error("the changes must be an object");
  const r = raw as Record<string, unknown>;
  const p: ProfilePatch = {};
  for (const k of Object.keys(r)) {
    const v = r[k];
    if (v === undefined) continue;
    switch (k) {
      case "legalName":
      case "tradingName":
      case "industry":
      case "address":
      case "payrollSystem":
      case "signer":
      case "notes":
        p[k] = str(v, k);
        break;
      case "abn": {
        const s = str(v, k);
        if (s && !/^\d{11}$/.test(s.replace(/\s/g, ""))) throw new Error("ABN must have 11 digits");
        p.abn = s ? s.replace(/\s/g, "").replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4") : null;
        break;
      }
      case "states": {
        const s = list(v, k).map((x) => x.toUpperCase());
        const bad = s.filter((x) => !(AU_STATES as readonly string[]).includes(x));
        if (bad.length) throw new Error(`unknown state(s): ${bad.join(", ")} (use ${AU_STATES.join(", ")})`);
        p.states = [...new Set(s)];
        break;
      }
      case "employmentTypes": {
        const s = list(v, k).map((x) => x.toLowerCase());
        const bad = s.filter((x) => !(EMPLOYMENT_TYPES as readonly string[]).includes(x));
        if (bad.length) throw new Error(`unknown employment type(s): ${bad.join(", ")} (use ${EMPLOYMENT_TYPES.join(", ")})`);
        p.employmentTypes = [...new Set(s)];
        break;
      }
      case "awards":
      case "benefitsAndRules":
        p[k] = list(v, k);
        break;
      case "headcount": {
        if (v === null) p.headcount = null;
        else {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error("headcount must be a whole number");
          p.headcount = n;
        }
        break;
      }
      case "payFrequency":
        if (v !== null && !["weekly", "fortnightly", "monthly"].includes(String(v))) throw new Error("payFrequency must be weekly, fortnightly or monthly");
        p.payFrequency = (v as BusinessProfile["payFrequency"]) ?? null;
        break;
      case "hasEap":
        p.hasEap = v === null ? null : Boolean(v);
        break;
      case "adviser": {
        if (v === null) {
          p.adviser = null;
          break;
        }
        const a = v as Record<string, unknown>;
        const kinds: Adviser["kind"][] = ["hr-adviser", "employment-lawyer", "employer-association", "accountant", "none"];
        if (!kinds.includes(a.kind as Adviser["kind"])) throw new Error(`adviser.kind must be one of ${kinds.join(", ")}`);
        p.adviser = { kind: a.kind as Adviser["kind"], name: str(a.name, "adviser.name"), contact: str(a.contact, "adviser.contact") };
        break;
      }
      default:
        throw new Error(`unknown field "${k}"`);
    }
  }
  return p;
}

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return "(not set)";
  if (Array.isArray(v)) return v.length ? v.join("; ") : "(none)";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") {
    const a = v as Adviser;
    if (a.kind === "none") return "none";
    return [a.kind.replace(/-/g, " "), a.name, a.contact].filter(Boolean).join(", ");
  }
  return String(v);
};

/** Human-readable lines "Label: old → new" for a confirmation prompt. */
export function describeChanges(current: BusinessProfile, patch: ProfilePatch): string[] {
  const out: string[] = [];
  for (const k of Object.keys(patch) as (keyof ProfilePatch)[]) {
    const before = fmt(current[k]);
    const after = fmt(patch[k]);
    if (before === after) continue;
    out.push(before === "(not set)" || before === "(none)" ? `${FIELD_LABELS[k]}: ${after}` : `${FIELD_LABELS[k]}: ${before} → ${after}`);
  }
  return out;
}

export class BusinessStore {
  readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "business.json");
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  get(): BusinessProfile {
    if (!this.exists()) return { ...EMPTY_PROFILE };
    try {
      return { ...EMPTY_PROFILE, ...(JSON.parse(readFileSync(this.path, "utf8")) as Partial<BusinessProfile>) };
    } catch {
      return { ...EMPTY_PROFILE };
    }
  }

  update(patch: ProfilePatch): BusinessProfile {
    const next: BusinessProfile = { ...this.get(), ...patch, updatedAt: now().toISOString() };
    writeFileSync(this.path, JSON.stringify(next, null, 2) + "\n");
    return next;
  }

  /** The business's display name (trading name first). */
  name(): string | null {
    const p = this.get();
    return p.tradingName ?? p.legalName;
  }
}

/** Plain lines for /profile. */
export function profileLines(p: BusinessProfile): string[] {
  return (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).map((k) => `${FIELD_LABELS[k]}: ${fmt(p[k])}`);
}

/**
 * The "# This business" section of the developer instructions. Missing fields
 * are listed so the model uses placeholders instead of guessing.
 */
export function renderProfile(store: BusinessStore): string {
  if (!store.exists()) {
    return [
      "# This business",
      "",
      "No business profile has been set up yet. You know nothing about this business: use placeholders such as [Business name] and [State] and never guess.",
      "Whenever a reply would contain business details (letters, emails, contracts, job ads, anything signed by the business) or depends on them (the state, award, employment types), do the task with placeholders and end with one line: \"Tip: run /setup (about 3 minutes) so I can fill in your business details next time.\" (in the user's language).",
    ].join("\n");
  }
  const p = store.get();
  const set: string[] = [];
  const missing: string[] = [];
  for (const k of Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]) {
    const v = p[k];
    const empty = v === null || (Array.isArray(v) && v.length === 0);
    if (empty) missing.push(FIELD_LABELS[k]);
    else set.push(`- ${FIELD_LABELS[k]}: ${fmt(v)}`);
  }
  return [
    "# This business",
    "",
    "The owner's business profile (from the setup interview; the owner confirmed every entry). It is the only source of facts about this business.",
    "",
    ...set,
    ...(missing.length ? ["", `Not recorded: ${missing.join(", ")}. Use a placeholder for these; never guess.`] : []),
    "",
    smallBusinessLine(p),
    ...(adviserLine(p) ? [adviserLine(p)!] : []),
  ].join("\n");
}

/**
 * Worked out by code, because the model mixed up the small business rules in the
 * evaluation (e.g. applying the 6-month casual rule to a business with 14 employees).
 */
export function smallBusinessLine(p: BusinessProfile): string {
  const rules =
    "Rules that differ for small business employers include: the casual employee choice pathway (12 months instead of 6), when the CEIS is given again, the unfair dismissal minimum employment period (12 months instead of 6) and the Small Business Fair Dismissal Code, and the exemption from NES redundancy pay. Check the details with search_official_sources.";
  if (p.headcount === null) {
    return `Small business employer (fewer than 15 employees) under the Fair Work Act: unknown (headcount not recorded). Ask the owner when it matters. ${rules}`;
  }
  const small = p.headcount < 15;
  return (
    `Small business employer (fewer than 15 employees) under the Fair Work Act: ${small ? "YES" : "NO"}, based on ${p.headcount} employees in the profile. ` +
    `The legal count includes employees of associated entities, and casuals only if they work on a regular and systematic basis${small && p.headcount >= 12 ? "; this business is close to 15, so confirm the count" : ""}. ${rules}`
  );
}

/** An accountant or bookkeeper is not an employment-law adviser (the model referred legal questions to one in the evaluation). */
export function adviserLine(p: BusinessProfile): string | null {
  if (p.adviser?.kind === "accountant") {
    return "The recorded adviser is an accountant or bookkeeper: use them for payroll, tax and super questions only. For employment-law risk (dismissal, discipline, contracts, discrimination, apprenticeships), refer to an employment lawyer, an employer or industry association, or the Fair Work Infoline (13 13 94).";
  }
  return null;
}
