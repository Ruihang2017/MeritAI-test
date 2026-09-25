// Setup and profile, employee register, and compliance reminders (30 scenarios).
import type { Scenario } from "../types";

const SETUP = "Start the business setup interview. Ask in English unless I answer in another language.";
const byName = (ctx: Parameters<NonNullable<Scenario["expect"]["state"]>>[0], re: RegExp) =>
  ctx.register.list({ includeLeft: true }).find((e) => re.test(e.name));

export const BUSINESS_OPS: Scenario[] = [
  // ------------------------------------------------------------------ setup / profile
  {
    id: "setup-01",
    persona: "newowner",
    category: "setup",
    title: "Setup interview from scratch (food truck, TAS)",
    skill: "business-setup",
    turns: [
      SETUP,
      "It's Salt & Smoke Food Co Pty Ltd, trading as Salt & Smoke. We're a food truck doing BBQ at markets and events around Hobart, Tasmania. No fixed address yet, just my home office.",
      "Right now it's just me, but I'm hiring 3 casuals for weekends. Not sure which award. I'll pay weekly, probably using Xero.",
      "Staff get a free meal each shift. I'll sign letters: Rhys Morgan, Owner. No adviser, no EAP.",
    ],
    expect: {
      skillsAny: ["business-setup"],
      tools: ["profile saved"],
      state: (c) => {
        const p = c.business.get();
        if (!/Salt/.test(`${p.legalName} ${p.tradingName}`)) return "name not saved";
        if (!p.states.includes("TAS")) return "TAS not saved";
        if (!p.employmentTypes.includes("casual")) return "casual not saved";
        if (!/Rhys/.test(p.signer ?? "")) return "signer not saved";
        if (p.awards.some((a) => /award/i.test(a) && !/unsure|not sure/i.test(a))) return `award guessed: ${p.awards.join("; ")}`;
        return null;
      },
    },
    rubric: "Runs a short, friendly interview in rounds, saves each round through the profile tool, does not guess the award or address, and ends with a short summary and what it can now help with.",
  },
  {
    id: "setup-02",
    persona: "newowner",
    category: "setup",
    title: "No profile: casual contract request uses placeholders and suggests /setup",
    turns: ["I need a contract for my first casual employee who starts next week. Can you draft one?"],
    expect: {
      mustMatch: [/\/setup/],
      mustNotMatch: [/Salt & Smoke|Bluegum/],
    },
    rubric: "Either drafts with placeholders for all business details, or asks once in one short list for the essential missing terms (it knows nothing about the business); invents nothing; mentions the starting obligations (FWIS, CEIS); suggests running /setup.",
  },
  {
    id: "setup-03",
    persona: "cafe",
    category: "setup",
    title: "Address change goes to the profile (confirmed)",
    turns: ["We've moved the café to 30 Enmore Rd, Enmore NSW 2042. Please update our details."],
    expect: { confirmAsked: true, state: (c) => (/Enmore Rd/.test(c.business.get().address ?? "") ? null : "address not updated") },
    rubric: "Updates the business address through the profile tool (the app asks the owner to confirm) and confirms briefly.",
  },
  {
    id: "setup-04",
    persona: "cafe",
    category: "setup",
    title: "Declined profile change is not saved",
    turns: ["We're going to pay everyone weekly from now on. Update the profile."],
    confirm: [false],
    expect: { confirmAsked: true, state: (c) => (c.business.get().payFrequency === "fortnightly" ? null : "saved despite the owner declining") },
    rubric: "Tries to update the pay frequency; when the owner declines, says nothing was saved and asks what to correct. May mention that changing pay frequency may need notice or agreement.",
  },
  {
    id: "setup-05",
    persona: "retail",
    category: "setup",
    title: "Third store interstate (NSW) added to profile",
    turns: ["Big news, we're opening a third store in Byron Bay next month, so we'll have staff in New South Wales too."],
    expect: { state: (c) => (c.business.get().states.includes("NSW") && c.business.get().states.includes("QLD") ? null : `states: ${c.business.get().states}`) },
    rubric: "Adds NSW to the states (keeping QLD) after confirmation, and briefly flags what changes for NSW staff (e.g. NSW public holidays, long service leave law, payroll tax is out of scope) without overloading the owner.",
  },
  {
    id: "setup-06",
    persona: "plumber",
    category: "setup",
    title: "New adviser recorded",
    turns: ["We've started using an employment lawyer, Jane Ho from Ho Workplace Legal. Please note her as our adviser."],
    expect: { state: (c) => (/Jane Ho/.test(c.business.get().adviser?.name ?? "") && c.business.get().adviser?.kind === "employment-lawyer" ? null : JSON.stringify(c.business.get().adviser)) },
    rubric: "Saves the adviser as an employment lawyer named Jane Ho through the profile tool, after confirmation.",
  },
  {
    id: "setup-07",
    persona: "newowner",
    category: "setup",
    title: "Setup interview in Chinese",
    skill: "business-setup",
    turns: [
      SETUP,
      "我们公司叫 Harbour Dumpling House Pty Ltd，是霍巴特的一家饺子店，地址 5 Elizabeth St, Hobart TAS 7000。",
      "现在有 4 个员工：1 个全职厨师，3 个临时工。每两周发工资。Award 我不知道。",
      "信由我签：Wendy Liu, Owner。没有顾问，也没有 EAP。",
    ],
    expect: {
      skillsAny: ["business-setup"],
      mustMatch: [/[一-鿿]/],
      state: (c) => {
        const p = c.business.get();
        if (!/Dumpling/.test(`${p.legalName} ${p.tradingName}`)) return "name not saved";
        if (!p.states.includes("TAS")) return "TAS not saved";
        if (p.payFrequency !== "fortnightly") return "pay frequency not saved";
        return null;
      },
    },
    rubric: "Switches to Chinese once the owner answers in Chinese, saves the answers through the profile tool, does not guess the award, and summarises in Chinese.",
  },
  {
    id: "setup-08",
    persona: "salon",
    category: "setup",
    title: "What do you know about my business?",
    turns: ["Remind me, what do you have on file about my business?"],
    expect: { mustMatch: [/Luxe Hair/, /Hair and Beauty/, /Priya Sharma/] },
    rubric: "Summarises the recorded profile accurately and briefly, notes anything not recorded, invents nothing, and says how to change it (/setup or tell it).",
  },
  {
    id: "setup-09",
    persona: "startup",
    category: "setup",
    title: "Overseas staff: not an Australian state",
    turns: ["We just hired two developers in Auckland, New Zealand. Add New Zealand to our profile's states."],
    expect: { state: (c) => (c.business.get().states.every((s) => ["VIC", "NSW"].includes(s)) ? null : `states: ${c.business.get().states}`) },
    rubric: "Explains the profile's states are Australian only and that New Zealand employees are under New Zealand law (outside what it covers), suggests getting local advice, and may offer to note it in the profile notes instead.",
  },
  {
    id: "setup-10",
    persona: "accounting",
    category: "setup",
    title: "Headcount change in Chinese",
    turns: ["我们现在有 7 个员工了，帮我更新一下。"],
    expect: { mustMatch: [/[一-鿿]/], state: (c) => (c.business.get().headcount === 7 ? null : `headcount ${c.business.get().headcount}`) },
    rubric: "Updates the headcount to 7 after confirmation and replies in Chinese; may note the business is still a small business employer (fewer than 15).",
  },

  // ------------------------------------------------------------------ employee register
  {
    id: "reg-01",
    persona: "cafe",
    category: "register",
    title: "Add a new casual",
    turns: ["I've just hired Jordan Lee as a casual barista, starting next Monday. He's an Australian citizen. Add him to the staff register."],
    expect: {
      tools: ["register: added"],
      state: (c) => {
        const e = byName(c, /Jordan/);
        if (!e) return "not added";
        if (e.employmentType !== "casual") return `type ${e.employmentType}`;
        if (e.visaExpiry) return "visa expiry invented";
        return null;
      },
    },
    rubric: "Adds Jordan as a casual barista with the right start date (the app confirms), then mentions the starting paperwork he needs (FWIS, CEIS, TFN, super choice).",
  },
  {
    id: "reg-02",
    persona: "cafe",
    category: "register",
    title: "Record documents for an existing employee",
    turns: ["Ana did her TFN declaration and her super choice form today, and we ran her induction. Please record that."],
    expect: {
      tools: ["register:"],
      state: (c) => {
        const d = new Set(byName(c, /Ana/)?.documents.map((x) => x.id));
        return d.has("tfn") && d.has("super_choice") && d.has("induction") ? null : `docs: ${[...d]}`;
      },
    },
    rubric: "Records the three items for Ana with today's date after confirmation, and points out what is still outstanding for her (contract, CEIS as a casual, VEVO check for her visa).",
  },
  {
    id: "reg-03",
    persona: "cafe",
    category: "register",
    title: "Who is missing paperwork?",
    turns: ["Which of my staff are still missing starting paperwork?"],
    expect: { tools: ["register:"], mustMatch: [/Ana/] },
    rubric: "Lists Ana's missing items from the register (contract, CEIS, TFN, super choice, induction, VEVO) and says the others are complete; offers help to fix it.",
  },
  {
    id: "reg-04",
    persona: "plumber",
    category: "register",
    title: "Probation passed: clear the date",
    turns: ["Kerry passed her probation today. Please clear her probation date in the register."],
    expect: { state: (c) => (byName(c, /Kerry/)?.probationEnd ? "probation end still set" : null) },
    rubric: "Clears Kerry's probation end date after confirmation and offers a short letter confirming she passed probation.",
  },
  {
    id: "reg-05",
    persona: "retail",
    category: "register",
    title: "Refuse to store bank details",
    turns: ["Save Hana's bank details in the register so I have them handy: BSB 064-000, account 12345678."],
    expect: {
      mustMatch: [/payroll|KeyPay|bank|sensitive|secure/i],
      state: (c) => (JSON.stringify(byName(c, /Hana/)).match(/064|12345678/) ? "bank details stored" : null),
    },
    rubric: "Declines to store bank details in the register, explains briefly why (sensitive; belongs in the payroll system, here KeyPay), and does not repeat the numbers more than needed.",
  },
  {
    id: "reg-06",
    persona: "landscaping",
    category: "register",
    title: "Extend a fixed-term contract",
    turns: ["We're extending Sam Ortiz's project contract by 3 months. Update his end date."],
    expect: { state: (c) => { const e = byName(c, /Sam Ortiz/); return e?.endDate && e.endDate > new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10) ? null : `end ${e?.endDate}`; } },
    rubric: "Updates the end date by about 3 months after confirmation, and flags the fixed-term rules on extensions/renewals (limits on length and renewals) and that the extension should be in writing, citing official sources.",
  },
  {
    id: "reg-07",
    persona: "salon",
    category: "register",
    title: "Apprentice left",
    turns: ["Ella Brown, our apprentice, quit and her last day was last Friday. Update the register."],
    expect: { state: (c) => (byName(c, /Ella/)?.status === "left" ? null : "not marked as left") },
    rubric: "Marks Ella as left with the right last day after confirmation (not deleted), and reminds the owner about final pay, the apprenticeship authority/training contract notification, and returning property.",
  },
  {
    id: "reg-08",
    persona: "startup",
    category: "register",
    title: "Delete a record added by mistake",
    turns: ["Please delete Jess Taylor from the register completely. I added her by mistake."],
    expect: { confirmAsked: true, state: (c) => (byName(c, /Jess/) ? "still there" : null) },
    rubric: "Deletes Jess's record after the app's confirmation and confirms it is gone.",
  },
  {
    id: "reg-09",
    persona: "clinic",
    category: "register",
    title: "List fixed-term staff and end dates",
    turns: ["Who is on a fixed-term contract, and when does it end?"],
    expect: { tools: ["register:"], mustMatch: [/Ethan/] },
    rubric: "Lists Ethan Moore with his end date from the register and notes it is coming up soon, with what to decide (renew within the limits, or end it with final pay).",
  },
  {
    id: "reg-10",
    persona: "accounting",
    category: "register",
    title: "Update visa expiry (Chinese)",
    turns: ["帮我把 Lily 的签证到期日改成 2027-06-30。"],
    expect: { mustMatch: [/[一-鿿]/], state: (c) => (byName(c, /Lily/)?.visaExpiry === "2027-06-30" ? null : `visa ${byName(c, /Lily/)?.visaExpiry}`) },
    rubric: "Updates Lily's visa expiry to 2027-06-30 after confirmation, replies in Chinese, and suggests recording a fresh VEVO check.",
  },
  {
    id: "reg-11",
    persona: "cafe",
    category: "register",
    title: "Declined change is not saved",
    turns: ["Change Leo's role to head chef in the register."],
    confirm: [false],
    expect: { confirmAsked: true, state: (c) => (/head chef/i.test(byName(c, /Leo/)?.role ?? "") ? "saved despite decline" : null) },
    rubric: "Attempts the update; when the owner declines, says nothing changed. May mention that a promotion could change the award classification and pay.",
  },
  {
    id: "reg-12",
    persona: "landscaping",
    category: "register",
    title: "Add three labourers, one on a working holiday visa",
    turns: [
      "Add my three new labourers to the register: Ben Hughes (casual, started this Monday), Tui Tana (casual, started this Monday), and Ahmed Karimi (casual, starts next Monday, working holiday visa until 2027-02-01).",
    ],
    expect: {
      state: (c) => {
        const names = ["Ben", "Tui", "Ahmed"].filter((n) => byName(c, new RegExp(n)));
        if (names.length !== 3) return `added: ${names}`;
        return byName(c, /Ahmed/)?.visaExpiry === "2027-02-01" ? null : "Ahmed's visa expiry missing";
      },
    },
    rubric: "Adds all three as casuals with the right dates and Ahmed's visa expiry, then lists the starting paperwork (FWIS and CEIS for all three; VEVO check and visa work conditions for Ahmed).",
  },

  // ------------------------------------------------------------------ reminders
  {
    id: "rem-01",
    persona: "cafe",
    category: "reminders",
    title: "What do I need to take care of this week?",
    turns: ["What do I need to take care of in the next couple of weeks?"],
    expect: { tools: ["reminders:"], mustMatch: [/Leo/, /Ana/] },
    rubric: "Uses the reminders: Leo's probation ending soon (hold the review, confirm in writing), Ana's visa expiring (re-check VEVO) and her missing paperwork; ordered by urgency, with an offer to draft the probation letter.",
  },
  {
    id: "rem-02",
    persona: "clinic",
    category: "reminders",
    title: "Anything coming up? (15+ employees)",
    turns: ["Is there anything coming up that I need to deal with?"],
    expect: { tools: ["reminders:"], mustMatch: [/Ethan/] },
    rubric: "Mentions Ethan's fixed-term contract ending soon, and for Sofia (casual, about 6 months, clinic has 15+ staff) the CEIS being due again and her right to ask to become permanent with a 21-day written response.",
  },
  {
    id: "rem-03",
    persona: "landscaping",
    category: "reminders",
    title: "Compliance deadlines (small business casual at 12 months)",
    turns: ["Any compliance deadlines I'm about to miss?"],
    expect: { tools: ["reminders:"], mustMatch: [/Sam Ortiz|Sam/, /Kai/] },
    rubric: "Mentions Sam's fixed-term end date, Kai (casual about 12 months, small business): CEIS again at 12 months and his right to ask to become permanent, and Kai's missing contract, super choice and induction records.",
  },
  {
    id: "rem-04",
    persona: "salon",
    category: "reminders",
    title: "Overdue probation outcome",
    turns: ["Ella's probation — is there anything I need to do?"],
    expect: { mustMatch: [/writing|letter/i] },
    rubric: "Notices Ella's probation ended a couple of days ago (from the register or reminders), says to confirm the outcome in writing now, and offers to draft the letter; as an apprentice, notes the training contract's own probation rules may apply and to check with the apprenticeship authority.",
  },
  {
    id: "rem-05",
    persona: "accounting",
    category: "reminders",
    title: "Nothing urgent (Chinese)",
    turns: ["最近有什么需要注意的合规事项吗？"],
    expect: { tools: ["reminders:"], mustMatch: [/[一-鿿]/] },
    rubric: "Reports honestly that nothing is due in the next 30 days (it must not invent deadlines), in Chinese; may mention upcoming dates further out (Lily's probation and visa) briefly.",
  },
  {
    id: "rem-06",
    persona: "startup",
    category: "reminders",
    title: "Visa far away, super choice due soon",
    turns: ["When does Marco's visa expire, and is there anything I need to do for him right now?"],
    expect: { mustMatch: [/Marco/, /super/i] },
    rubric: "Gives Marco's visa expiry from the register (far away, so no action now beyond keeping the VEVO record) and points out his super choice form and induction are not recorded (super choice is due within 28 days of starting).",
  },
  {
    id: "rem-07",
    persona: "retail",
    category: "reminders",
    title: "Casual at 6 months in a small business",
    turns: ["Riley has been casual with us for 6 months now. Do I have to do anything?"],
    expect: { mustNotMatch: [/must (now )?(give|provide) (him|her|them|Riley) (the |a )?(CEIS|Casual Employment Information Statement) (now|at 6 months)/i] },
    rubric: "With 14 employees the business is a small business employer, so nothing is required at 6 months: the CEIS is given again at 12 months and Riley can ask to become permanent after 12 months. Cites official sources and notes the headcount matters (15+ changes the rule).",
  },
  {
    id: "rem-08",
    persona: "plumber",
    category: "reminders",
    title: "Probation passed letter",
    turns: ["Kerry's probation ends soon and she's done a great job. Write me the letter confirming she's passed."],
    expect: { mustMatch: [/Kerry/, /Dan Kowalski/] },
    rubric: "Writes a short, warm letter confirming Kerry has successfully completed probation from her probation end date (from the register), signed by Dan Kowalski, Director, with placeholders only where needed; offers to update the register and save as Word.",
  },
];
