// Builds <out>/report.md (and summary.json) from <out>/results.jsonl.
//   npm run eval:report -- [--out eval/results/<name>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { ROOT } from "../src/assistant";
import { todayLocal } from "../src/business/reminders";
import { SCENARIOS } from "./scenarios";
import { SETS } from "./sets";
import { JUDGE_EFFORT, JUDGE_MODEL } from "./judge";
import type { RunResult, Scenario } from "./types";

const i = process.argv.indexOf("--out");
const rawOut = i >= 0 ? process.argv[i + 1] : `eval/results/${todayLocal()}`;
const OUT = isAbsolute(rawOut) ? rawOut : join(ROOT, rawOut);
const file = join(OUT, "results.jsonl");
if (!existsSync(file)) throw new Error(`no results at ${file}`);

// Latest result per scenario#run (a resumed run may append a newer line).
const latest = new Map<string, RunResult>();
for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(line) as RunResult;
  latest.set(`${r.scenario}#${r.run}`, r);
}
const results = [...latest.values()];
const byScenario = new Map<string, RunResult[]>();
for (const r of results) byScenario.set(r.scenario, [...(byScenario.get(r.scenario) ?? []), r].sort((a, b) => a.run - b.run));
const scen = new Map<string, Scenario>(SCENARIOS.map((s) => [s.id, s]));

const DIMS = ["correctness", "completeness", "actionability", "clarity", "safety", "grounding"] as const;
const hardOk = (r: RunResult) => r.status === "ok" && r.checks.every((c) => c.ok);
const judgeOk = (r: RunResult) => r.judge?.verdict === "pass";
const bothOk = (r: RunResult) => hardOk(r) && judgeOk(r);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x: number) => (Number.isNaN(x) ? "-" : x.toFixed(1));
const q = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const excerpt = (s: string, n = 400) => cell(s.length > n ? s.slice(0, n) + "…" : s);
const scoreOf = (r: RunResult) => (r.judge ? avg(DIMS.map((d) => r.judge!.scores[d])) : NaN);

type Stability = "stable pass" | "flaky" | "stable fail";
const stability = (rs: RunResult[], ok: (r: RunResult) => boolean): Stability => {
  const n = rs.filter(ok).length;
  return n === rs.length ? "stable pass" : n === 0 ? "stable fail" : "flaky";
};

function group<K extends string>(key: (r: RunResult) => K) {
  const m = new Map<K, RunResult[]>();
  for (const r of results) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function table(rows: [string, RunResult[]][], label: string): string[] {
  const out = [
    `| ${label} | Scenarios | Runs | Hard checks | Judge pass | Both | ${DIMS.map((d) => d.slice(0, 5)).join(" | ")} | Median s |`,
    `|---|---|---|---|---|---|${DIMS.map(() => "---|").join("")}---|`,
  ];
  for (const [k, rs] of rows) {
    const judged = rs.filter((r) => r.judge);
    out.push(
      `| ${k} | ${new Set(rs.map((r) => r.scenario)).size} | ${rs.length} | ${pct(rs.filter(hardOk).length, rs.length)} | ${pct(judged.filter(judgeOk).length, judged.length)} | ${pct(rs.filter(bothOk).length, rs.length)} | ` +
        DIMS.map((d) => f1(avg(judged.map((r) => r.judge!.scores[d])))).join(" | ") +
        ` | ${f1(q(rs.map((r) => r.ms / 1000), 0.5))} |`,
    );
  }
  return out;
}

const judged = results.filter((r) => r.judge);
const errors = results.filter((r) => r.status === "error");
const scenarioRows = [...byScenario.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const stab = scenarioRows.map(([id, rs]) => ({ id, rs, hard: stability(rs, hardOk), judge: stability(rs.filter((r) => r.judge), judgeOk), both: stability(rs, bothOk) }));
const count = (k: "hard" | "judge" | "both", v: Stability) => stab.filter((s) => s[k] === v).length;

// Failing checks by name.
const failing = new Map<string, { n: number; scenarios: Set<string> }>();
for (const r of results) for (const c of r.checks.filter((c) => !c.ok)) {
  const e = failing.get(c.name) ?? { n: 0, scenarios: new Set() };
  e.n++;
  e.scenarios.add(r.scenario);
  failing.set(c.name, e);
}

// Critical issues, per scenario.
const critical = scenarioRows
  .map(([id, rs]) => ({ id, issues: rs.flatMap((r) => (r.judge?.critical_issues ?? []).map((x) => `run ${r.run}: ${x}`)) }))
  .filter((x) => x.issues.length);

const lowest = [...judged].sort((a, b) => scoreOf(a) - scoreOf(b)).slice(0, 12);
const guards = {
  unverified: results.filter((r) => r.checks.some((c) => c.name === "no unverified links" && !c.ok)).length,
  nonOfficial: results.filter((r) => r.checks.some((c) => c.name === "only official links" && !c.ok)).length,
  payCalc: results.filter((r) => r.checks.some((c) => c.name === "no pay calculation" && !c.ok)).length,
  unanswered: results.filter((r) => r.checks.some((c) => c.name === "every turn answered" && !c.ok)).length,
};
const meta = existsSync(join(OUT, "meta.json")) ? JSON.parse(readFileSync(join(OUT, "meta.json"), "utf8")) : {};

const L: string[] = [];
L.push(`# Evaluation report`, "");
L.push(
  `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} from \`${file.replace(ROOT, ".")}\`. Assistant: gpt-5.6-luna (low), as in the CLI. Judge: ${[...new Set(results.filter((r) => r.judge).map((r) => r.judgeModel ?? "gpt-6-astra"))].join(", ") || JUDGE_MODEL} (${JUDGE_EFFORT}), isolated, no tools. Synthetic businesses and people only.`,
  "",
);
L.push(`## 1 Summary`, "");
L.push(`| | Value |`, `|---|---|`);
L.push(`| Scenarios | ${byScenario.size} of ${meta.set && SETS[meta.set] ? SETS[meta.set].length : SCENARIOS.length} in set "${meta.set ?? "full"}" (runs per scenario: ${meta.runs ?? "?"}) |`);
L.push(`| Runs | ${results.length} (errors: ${errors.length}; judged: ${judged.length}) |`);
L.push(`| Runs passing all hard checks | ${pct(results.filter(hardOk).length, results.length)} |`);
L.push(`| Runs the judge passed | ${pct(judged.filter(judgeOk).length, judged.length)} |`);
L.push(`| Runs passing both | ${pct(results.filter(bothOk).length, results.length)} |`);
L.push(`| Scenarios, both: stable pass / flaky / stable fail | ${count("both", "stable pass")} / ${count("both", "flaky")} / ${count("both", "stable fail")} |`);
L.push(`| Average judge scores | ${DIMS.map((d) => `${d} ${f1(avg(judged.map((r) => r.judge!.scores[d])))}`).join(", ")} |`);
L.push(`| Guards (runs) | unverified links ${guards.unverified}, non-official links ${guards.nonOfficial}, pay calculations ${guards.payCalc}, unanswered turns ${guards.unanswered} |`);
L.push(`| Reply time per run | median ${f1(q(results.map((r) => r.ms / 1000), 0.5))} s, p90 ${f1(q(results.map((r) => r.ms / 1000), 0.9))} s |`);
L.push("");
L.push(`"Flaky" means the same scenario passed in some runs and failed in others. "Hard checks" are deterministic rules; the judge grades quality from 1 to 5.`, "");

L.push(`## 2 By category`, "", ...table(group((r) => r.category), "Category"), "");
L.push(`## 3 By business`, "", ...table(group((r) => r.persona), "Business"), "");

L.push(`## 4 Hard checks that failed`, "");
if (!failing.size) L.push("None.", "");
else {
  L.push(`| Check | Failed runs | Scenarios |`, `|---|---|---|`);
  for (const [name, e] of [...failing.entries()].sort((a, b) => b[1].n - a[1].n)) L.push(`| ${cell(name)} | ${e.n} | ${[...e.scenarios].sort().join(", ")} |`);
  L.push("");
}

L.push(`## 5 Critical issues found by the judge`, "");
if (!critical.length) L.push("None.", "");
for (const c of critical) {
  L.push(`**${c.id}** (${scen.get(c.id)?.title ?? ""})`);
  for (const x of c.issues) L.push(`- ${cell(x)}`);
  L.push("");
}

L.push(`## 6 Flaky scenarios`, "");
const flaky = stab.filter((s) => s.both === "flaky");
if (!flaky.length) L.push("None.", "");
else {
  L.push(`| Scenario | Title | Hard | Judge | Failing in |`, `|---|---|---|---|---|`);
  for (const s of flaky) {
    const bad = s.rs.filter((r) => !bothOk(r)).map((r) => `run ${r.run}: ${[...r.checks.filter((c) => !c.ok).map((c) => c.name), ...(r.judge && !judgeOk(r) ? ["judge fail"] : [])].join("; ")}`);
    L.push(`| ${s.id} | ${cell(scen.get(s.id)?.title ?? "")} | ${s.hard} | ${s.judge} | ${cell(bad.join(" / "))} |`);
  }
  L.push("");
}

L.push(`## 7 Lowest-scoring answers`, "");
for (const r of lowest) {
  const s = scen.get(r.scenario);
  L.push(`### ${r.scenario} run ${r.run}: ${f1(scoreOf(r))} (${r.judge!.verdict})`, "");
  L.push(`${s?.title ?? ""}. Business: ${r.persona}.`, "");
  L.push(`- **Owner:** ${excerpt(s?.turns.at(-1) ?? "", 300)}`);
  L.push(`- **Judge:** ${cell(r.judge!.summary)}`);
  for (const x of r.judge!.critical_issues) L.push(`- **Critical:** ${cell(x)}`);
  for (const x of r.judge!.minor_issues.slice(0, 3)) L.push(`- Minor: ${cell(x)}`);
  L.push(`- **Reply (start):** ${excerpt(r.replies.at(-1) ?? "", 600)}`, "");
}

if (errors.length) {
  L.push(`## 8 Run errors`, "");
  for (const r of errors) L.push(`- ${r.scenario}#${r.run}: ${cell(r.error ?? "")}`);
  L.push("");
}

L.push(`## Appendix: every scenario`, "");
L.push(`| Scenario | Category | Business | Title | Hard | Judge | Avg score |`, `|---|---|---|---|---|---|---|`);
for (const s of stab) {
  const sc = scen.get(s.id);
  const n = (ok: (r: RunResult) => boolean, rs: RunResult[]) => `${rs.filter(ok).length}/${rs.length}`;
  L.push(`| ${s.id} | ${sc?.category ?? ""} | ${sc?.persona ?? ""} | ${cell(sc?.title ?? "")} | ${n(hardOk, s.rs)} | ${n(judgeOk, s.rs.filter((r) => r.judge))} | ${f1(avg(s.rs.filter((r) => r.judge).map(scoreOf)))} |`);
}
L.push("");

writeFileSync(join(OUT, "report.md"), L.join("\n"));
writeFileSync(
  join(OUT, "summary.json"),
  JSON.stringify(
    {
      runs: results.length,
      scenarios: byScenario.size,
      hardPass: results.filter(hardOk).length,
      judgePass: judged.filter(judgeOk).length,
      bothPass: results.filter(bothOk).length,
      stability: { stablePass: count("both", "stable pass"), flaky: count("both", "flaky"), stableFail: count("both", "stable fail") },
      guards,
      scores: Object.fromEntries(DIMS.map((d) => [d, avg(judged.map((r) => r.judge!.scores[d]))])),
    },
    null,
    2,
  ),
);
console.log(`report: ${join(OUT, "report.md")}`);
