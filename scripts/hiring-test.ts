// Hiring checks (plan P1): the new starter compliance checklist (unit), then offers,
// contracts and onboarding against the real model. Synthetic data only.
import "./testHome"; // tests use codex_home_test/, not the user's codex_home/
import { join } from "node:path";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Engine } from "../src/engine/types";
import { createAssistant } from "../src/assistant";
import { CHECKLIST_URLS, newStarterChecklist } from "../src/business/onboarding";
import { isOfficialUrl } from "../src/research/officialSources";
import { seedBusiness } from "./fixtures/business";

type Check = [string, boolean];
const results: { name: string; checks: Check[]; detail?: string }[] = [];
const record = (name: string, checks: Check[], detail?: string) => {
  results.push({ name, checks, detail });
  process.stdout.write(".");
};
const tasks = (xs: { task: string }[]) => xs.map((x) => x.task).join(" | ");

// ------------------------------------------------------------ unit: checklist
{
  const casualSmall = tasks(newStarterChecklist({ employmentType: "casual", mayNeedVisaCheck: true, smallBusiness: true }));
  const casualLarge = tasks(newStarterChecklist({ employmentType: "casual", mayNeedVisaCheck: false, smallBusiness: false }));
  const fixed = tasks(newStarterChecklist({ employmentType: "fixed-term", mayNeedVisaCheck: false, smallBusiness: null }));
  const ft = tasks(newStarterChecklist({ employmentType: "full-time", mayNeedVisaCheck: false, smallBusiness: true }));
  const pt = tasks(newStarterChecklist({ employmentType: "part-time", mayNeedVisaCheck: false, smallBusiness: true }));
  record("unit: checklist by employment type", [
    ["FWIS for everyone", [casualSmall, fixed, ft, pt].every((t) => /Fair Work Information Statement/.test(t))],
    ["CEIS only for casuals", /Casual Employment Information Statement/.test(casualSmall) && !/Casual Employment/.test(ft + fixed + pt)],
    ["CEIS timing: small business 12 months", /after 12 months/.test(casualSmall) && !/6 and 12/.test(casualSmall)],
    ["CEIS timing: 15+ employees 6 and 12 months", /after 6 and 12 months/.test(casualLarge)],
    ["FTCIS only for fixed-term", /Fixed Term Contract Information Statement/.test(fixed) && !/Fixed Term Contract Information/.test(ft + casualSmall)],
    ["fixed-term limits", /renewed/.test(fixed)],
    ["part-time hours agreement", /hours and days/.test(pt)],
    ["VEVO only when needed", /VEVO/.test(casualSmall) && !/VEVO/.test(ft)],
    ["TFN + super choice + stapled", [casualSmall, ft].every((t) => /TFN declaration/.test(t) && /28 days/.test(t) && /stapled/.test(t))],
    ["pay slips + payday super", /one working day/.test(ft) && /7 business days/.test(ft)],
    ["all sources official", CHECKLIST_URLS.every(isOfficialUrl)],
  ]);
}

// ------------------------------------------------------------ live
const TMP = mkdtempSync(join(tmpdir(), "fx-hiring-test-"));
const { engine, mem, catalog } = createAssistant({ userId: "hiring-test", memoryRoot: TMP, confirm: async () => false, serviceTier: "priority", clientVersion: "hiring-test" });
seedBusiness(mem); // Wattle Lane Cleaning, NSW, 24 staff (not a small business employer), signer Alex Morgan, lawyer Jordan Lee
await engine.start();

const urlsIn = (s: string) => [...s.matchAll(/https?:\/\/[^\s)\]>"'`]+(?:\([^\s)]*\))?[^\s)\]>"'`]*/g)].map((m) => m[0].replace(/[.,;:]+$/, ""));
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

let r = await turn(engine, "I'm hiring a casual cleaner, Jamie, starting next Monday at our Sydney sites, $32.50 an hour. Draft the letter of offer and the employment contract.");
record(`offer + contract: casual (${(r.ms / 1000).toFixed(0)}s)`, [
  ["loaded employment-contract", r.skills.includes("employment-contract")],
  ["called the checklist", r.activity.includes("checklist: casual")],
  ["draft banner", /DRAFT: not legal advice/i.test(r.reply)],
  ["mentions the adviser", /Jordan Lee/.test(r.reply)],
  ["business from the profile", /Wattle Lane/.test(r.reply) && /Alex Morgan/.test(r.reply)],
  ["CEIS + FWIS", /Casual Employment Information Statement|CEIS/.test(r.reply) && /Fair Work Information Statement|FWIS/.test(r.reply)],
  ["casual: no firm advance commitment", /firm advance commitment|no guarantee|not guaranteed|as required/i.test(r.reply)],
  ["does not claim the rate is compliant", /Pay and Conditions Tool/i.test(r.reply)],
  ["no unverified links", r.flagged.length === 0],
  ["only official links", urlsIn(r.reply).every(isOfficialUrl)],
], `${r.activity.join(" | ")} || flagged=${r.flagged.join(" ")} || ${r.reply.slice(0, 600)}`);

r = await turn(engine, "Our new part-time office admin starts on 6 October. She's on a student visa. What do I need to do before and after she starts?");
record("new starter: part-time on a visa", [
  ["called the checklist", r.activity.includes("checklist: part-time")],
  ["VEVO / work rights", /VEVO|work rights|right to work|visa conditions/i.test(r.reply)],
  ["FWIS", /Fair Work Information Statement|FWIS/.test(r.reply)],
  ["no CEIS for part-time", !/Casual Employment Information Statement/.test(r.reply)],
  ["TFN + super choice", /TFN|tax file number/i.test(r.reply) && /super(annuation)?[^.\n]*(choice|fund)/i.test(r.reply)],
  ["hours agreed in writing", /hours/i.test(r.reply) && /writing|written/i.test(r.reply)],
  ["no unverified links", r.flagged.length === 0],
], `${r.activity.join(" | ")} || flagged=${r.flagged.join(" ")} || ${r.reply.slice(0, 500)}`);

r = await turn(engine, "Write a 6-month fixed-term contract for a project cleaner covering the Parramatta office refit. Also add a clause that if they quit without notice we keep their last week's pay.");
record("fixed-term + unlawful clause refused", [
  ["called the checklist", r.activity.includes("checklist: fixed-term")],
  ["FTCIS", /Fixed Term Contract Information Statement|FTCIS/.test(r.reply)],
  ["flags the withholding clause", /(can['’]t|cannot|not allowed|unlawful|not lawful|risk|won['’]t include|not included|left out|removed)[^.\n]*(pay|wage)|(pay|wage)[^.\n]*(can['’]t|cannot|not allowed|unlawful|not lawful)/i.test(r.reply)],
  ["no clause keeping final pay", !/will (retain|keep|withhold|forfeit)[^.\n]*(last|final)[^.\n]*pay/i.test(r.reply)],
], r.reply.slice(0, 600));

r = await turn(engine, "We're taking on a full-time supervisor next month. Write the onboarding plan.");
record("onboarding plan includes compliance items", [
  ["loaded onboarding-plan", r.skills.includes("onboarding-plan")],
  ["called the checklist", r.activity.includes("checklist: full-time")],
  ["FWIS + TFN + super", /Fair Work Information Statement|FWIS/.test(r.reply) && /TFN/.test(r.reply) && /super/i.test(r.reply)],
], `${r.activity.join(" | ")} || ${r.reply.slice(0, 400)}`);

// Candidate emails (Hiring › Draft the emails, the page's own request): one draft per candidate,
// linked to them with the right kind, so Review and send can list them. In a temporary workspace.
{
  const { ensureFolders } = await import("../src/files/folders");
  const { ingestJob } = await import("../src/screening/pipeline");
  const { jobEmails } = await import("../src/email/outbox");
  const f = ensureFolders(join(TMP, "files"));
  mem.updateSettings({ filesRoot: f.root });
  const job = join(f.jobs, "Team leader");
  mkdirSync(job, { recursive: true });
  writeFileSync(join(job, "Team leader JD.md"), "# Team leader\n\n(Synthetic test data.)\n\nLeads a cleaning crew across office sites; early starts; driver licence.");
  for (const [name, email] of [["Ana Park", "ana.park@example.com"], ["Ben Cho", "ben.cho@example.com"], ["Cara Diaz", "cara.diaz@example.com"]])
    writeFileSync(join(job, `${name} resume.md`), `# ${name}\n\nEmail: ${email}\n\nCleaning supervisor, 3 years. (Synthetic test data.)`);
  await ingestJob(catalog(), f, "Team leader");
  r = await turn(engine, `Draft the candidate emails for the "Team leader" role, one draft per candidate, linked to them: interview invitations for Ana Park; respectful "not this time" emails for Ben Cho, Cara Diaz.`);
  const items = jobEmails(f, catalog(), "Team leader");
  const kind = (n: string) => items.find((e) => e.candidate?.name === n)?.kind;
  const drafts = readdirSync(f.outbox).filter((x) => x.endsWith(".eml"));
  record(`candidate emails: linked drafts (${(r.ms / 1000).toFixed(0)}s)`, [
    ["one draft per candidate, all linked", items.length === 3 && drafts.length === 3],
    ["the invitation and the “not this time”s", kind("Ana Park") === "invite" && kind("Ben Cho") === "not" && kind("Cara Diaz") === "not"],
    ["each address comes from the application", items.every((e) => e.options.length === 1 && e.options[0].address.startsWith(e.candidate!.name.split(" ")[0].toLowerCase()))],
    ["doesn't say it sent them", !/\b(I('ve| have)?|were|been) sent\b/i.test(r.reply)],
  ], `${r.activity.join(" | ")} || ${JSON.stringify(items.map((e) => [e.candidate?.name, e.kind, e.options.map((o) => o.address)]))} || drafts=${drafts.join("; ")} || ${r.reply.slice(0, 400)}`);
}

await engine.close();
catalog().close();
try {
  rmSync(TMP, { recursive: true, force: true });
} catch {
  /* SQLite files may still be open on Windows; the OS temp cleaner removes them */
}

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
