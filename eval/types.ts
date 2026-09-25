// Evaluation types. Scenarios are realistic requests from small business owners, run
// against the real assistant (createAssistant, same as the CLI) several times each.
import type { EmployeeInput, Register } from "../src/business/register";
import type { BusinessStore, ProfilePatch } from "../src/business/profile";
import type { Folders } from "../src/files/folders";

export type PersonaId =
  | "cafe"
  | "plumber"
  | "retail"
  | "clinic"
  | "accounting"
  | "landscaping"
  | "salon"
  | "startup"
  | "newowner";

export interface Persona {
  id: PersonaId;
  /** One line for the report and the judge. */
  summary: string;
  /** null = the owner has not run /setup. */
  profile: ProfilePatch | null;
  /** Policy documents in Policies/ (file name → markdown). */
  policies: Record<string, string>;
  /** Employees in the register at the start of every run; dates as offsets in days from today. */
  staff: (EmployeeInput & { startOffset: number; probationEndOffset?: number; visaExpiryOffset?: number; endOffset?: number; docs?: string[] })[];
}

export type Category =
  | "setup"
  | "recruitment"
  | "screening"
  | "contracts"
  | "onboarding"
  | "register"
  | "reminders"
  | "award-pay"
  | "leave"
  | "performance"
  | "discipline"
  | "termination"
  | "offboarding"
  | "wellbeing-whs"
  | "fairness"
  | "privacy-safety"
  | "boundaries"
  | "policies"
  | "general";

export interface StateContext {
  register: Register;
  business: BusinessStore;
  folders: Folders;
}

export interface Expect {
  /** At least one of these skills must be loaded (explicitly or via load_skill). */
  skillsAny?: string[];
  /** Tool activity prefixes that must appear (e.g. "checklist:", "official sources:", "register:"). */
  tools?: string[];
  /** Tool activity prefixes that must NOT appear. */
  notTools?: string[];
  /** Every pattern must match the combined replies. */
  mustMatch?: RegExp[];
  /** No pattern may match the combined replies. */
  mustNotMatch?: RegExp[];
  /** At least one [y/n] confirmation must have been asked (or none, if false). */
  confirmAsked?: boolean;
  /** Check the workspace after the run; return a failure message, or null if fine. */
  state?: (ctx: StateContext) => string | null;
  /** Set true for the rare scenario where arithmetic on money is legitimate (not pay for hours). */
  allowPayArithmetic?: boolean;
}

export interface Scenario {
  id: string;
  persona: PersonaId;
  category: Category;
  /** Short description for the report. */
  title: string;
  /** User messages, in order, in one conversation. */
  turns: string[];
  /** Explicit skill for the first turn (like typing /<skill>), e.g. business-setup for /setup. */
  skill?: string;
  /** Answers to [y/n] confirmations, in order; default yes. */
  confirm?: boolean[];
  /** Extra files in the Inbox before the run (name → text content). */
  inbox?: Record<string, string>;
  expect: Expect;
  /** What a good answer does, for the judge (1-3 sentences). */
  rubric: string;
}

export interface JudgeResult {
  scores: { correctness: number; completeness: number; actionability: number; clarity: number; safety: number; grounding: number };
  verdict: "pass" | "fail";
  critical_issues: string[];
  minor_issues: string[];
  summary: string;
}

export interface RunResult {
  scenario: string;
  run: number;
  persona: PersonaId;
  category: Category;
  startedAt: string;
  ms: number;
  status: "ok" | "error";
  error?: string;
  replies: string[];
  activity: string[][];
  skills: string[];
  flagged: string[];
  asked: string[];
  checks: { name: string; ok: boolean; note?: string }[];
  /** Local date the run used (register dates are relative to it). */
  today?: string;
  /** Register, policies and Inbox at the start, as shown to the judge. */
  startState?: string;
  judge?: JudgeResult;
  judgeModel?: string;
  judgeError?: string;
}
