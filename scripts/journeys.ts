// User journeys with the real model (owner, 2026-09-27): does what the owner says in the chat reach
// the pages? Each journey runs on a fresh copy of the synthetic sample business (Wattle Lane
// Cleaning), through the same server session a browser uses, answering every question "yes".
// Checked: the data afterwards (staff, jobs, candidates, files, profile) and the UI signals (every
// change the adviser made arrived as a `changed` event in its reply; questions were cards in the
// reply, not dialogs). Uses the ChatGPT quota: about 2 to 4 turns per journey.
//
//   npx tsx scripts/journeys.ts [ids...] [--concurrency 3]
import "./testHome";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantApp } from "../src/app/app";
import { UiSession } from "../src/server/session";
import type { ServerEvent } from "../src/server/protocol";
import { DEMO_TODAY, seedDemo } from "./fixtures/demo";
import { readEml } from "../src/files/email";

process.env.FX_TODAY = DEMO_TODAY;

interface Turn {
  say: string;
  reply: string;
  tools: string[];
  changes: { by: string; turnId: string | null; summary: string; action: string; kind: string }[];
  questions: { title: string; turnId: string | null }[];
  error: string | null;
  seconds: number;
}
interface Ctx {
  app: AssistantApp;
  turns: Turn[];
  root: string;
  all: ServerEvent[];
}
interface Journey {
  id: string;
  title: string;
  /** Before the conversation (e.g. a job made on the page). */
  setup?: (c: Ctx) => Promise<void>;
  steps: string[];
  expect: (c: Ctx) => Promise<[string, boolean][]> | [string, boolean][];
}

const staff = (c: Ctx, name: string) => c.app.staff(true).find((e) => e.name.toLowerCase().includes(name.toLowerCase()));
const job = (c: Ctx, name: string) => c.app.jobs().find((j) => j.job.toLowerCase() === name.toLowerCase());
const text = (c: Ctx) => c.turns.map((t) => t.reply).join("\n\n");
const changed = (c: Ctx, pred: (x: Turn["changes"][number]) => boolean) => c.turns.some((t) => t.changes.some(pred));
const outbox = (c: Ctx) => readdirSync(join(c.root, "Outbox"));
const emls = (c: Ctx) => outbox(c).filter((f) => f.endsWith(".eml")).map((f) => ({ f, ...readEml(readFileSync(join(c.root, "Outbox", f), "utf8")) }));
const decision = async (c: Ctx, jobName: string, who: string) => {
  const r = await c.app.screenResults(jobName);
  const cand = r.ranked.find((x) => x.name.toLowerCase().includes(who.toLowerCase()));
  return cand ? (r.decisions.find((d) => d.file === cand.file)?.decision ?? null) : "missing";
};

const JOURNEYS: Journey[] = [
  {
    id: "hire-hannah",
    title: "A candidate accepts: the hire shows on Staff and on the job",
    steps: ["Hannah Cole accepted our Team leader offer. She starts Monday 5 October, full-time."],
    expect: (c) => [
      ["Hannah is on Staff", !!staff(c, "Hannah Cole")],
      ["the Team leader job counts the hire", job(c, "Team leader")?.hired === 1],
      ["the hire reached the reply (candidate hired, employee added)", changed(c, (x) => x.kind === "candidate" && x.action === "hired" && x.by === "adviser") && changed(c, (x) => x.kind === "employee" && x.action === "added")],
    ],
  },
  {
    id: "hire-two-close",
    title: "Both openings filled: hires counted, closing suggested or done",
    steps: ["Great news, Hannah Cole and Daniel Ortiz both accepted the Team leader job. Both start 12 October, full-time. That's everyone we need for that job."],
    expect: (c) => [
      ["both on Staff", !!staff(c, "Hannah Cole") && !!staff(c, "Daniel Ortiz")],
      ["the job counts 2 of 2", job(c, "Team leader")?.hired === 2],
      ["closing the job offered or done (never silently)", !!job(c, "Team leader")?.closedAt ? c.turns.some((t) => t.questions.some((q) => /Change Team leader|close/i.test(q.title))) : /close/i.test(text(c))],
    ],
  },
  {
    id: "decide",
    title: "Decisions said in the chat show in the ranking",
    steps: ["For the team leader job, put Ruth Adeyemi on the shortlist, and Kenji Watanabe is a no."],
    expect: async (c) => [
      ["Ruth shortlisted", (await decision(c, "Team leader", "Ruth")) === "shortlist"],
      ["Kenji not this time", (await decision(c, "Team leader", "Kenji")) === "not"],
      ["the decisions reached the reply", changed(c, (x) => x.kind === "candidate" && x.action === "shortlisted") && changed(c, (x) => x.kind === "candidate" && x.action === "not")],
    ],
  },
  {
    id: "close-job",
    title: "Close a job from the chat",
    steps: ["We've stopped hiring for the Office admin role for now. Please close that job."],
    expect: (c) => [
      ["Office admin closed", !!job(c, "Office admin")?.closedAt],
      ["the change reached the reply", changed(c, (x) => x.kind === "job" && x.action === "closed")],
    ],
  },
  {
    id: "openings",
    title: "Change how many people a job is for",
    steps: ["We now need 4 weekend cleaners, not 3. Can you update that?"],
    expect: (c) => [["Weekend cleaner is for 4", job(c, "Weekend cleaner")?.openings === 4]],
  },
  {
    id: "create-job",
    title: "A new job with a job description, created from the chat",
    steps: ["I need to hire a part-time bookkeeper, two days a week. Please write a short job description and set up the job for 1 person.", "That looks good. Create the job with it."],
    expect: (c) => {
      const j = c.app.jobs().find((x) => /bookkeep/i.test(x.job));
      return [
        ["the job exists", !!j],
        ["with its job description file", !!j?.jd],
        ["the new job reached the reply", changed(c, (x) => x.kind === "job" && x.action === "created")],
      ];
    },
  },
  {
    id: "office-admin-jd",
    title: "Write the missing job description and save it into the job",
    steps: ["The Office admin job has no job description. Write one with me: part-time, 3 days a week, answering phones, invoicing in Xero, rostering.", "Yes, that's good. Save it into the Office admin job."],
    expect: (c) => [["Office admin now has a JD", !!job(c, "Office admin")?.jd]],
  },
  {
    id: "marco-docs",
    title: "Paperwork done, said in the chat, recorded in Staff",
    steps: ["I gave Marco his Casual Employment Information Statement today, and he completed his TFN declaration today too."],
    expect: (c) => {
      const m = staff(c, "Marco");
      const ids = new Set(m?.documents.map((d) => d.id));
      return [
        ["CEIS and TFN recorded", ids.has("ceis") && ids.has("tfn")],
        ["the change reached the reply", changed(c, (x) => x.kind === "employee" && x.action === "documents")],
      ];
    },
  },
  {
    id: "priya-left",
    title: "A resignation: marked as left with the last day",
    steps: ["Priya resigned. Her last day is Friday 9 October. Please update the register."],
    expect: (c) => {
      const p = staff(c, "Priya");
      return [
        ["Priya left, last day 9 Oct", p?.status === "left" && p?.leftDate === "2026-10-09"],
        ["final pay mentioned", /final pay/i.test(text(c))],
        ["the change reached the reply", changed(c, (x) => x.kind === "employee" && x.action === "left")],
      ];
    },
  },
  {
    id: "sam-extend",
    title: "Extend a fixed-term contract (limits explained)",
    steps: ["Please extend Sam Park's contract by 3 months."],
    expect: (c) => [
      ["Sam's end date moved to 23 Jan 2027", staff(c, "Sam Park")?.endDate === "2027-01-23"],
      ["the 2-year and one-extension limits said", /2 years|two years/i.test(text(c)) && /once|one extension|more than once/i.test(text(c))],
    ],
  },
  {
    id: "offer-email",
    title: "An offer email to send from the owner's email app",
    steps: ["Hannah Cole accepted the Team leader offer, starting 5 October full-time. Draft her a welcome email I can send from Outlook: hannah.cole@example.com"],
    expect: (c) => {
      const e = emls(c);
      return [
        ["an email draft (.eml) in the Outbox", e.length >= 1],
        ["addressed to Hannah", e.some((x) => x.to.includes("hannah.cole@example.com"))],
      ];
    },
  },
  {
    id: "reject-emails",
    title: "Not-this-time emails as drafts to send",
    steps: ["Mark the rest of the team leader candidates Not this time, except Hannah and Daniel. Then draft a short, kind rejection email for Tariq Aziz that I can send from my email (tariq.aziz@example.com)."],
    expect: async (c) => [
      ["Tariq not this time", (await decision(c, "Team leader", "Tariq")) === "not"],
      ["Ruth or Kenji marked not this time too", ["Ruth", "Kenji", "Lucy"].some(() => true) && ((await decision(c, "Team leader", "Lucy")) === "not" || (await decision(c, "Team leader", "Ruth")) === "not")],
      ["an email draft to Tariq", emls(c).some((x) => x.to.includes("tariq.aziz@example.com"))],
    ],
  },
  {
    id: "hire-no-job",
    title: "A hire that isn't from a job: added to Staff only",
    steps: ["I've just hired Tom Nguyen as a casual cleaner, starting Monday 5 October. He wasn't from any job ad."],
    expect: (c) => [
      ["Tom on Staff", !!staff(c, "Tom Nguyen")],
      ["no job counted a hire", !changed(c, (x) => x.kind === "candidate" && x.action === "hired")],
    ],
  },
  {
    id: "unknown-candidate",
    title: "A name that isn't a candidate: asks, changes nothing",
    steps: ["Zara accepted the team leader offer, can you sort it out?"],
    expect: (c) => [
      ["nothing saved", !c.turns.some((t) => t.changes.length)],
      ["says there's no Zara and asks for details", /zara/i.test(text(c)) && /(isn['’]t|not)( currently)? (listed|a candidate|in)|can(['’]t|not) find|no candidate|\?/i.test(text(c))],
    ],
  },
  {
    id: "profile",
    title: "Business facts said in the chat reach the profile",
    steps: ["Quick update: we're now 12 employees, and we pay weekly now through Xero."],
    expect: (c) => {
      const p = c.app.profile().profile;
      return [
        ["headcount 12, weekly pay", p.headcount === 12 && p.payFrequency === "weekly"],
        ["the change reached the reply", changed(c, (x) => x.kind === "profile")],
      ];
    },
  },
  {
    id: "leo-probation",
    title: "Probation passed: the register reflects it",
    steps: ["Leo Tran passed his probation review today, he's staying on. Please record that in the register."],
    expect: (c) => [["Leo updated", changed(c, (x) => x.kind === "employee" && /Leo/.test(x.summary))]],
  },
  {
    id: "mia-visa",
    title: "A new visa expiry",
    steps: ["Mia Rossi's visa has been extended to 30 June 2028."],
    expect: (c) => [["Mia's visa expiry is 30 Jun 2028", staff(c, "Mia")?.visaExpiry === "2028-06-30"]],
  },
  {
    id: "screen-weekend",
    title: "Confirm criteria and screen, from the chat",
    steps: ["For the Weekend cleaner job: the draft criteria are fine, confirm them as they are and screen the applications."],
    expect: (c) => {
      const j = job(c, "Weekend cleaner");
      return [
        ["criteria confirmed", !!j && /confirmed/.test(j.criteria)],
        ["applications screened", (j?.screened ?? 0) > 0],
        ["the screening reached the reply", changed(c, (x) => x.kind === "job" && (x.action === "screened" || x.action === "criteria-confirmed"))],
      ];
    },
  },
  {
    id: "question",
    title: "A question only: nothing changes",
    steps: ["What can't I ask in a job interview?"],
    expect: (c) => [["no changes", !c.turns.some((t) => t.changes.length)]],
  },
  {
    id: "two-topics",
    title: "Jumping between topics: each change lands in its own reply",
    steps: ["Hannah Cole accepted the team leader offer, she starts 5 October full-time.", "Different thing: Priya resigned, her last day is 9 October."],
    expect: (c) => [
      ["Hannah added in reply 1", c.turns[0]?.changes.some((x) => x.kind === "employee" && x.action === "added") ?? false],
      ["Priya left in reply 2", c.turns[1]?.changes.some((x) => x.kind === "employee" && x.action === "left") ?? false],
      ["the hire counted", job(c, "Team leader")?.hired === 1],
    ],
  },
  {
    id: "hire-then-docs",
    title: "Hire, then the first paperwork",
    steps: ["Daniel Ortiz accepted the team leader role, starting 12 October full-time.", "I've given Daniel the Fair Work Information Statement today."],
    expect: (c) => {
      const d = staff(c, "Daniel Ortiz");
      return [
        ["Daniel on Staff and hired from the job", !!d && (job(c, "Team leader")?.hired ?? 0) >= 1],
        ["FWIS recorded", !!d?.documents.some((x) => x.id === "fwis")],
      ];
    },
  },
  {
    id: "reopen",
    title: "Reopen a closed job",
    steps: ["We need one more casual cleaner after all. Reopen the Casual cleaner job for one more person."],
    expect: (c) => {
      const j = job(c, "Casual cleaner");
      return [["Casual cleaner open again", !!j && !j.closedAt], ["for 2 people (1 hired + 1 more)", j?.openings === 2]];
    },
  },
  {
    id: "tailor-jd",
    title: "A job from a template, then tailored by the adviser (replacing the JD after an OK)",
    setup: async (c) => {
      await c.app.createJobFromText("Barista", 1, "# Barista\n\n**[Business name]** · Casual · [Location]\n\n## About us\n\n[One or two sentences about the business.]\n\n## What you'll do\n\n- Make espresso coffee\n\n## How to apply\n\n[How to apply]");
    },
    steps: ["Tailor the job description of \"Barista\" to my business: fill in the bracketed parts you can from my business profile and use weekday mornings 6 to 11 for the hours. Then save the new version into the job."],
    expect: (c) => [
      ["the JD was replaced after an OK", c.turns.some((t) => t.questions.some((q) => /Replace the job description of Barista/.test(q.title)))],
      ["the job still has its JD", !!job(c, "Barista")?.jd],
    ],
  },
  {
    id: "contract-email",
    title: "A contract saved, then emailed as an attachment",
    steps: ["Hannah Cole accepted the Team leader role, full-time, starting 5 October. Draft her employment contract and save it as a Word document, then draft an email to hannah.cole@example.com with the contract attached, for me to send from Outlook."],
    expect: (c) => {
      const e = emls(c);
      return [
        ["a Word contract in the Outbox", outbox(c).some((f) => /contract/i.test(f) && f.endsWith(".docx"))],
        ["an email draft with the contract attached", e.some((x) => x.to.includes("hannah.cole@example.com") && x.attachments.some((a) => /contract/i.test(a)))],
      ];
    },
  },
  {
    id: "undo-hire",
    title: "A hire that falls through: removed from Staff, the job no longer counts it",
    steps: ["Hannah Cole accepted the team leader role, starting 5 October full-time.", "Bad news, Hannah just pulled out before starting. Please remove her from the staff register completely."],
    expect: (c) => [
      ["Hannah is gone from Staff", !staff(c, "Hannah Cole")],
      ["the job counts 0 hired again", job(c, "Team leader")?.hired === 0],
      ["the delete was asked as a destructive question", c.turns[1]?.questions.some((q) => /Delete Hannah Cole/.test(q.title)) ?? false],
    ],
  },
  {
    id: "invite-email",
    title: "Shortlist and invite to interview, as an email draft",
    steps: ["Please shortlist Ruth Adeyemi for team leader and draft an interview invitation email to her for Tuesday 6 October at 10 am at our office, ruth.adeyemi@example.com. I'll send it from Outlook."],
    expect: async (c) => [
      ["Ruth shortlisted", (await decision(c, "Team leader", "Ruth")) === "shortlist"],
      ["an invite draft to Ruth", emls(c).some((x) => x.to.includes("ruth.adeyemi@example.com"))],
    ],
  },
  {
    id: "close-after-yes",
    title: "Filled, suggested, closed when the owner says yes",
    steps: ["Hannah Cole and Daniel Ortiz both accepted the team leader offers, both full-time from 12 October.", "Yes, close the team leader job."],
    expect: (c) => [
      ["2 of 2 hired", job(c, "Team leader")?.hired === 2],
      ["closed", !!job(c, "Team leader")?.closedAt],
    ],
  },
  {
    id: "adviser-profile",
    title: "The business's adviser saved to the profile",
    steps: ["For employment law questions we use an employment lawyer, Jane Smith at Smith Workplace Law (synthetic). Please save that to our profile."],
    expect: (c) => {
      const p = c.app.profile().profile;
      return [["adviser saved as a lawyer", !!p.adviser && /lawyer/i.test(JSON.stringify(p.adviser)) && /Jane Smith/.test(JSON.stringify(p.adviser))]];
    },
  },
  {
    id: "no-show",
    title: "A process question with a draft letter, no register change",
    steps: ["Tom Becker hasn't turned up for a week and isn't answering his phone. What should I do? Draft a letter I can send him, and save it."],
    expect: (c) => [
      ["a letter saved", outbox(c).some((f) => f.endsWith(".docx") && !/screening|all candidates|probation|welcome|acknowledgement/i.test(f))],
      ["the register not changed (he hasn't left)", staff(c, "Tom Becker")?.status === "active"],
      ["not treated as a resignation", !/abandon(ed)? .*(resign|terminat)ed automatically/i.test(text(c))],
    ],
  },
  {
    id: "today-dates",
    title: "Relative dates use the app's day (the sample business runs on 26 Sep 2026)",
    steps: ["I gave Marco his super choice form today."],
    expect: (c) => {
      const m = staff(c, "Marco");
      return [["recorded on 26 Sep 2026", m?.documents.some((d) => d.id === "super_choice" && d.date === "2026-09-26") ?? false]];
    },
  },
];

async function runJourney(j: Journey): Promise<{ id: string; title: string; checks: [string, boolean][]; sync: [string, boolean][]; turns: Turn[]; seconds: number; error: string | null }> {
  const base = mkdtempSync(join(tmpdir(), `journey-${j.id}-`));
  const root = join(base, "files");
  const memoryRoot = join(base, "memory");
  await seedDemo({ filesRoot: root, memoryRoot, userId: "journey", memory: false });
  const session = new UiSession({ engine: "codex" });
  const app = new AssistantApp({ userId: "journey", memoryRoot, filesRoot: root, format: "markdown", ui: { confirm: session.confirm, progress: session.progress } });
  session.attach(app);
  const all: ServerEvent[] = [];
  session.subscribe((e) => {
    all.push(e);
    // The owner says yes to every question.
    if (e.event === "confirm") setTimeout(() => void session.handle({ id: 0, method: "answerConfirm", params: { id: e.id, yes: true } }), 200);
  });
  const t0 = Date.now();
  const turns: Turn[] = [];
  let error: string | null = null;
  try {
    const acct = await app.start();
    if (!acct.loggedIn) throw new Error("codex_home_test is not signed in (npm run login:test)");
    await app.openSession();
    await j.setup?.({ app, turns, root, all });
    for (const [i, say] of j.steps.entries()) {
      const turnId = `${j.id}-${i}`;
      const s0 = Date.now();
      const from = all.length;
      await session.handle({ id: i + 1, method: "send", params: { text: say, turnId } });
      const done = await new Promise<Extract<ServerEvent, { event: "turnDone" }>>((ok, fail) => {
        const t = setInterval(() => {
          const d = all.slice(from).find((e): e is Extract<ServerEvent, { event: "turnDone" }> => e.event === "turnDone" && e.turnId === turnId);
          if (d) (clearInterval(t), ok(d));
          else if (Date.now() - s0 > 6 * 60_000) (clearInterval(t), fail(new Error(`turn ${i + 1} took over 6 minutes`)));
        }, 200);
      });
      const evs = all.slice(from);
      const mine = evs.filter((e): e is Extract<ServerEvent, { event: "turn" }> => e.event === "turn" && e.turnId === turnId);
      turns.push({
        say,
        reply: mine.flatMap((e) => (e.ev.type === "text_done" ? [e.ev.text] : [])).join("\n\n"),
        tools: mine.flatMap((e) => (e.ev.type === "tool_activity" ? [e.ev.summary] : [])),
        changes: evs.flatMap((e) => (e.event === "changed" ? [{ by: e.by, turnId: e.turnId, summary: e.change.summary, action: e.change.action, kind: e.change.ref.kind }] : [])),
        questions: evs.flatMap((e) => (e.event === "confirm" ? [{ title: e.req.title, turnId: e.turnId }] : [])),
        error: done.error ?? null,
        seconds: Math.round((Date.now() - s0) / 1000),
      });
    }
  } catch (e) {
    error = (e as Error).message;
  }
  const c: Ctx = { app, turns, root, all };
  let checks: [string, boolean][] = [];
  try {
    checks = error ? [] : await j.expect(c);
  } catch (e) {
    checks = [[`expect threw: ${(e as Error).message}`, false]];
  }
  const ids = new Set(j.steps.map((_, i) => `${j.id}-${i}`));
  const sync: [string, boolean][] = [
    ["every change was the adviser's, in one of the replies", turns.every((t) => t.changes.every((x) => x.by === "adviser" && x.turnId !== null && ids.has(x.turnId)))],
    ["every question was a card in its reply (no dialogs)", turns.every((t) => t.questions.every((q) => q.turnId !== null && ids.has(q.turnId)))],
    ["no failed replies", !error && turns.every((t) => !t.error)],
  ];
  await app.close().catch(() => null);
  return { id: j.id, title: j.title, checks, sync, turns, seconds: Math.round((Date.now() - t0) / 1000), error };
}

const args = process.argv.slice(2);
const ci = args.indexOf("--concurrency");
const concurrency = ci >= 0 ? Number(args[ci + 1]) : 3;
const only = args.filter((a, i) => !a.startsWith("--") && (ci < 0 || i !== ci + 1));
const list = only.length ? JOURNEYS.filter((j) => only.includes(j.id)) : JOURNEYS;
const results: Awaited<ReturnType<typeof runJourney>>[] = [];
const queue = [...list];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const r = await runJourney(j);
      results.push(r);
      const ok = r.checks.length > 0 && r.checks.every(([, v]) => v);
      const syncOk = r.sync.every(([, v]) => v);
      console.log(`${ok && syncOk ? "PASS" : "FAIL"}  ${r.id} (${r.seconds}s)${r.error ? `  error: ${r.error}` : ""}`);
      for (const [n, v] of [...r.checks, ...r.sync]) if (!v) console.log(`      x ${n}`);
    }
  }),
);
results.sort((a, b) => list.findIndex((j) => j.id === a.id) - list.findIndex((j) => j.id === b.id));
const dir = join(process.cwd(), "eval", "results");
mkdirSync(dir, { recursive: true });
const file = join(dir, `journeys-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.json`);
writeFileSync(file, JSON.stringify(results, null, 2));
const pass = results.filter((r) => r.checks.length && r.checks.every(([, v]) => v) && r.sync.every(([, v]) => v)).length;
console.log(`\n${pass}/${results.length} journeys passed. Details: ${file}`);
process.exit(0);
