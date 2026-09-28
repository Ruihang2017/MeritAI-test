// Evaluation runner. Runs every scenario N times against the real assistant (same wiring
// as the CLI), applies the hard checks, has a stronger model grade each run, and appends
// one JSON line per run to <out>/results.jsonl. Resumable: finished runs are skipped, and
// runs graded by a different judge model (or not graded) are re-graded without re-running.
//
//   npm run eval -- [--set core|regression|full] [--runs 2] [--concurrency 8] [--only <regex>] [--out eval/results/<name>] [--no-judge] [--rejudge-only]
import "../scripts/testHome"; // tests use codex_home_test/, not the user's codex_home/
import { confirmText } from "../src/engine/types";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistant, ROOT, type Assistant } from "../src/assistant";
import type { EngineEvent } from "../src/engine/types";
import { ensureFolders } from "../src/files/folders";
import { BusinessStore } from "../src/business/profile";
import { DOCUMENTS, employeeLine, normaliseEmployee, type DocumentId } from "../src/business/register";
import { addDays, todayLocal } from "../src/business/reminders";
import { PERSONAS } from "./personas";
import { SCENARIOS } from "./scenarios";
import { SETS } from "./sets";
import { runChecks } from "./checks";
import { judge, JUDGE_MODEL, LEGACY_JUDGE_MODEL } from "./judge";
import type { Persona, RunResult, Scenario } from "./types";

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const SET = arg("set", "core")!;
if (!SETS[SET]) throw new Error(`unknown set "${SET}" (use ${Object.keys(SETS).join(", ")})`);
const RUNS = Number(arg("runs", "2"));
const CONCURRENCY = Number(arg("concurrency", "8"));
/** Only re-grade existing runs with the current judge; never start new conversations (keeps an old baseline pure). */
const REJUDGE_ONLY = process.argv.includes("--rejudge-only");
const ONLY = arg("only") ? new RegExp(arg("only")!) : null;
const OUT = join(ROOT, arg("out", `eval/results/${todayLocal()}`)!);
const JUDGE = !process.argv.includes("--no-judge");
const TURN_TIMEOUT_MS = 4 * 60_000;
const RATE_LIMIT = /usage limit|rate limit|too many requests|\b429\b|quota/i;

mkdirSync(OUT, { recursive: true });
const RESULTS = join(OUT, "results.jsonl");

// Latest result per scenario#run.
const previous = new Map<string, RunResult>();
if (existsSync(RESULTS)) {
  for (const line of readFileSync(RESULTS, "utf8").split("\n").filter(Boolean)) {
    try {
      const r = JSON.parse(line) as RunResult;
      previous.set(`${r.scenario}#${r.run}`, r);
    } catch {
      /* skip */
    }
  }
}
const judgedBy = (r: RunResult) => (r.judge ? (r.judgeModel ?? LEGACY_JUDGE_MODEL) : null);

const scenarios = SCENARIOS.filter((s) => SETS[SET].includes(s.id) && (!ONLY || ONLY.test(s.id)));
const ids = new Set<string>();
for (const s of SCENARIOS) {
  if (ids.has(s.id)) throw new Error(`duplicate scenario id ${s.id}`);
  ids.add(s.id);
}

type Item = { sc: Scenario; run: number; existing?: RunResult };
const queue: Item[] = [];
const rejudge: Item[] = [];
let alreadyDone = 0;
// Runs outermost, so partial results cover every scenario once before repeating.
for (let run = 1; run <= RUNS; run++) {
  for (const sc of scenarios) {
    const prev = previous.get(`${sc.id}#${run}`);
    if (prev?.status !== "ok") {
      if (!REJUDGE_ONLY) queue.push({ sc, run });
    }
    else if (JUDGE && judgedBy(prev) !== JUDGE_MODEL) rejudge.push({ sc, run, existing: prev });
    else alreadyDone++;
  }
}
queue.unshift(...rejudge); // grading only: cheap, do it first
writeFileSync(join(OUT, "meta.json"), JSON.stringify({ set: SET, runs: RUNS, scenarios: scenarios.length, judge: JUDGE ? JUDGE_MODEL : null, only: ONLY?.source ?? null, updatedAt: new Date().toISOString() }, null, 2));
console.log(
  `set ${SET}: ${scenarios.length} scenarios × ${RUNS} runs; ${alreadyDone} done, ${rejudge.length} to re-grade, ${queue.length - rejudge.length} to run; ` +
    `concurrency ${CONCURRENCY}; judge ${JUDGE ? JUDGE_MODEL : "off"}; out ${OUT}`,
);

const TMP = mkdtempSync(join(tmpdir(), "fx-eval-"));
let stopReason: string | null = null;
let consecutiveLimits = 0;
let finished = 0;
let total = 0;
const t0 = Date.now();

/** Local calendar date of an ISO timestamp. */
const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Fresh workspace for one run: profile, policies, register (dates relative to `today`), Inbox. */
function seed(a: Assistant, w: number, persona: Persona, sc: Scenario, today: string) {
  const f = ensureFolders(join(mkdtempSync(join(TMP, `ws-${w}-`)), "files"));
  a.mem.updateSettings({ filesRoot: f.root });
  if (persona.profile) new BusinessStore(f.data).update(persona.profile);
  for (const [name, text] of Object.entries(persona.policies)) writeFileSync(join(f.policies, name), text);
  for (const [name, text] of Object.entries(sc.inbox ?? {})) writeFileSync(join(f.inbox, name), text);
  const reg = a.register();
  for (const s of persona.staff) {
    const { startOffset, probationEndOffset, visaExpiryOffset, endOffset, docs, ...rest } = s;
    const e = reg.add(
      normaliseEmployee(
        {
          ...rest,
          startDate: addDays(today, startOffset),
          ...(probationEndOffset !== undefined ? { probationEnd: addDays(today, probationEndOffset) } : {}),
          ...(visaExpiryOffset !== undefined ? { visaExpiry: addDays(today, visaExpiryOffset) } : {}),
          ...(endOffset !== undefined ? { endDate: addDays(today, endOffset) } : {}),
        },
        true,
      ),
    );
    if (docs?.length) reg.recordDocuments(e.id, docs as DocumentId[], addDays(today, startOffset));
  }
  // What the assistant could look up at the start (the judge sees it too, to avoid false "missing" findings).
  const startState = [
    `Employee register at the start (the assistant can read it with list_employees; recorded documents are not listed as outstanding): ${reg.list().map((e) => employeeLine(e) + ` | recorded: ${e.documents.map((d) => DOCUMENTS[d.id]).join("; ") || "none"}`).join(" || ") || "empty"}`,
    `Policy documents: ${Object.keys(persona.policies).join(", ") || "none"}`,
    sc.inbox ? `Files in the Inbox: ${Object.keys(sc.inbox).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { f, reg, startState };
}

/** Counts usage-limit errors; stops everything after 5 in a row. Returns true if it was one. */
async function limitHit(message: string): Promise<boolean> {
  if (!RATE_LIMIT.test(message)) return false;
  consecutiveLimits++;
  if (consecutiveLimits >= 5) stopReason = `usage limit reached (${message}); rerun the same command later to resume`;
  else await new Promise((r) => setTimeout(r, 60_000));
  return true;
}

function log(r: RunResult, note = "") {
  finished++;
  const failedChecks = r.checks.filter((c) => !c.ok).length;
  const eta = queue.length ? Math.round((((Date.now() - t0) / finished) * queue.length) / CONCURRENCY / 60_000) : 0;
  console.log(
    `[${finished}/${total}] ${r.scenario}#${r.run}${note} ${r.status}${r.error ? `: ${r.error}` : ""} ` +
      `${(r.ms / 1000).toFixed(0)}s checks ${r.checks.length - failedChecks}/${r.checks.length}` +
      `${r.judge ? ` judge ${r.judge.verdict}` : r.judgeError ? ` judge error: ${r.judgeError}` : ""}${eta ? ` (~${eta} min left)` : ""}`,
  );
}

async function worker(w: number) {
  let answers: boolean[] = [];
  let asked: string[] = [];
  const a = createAssistant({
    userId: `eval-w${w}`,
    memoryRoot: join(TMP, `mem-${w}`),
    confirm: async (q) => {
      asked.push(confirmText(q));
      return answers.length ? answers.shift()! : true;
    },
    serviceTier: "priority",
    clientVersion: "eval",
  });
  await a.engine.start();

  while (queue.length && !stopReason) {
    const item = queue.shift()!;
    const { sc, run } = item;
    const persona = PERSONAS[sc.persona];

    // ---- re-grade an existing run (no new assistant conversation)
    if (item.existing) {
      const r: RunResult = { ...item.existing, judge: undefined, judgeError: undefined };
      r.today ??= localDate(r.startedAt);
      r.startState ??= seed(a, w, persona, sc, r.today).startState;
      try {
        r.judge = await judge(a.engine, sc, persona, r, r.today, r.startState);
        r.judgeModel = JUDGE_MODEL;
        consecutiveLimits = 0;
      } catch (e) {
        if (await limitHit((e as Error).message)) {
          queue.unshift(item);
          continue;
        }
        r.judgeError = (e as Error).message;
      }
      appendFileSync(RESULTS, JSON.stringify(r) + "\n");
      log(r, " (re-graded)");
      continue;
    }

    // ---- full run
    const today = todayLocal();
    const { f, reg, startState } = seed(a, w, persona, sc, today);
    answers = [...(sc.confirm ?? [])];
    asked = [];
    const result: RunResult = {
      scenario: sc.id,
      run,
      persona: sc.persona,
      category: sc.category,
      startedAt: new Date().toISOString(),
      today,
      startState,
      ms: 0,
      status: "ok",
      replies: [],
      activity: [],
      skills: [],
      flagged: [],
      asked,
      checks: [],
    };
    const started = Date.now();
    try {
      await a.engine.newSession();
      // An explicit skill is injected by the server and emits no skill_loaded event (the CLI prints it itself).
      if (sc.skill) result.skills.push(sc.skill);
      for (const [i, text] of sc.turns.entries()) {
        let reply = "";
        const act: string[] = [];
        let failed: string | null = null;
        const timer = setTimeout(() => a.engine.interrupt().catch(() => {}), TURN_TIMEOUT_MS);
        for await (const ev of a.engine.send(text, i === 0 && sc.skill ? { skill: sc.skill } : {}) as AsyncIterable<EngineEvent>) {
          if (ev.type === "text_delta") reply += ev.text;
          if (ev.type === "text_done" && !reply) reply = ev.text;
          // As a front end does: the message is replaced by the one without the model's own notes.
          if (ev.type === "text_done" && ev.notesRemoved) {
            const k = reply.lastIndexOf(ev.notesRemoved);
            if (k >= 0) reply = reply.slice(0, k).trimEnd();
            act.push(`leaked notes removed: ${ev.notesRemoved}`);
          }
          if (ev.type === "tool_activity") act.push(ev.summary);
          if (ev.type === "skill_loaded") result.skills.push(ev.name);
          if (ev.type === "unverified_links") result.flagged.push(...ev.urls);
          // As a front end does: the shortened link is replaced in the shown reply.
          if (ev.type === "links_corrected") for (const f of ev.fixes) { reply = reply.split(f.from).join(f.to); act.push(`link corrected: ${f.from} → ${f.to}`); }
          if (ev.type === "error" && !ev.willRetry) failed = ev.message;
          if (ev.type === "turn_end" && ev.status !== "completed") failed ??= ev.error ?? `turn ${ev.status}`;
        }
        clearTimeout(timer);
        result.replies.push(reply);
        result.activity.push(act);
        if (failed && !reply) throw new Error(failed);
      }
      result.ms = Date.now() - started;
      result.checks = runChecks(sc, result, { register: reg, business: a.business(), folders: f });
      consecutiveLimits = 0;
      if (JUDGE) {
        try {
          result.judge = await judge(a.engine, sc, persona, result, today, startState);
          result.judgeModel = JUDGE_MODEL;
        } catch (e) {
          result.judgeError = (e as Error).message;
          await limitHit(result.judgeError); // the run is kept; it is re-graded on the next start
        }
      }
    } catch (e) {
      result.status = "error";
      result.error = (e as Error).message;
      result.ms = Date.now() - started;
      if (await limitHit(result.error)) {
        queue.unshift(item); // not recorded: retried later
        continue;
      }
    }
    appendFileSync(RESULTS, JSON.stringify(result) + "\n");
    log(result);
  }
  await a.engine.close();
}

// Keep a copy of the persona definitions next to the results.
cpSync(join(ROOT, "eval", "personas.ts"), join(OUT, "personas.snapshot.txt"));
total = queue.length;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, (_, i) => worker(i + 1)));
try {
  rmSync(TMP, { recursive: true, force: true });
} catch {
  /* SQLite files may still be open on Windows; the OS temp cleaner removes them */
}
if (stopReason) {
  console.log(`\nSTOPPED: ${stopReason}`);
  process.exit(2);
}
console.log(`\nDone in ${Math.round((Date.now() - t0) / 60_000)} min. Report: npm run eval:report -- --out ${OUT}`);
