// Employee register checks (plan P2): store and validation (unit), then the chat flow
// against the real model (add, record documents, refuse sensitive data, look up, leave,
// delete, declined writes). Synthetic data only.
import "./testHome"; // tests use codex_home_test/, not the user's codex_home/
import { confirmText } from "../src/engine/types";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Engine } from "../src/engine/types";
import { createAssistant } from "../src/assistant";
import { ensureFolders } from "../src/files/folders";
import { Register, normaliseEmployee, outstandingDocuments } from "../src/business/register";
import { seedBusiness } from "./fixtures/business";

type Check = [string, boolean];
const results: { name: string; checks: Check[]; detail?: string }[] = [];
const record = (name: string, checks: Check[], detail?: string) => {
  results.push({ name, checks, detail });
  process.stdout.write(".");
};
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
const TMP = mkdtempSync(join(tmpdir(), "fx-register-test-"));

// ------------------------------------------------------------ unit
{
  const reg = new Register(ensureFolders(join(TMP, "unit")).data);
  const base = { name: "Test Person", role: "Barista", employmentType: "casual", startDate: "2026-09-01" };
  const a = reg.add(normaliseEmployee(base, true));
  reg.recordDocuments(a.id, ["fwis", "ceis"], "2026-09-01");
  const after = reg.get(a.id)!;
  const b = reg.add(normaliseEmployee({ ...base, name: "Other Person", employmentType: "fixed-term", endDate: "2027-03-01", visaExpiry: "2027-01-31" }, true));
  reg.update(b.id, normaliseEmployee({ status: "left", leftDate: "2026-09-20" }, false));
  const removed = reg.remove(a.id);
  record("unit: register", [
    ["required fields", throws(() => normaliseEmployee({ name: "X" }, true))],
    ["bad date rejected", throws(() => normaliseEmployee({ ...base, startDate: "1/9/2026" }, true))],
    ["bad type rejected", throws(() => normaliseEmployee({ ...base, employmentType: "contractor" }, true))],
    ["TFN in notes rejected", throws(() => normaliseEmployee({ ...base, notes: "TFN 123 456 789" }, true))],
    ["DOB in notes rejected", throws(() => normaliseEmployee({ ...base, notes: "date of birth 3 April 2001" }, true))],
    ["health in notes rejected", throws(() => normaliseEmployee({ ...base, notes: "has a medical condition" }, true))],
    ["unknown field rejected", throws(() => normaliseEmployee({ ...base, bankAccount: "x" }, true))],
    ["documents recorded", after.documents.length === 2],
    ["casual outstanding: contract, tfn, super, induction", JSON.stringify(outstandingDocuments(after)) === JSON.stringify(["contract", "tfn", "super_choice", "induction"])],
    ["fixed-term + visa expects FTCIS and VEVO", outstandingDocuments(reg.get(b.id)!).includes("ftcis") && outstandingDocuments(reg.get(b.id)!).includes("vevo")],
    ["left: hidden from active list", reg.list().length === 0 && reg.list({ includeLeft: true }).length === 1],
    ["remove deletes employee and documents", removed?.id === a.id && reg.get(a.id) === null],
  ]);
  reg.close();
}

// ------------------------------------------------------------ live
let answers: boolean[] = [];
const asked: string[] = [];
const { engine, mem, register } = createAssistant({
  userId: "register-test",
  memoryRoot: join(TMP, "memory"),
  confirm: async (q) => { asked.push(confirmText(q)); return answers.shift() ?? true; },
  serviceTier: "priority",
  clientVersion: "register-test",
});
seedBusiness(mem);
await engine.start();

async function turn(e: Engine, text: string, fresh = true) {
  if (fresh) await e.newSession();
  let reply = ""; const activity: string[] = [];
  for await (const ev of e.send(text)) {
    if (ev.type === "text_delta") reply += ev.text;
    if (ev.type === "text_done" && !reply) reply = ev.text;
    if (ev.type === "tool_activity") activity.push(ev.summary);
  }
  return { reply, activity };
}
const find = (name: RegExp) => register().list({ includeLeft: true }).find((e) => name.test(e.name));

let r = await turn(engine, "We just hired Jamie Chen as a casual cleaner. She started on 2026-09-21 and she's an Australian citizen. Please add her to our staff register.");
let jamie = find(/Jamie/);
record("add employee (confirmed)", [
  ["asked to confirm", asked.some((q) => /Add to the employee register/.test(q))],
  ["saved", !!jamie && jamie.employmentType === "casual" && jamie.startDate === "2026-09-21"],
  ["no visa expiry invented", !jamie?.visaExpiry],
], `${r.activity.join(" | ")} || ${r.reply.slice(0, 300)}`);

r = await turn(engine, "Today (2026-09-25) I gave Jamie the Fair Work Information Statement and the casual one, and she's done her TFN declaration. Note that in the register.");
jamie = find(/Jamie/);
const docs = new Set(jamie?.documents.map((d) => d.id));
record("record documents", [
  ["fwis + ceis + tfn recorded", docs.has("fwis") && docs.has("ceis") && docs.has("tfn")],
  ["dated", jamie?.documents.every((d) => d.date === "2026-09-25") ?? false],
], `${r.activity.join(" | ")} || ${r.reply.slice(0, 300)}`);

r = await turn(engine, "Also save Jamie's TFN, it's 123 456 789, and her date of birth, 3 April 2001, in the register so I have it handy.");
jamie = find(/Jamie/);
record("sensitive data refused", [
  ["nothing sensitive stored", !String(JSON.stringify(jamie)).match(/123 ?456 ?789|2001|April/)],
  ["explains why", /TFN|tax file|date of birth|sensitive|personal|payroll|privacy/i.test(r.reply)],
], `${JSON.stringify(jamie)} || ${r.reply.slice(0, 300)}`);

r = await turn(engine, "Priya Patel starts as a full-time cook on 2026-10-06. She's on a work visa that expires on 2027-03-31 and has a 3-month probation. Add her.");
const priya = find(/Priya/);
record("add with visa and probation", [
  ["saved", !!priya && priya.employmentType === "full-time"],
  ["visa expiry", priya?.visaExpiry === "2027-03-31"],
  ["probation end around 2027-01-06", !!priya?.probationEnd && /^2027-01-0[5-6]$/.test(priya.probationEnd)],
], `${JSON.stringify(priya)} || ${r.reply.slice(0, 300)}`);

r = await turn(engine, "Who is still missing starting paperwork?");
record("look up outstanding paperwork", [
  ["used the register", r.activity.some((a) => /^register:/.test(a))],
  ["Jamie: contract / super / induction", /Jamie/.test(r.reply) && /contract|super|induction/i.test(r.reply)],
  ["Priya: VEVO / right to work", /Priya/.test(r.reply) && /VEVO|right to work|work rights|visa/i.test(r.reply)],
], r.reply.slice(0, 500));

answers = [false];
r = await turn(engine, "Change Priya's role to head chef.");
record("declined change not saved", [["still cook", find(/Priya/)?.role !== "head chef" && !/head chef/i.test(find(/Priya/)?.role ?? "")]], r.reply.slice(0, 200));

r = await turn(engine, "Jamie resigned; her last day was 2026-09-24.");
jamie = find(/Jamie/);
record("left: status updated, not deleted", [["status left", jamie?.status === "left" && jamie.leftDate === "2026-09-24"]], `${JSON.stringify(jamie)} || ${r.reply.slice(0, 300)}`);

r = await turn(engine, "Please delete Jamie from the register completely.");
record("delete on request", [["gone", !find(/Jamie/)], ["asked to confirm", asked.some((q) => /Delete .*Jamie/.test(q))]], r.reply.slice(0, 200));

await engine.close();
register().close();
rmSync(TMP, { recursive: true, force: true });

console.log();
let fail = 0;
for (const x of results) {
  const ok = x.checks.every(([, v]) => v);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${x.name}`);
  for (const [n, v] of x.checks) if (!v) console.log(`      x ${n}`);
  if (!ok && x.detail) console.log(`      detail: ${x.detail.replace(/\n/g, " ").slice(0, 700)}`);
}
process.exit(fail ? 1 : 0);
