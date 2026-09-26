// Award and pay checks (plan P4): the award-finder skill against the real model.
// Assistive only: likely award and level with reasons and official sources, no pay
// calculations, always the Fair Work tools to confirm. Synthetic data only.
import "./testHome"; // tests use codex_home_test/, not the user's codex_home/
import { confirmText } from "../src/engine/types";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Engine } from "../src/engine/types";
import { createAssistant } from "../src/assistant";
import { isOfficialUrl } from "../src/research/officialSources";
import { normaliseEmployee } from "../src/business/register";
import { seedBusiness, TEST_PROFILE } from "./fixtures/business";
import { looksLikePayCalculation } from "../src/business/payGuard";

type Check = [string, boolean];
const results: { name: string; checks: Check[]; detail?: string }[] = [];
const record = (name: string, checks: Check[], detail?: string) => {
  results.push({ name, checks, detail });
  process.stdout.write(".");
};
const urlsIn = (s: string) => [...s.matchAll(/https?:\/\/[^\s)\]>"'`]+(?:\([^\s)]*\))?[^\s)\]>"'`]*/g)].map((m) => m[0].replace(/[.,;:]+$/, ""));
const CONFIRM_LINE = /Confirm the award, level and pay with the Fair Work Pay and Conditions Tool before you pay/i;

// ------------------------------------------------------------ unit: pay guard
record("unit: pay calculation guard", [
  ["hours × rate", looksLikePayCalculation("6 hours × $60.93 = $365.58 gross")],
  ["rate x hours", looksLikePayCalculation("$31.20 x 8")],
  ["total pay", looksLikePayCalculation("Total pay for the shift: $250.00")],
  ["you owe her", looksLikePayCalculation("You owe her $365.58.")],
  ["amount owed", looksLikePayCalculation("- Amount owed: $365.58")],
  ["a quoted rate is fine", !looksLikePayCalculation("The Level 1 minimum rate is $26.44 per hour (base rate = $26.44), from 1 July 2026.")],
  ["hours without money are fine", !looksLikePayCalculation("She worked 6 hours on Sunday.")],
]);

const TMP = mkdtempSync(join(tmpdir(), "fx-award-test-"));
let answers: boolean[] = [];
const asked: string[] = [];
function assistant(user: string) {
  return createAssistant({ userId: user, memoryRoot: TMP, confirm: async (q) => { asked.push(confirmText(q)); return answers.shift() ?? false; }, serviceTier: "priority", clientVersion: "award-test" });
}
async function turn(e: Engine, text: string) {
  await e.newSession();
  const t0 = Date.now();
  let reply = ""; const activity: string[] = []; const skills: string[] = []; const flagged: string[] = [];
  for await (const ev of e.send(text)) {
    if (ev.type === "text_delta") reply += ev.text;
    if (ev.type === "text_done" && !reply) reply = ev.text;
    if (ev.type === "tool_activity") activity.push(ev.summary);
    if (ev.type === "skill_loaded") skills.push(ev.name);
    if (ev.type === "unverified_links") flagged.push(...ev.urls);
  }
  return { reply, activity, skills, flagged, ms: Date.now() - t0 };
}

// Cleaning business (the profile says: Cleaning Services Award).
const A = assistant("award-a");
seedBusiness(A.mem);
A.register().add(normaliseEmployee({ name: "Jamie Chen", role: "Cleaner", employmentType: "casual", startDate: "2026-09-21" }, true));
await A.engine.start();

let r = await turn(A.engine, "We're hiring someone to clean offices at night: vacuuming, bins, bathrooms, no supervision of others, no qualifications needed. Which award and level would they be on?");
record(`cleaner: award + level (${(r.ms / 1000).toFixed(0)}s)`, [
  ["loaded award-finder", r.skills.includes("award-finder")],
  ["researched official sources", r.activity.some((a) => a.startsWith("official sources:"))],
  ["official pay tools", r.activity.includes("pay tools")],
  ["Cleaning Services Award", /Cleaning Services Award/i.test(r.reply)],
  ["a classification level with reasons", /level\s*1|Cleaning Services Employee Level|level one/i.test(r.reply)],
  ["confirm line", CONFIRM_LINE.test(r.reply)],
  ["Infoline", /13 13 94/.test(r.reply)],
  ["no pay arithmetic", !looksLikePayCalculation(r.reply)],
  ["no unverified links", r.flagged.length === 0],
  ["only official links", urlsIn(r.reply).every(isOfficialUrl)],
], `${r.activity.join(" | ")} || flagged=${r.flagged.join(" ")} || ${r.reply.slice(0, 700)}`);

r = await turn(A.engine, "Jamie is a casual level 1 cleaner. She worked 6 hours last Sunday. Work out exactly how much I owe her for that shift.");
record("pay calculation declined, tools instead", [
  ["no pay arithmetic", !looksLikePayCalculation(r.reply)],
  ["points to the Pay and Conditions Tool", /Pay and Conditions Tool/i.test(r.reply)],
  ["mentions the Sunday / casual rates to check", /Sunday|penalt|weekend/i.test(r.reply) && /casual/i.test(r.reply)],
  ["no unverified links", r.flagged.length === 0],
], `${r.activity.join(" | ")} || ${r.reply.slice(0, 600)}`);

answers = [true];
r = await turn(A.engine, "Yes, please record that Jamie is on the Cleaning Services Award, Level 1, in the register.");
const jamie = A.register().list().find((e) => /Jamie/.test(e.name));
record("award recorded in the register (confirmed)", [
  ["award", /Cleaning Services/i.test(jamie?.award ?? "")],
  ["level", /1/.test(jamie?.classification ?? "")],
], `${JSON.stringify(jamie)} || ${r.reply.slice(0, 300)}`);
await A.engine.close();
A.register().close();

// A café with no award recorded: coverage is not obvious, so it should reason, not guess.
const B = assistant("award-b");
seedBusiness(B.mem, { profile: { ...TEST_PROFILE, legalName: "Bluegum Cafe Pty Ltd", tradingName: "Bluegum Cafe", industry: "Café serving coffee and meals, dine-in and takeaway (synthetic)", awards: [], benefitsAndRules: [] }, policies: false });
await B.engine.start();
r = await turn(B.engine, "Which award covers our new kitchen hand, and what level? They wash dishes, do basic food prep and clean the kitchen, no qualifications, casual, supervised by the cook.");
record(`café kitchen hand: likely award with reasons (${(r.ms / 1000).toFixed(0)}s)`, [
  ["loaded award-finder", r.skills.includes("award-finder")],
  ["a hospitality-type award named", /Restaurant Industry Award|Hospitality Industry \(General\) Award|Fast Food Industry Award/i.test(r.reply)],
  ["hedged (likely / depends)", /likely|probably|depends|if your|check/i.test(r.reply)],
  ["confirm line", CONFIRM_LINE.test(r.reply)],
  ["no unverified links", r.flagged.length === 0],
], `${r.activity.join(" | ")} || ${r.reply.slice(0, 700)}`);
await B.engine.close();
rmSync(TMP, { recursive: true, force: true });

console.log();
let fail = 0;
for (const x of results) {
  const ok = x.checks.every(([, v]) => v);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${x.name}`);
  for (const [n, v] of x.checks) if (!v) console.log(`      x ${n}`);
  if (!ok && x.detail) console.log(`      detail: ${x.detail.replace(/\n/g, " ").slice(0, 900)}`);
}
process.exit(fail ? 1 : 0);
