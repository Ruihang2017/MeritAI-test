// Unit checks that never call the model (free: no ChatGPT quota). Covers the fixes from
// the first evaluation: apprentices, the leaving checklist, fixed-term notes, reminder
// wording, small business status and adviser referral.
import { join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ensureFolders } from "../src/files/folders";
import { BusinessStore, adviserLine, renderProfile, smallBusinessLine, EMPTY_PROFILE } from "../src/business/profile";
import { CHECKLIST_URLS, TRAINING_AUTHORITIES, authoritiesFor, newStarterChecklist } from "../src/business/onboarding";
import { leavingChecklist, leavingText, isApprenticeRole } from "../src/business/leaving";
import { Register, employeeLine, normaliseEmployee, type Employee } from "../src/business/register";
import { registerTools, FIXED_TERM_NOTE } from "../src/business/registerTools";
import { computeReminders } from "../src/business/reminders";
import { isOfficialUrl } from "../src/research/officialSources";
import { AssistantApp } from "../src/app/app";
import { PendingConfirms } from "../src/app/confirms";
import { launchCommand, type LaunchCommand } from "../src/app/launch";
import { STAGING_PREFIX } from "../src/app/uploads";
import { ROOT } from "../src/assistant";
import { basePrompt, MARKDOWN_SWAPS } from "../src/basePrompt";
import { MAX_ATTACH_BYTES } from "../src/files/attach";
import { confirmText, type Confirm, type ConfirmContext, type ConfirmRequest } from "../src/engine/types";

type Check = [string, boolean];
const results: { name: string; checks: Check[]; detail?: string }[] = [];
const record = (name: string, checks: Check[], detail?: string) => results.push({ name, checks, detail });
const TMP = mkdtempSync(join(tmpdir(), "fx-unit-"));

// ------------------------------------------------------------ apprentices in the new starter checklist
{
  const act = newStarterChecklist({ employmentType: "full-time", mayNeedVisaCheck: false, smallBusiness: true, apprentice: true, states: ["ACT"] });
  const unknown = newStarterChecklist({ employmentType: "full-time", mayNeedVisaCheck: false, smallBusiness: true, apprentice: true, states: [] });
  const plain = newStarterChecklist({ employmentType: "full-time", mayNeedVisaCheck: false, smallBusiness: true });
  const t = (xs: { task: string }[]) => xs.map((x) => x.task).join(" | ");
  record("apprentice checklist", [
    ["ACT: Skills Canberra + training contract", /Skills Canberra/.test(t(act)) && /training contract/.test(t(act))],
    ["only the business's state", !/Skills NSW/.test(t(act))],
    ["unknown state: all 8 authorities", authoritiesFor([]).length === 8 && Object.keys(TRAINING_AUTHORITIES).every((s) => t(unknown).includes(`${s}:`))],
    ["not added for other employees", !/training contract/.test(t(plain))],
    ["all checklist URLs official", CHECKLIST_URLS.every(isOfficialUrl)],
  ], CHECKLIST_URLS.filter((u) => !isOfficialUrl(u)).join(" "));
}

// ------------------------------------------------------------ leaving checklist
{
  const resign = leavingChecklist({ reason: "resignation", apprentice: false, states: ["NSW"] }).map((x) => x.task).join(" | ");
  const dismiss = leavingChecklist({ reason: "dismissal", apprentice: false, states: ["NSW"] }).map((x) => x.task).join(" | ");
  const appr = leavingChecklist({ reason: "resignation", apprentice: true, states: ["ACT"] }).map((x) => x.task).join(" | ");
  const text = leavingText({ reason: "resignation", apprentice: false, states: [] });
  record("leaving checklist", [
    ["final pay timing (award, most within 7 days)", /within 7 days/.test(resign) && /at least monthly/.test(resign)],
    ["annual leave with loading; personal leave not paid out", /annual leave with annual leave loading/.test(resign) && /personal\/carer's leave is not paid out/.test(resign)],
    ["records 7 years + separation certificate", /7 years/.test(resign) && /Separation Certificate/.test(resign)],
    ["property and access", /return of property/.test(resign) && /access/.test(resign)],
    ["dismissal: get advice first", /Get advice before acting/.test(dismiss) && !/Get advice before acting/.test(resign)],
    ["apprentice: training authority", /Skills Canberra/.test(appr) && !/training authority/.test(resign)],
    ["all links official", [...text.matchAll(/https:\/\/\S+/g)].every((m) => isOfficialUrl(m[0]))],
    ["no pay calculation asked", /Do not calculate the final pay amount/.test(text)],
    ["apprentice role detection", isApprenticeRole("Apprentice hairdresser (1st year)") && isApprenticeRole("Business trainee") && !isApprenticeRole("Barista")],
  ]);
}

// ------------------------------------------------------------ register: wording, leaving and fixed-term notes
{
  const f = ensureFolders(join(TMP, "reg"));
  const store = new BusinessStore(f.data);
  store.update({ states: ["ACT"], headcount: 7 });
  const reg = new Register(f.data);
  const ella = reg.add(normaliseEmployee({ name: "Ella Test", role: "Apprentice hairdresser", employmentType: "full-time", startDate: "2026-06-01" }, true));
  reg.recordDocuments(ella.id, ["contract", "fwis"], "2026-06-01");
  const sam = reg.add(normaliseEmployee({ name: "Sam Test", role: "Project worker", employmentType: "fixed-term", startDate: "2026-06-01", endDate: "2026-10-01" }, true));
  const line = employeeLine(reg.get(ella.id)!);
  const tools = registerTools({ register: () => reg, business: () => store, confirm: async () => true });
  const update = tools.find((t) => t.name === "update_employee")!;
  const left = await update.handle({ id: ella.id, changes: { status: "left", leftDate: "2026-09-20" } });
  const extended = await update.handle({ id: sam.id, changes: { endDate: "2027-01-01" } });
  const roleOnly = await update.handle({ id: sam.id, changes: { role: "Senior project worker" } });
  record("register notes", [
    ["line: recorded with dates", /recorded: Written contract signed \(2026-06-01\); Fair Work Information Statement given \(2026-06-01\)/.test(line)],
    ["line: 'not recorded yet', not 'outstanding'", /not recorded yet: TFN declaration completed/.test(line) && !/outstanding/.test(line)],
    ["left: leaving checklist + apprentice authority", /Leaving checklist/.test(left.text) && /within 7 days/.test(left.text) && /Skills Canberra/.test(left.text)],
    ["fixed-term end date change: limits note", extended.text.includes(FIXED_TERM_NOTE) && /2 years/.test(extended.text)],
    ["other changes: no extra notes", !/Leaving checklist|2 years/.test(roleOnly.text)],
  ], left.text.slice(0, 300));
  reg.close();
}

// ------------------------------------------------------------ reminders wording
{
  const base = { endDate: null, award: null, classification: null, visaExpiry: null, status: "active" as const, leftDate: null, notes: null };
  const marco: Employee = { ...base, id: 1, name: "Marco", role: "Engineer", employmentType: "full-time", startDate: "2026-09-06", probationEnd: null, documents: [{ id: "contract", date: "2026-09-06" }, { id: "fwis", date: "2026-09-06" }, { id: "tfn", date: "2026-09-06" }] };
  const ella: Employee = { ...base, id: 2, name: "Ella", role: "Apprentice hairdresser", employmentType: "full-time", startDate: "2026-06-01", probationEnd: "2026-09-24", documents: ["contract", "fwis", "tfn", "super_choice", "induction"].map((id) => ({ id: id as never, date: "2026-06-01" })) };
  const leo: Employee = { ...ella, id: 3, name: "Leo", role: "Cook" };
  const rs = computeReminders({ employees: [marco, ella, leo], headcount: 30, today: "2026-09-26" });
  const paper = rs.find((r) => /Marco/.test(r.title))!;
  const pe = rs.find((r) => /Ella/.test(r.title))!;
  const pl = rs.find((r) => /Leo/.test(r.title))!;
  record("reminder wording", [
    ["paperwork: only unrecorded items", /Super choice form given/.test(paper.detail) && /Induction/.test(paper.detail) && !/Fair Work Information Statement|TFN/.test(paper.detail)],
    ["paperwork: super date, not overdue yet (due at start for induction)", /by 2026-10-04/.test(paper.detail)],
    ["apprentice probation: training authority", /training contract/.test(pe.detail) && /authority/.test(pe.detail)],
    ["normal probation: not a legal deadline", /not by law/.test(pl.detail)],
  ], JSON.stringify(rs.map((r) => r.detail)));
}

// ------------------------------------------------------------ small business status and adviser referral
{
  const p = (x: Partial<typeof EMPTY_PROFILE>) => ({ ...EMPTY_PROFILE, ...x });
  const f = ensureFolders(join(TMP, "prof"));
  const store = new BusinessStore(f.data);
  store.update({ legalName: "X", headcount: 14, adviser: { kind: "accountant", name: "Bob", contact: null } });
  record("small business and adviser", [
    ["14 → YES, close to 15", /: YES, based on 14/.test(smallBusinessLine(p({ headcount: 14 }))) && /close to 15/.test(smallBusinessLine(p({ headcount: 14 })))],
    ["22 → NO", /: NO, based on 22/.test(smallBusinessLine(p({ headcount: 22 })))],
    ["unknown", /unknown/.test(smallBusinessLine(p({ headcount: null })))],
    ["counting rule stated", /associated entities/.test(smallBusinessLine(p({ headcount: 5 }))) && /regular and systematic/.test(smallBusinessLine(p({ headcount: 5 })))],
    ["accountant: not for employment law", /payroll, tax and super questions only/.test(adviserLine(p({ adviser: { kind: "accountant", name: null, contact: null } })) ?? "")],
    ["lawyer: no extra line", adviserLine(p({ adviser: { kind: "employment-lawyer", name: null, contact: null } })) === null],
    ["rendered into the instructions", /Small business employer .*YES/.test(renderProfile(store)) && /payroll, tax and super questions only/.test(renderProfile(store))],
  ]);
}

// ------------------------------------------------------------ application layer (no engine start, no model)
{
  const asked: string[] = [];
  const f = ensureFolders(join(TMP, "app-files"));
  const app = new AssistantApp({
    userId: "unit-app",
    memoryRoot: join(TMP, "app-mem"),
    filesRoot: f.root,
    ui: { confirm: async (r) => (asked.push(confirmText(r)), false) },
  });
  const src = join(TMP, "drop src");
  mkdirSync(join(src, "applicants"), { recursive: true });
  writeFileSync(join(src, "Resume A.md"), "# A\nBarista");
  const withText = await app.takeDroppedPaths(`"${join(src, "Resume A.md")}" is she a good fit?`);
  const pendingAfterText = app.hasPendingAttachments();
  const onlyPath = await app.takeDroppedPaths(`"${join(src, "Resume A.md")}"`);
  const folder = await app.attach([join(src, "applicants")]);
  const refused = await app.attach([join(TMP, "app-mem")]);
  record("application layer", [
    ["dropped path removed from the text", withText.text === "is she a good fit?" && withText.outcomes[0]?.kind === "attached"],
    ["attachment waits for the next message", pendingAfterText],
    ["path-only line: empty text, reused file", onlyPath.text === "" && onlyPath.outcomes[0]?.kind === "attached" && (onlyPath.outcomes[0] as { reused: boolean }).reused],
    ["folder import asked and declined", folder[0]?.kind === "not-imported" && asked.some((q) => /Import the folder "applicants"/.test(q))],
    ["assistant folders refused", refused[0]?.kind === "refused"],
    ["no profile → needs setup", app.needsSetup() && !app.profile().exists],
    ["empty register, reminders, jobs, memories", !app.staff().length && !app.reminders().length && !app.jobs().length && !app.memories().preferences.length],
    ["workspace from the host", app.folders().root === f.root],
    ["tiers", app.setTier("standard") === "standard" && app.setTier("bogus") === null],
  ], JSON.stringify({ withText, onlyPath, folder, refused }).slice(0, 600));
}

// ------------------------------------------------------------ reply format (plain for the terminal, markdown for a UI)
{
  const file = readFileSync(join(ROOT, "prompts/base.md"), "utf8");
  const plain = basePrompt(ROOT).split("\n");
  const md = basePrompt(ROOT, "markdown");
  const changed = plain.map((l, i) => (l === md.split("\n")[i] ? null : md.split("\n")[i])).filter((l) => l !== null);
  record("reply format", [
    ["plain = prompts/base.md unchanged", basePrompt(ROOT) === file && basePrompt(ROOT, "plain") === file],
    ["markdown: only the formatting lines differ", plain.length === md.split("\n").length && changed.length === MARKDOWN_SWAPS.length && MARKDOWN_SWAPS.every(([, m]) => changed.some((l) => l!.includes(m)))],
    ["markdown rule: headings, numbered lists, bold, links", /GitHub-flavoured markdown/.test(md) && /headings/.test(md) && /numbered lists/.test(md) && /\*\*bold\*\*/.test(md) && /\[text\]\(url\)/.test(md)],
    ["markdown: no raw-text rule left", !/raw text|plain-text|no bold or italics/.test(md)],
  ], changed.join("\n"));
}

// ------------------------------------------------------------ cancellable confirmations
{
  const pc = new PendingConfirms();
  const ctxs: ConfirmContext[] = [];
  const answers: ((v: boolean) => void)[] = [];
  const ui: Confirm = (_req, ctx) => (ctxs.push(ctx!), new Promise<boolean>((r) => answers.push(r)));
  const req = { kind: "profile", title: "Save to the business profile?" } as const;
  const first = pc.ask(ui, req);
  const listed = pc.list();
  answers[0](true);
  const firstResult = await first;
  const afterAnswer = pc.list().length;
  const second = pc.ask(ui, { kind: "register", title: "Add to the register?" });
  const third = pc.ask(ui, { kind: "memory", title: "Remember this?" });
  const cancelled = pc.cancelAll();
  answers[1](true); // a late answer changes nothing
  const [r2, r3] = await Promise.all([second, third]);
  const oneArg = await pc.ask(async (r) => r.title === "old style", { kind: "setup", title: "old style" });

  // Through the app: a dropped folder asks to import; the UI never answers, the app withdraws it.
  const f = ensureFolders(join(TMP, "confirm-files"));
  const src = join(TMP, "confirm-drop", "Applicants");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "a.md"), "# A");
  const appCtxs: ConfirmContext[] = [];
  const app = new AssistantApp({ userId: "unit-confirm", memoryRoot: join(TMP, "confirm-mem"), filesRoot: f.root, ui: { confirm: (_r, ctx) => (appCtxs.push(ctx!), new Promise<boolean>(() => {})) } });
  const attaching = app.attach([src]);
  await new Promise((r) => setImmediate(r));
  const appListed = app.pendingConfirms();
  const appCancelled = app.cancelPendingConfirms();
  const outcome = await attaching;
  record("cancellable confirmations", [
    ["pending listed with id and request", listed.length === 1 && listed[0].id === ctxs[0].id && listed[0].req === req],
    ["answered: resolved and removed from the list", firstResult === true && afterAnswer === 0],
    ["unique ids", new Set(ctxs.map((c) => c.id)).size === 3],
    ["cancel: resolves false without an answer, signal aborted", cancelled === 2 && r2 === false && r3 === false && ctxs[1].signal.aborted && !pc.list().length],
    ["single-argument UI confirm still works", oneArg === true],
    ["app: pending folder import listed with the UI's id", appListed.length === 1 && appListed[0].req.kind === "folder-import" && appListed[0].id === appCtxs[0]?.id],
    ["app: cancelled → declined (not imported)", appCancelled === 1 && outcome[0]?.kind === "not-imported" && appCtxs[0].signal.aborted && !app.pendingConfirms().length],
  ], JSON.stringify({ appListed, outcome }).slice(0, 600));
}

// ------------------------------------------------------------ open and reveal workspace files
{
  const f = ensureFolders(join(TMP, "open-files"));
  const doc = join(f.outbox, "Report.docx");
  writeFileSync(doc, "x");
  writeFileSync(join(f.data, "secret.json"), "{}");
  writeFileSync(join(TMP, "outside.txt"), "x");
  const launched: LaunchCommand[] = [];
  const app = new AssistantApp({
    userId: "unit-open",
    memoryRoot: join(TMP, "open-mem"),
    filesRoot: f.root,
    ui: { confirm: async () => false },
    launcher: async (c) => void launched.push(c),
  });
  const opened = await app.openFile(doc);
  const revealed = await app.revealFile(doc);
  const refused = [
    await app.openFile(join(TMP, "outside.txt")),
    await app.openFile(join(f.outbox, "..", "..", "outside.txt")),
    await app.openFile(join(f.outbox, "missing.docx")),
    await app.openFile(join(f.data, "secret.json")),
    await app.revealFile(f.data),
  ];
  const same = (a: LaunchCommand | undefined, b: LaunchCommand) => JSON.stringify(a) === JSON.stringify(b);
  record("open and reveal files", [
    ["open: the default app, through the launcher", opened.ok && same(launched[0], launchCommand("open", realpathSync(doc)))],
    ["reveal: the file manager", revealed.ok && same(launched[1], launchCommand("reveal", realpathSync(doc)))],
    ["refused: outside the workspace, .., missing, the .assistant folder", refused.every((r) => !r.ok) && launched.length === 2],
    ["Windows: explorer, quoted verbatim", same(launchCommand("open", "C:\\a b\\R.docx", "win32"), { command: "explorer.exe", args: ['"C:\\a b\\R.docx"'], verbatim: true }) && same(launchCommand("reveal", "C:\\a b\\R.docx", "win32"), { command: "explorer.exe", args: ['/select,"C:\\a b\\R.docx"'], verbatim: true })],
    ["macOS open / open -R; Linux xdg-open (reveal: the folder)", same(launchCommand("reveal", "/u/R.docx", "darwin"), { command: "open", args: ["-R", "/u/R.docx"] }) && same(launchCommand("open", "/u/R.docx", "linux"), { command: "xdg-open", args: ["/u/R.docx"] }) && same(launchCommand("reveal", "/u/R.docx", "linux"), { command: "xdg-open", args: ["/u"] })],
  ], JSON.stringify({ launched, refused }).slice(0, 600));
}

// ------------------------------------------------------------ attachments uploaded as bytes (a browser UI)
{
  const asked: string[] = [];
  const f = ensureFolders(join(TMP, "upload-files"));
  const app = new AssistantApp({ userId: "unit-upload", memoryRoot: join(TMP, "upload-mem"), filesRoot: f.root, ui: { confirm: async (r) => (asked.push(confirmText(r)), false) } });
  const staging = () => readdirSync(tmpdir()).filter((n) => n.startsWith(STAGING_PREFIX));
  const before = new Set(staging());
  const text = (s: string) => Buffer.from(s);
  const one = await app.attachBytes([{ name: "Resume B.md", data: text("# B\nCook") }]);
  const again = await app.attachBytes([{ name: "Resume B.md", data: new Uint8Array(text("# B\nCook")) }]);
  const names = await app.attachBytes([
    { name: "..\\..\\evil.md", data: text("e") },
    { name: "CON.txt", data: text("c") },
    { name: 'a:b?"c".md.', data: text("a") },
  ]);
  const paths = await app.attachBytes([
    { name: "x.md", relPath: "../x.md", data: text("x") },
    { name: "x.md", relPath: "Applicants/../../x.md", data: text("x") },
    { name: "x.md", relPath: "C:/Temp/x.md", data: text("x") },
    { name: "x.md", relPath: "/etc/x.md", data: text("x") },
  ]);
  const big = await app.attachBytes([{ name: "big.pdf", data: new Uint8Array(MAX_ATTACH_BYTES + 1) }]);
  const folder = await app.attachBytes([
    { name: "a.md", relPath: "Applicants/a.md", data: text("# A") },
    { name: "b.md", relPath: "Applicants/sub/b.md", data: text("# B") },
  ]);
  const attached = (o: (typeof one)[number] | undefined) => (o?.kind === "attached" ? o : null);
  const left = staging().filter((n) => !before.has(n));
  record("attachments from bytes", [
    ["single file: attached to the Inbox, waits for the next message", attached(one[0])?.name === "Resume B.md" && one[0].path === "Resume B.md" && existsSync(join(f.inbox, "Resume B.md")) && app.hasPendingAttachments()],
    ["identical upload reused", attached(again[0])?.reused === true && !existsSync(join(f.inbox, "Resume B (2).md"))],
    ["names sanitised (basename, device names, characters)", attached(names[0])?.name === "evil.md" && attached(names[1])?.name === "_CON.txt" && attached(names[2])?.name === "a_b__c_.md" && !existsSync(join(TMP, "evil.md"))],
    ["folder paths with .. or absolute refused", paths.length === 4 && paths.every((o) => o.kind === "refused")],
    ["oversize refused", big[0]?.kind === "refused"],
    ["dropped folder: asks to import (declined)", folder.length === 1 && folder[0].kind === "not-imported" && folder[0].path === "Applicants" && asked.some((q) => /Import the folder "Applicants"/.test(q))],
    ["staging folders deleted", left.length === 0],
  ], JSON.stringify({ one, again, names, paths, big, folder, left }).slice(0, 600));
}

// ------------------------------------------------------------------ forms (register and profile, no model)
{
  let answer = false;
  const asked: ConfirmRequest[] = [];
  const f = ensureFolders(join(TMP, "forms-files"));
  const app = new AssistantApp({ userId: "unit-forms", memoryRoot: join(TMP, "forms-mem"), filesRoot: f.root, ui: { confirm: async (r) => (asked.push(r), answer) } });
  const profile = app.updateProfile({ legalName: "Test Cleaning Pty Ltd", states: ["NSW"], headcount: 9 });
  const same = app.updateProfile({ headcount: 9 });
  const badProfile = app.updateProfile({ notes: "Owner DOB 14/03/1971" });
  const marco = app.addEmployee({ name: "Marco Test", role: "Cleaner", employmentType: "casual", startDate: "2026-09-06" });
  const dup = app.addEmployee({ name: "marco test", role: "Cleaner", employmentType: "casual", startDate: "2026-09-06" });
  const pii = app.addEmployee({ name: "Ann Test", role: "Admin", employmentType: "part-time", startDate: "2026-09-06", notes: "DOB 14/03/1991" });
  const sam = app.addEmployee({ name: "Sam Test", role: "Project cleaner", employmentType: "fixed-term", startDate: "2026-05-01", endDate: "2026-10-23" });
  const samId = sam.ok ? sam.employee.id : -1;
  const extend = app.updateEmployee(samId, { endDate: "2027-01-22" });
  const role = app.updateEmployee(samId, { role: "Senior project cleaner" });
  const leftViaUpdate = app.updateEmployee(samId, { status: "left", leftDate: "2026-10-01" });
  const marcoId = marco.ok ? marco.employee.id : -1;
  const docs = app.recordDocuments(marcoId, ["ceis", "super_choice"], "2026-09-25");
  const badDate = app.recordDocuments(marcoId, ["induction"], "25/09/2026");
  const left = app.markLeft(marcoId, "2026-10-09", "resignation");
  const badReason = app.markLeft(samId, "2026-10-09", "quit" as never);
  const declined = await app.removeEmployee(samId);
  const keptAfterNo = app.staff(true).some((e) => e.id === samId);
  answer = true;
  const removed = await app.removeEmployee(samId);
  const t = (xs: { task: string }[]) => xs.map((x) => x.task).join(" | ");
  record("forms", [
    ["profile saved without a yes/no, lines for the receipt", profile.ok && profile.lines.length === 3 && !app.needsSetup() && !asked.some((q) => q.kind === "profile")],
    ["profile: nothing changed → no lines", same.ok && same.lines.length === 0],
    ["profile: date of birth refused", !badProfile.ok && /date of birth/.test(badProfile.error)],
    ["add: new starter checklist for a casual", marco.ok && /Casual Employment Information Statement/.test(t(marco.checklist)) && marco.checklist.every((i) => isOfficialUrl(i.source.url))],
    ["add: duplicate name refused", !dup.ok && /already in the register/.test(dup.error)],
    ["add: date of birth in notes refused", !pii.ok && /sensitive personal data/.test(pii.error)],
    ["update: fixed-term end date → limits note", extend.ok && extend.notes.length === 1 && /2 years/.test(extend.notes[0].text) && isOfficialUrl(extend.notes[0].source.url)],
    ["update: other changes → no note", role.ok && role.notes.length === 0],
    ["update: leaving must use markLeft", !leftViaUpdate.ok],
    ["documents recorded with the date; bad date refused", docs.ok && docs.employee.documents.some((d) => d.id === "ceis" && d.date === "2026-09-25") && !badDate.ok],
    ["markLeft: status left + resignation checklist", left.ok && left.employee.status === "left" && left.employee.leftDate === "2026-10-09" && /within 7 days/.test(t(left.checklist)) && !/Get advice before acting/.test(t(left.checklist))],
    ["markLeft: unknown reason refused", !badReason.ok],
    ["delete: destructive confirm, declined keeps the record", declined.ok && !declined.removed && keptAfterNo && asked.some((q) => q.destructive === true)],
    ["delete: confirmed removes it", removed.ok && removed.removed && !app.staff(true).some((e) => e.id === samId)],
    ["only delete asked a question", asked.length === 2],
  ], JSON.stringify({ profile, badProfile, dup, pii, extend, leftViaUpdate, badDate, badReason, declined }).slice(0, 700));
}

try {
  rmSync(TMP, { recursive: true, force: true });
} catch {
  /* SQLite files may still be open on Windows; the OS temp cleaner removes them */
}
let fail = 0;
for (const x of results) {
  const ok = x.checks.every(([, v]) => v);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${x.name}`);
  for (const [n, v] of x.checks) if (!v) console.log(`      x ${n}`);
  if (!ok && x.detail) console.log(`      detail: ${x.detail.slice(0, 600)}`);
}
process.exit(fail ? 1 : 0);
