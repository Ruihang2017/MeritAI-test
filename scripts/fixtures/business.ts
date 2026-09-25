// Synthetic test business for the automated suites (SYNTHETIC TEST DATA: not a real business).
// seedBusiness() points a test user at a throwaway workspace with this profile and the
// policies in ./policies, so no suite touches the real files/ folder.
import { cpSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ensureFolders, type Folders } from "../../src/files/folders";
import { BusinessStore, type ProfilePatch } from "../../src/business/profile";
import type { UserMemory } from "../../src/memory/store";

export const TEST_PROFILE: ProfilePatch = {
  legalName: "Wattle Lane Cleaning Co Pty Ltd",
  tradingName: "Wattle Lane Cleaning",
  industry: "Commercial office cleaning (synthetic test business)",
  states: ["NSW"],
  address: "[Business address]",
  headcount: 24,
  employmentTypes: ["full-time", "part-time", "casual"],
  awards: ["Cleaning Services Award"],
  payFrequency: "fortnightly",
  payrollSystem: "Xero",
  benefitsAndRules: [
    "Paid parental leave: 3 months for the birthing parent, 2 weeks for the non-birthing parent",
    "One paid mental wellness day per year",
    "Uniforms and safety boots provided",
  ],
  signer: "Alex Morgan, Operations Manager",
  adviser: { kind: "employment-lawyer", name: "Jordan Lee (Lee Workplace Law, synthetic)", contact: null },
  hasEap: false,
  notes: null,
};

const POLICIES = join(dirname(fileURLToPath(import.meta.url)), "policies");

/**
 * Creates a workspace for `mem`'s user with the test profile (unless `profile` is null)
 * and the fixture policies (unless `policies` is false). Returns the folders.
 */
export function seedBusiness(mem: UserMemory, opts: { profile?: ProfilePatch | null; policies?: boolean } = {}): Folders {
  const f = ensureFolders(join(mkdtempSync(join(tmpdir(), "fx-business-")), "files"));
  mem.updateSettings({ filesRoot: f.root });
  const profile = opts.profile === undefined ? TEST_PROFILE : opts.profile;
  if (profile) new BusinessStore(f.data).update(profile);
  if (opts.policies !== false) cpSync(POLICIES, f.policies, { recursive: true });
  return f;
}
