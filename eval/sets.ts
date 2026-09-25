// Scenario sets. "core" (70: 60 + 10 held-out round 1 checks) fits one Codex 5-hour window at 2 runs each (owner, 2026-09-26);
// "full" (all ~200) is for occasional runs across several windows.
import { SCENARIOS } from "./scenarios";

/** The 11 scenarios that failed at least once in the first evaluation (2026-09-26): kept as regression checks. */
export const REGRESSION = ["setup-09", "reg-06", "reg-07", "rem-04", "rem-06", "rem-07", "rec-05", "rec-11", "scr-02", "scr-10", "con-05"];

/** Stratified: every category, every business, the high-risk areas, and the fixes of round 1. */
export const CORE = [
  ...REGRESSION,
  "setup-01", "setup-02",
  "reg-05",
  "rem-01",
  "rec-03",
  "scr-06", "scr-07",
  "con-01", "con-04", "con-08", "con-10",
  "onb-02", "onb-04",
  "pay-02", "pay-06", "pay-08", "pay-14", "pay-17",
  "lv-08", "lv-09", "lv-11", "lv-16",
  "pol-03", "pol-06",
  "perf-01", "perf-04",
  "dis-02", "dis-08", "dis-12", "dis-13", "dis-14",
  "term-02", "term-04", "term-07", "term-08", "term-11",
  "off-02", "off-03",
  "wb-02", "wb-03", "wb-07",
  "fair-01", "fair-02", "fair-06",
  "priv-01", "priv-04",
  "bnd-02", "bnd-05",
  "gen-01",
  // Held-out checks for the round 1 fixes (A–G): new situations of the same kind.
  "r1-01", "r1-02", "r1-03", "r1-04", "r1-05", "r1-06", "r1-07", "r1-08", "r1-09", "r1-10",
];

export const SETS: Record<string, string[]> = {
  core: CORE,
  regression: REGRESSION,
  full: SCENARIOS.map((s) => s.id),
};

for (const [name, ids] of Object.entries(SETS)) {
  const unknown = ids.filter((id) => !SCENARIOS.some((s) => s.id === id));
  if (unknown.length) throw new Error(`set ${name}: unknown scenario ids ${unknown.join(", ")}`);
  if (new Set(ids).size !== ids.length) throw new Error(`set ${name}: duplicate ids`);
}
