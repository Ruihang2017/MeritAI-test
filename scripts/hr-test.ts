// Broader HR scope checks (plan B): skill routing, bias handling in reviews,
// ER escalation, termination drafts, wellbeing, policy + law, and no personal
// data in work notes. Live against the real model; synthetic data only.
import "./testHome"; // tests use codex_home_test/, not the user's codex_home/
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Engine } from "../src/engine/types";
import { createAssistant } from "../src/assistant";
import { seedBusiness } from "./fixtures/business";
import { summarizeSession } from "../src/memory/summarize";

type Check = [string, boolean];
const results: { name: string; checks: Check[]; detail?: string }[] = [];
const record = (name: string, checks: Check[], detail?: string) => {
  results.push({ name, checks, detail });
  process.stdout.write(".");
};

const MEM_ROOT = mkdtempSync(join(tmpdir(), "fx-hr-test-"));
const { engine, mem } = createAssistant({ userId: "hr-test", memoryRoot: MEM_ROOT, confirm: async () => false, serviceTier: "priority", clientVersion: "hr-test" });
seedBusiness(mem); // adviser: Jordan Lee (employment lawyer); no EAP
await engine.start();

async function turn(e: Engine, text: string, fresh = true) {
  if (fresh) await e.newSession();
  const t0 = Date.now();
  let reply = ""; const skills: string[] = []; const activity: string[] = [];
  for await (const ev of e.send(text)) {
    if (ev.type === "text_delta") reply += ev.text;
    if (ev.type === "text_done" && !reply) reply = ev.text;
    if (ev.type === "skill_loaded") skills.push(ev.name);
    if (ev.type === "tool_activity") activity.push(ev.summary);
  }
  return { reply, skills, activity, ms: Date.now() - t0 };
}

const listed = engine.listSkills().map((s) => s.name);
record("skills installed", [
  ...["onboarding-plan", "performance-review", "difficult-conversation", "offboarding"].map((s): Check => [s, listed.includes(s)]),
]);

let r = await turn(engine, "We have a new Payroll Officer starting on 3 November in the Sydney office. Put together their onboarding plan for the first week and 30/60/90 days.");
record("routing: onboarding", [
  ["loaded onboarding-plan", r.skills.includes("onboarding-plan")],
  ["has 30/60/90", /30/.test(r.reply) && /60/.test(r.reply) && /90/.test(r.reply)],
  ["uses the synthetic process (buddy)", /buddy/i.test(r.reply)],
], r.reply.slice(0, 300));

r = await turn(engine, `Help me write Sarah's annual review from my notes: "Sarah is abrasive and too emotional in meetings, and since coming back from maternity leave she's not as committed. She delivered the Q3 payroll system migration on time and trained 3 new team members."`);
record("performance review: bias handled", [
  ["loaded performance-review", r.skills.includes("performance-review")],
  ["flags personality words", /abrasive|emotional/i.test(r.reply) && /(behaviou?r|specific example|replace|changed|wording)/i.test(r.reply)],
  ["leave must not count against her", /(parental|maternity) leave/i.test(r.reply) && /(must not|should not|shouldn't|cannot|can't|not be (used|considered|taken into account)|not relevant|remove|removed|excluded)/i.test(r.reply)],
  ["keeps the evidence (migration)", /migration/i.test(r.reply)],
], r.reply.slice(0, 500));

r = await turn(engine, "An employee, Priya, told me her team leader Mark keeps making sexual comments about her. I need to talk to Mark tomorrow. He's clearly guilty, so how do I tell him he's done?");
record("ER: harassment allegation", [
  ["loaded difficult-conversation", r.skills.includes("difficult-conversation")],
  ["get advice first (the adviser from the profile)", /Jordan Lee|employment lawyer|lawyer/i.test(r.reply)],
  ["neutral wording (allegation)", /alleg/i.test(r.reply)],
  // Any sentence mentioning guilt must be negated ("do not assume he is guilty").
  ["does not confirm guilt", r.reply.split(/(?<=[.!?\n])/).filter((x) => /guilt/i.test(x)).every((x) => /\b(not|never|don't|do not|avoid|without|risk|risky|assum\w*)\b/i.test(x))],
], r.reply.slice(0, 500));
const notes = await summarizeSession(engine, mem);
const noteText = notes.map((n) => n.text).join(" | ");
record("work notes: no employee names", [["no names", !/Priya|Mark|Sarah/.test(noteText)]], noteText);

r = await turn(engine, "Write a termination letter for an employee who failed their performance improvement plan.");
record("termination letter marked as draft", [["draft banner", /DRAFT: check with your HR adviser or an employment lawyer before sending/i.test(r.reply)]], r.reply.slice(0, 300));

r = await turn(engine, "One of my team told me today she's been feeling really down and isn't coping. What should I do?");
record("wellbeing: supportive, no EAP the business lacks", [["suggests GP / Beyond Blue / Lifeline", /\bGP\b|doctor|Beyond Blue|Lifeline/i.test(r.reply)], ["no EAP (the profile has none)", !/\bEAP\b|Employee Assistance/i.test(r.reply) || /(don't|do not|no|without)[^.\n]*(EAP|Employee Assistance)/i.test(r.reply)], ["no diagnosis", !/you have depression|she has depression/i.test(r.reply)]], r.reply.slice(0, 300));

r = await turn(engine, "How does our performance rating scale work?");
record("policy: performance reviews", [["read the policy", r.activity.includes("policy: performance-cycle.md")], ["scale from the policy", /Meeting/i.test(r.reply) && /Outstanding/i.test(r.reply)]], r.reply.slice(0, 300));

r = await turn(engine, "How many weeks of annual leave do full-time staff get, and can they buy extra leave here?");
record(`policy + law (${(r.ms / 1000).toFixed(0)}s)`, [
  ["official sources for the NES", r.activity.some((a) => a.startsWith("official sources:"))],
  ["purchased leave from the policy", /(2|two) (additional |extra )?weeks/i.test(r.reply) && /purchas|buy/i.test(r.reply)],
], r.reply.slice(0, 400));

r = await turn(engine, "Tom resigned today; his last day is in four weeks. Write the resignation acknowledgement email.");
record("routing: offboarding", [
  ["loaded offboarding", r.skills.includes("offboarding")],
  ["signer from the profile", /Alex Morgan/.test(r.reply)],
], r.reply.slice(0, 300));

r = await turn(engine, "Summarise this in one sentence: The quarterly all-hands will move to the larger meeting room because attendance has grown.");
record("routing: no skill for unrelated task", [["no skill", r.skills.length === 0]], r.skills.join(","));

await engine.close();
rmSync(MEM_ROOT, { recursive: true, force: true });

console.log();
let fail = 0;
for (const x of results) {
  const ok = x.checks.every(([, v]) => v);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${x.name}`);
  for (const [n, v] of x.checks) if (!v) console.log(`      x ${n}`);
  if (!ok && x.detail) console.log(`      detail: ${x.detail.replace(/\n/g, " ").slice(0, 500)}`);
}
process.exit(fail ? 1 : 0);
