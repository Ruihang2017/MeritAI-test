// Compliance reminder checks (plan P3): date rules with fixed dates (unit), then one
// live question answered from get_reminders. Synthetic data only.
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createAssistant } from "../src/assistant";
import { addMonths, ceisDueDates, computeReminders, todayLocal, addDays } from "../src/business/reminders";
import { normaliseEmployee, type Employee } from "../src/business/register";
import { seedBusiness } from "./fixtures/business";

type Check = [string, boolean];
const results: { name: string; checks: Check[]; detail?: string }[] = [];
const record = (name: string, checks: Check[], detail?: string) => {
  results.push({ name, checks, detail });
  process.stdout.write(".");
};

let nextId = 1;
const emp = (x: Partial<Employee>): Employee => ({
  id: nextId++, name: "Person", role: "Cleaner", employmentType: "full-time", startDate: "2026-01-05",
  endDate: null, award: null, classification: null, probationEnd: null, visaExpiry: null,
  status: "active", leftDate: null, notes: null,
  documents: ["contract", "fwis", "tfn", "super_choice", "induction", "ceis", "ftcis", "vevo"].map((id) => ({ id: id as never, date: "2026-01-05" })),
  ...x,
});

// ------------------------------------------------------------ unit
{
  const today = "2026-08-25";
  const casual = emp({ name: "Casey", employmentType: "casual", startDate: "2026-03-10", documents: [{ id: "contract", date: "2026-03-10" }, { id: "fwis", date: "2026-03-10" }, { id: "ceis", date: "2026-03-10" }, { id: "tfn", date: "2026-03-10" }, { id: "super_choice", date: "2026-03-20" }, { id: "induction", date: "2026-03-10" }] });
  const large = computeReminders({ employees: [casual], headcount: 24, today });
  const small = computeReminders({ employees: [casual], headcount: 8, today });
  const unknown = computeReminders({ employees: [casual], headcount: null, today });
  const casualGiven = { ...casual, documents: casual.documents.map((d) => (d.id === "ceis" ? { ...d, date: "2026-09-10" } : d)) };
  const afterGiven = computeReminders({ employees: [casualGiven], headcount: 24, today });

  record("unit: dates", [
    ["addMonths end of month", addMonths("2026-01-31", 1) === "2026-02-28" && addMonths("2028-01-31", 1) === "2028-02-29"],
    ["CEIS 15+: 6, 12, then every 12 months", JSON.stringify(ceisDueDates("2024-03-10", false, "2026-12-31")) === '["2024-09-10","2025-03-10","2026-03-10"]'],
    ["CEIS small business: 12 months only", JSON.stringify(ceisDueDates("2024-03-10", true, "2026-12-31")) === '["2025-03-10"]'],
  ]);
  record("unit: casual rules", [
    ["15+: CEIS again at 6 months", large.some((r) => /Casual Employment Information Statement/.test(r.title) && r.due === "2026-09-10")],
    ["15+: may ask to become permanent at 6 months, 21 days to respond", large.some((r) => /become permanent from 2026-09-10/.test(r.title) && /21 days/.test(r.detail))],
    ["small business: nothing at 6 months", small.length === 0],
    ["unknown headcount: earlier (15+) rules", unknown.length === large.length],
    ["CEIS recorded again → cleared", !afterGiven.some((r) => /Casual Employment Information Statement/.test(r.title))],
  ], JSON.stringify({ large, small }));

  const today2 = "2026-09-25";
  const rs = computeReminders({
    headcount: 24,
    today: today2,
    payrollSystem: "Xero",
    employees: [
      emp({ name: "Pat", probationEnd: "2026-10-06" }),
      emp({ name: "Vi", visaExpiry: "2026-10-20" }),
      emp({ name: "Fay", employmentType: "fixed-term", endDate: "2026-10-15" }),
      emp({ name: "Newbie", employmentType: "casual", startDate: "2026-09-21", documents: [{ id: "fwis", date: "2026-09-21" }] }),
      emp({ name: "Later", probationEnd: "2027-03-01", visaExpiry: "2028-01-01" }),
      emp({ name: "Gone", probationEnd: "2026-10-06", status: "left" }),
      emp({ name: "SuperOnly", startDate: "2026-09-20", documents: ["contract", "fwis", "tfn", "induction"].map((id) => ({ id: id as never, date: "2026-09-20" })) }),
    ],
  });
  const t = rs.map((r) => r.title).join(" | ");
  record("unit: register reminders", [
    ["probation: 2 weeks before, overdue now", rs.some((r) => /Probation ends 2026-10-06: Pat/.test(r.title) && r.overdue)],
    ["visa: 30 days before", rs.some((r) => /Visa .* 2026-10-20: Vi/.test(r.title) && r.due === "2026-09-20")],
    ["fixed-term: 4 weeks before", rs.some((r) => /Fixed-term contract ends 2026-10-15: Fay/.test(r.title))],
    ["new casual: paperwork not recorded", rs.some((r) => /paperwork not recorded in the register for Newbie/.test(r.title) && /Casual Employment Information Statement/.test(r.detail) && /TFN/.test(r.detail))],
    ["super only: due 28 days after start", rs.some((r) => /SuperOnly/.test(r.title) && r.due === "2026-10-18" && !r.overdue)],
    ["far-off dates not shown", !/Later/.test(t)],
    ["people who left not shown", !/Gone/.test(t)],
    ["no wage review in September", !/1 July/.test(t)],
    ["sorted by due date", rs.every((r, i) => i === 0 || rs[i - 1].due <= r.due)],
  ], t);

  const june = computeReminders({ employees: [], headcount: 5, today: "2026-06-01", payrollSystem: "Xero" });
  record("unit: annual wage review", [
    ["shown in June", june.some((r) => /1 July 2026/.test(r.title) && /first full pay period on or after 1 July/.test(r.detail) && /Xero/.test(r.detail))],
    ["official source", june.every((r) => r.source?.url.startsWith("https://www.fairwork.gov.au/"))],
  ]);
}

// ------------------------------------------------------------ live
const TMP = mkdtempSync(join(tmpdir(), "fx-reminders-test-"));
const { engine, mem, register } = createAssistant({ userId: "reminders-test", memoryRoot: TMP, confirm: async () => true, serviceTier: "priority", clientVersion: "reminders-test" });
seedBusiness(mem);
const today = todayLocal();
register().add(normaliseEmployee({ name: "Pat Nguyen", role: "Cleaner", employmentType: "full-time", startDate: addDays(today, -160), probationEnd: addDays(today, 7) }, true));
register().add(normaliseEmployee({ name: "Vi Tran", role: "Cleaner", employmentType: "part-time", startDate: addDays(today, -300), visaExpiry: addDays(today, 20) }, true));
await engine.start();
await engine.newSession();
let reply = ""; const activity: string[] = [];
for await (const ev of engine.send("What do I need to take care of in the next few weeks?")) {
  if (ev.type === "text_delta") reply += ev.text;
  if (ev.type === "tool_activity") activity.push(ev.summary);
}
record("live: owner asks what to do", [
  ["used get_reminders", activity.some((a) => /^reminders:/.test(a))],
  ["probation for Pat", /Pat/.test(reply) && /probation/i.test(reply)],
  ["visa for Vi", /Vi/.test(reply) && /visa|VEVO|work rights/i.test(reply)],
  ["paperwork not recorded", /paperwork|contract|information statement|TFN/i.test(reply)],
], `${activity.join(" | ")} || ${reply.slice(0, 500)}`);
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
  if (!ok && x.detail) console.log(`      detail: ${x.detail.replace(/\n/g, " ").slice(0, 900)}`);
}
process.exit(fail ? 1 : 0);
