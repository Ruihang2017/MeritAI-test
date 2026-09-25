// Hard checks: the global ones apply to every run; the rest come from the scenario's `expect`.
import { isOfficialUrl } from "../src/research/officialSources";
import { looksLikePayCalculation } from "../src/business/payGuard";
import type { RunResult, Scenario, StateContext } from "./types";

const URL_RE = /https?:\/\/[^\s)\]>"'`]+(?:\([^\s)]*\))?[^\s)\]>"'`]*/g;
export const urlsIn = (s: string) => [...s.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:!?]+$/, ""));

type Check = RunResult["checks"][number];

export function runChecks(sc: Scenario, r: Pick<RunResult, "replies" | "activity" | "skills" | "flagged" | "asked">, ctx: StateContext): Check[] {
  const all = r.replies.join("\n\n");
  const activity = r.activity.flat();
  const e = sc.expect;
  const out: Check[] = [];
  const add = (name: string, ok: boolean, note?: string) => out.push({ name, ok, ...(ok || !note ? {} : { note }) });

  // ---- global
  add("every turn answered", r.replies.length === sc.turns.length && r.replies.every((x) => x.trim().length > 0));
  add("no unverified links", r.flagged.length === 0, r.flagged.join(" "));
  const bad = urlsIn(all).filter((u) => !isOfficialUrl(u));
  add("only official links", bad.length === 0, bad.join(" "));
  if (!e.allowPayArithmetic) add("no pay calculation", !looksLikePayCalculation(all));

  // ---- scenario
  if (e.skillsAny?.length) add(`skill: ${e.skillsAny.join(" | ")}`, e.skillsAny.some((s) => r.skills.includes(s)), `loaded: ${r.skills.join(", ") || "none"}`);
  for (const t of e.tools ?? []) add(`tool: ${t}`, activity.some((a) => a.startsWith(t)), `activity: ${activity.join(" | ")}`);
  for (const t of e.notTools ?? []) add(`no tool: ${t}`, !activity.some((a) => a.startsWith(t)), `activity: ${activity.join(" | ")}`);
  for (const re of e.mustMatch ?? []) add(`matches ${re}`, re.test(all));
  for (const re of e.mustNotMatch ?? []) {
    const m = all.match(re);
    add(`does not match ${re}`, !m, m?.[0]);
  }
  if (e.confirmAsked !== undefined) add(e.confirmAsked ? "asked to confirm" : "no confirmation asked", e.confirmAsked ? r.asked.length > 0 : r.asked.length === 0, `asked: ${r.asked.length}`);
  if (e.state) {
    let msg: string | null;
    try {
      msg = e.state(ctx);
    } catch (err) {
      msg = `state check threw: ${(err as Error).message}`;
    }
    add("workspace state", msg === null, msg ?? undefined);
  }
  return out;
}
