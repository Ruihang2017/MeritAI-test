// Business profile, owner audience and drag-and-drop checks (plan P0): unit checks on the
// profile store and attachment handling, then live checks against the real model.
// Synthetic data only.
import { confirmText } from "../src/engine/types";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { Engine } from "../src/engine/types";
import { createAssistant } from "../src/assistant";
import { ensureFolders } from "../src/files/folders";
import { BusinessStore, describeChanges, normalisePatch, renderProfile } from "../src/business/profile";
import { attachToInbox, findDroppedPaths, rewriteMessage } from "../src/files/attach";
import { seedBusiness } from "./fixtures/business";

type Check = [string, boolean];
const results: { name: string; checks: Check[]; detail?: string }[] = [];
const record = (name: string, checks: Check[], detail?: string) => {
  results.push({ name, checks, detail });
  process.stdout.write(".");
};
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

const TMP = mkdtempSync(join(tmpdir(), "fx-business-test-"));

// ------------------------------------------------------------ unit: profile
{
  const F = ensureFolders(join(TMP, "unit"));
  const store = new BusinessStore(F.data);
  const noProfile = renderProfile(store);
  const p = normalisePatch({ legalName: "Test Co", states: ["nsw", "VIC"], abn: "51824753556", employmentTypes: ["Casual"] });
  const lines = describeChanges(store.get(), p);
  store.update(p);
  const changed = describeChanges(store.get(), normalisePatch({ states: ["NSW"] }));
  record("unit: profile", [
    ["no profile → says so, suggests /setup", /No business profile/.test(noProfile) && /\/setup/.test(noProfile)],
    ["states upper-cased", JSON.stringify(p.states) === '["NSW","VIC"]'],
    ["ABN formatted", p.abn === "51 824 753 556"],
    ["bad state rejected", throws(() => normalisePatch({ states: ["Sydney"] }))],
    ["bad ABN rejected", throws(() => normalisePatch({ abn: "123" }))],
    ["unknown field rejected", throws(() => normalisePatch({ ceo: "x" }))],
    ["change lines", lines.length === 4 && lines.some((l) => l.startsWith("Legal name: Test Co"))],
    ["old → new shown", changed.length === 1 && /NSW; VIC → NSW/.test(changed[0])],
    ["rendered with missing fields listed", /Legal name: Test Co/.test(renderProfile(store)) && /Not recorded:.*Pay frequency/.test(renderProfile(store))],
  ], JSON.stringify({ lines, changed }));
}

// ------------------------------------------------------------ unit: drag and drop
{
  const F = ensureFolders(join(TMP, "drop"));
  const src = join(TMP, "src dir");
  mkdirSync(join(src, "applicants"), { recursive: true });
  writeFileSync(join(src, "Resume Taylor.md"), "Taylor Reed\nBarista, 3 years");
  const plain = join(TMP, "plain");
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, "notes.txt"), "plain");
  writeFileSync(join(src, "run.exe"), "MZ");
  const forbidden = join(TMP, "codex_home");
  mkdirSync(forbidden, { recursive: true });
  writeFileSync(join(forbidden, "auth.md"), "secret");

  const line = `"${join(src, "Resume Taylor.md")}" ${join(plain, "notes.txt")}, what do you think? "C:\\no\\such file.pdf"`;
  const found = findDroppedPaths(line);
  const r1 = attachToInbox(F, found[0].path, [forbidden]);
  const r1again = attachToInbox(F, found[0].path, [forbidden]);
  writeFileSync(join(src, "Resume Taylor.md"), "Taylor Reed\nBarista, 4 years"); // different content, same name
  const r1changed = attachToInbox(F, found[0].path, [forbidden]);
  const r2 = attachToInbox(F, found[1].path, [forbidden]);
  const exe = attachToInbox(F, join(src, "run.exe"), [forbidden]);
  const secret = attachToInbox(F, join(forbidden, "auth.md"), [forbidden]);
  const folder = attachToInbox(F, join(src, "applicants"), [forbidden]);
  const msg = rewriteMessage(line, found, [r1, r2]);
  record("unit: drag and drop", [
    ["finds quoted (spaces) + unquoted with trailing comma", found.length === 2 && found[1].raw.endsWith("notes.txt")],
    ["ignores paths that do not exist", !found.some((d) => /no\\such/.test(d.path))],
    ["copied to Inbox", r1.kind === "file" && !r1.reused && readdirSync(F.inbox).includes("Resume Taylor.md")],
    ["identical file reused", r1again.kind === "file" && r1again.reused && r1again.name === "Resume Taylor.md"],
    ["different content never overwrites", r1changed.kind === "file" && r1changed.name === "Resume Taylor (2).md"],
    ["unsupported type refused", exe.kind === "refused"],
    ["assistant folders refused", secret.kind === "refused"],
    ["folder offered as job", folder.kind === "folder"],
    ["message rewritten", /\[attached: "Resume Taylor\.md" \(in the Inbox\)\] \[attached: "notes\.txt" \(in the Inbox\)\], what do you think\?/.test(msg)],
  ], msg);
}

// ------------------------------------------------------------ live
const MEM_ROOT = join(TMP, "memory");
let answers: boolean[] = [];
const asked: string[] = [];
const { engine, mem, business } = createAssistant({
  userId: "business-test",
  memoryRoot: MEM_ROOT,
  confirm: async (q) => { asked.push(confirmText(q)); return answers.shift() ?? true; },
  serviceTier: "priority",
  clientVersion: "business-test",
});
const F = seedBusiness(mem, { profile: null, policies: false }); // empty workspace, no profile yet
await engine.start();

async function turn(e: Engine, text: string, opts: { skill?: string; images?: string[]; fresh?: boolean } = {}) {
  if (opts.fresh) await e.newSession();
  let reply = ""; const activity: string[] = []; const skills: string[] = [];
  for await (const ev of e.send(text, { skill: opts.skill, images: opts.images })) {
    if (ev.type === "text_delta") reply += ev.text;
    if (ev.type === "text_done" && !reply) reply = ev.text;
    if (ev.type === "tool_activity") activity.push(ev.summary);
    if (ev.type === "skill_loaded") skills.push(ev.name);
  }
  return { reply, activity, skills };
}

// No profile yet: work continues with placeholders and a nudge to /setup.
let r = await turn(engine, "Write a short letter confirming a casual employee's new roster from next Monday.", { fresh: true });
record("no profile: placeholders + suggests /setup", [
  ["suggests /setup", /\/setup/.test(r.reply)],
  ["placeholder for the business", /\[(Business|Company)[^\]]*\]/i.test(r.reply)],
], r.reply.slice(0, 400));

// Setup interview: the owner answers whatever the assistant asks, over a few rounds.
await engine.newSession();
const setupTranscript: string[] = [];
const OWNER = [
  "We're Bluegum Cafe Pty Ltd, trading as Bluegum Cafe. ABN not handy. A café with some catering, at 12 King St, Newtown NSW 2042. All staff work in NSW.",
  "About 9 staff: 2 full-time and 7 casuals. Award: I think the hospitality one, not sure. We pay fortnightly through Xero.",
  "Staff get a free meal each shift and we provide aprons. I sign letters: Sam Nguyen, Owner. No HR adviser or lawyer, and no EAP.",
  "That's everything, thanks.",
];
r = await turn(engine, "Start the business setup interview. Ask in English unless I answer in another language.", { skill: "business-setup" });
setupTranscript.push(r.reply);
for (const answer of OWNER) {
  if (business().get().signer && /Sam/.test(business().get().signer ?? "")) break;
  r = await turn(engine, answer);
  setupTranscript.push(r.reply);
}
const prof = business().get();
record("setup interview → profile", [
  ["asked the owner to confirm", asked.some((q) => /business profile/.test(q))],
  ["name", /Bluegum/.test(`${prof.legalName} ${prof.tradingName}`)],
  ["state NSW", prof.states.includes("NSW")],
  ["casual recorded", prof.employmentTypes.includes("casual")],
  ["fortnightly", prof.payFrequency === "fortnightly"],
  ["signer", /Sam Nguyen/.test(prof.signer ?? "")],
  ["award not guessed (unsure or as said)", prof.awards.every((a) => /unsure|not sure|hospitality/i.test(a))],
  ["no adviser recorded as a person", !prof.adviser || prof.adviser.kind === "none"],
], `${JSON.stringify(prof)} || ${setupTranscript.map((t) => t.slice(0, 200)).join(" / ")}`);

// The profile is used in a new session.
r = await turn(engine, "Write a short letter confirming a casual employee's new roster from next Monday.", { fresh: true });
record("profile used in drafts", [
  ["business name", /Bluegum/.test(r.reply)],
  ["signer", /Sam Nguyen/.test(r.reply)],
  ["no /setup nudge any more", !/\/setup/.test(r.reply)],
], r.reply.slice(0, 400));

// A change mentioned in the chat goes to the profile, after confirmation.
answers = [true];
const askedBefore = asked.length;
r = await turn(engine, "By the way, we've just opened a second café in Melbourne, so we now have staff in Victoria too.", { fresh: true });
record("profile updated from the chat (confirmed)", [
  ["asked to confirm", asked.length > askedBefore],
  ["VIC added, NSW kept", business().get().states.includes("VIC") && business().get().states.includes("NSW")],
], r.reply.slice(0, 300));

// Declined change is not saved.
answers = [false];
r = await turn(engine, "Update our profile: we now pay weekly instead of fortnightly.", { fresh: true });
record("declined change not saved", [["still fortnightly", business().get().payFrequency === "fortnightly"]], r.reply.slice(0, 300));

// ER without an adviser: Fair Work Infoline / lawyer, draft banner.
r = await turn(engine, "One of my casuals keeps turning up late. I want to sack him tomorrow. Write the termination letter.", { fresh: true });
record("ER, no adviser: where to get advice + banner", [
  ["Fair Work Infoline or lawyer", /13 13 94|Fair Work (Infoline|Ombudsman)|employment lawyer|employer association/i.test(r.reply)],
  ["draft banner", /DRAFT: check with your HR adviser or an employment lawyer before sending/i.test(r.reply)],
  ["no Employee Relations team", !/Employee Relations team|contact ER\b|People and Culture/i.test(r.reply)],
], r.reply.slice(0, 500));

// Drag and drop: a dropped resume is copied into the Inbox and read.
{
  const src = join(TMP, "Downloads");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "Taylor Reed resume.md"), "# Taylor Reed\nBarista at Little Fig Espresso, Sydney, 2022-2025: 300+ coffees a day, opened the store alone on weekends, trained 2 new baristas.\nRSA certificate. Available weekends.");
  const line = `"${join(src, "Taylor Reed resume.md")}" is this person a good fit for a weekend barista job? Two lines.`;
  const dropped = findDroppedPaths(line);
  const res = dropped.map((d) => attachToInbox(F, d.path, []));
  r = await turn(engine, rewriteMessage(line, dropped, res), { fresh: true });
  record("drag and drop: resume read from the Inbox", [
    ["copied", readdirSync(F.inbox).includes("Taylor Reed resume.md")],
    ["read it", r.activity.some((a) => /read: Taylor Reed resume\.md/.test(a))],
    ["answer uses it", /weekend|RSA|barista/i.test(r.reply)],
  ], `${r.activity.join(" | ")} || ${r.reply.slice(0, 300)}`);
}

// Drag and drop: an image (a roster screenshot) is shown to the model.
{
  const png = join(TMP, "roster.png");
  const ps = `Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap 700,220; $g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::White); $f = New-Object System.Drawing.Font('Arial',20); $br = [System.Drawing.Brushes]::Black; $g.DrawString('ROSTER week of 6 Oct', $f, $br, 10, 10); $g.DrawString('Mon  Priya  7:00 - 15:00', $f, $br, 10, 60); $g.DrawString('Tue  Jordan  10:00 - 18:30', $f, $br, 10, 110); $g.DrawString('Wed  Priya  7:00 - 12:00', $f, $br, 10, 160); $b.Save('${png}'); $g.Dispose(); $b.Dispose()`;
  spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
  const dropped = findDroppedPaths(`${png} what hours does Jordan work on Tuesday? One line.`);
  const res = dropped.map((d) => attachToInbox(F, d.path, []));
  const images = res.flatMap((x) => (x.kind === "file" && x.image ? [x.path] : []));
  r = await turn(engine, rewriteMessage(`${png} what hours does Jordan work on Tuesday? One line.`, dropped, res), { fresh: true, images });
  record("drag and drop: image seen by the model", [
    ["attached as image", images.length === 1],
    ["read the roster", /10(:00)?\s*(am)?\s*(-|–|to)\s*(18:30|6:30)/i.test(r.reply)],
  ], r.reply.slice(0, 300));
}

await engine.close();
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
