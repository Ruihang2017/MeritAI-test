// Unit checks that never call the model (free: no ChatGPT quota). Covers the fixes from
// the first evaluation: apprentices, the leaving checklist, fixed-term notes, reminder
// wording, small business status and adviser referral.
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ensureFolders } from "../src/files/folders";
import { BusinessStore, adviserLine, renderProfile, smallBusinessLine, EMPTY_PROFILE } from "../src/business/profile";
import { CHECKLIST_URLS, TRAINING_AUTHORITIES, authoritiesFor, newStarterChecklist } from "../src/business/onboarding";
import { leavingChecklist, leavingText, isApprenticeRole } from "../src/business/leaving";
import { Register, employeeLine, normaliseEmployee, type Employee } from "../src/business/register";
import { registerTools, FIXED_TERM_NOTE } from "../src/business/registerTools";
import { computeReminders } from "../src/business/reminders";
import { isOfficialUrl } from "../src/research/officialSources";

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

rmSync(TMP, { recursive: true, force: true });
let fail = 0;
for (const x of results) {
  const ok = x.checks.every(([, v]) => v);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${x.name}`);
  for (const [n, v] of x.checks) if (!v) console.log(`      x ${n}`);
  if (!ok && x.detail) console.log(`      detail: ${x.detail.slice(0, 600)}`);
}
process.exit(fail ? 1 : 0);
