// Compares two evaluation runs on the scenarios they share (e.g. before and after a round of fixes).
//   npm run eval:compare -- --before eval/results/baseline --after eval/results/round1 [--out <file.md>]
// Only runs graded by the same judge model are compared, so a judge change cannot look like an improvement.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { ROOT } from "../src/assistant";
import { SCENARIOS } from "./scenarios";
import { REGRESSION } from "./sets";
import type { RunResult } from "./types";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const abs = (p: string) => (isAbsolute(p) ? p : join(ROOT, p));
const BEFORE = abs(arg("before") ?? "eval/results/baseline");
const AFTER = abs(arg("after") ?? "eval/results/round1");
const OUT = abs(arg("out") ?? join(AFTER, "compare.md"));

function load(dir: string): Map<string, RunResult[]> {
  const file = join(dir, "results.jsonl");
  if (!existsSync(file)) throw new Error(`no results at ${file}`);
  const latest = new Map<string, RunResult>();
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as RunResult;
    latest.set(`${r.scenario}#${r.run}`, r);
  }
  const by = new Map<string, RunResult[]>();
  for (const r of latest.values()) by.set(r.scenario, [...(by.get(r.scenario) ?? []), r]);
  return by;
}

const DIMS = ["correctness", "completeness", "actionability", "clarity", "safety", "grounding"] as const;
const ok = (r: RunResult) => r.status === "ok" && r.checks.every((c) => c.ok) && r.judge?.verdict === "pass";
const score = (rs: RunResult[]) => {
  const j = rs.filter((r) => r.judge);
  return j.length ? j.reduce((a, r) => a + DIMS.reduce((b, d) => b + r.judge!.scores[d], 0) / DIMS.length, 0) / j.length : NaN;
};
const judgeOf = (rs: RunResult[]) => new Set(rs.filter((r) => r.judge).map((r) => r.judgeModel ?? "gpt-6-astra"));

const before = load(BEFORE);
const after = load(AFTER);
const shared = [...after.keys()].filter((id) => before.has(id)).sort();
const title = new Map(SCENARIOS.map((s) => [s.id, s.title]));

const L: string[] = [`# Before / after`, "", `Before: \`${BEFORE.replace(ROOT, ".")}\`. After: \`${AFTER.replace(ROOT, ".")}\`. Scenarios in both: ${shared.length}.`, ""];
const rows: string[] = [];
let fixed = 0, regressed = 0, mixedJudge = 0;
let bPass = 0, bRuns = 0, aPass = 0, aRuns = 0;
for (const id of shared) {
  const b = before.get(id)!, a = after.get(id)!;
  const jb = judgeOf(b), ja = judgeOf(a);
  const sameJudge = jb.size === 1 && ja.size === 1 && [...jb][0] === [...ja][0];
  if (!sameJudge) mixedJudge++;
  const pb = b.filter(ok).length, pa = a.filter(ok).length;
  bPass += pb; bRuns += b.length; aPass += pa; aRuns += a.length;
  const rb = pb / b.length, ra = pa / a.length;
  const change = ra > rb ? "better" : ra < rb ? "worse" : "same";
  if (rb < 1 && ra === 1) fixed++;
  if (rb === 1 && ra < 1) regressed++;
  rows.push(`| ${id}${REGRESSION.includes(id) ? " (regression)" : ""} | ${title.get(id) ?? ""} | ${pb}/${b.length} | ${pa}/${a.length} | ${score(b).toFixed(1)} → ${score(a).toFixed(1)} | ${change}${sameJudge ? "" : " (different judges)"} |`);
}
L.push(`| | Before | After |`, `|---|---|---|`);
L.push(`| Runs passing (hard checks and judge) | ${bPass}/${bRuns} | ${aPass}/${aRuns} |`);
L.push("", `Scenarios fixed (failed before, all runs pass now): ${fixed}. Regressed (all passed before, not now): ${regressed}.${mixedJudge ? ` ${mixedJudge} scenario(s) were graded by different judges; re-grade the older run with --rejudge-only first.` : ""}`, "");
L.push(`| Scenario | Title | Before | After | Avg score | Change |`, `|---|---|---|---|---|---|`, ...rows, "");
writeFileSync(OUT, L.join("\n"));
console.log(L.slice(0, 8).join("\n"));
console.log(`\nwritten: ${OUT}`);
