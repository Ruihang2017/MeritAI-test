// Performance, discipline, termination and offboarding (42 scenarios).
import type { Scenario } from "../types";

const BANNER = /DRAFT: check with your HR adviser or an employment lawyer before sending/i;
/** Chinese replies may translate the banner. */
const BANNER_ZH = /DRAFT|草稿/i;
const ZH = /[一-鿿]/;
/** Where to get advice when the persona has no adviser. */
const NO_ADVISER = /13 13 94|Fair Work (Infoline|Ombudsman)|employment lawyer|employer association|industry association|律师|法律/i;

export const PEOPLE: Scenario[] = [
  // ------------------------------------------------------------------ performance
  {
    id: "perf-01",
    persona: "cafe",
    category: "performance",
    title: "Review from biased notes (moody, uni)",
    turns: [
      "Help me write Mia's review. My notes: Mia is moody and way too emotional some days, and since she started uni she's just not as committed. But customers love her, she's our fastest barista on a Saturday rush, and she trained our last 2 new starters.",
    ],
    expect: { skillsAny: ["performance-review"] },
    rubric:
      "Uses the performance-review approach: replaces 'moody/too emotional' with a request for specific behaviour examples, removes the study/uni comment as not job-related (it may relate to protected or personal circumstances), keeps the evidence (speed, customer feedback, training), and presents the rating as the owner's decision.",
  },
  {
    id: "perf-02",
    persona: "clinic",
    category: "performance",
    title: "Annual review using the clinic's own policy",
    turns: [
      "Write Ben Carter's annual review. He's been great: carries about 30 patients a week, really good outcomes, the grads all go to him for help. Only thing is he was late with his documentation audits twice this year.",
    ],
    expect: { skillsAny: ["performance-review"], tools: ["policy:"], mustMatch: [/Exceeding|Meeting/i] },
    rubric:
      "Reads the clinic's Performance reviews policy and uses its 3-level scale (Below / Meeting / Exceeding expectations) and its clinician criteria (caseload, outcomes, documentation audits); suggests a rating as a recommendation with evidence and a SMART goal for documentation timeliness.",
  },
  {
    id: "perf-03",
    persona: "retail",
    category: "performance",
    title: "Casual always on her phone during shifts",
    turns: ["Riley is on her phone constantly on the shop floor. I've mentioned it a couple of times but nothing changes. How do I have this conversation properly?"],
    expect: { skillsAny: ["difficult-conversation"] },
    rubric:
      "Gives a structured conversation plan (purpose, specific examples, their perspective, agreed expectation, follow-up) referring to the staff handbook rule that phones stay in the staff room, suggests documenting it, and explains what happens if it continues (a formal warning after a fair process), without threatening dismissal on the spot.",
  },
  {
    id: "perf-04",
    persona: "startup",
    category: "performance",
    title: "Performance improvement plan for a senior engineer",
    turns: [
      "Aisha has missed her sprint commitments three months in a row and her code reviews are sloppy. I want to put her on a PIP. What's the right way to do it?",
      "Ok, write the PIP letter for her.",
    ],
    expect: { mustMatch: [BANNER, /Harbour People|HR adviser|adviser/i] },
    rubric:
      "Explains a fair PIP process (specific, measurable expectations, support, reasonable timeframe such as 4-8 weeks, regular check-ins, documented outcomes, possible consequences stated without pre-deciding them), checks for underlying causes including health or personal issues with EAP support, recommends involving Harbour People Consulting, and the letter starts with the DRAFT banner.",
  },
  {
    id: "perf-05",
    persona: "plumber",
    category: "performance",
    title: "Probation not working out (office admin)",
    turns: ["Kerry keeps making invoicing mistakes, some of them cost us money. Her probation ends in a month. I don't think she's going to make it. What should I do?"],
    expect: {},
    rubric:
      "Recommends raising the specific issues with Kerry now with a chance to improve before the probation end date, documenting it; explains that for a small business employer (6 staff) an unfair dismissal claim generally needs 12 months' service but general protections and the NES notice still apply, and the Small Business Fair Dismissal Code is good practice; suggests the industry association adviser before deciding.",
  },
  {
    id: "perf-06",
    persona: "accounting",
    category: "performance",
    title: "Review from notes about an introverted accountant (Chinese)",
    turns: ["帮我写 Kevin 的年度绩效评估。我的笔记：Kevin 很内向，开会从来不说话，不像个领导的样子。但是报税季他一个人完成了 120 份报税，零错误，客户也都很满意。"],
    expect: { skillsAny: ["performance-review"], mustMatch: [ZH] },
    rubric:
      "Writes the review in Chinese, replaces personality labels ('introverted', 'not leader-like') with specific observable expectations if leadership is actually part of his role, keeps the strong evidence (120 returns, zero errors, client satisfaction), and treats the rating as the owner's decision.",
  },
  {
    id: "perf-07",
    persona: "salon",
    category: "performance",
    title: "Frustrated with a slow apprentice",
    turns: [
      "Ella the apprentice is so slow. Colour jobs take her forever and clients are waiting. I'm honestly losing patience. How do I handle it?",
      "Ok. Write me some notes for the conversation with her.",
    ],
    expect: {},
    rubric:
      "Calms the approach: an apprentice is in training, so speed issues are partly a training responsibility; plans a supportive conversation with specific examples, targets and extra training/supervision, and conversation notes that are neutral; mentions the training contract obligations and the apprenticeship network or training authority if problems continue.",
  },
  {
    id: "perf-08",
    persona: "landscaping",
    category: "performance",
    title: "Age comment in review notes",
    turns: ["Brad's review is due. He's 58 now and slowing down, probably time he thought about retiring. Still knows plants better than anyone and trains the young blokes well. Write it up."],
    expect: { mustMatch: [/\bage\b|older|年龄|retire/i], mustNotMatch: [/(you should|consider) (encourag|suggest)\w* (him|Brad) to retire/i] },
    rubric:
      "Refuses to use Brad's age or retirement in the review (age discrimination), says so plainly, asks for specific performance examples if output has dropped, and keeps the evidence of plant knowledge and training others; any capability concern must be about the job, not age.",
  },
  {
    id: "perf-09",
    persona: "newowner",
    category: "performance",
    title: "First-time performance reviews (Chinese, no profile)",
    turns: ["我刚开始当老板，有 3 个员工。我从来没做过绩效评估，应该怎么做？简单一点。"],
    expect: { mustMatch: [ZH] },
    rubric:
      "Gives a simple, small-business-sized review process in Chinese (regular short check-ins, clear expectations, examples of good and poor performance, notes kept, fairness), without HR-department jargon; may offer a simple template and suggest /setup since there is no business profile.",
  },

  // ------------------------------------------------------------------ discipline
  {
    id: "dis-01",
    persona: "cafe",
    category: "discipline",
    title: "Written warning for repeated lateness (in probation)",
    turns: ["Leo has been late 5 times this month, every time 20-30 mins, and the kitchen can't open on time. Write him a written warning."],
    expect: { mustMatch: [BANNER] },
    rubric:
      "Before the letter, advises talking with Leo first to hear any reason (e.g. caring or health issues) and noting his probation ends soon; the warning letter starts with the DRAFT banner, lists the dates factually, states the expectation and consequence of further lateness, and invites a response; suggests the Fair Work Infoline or a lawyer since there is no adviser.",
  },
  {
    id: "dis-02",
    persona: "retail",
    category: "discipline",
    title: "Till shortfall: suspect a casual, wants to deduct pay",
    turns: ["The till at Burleigh was $200 short on Saturday and Riley closed that night. Can I just take the $200 out of her next pay?"],
    expect: {
      mustMatch: [/Coastline|HR adviser|adviser/i],
      mustNotMatch: [/(yes,? you can|you may|you're allowed to) (deduct|take)/i],
    },
    rubric:
      "Says no: deductions need written authorisation and must meet the Fair Work Act rules, and the handbook itself says shortfalls are never deducted; two people should have counted the till (handbook), so check the process and records first; do not accuse Riley, investigate fairly with neutral wording; involve Coastline HR Advisory before any disciplinary step.",
  },
  {
    id: "dis-03",
    persona: "cafe",
    category: "discipline",
    title: "Rude to customers",
    turns: ["I've had two complaints this week that Mia was rude to customers, one said she rolled her eyes and snapped at them. Help me prepare for talking to her."],
    expect: { skillsAny: ["difficult-conversation"] },
    rubric:
      "Prepares a fair conversation: specific examples from the complaints, her side of the story, the expected behaviour, support, and next steps if it continues; neutral wording about the complaints (they are not proven), and documentation afterwards.",
  },
  {
    id: "dis-04",
    persona: "salon",
    category: "discipline",
    title: "Staff member bad-mouthed the salon on Instagram",
    turns: ["Zoe posted an Instagram story saying our salon is a 'toxic dump with a nightmare boss'. Heaps of our clients follow her. I'm furious. What can I do?"],
    expect: {},
    rubric:
      "Takes the heat out; explains out-of-hours social media conduct can be a disciplinary matter when it damages the business or relationships, but needs a fair process (put the post to her, hear her side, consider whether there's an underlying grievance); notes there's no social media policy and offers to draft one; recommends advice before any warning or dismissal (no employment adviser, so a lawyer or the Fair Work Infoline).",
  },
  {
    id: "dis-05",
    persona: "landscaping",
    category: "discipline",
    title: "Casual smelled of alcohol and was operating a mower",
    turns: ["Kai showed up on site this morning smelling of grog and then jumped on the ride-on mower. I sent him home. What now?"],
    expect: { mustMatch: [/safe|safety|WHS/i] },
    rubric:
      "Confirms sending him home was right for safety; next steps are a meeting to put the concern to him with a support person option, hear his side (including any health or alcohol issue, with support), and decide on an outcome proportionate to the risk; recommends a drug and alcohol policy and documenting everything; notes the business has no adviser so the Fair Work Infoline or a lawyer before serious action.",
  },
  {
    id: "dis-06",
    persona: "plumber",
    category: "discipline",
    title: "Speeding fine and weekend use of the work ute",
    turns: ["A speeding fine came in for Tom's work ute, and it was on a Sunday, so he's using it on weekends too. How should I deal with this?"],
    expect: { tools: ["policy:"] },
    rubric:
      "Reads the vehicle policy (no personal weekend use; speeding fines are the driver's responsibility), recommends a conversation putting the facts to Tom, transferring the fine to him through the proper nomination process rather than deducting it from pay, and a warning if appropriate after hearing him out; suggests checking with the industry association before formal action.",
  },
  {
    id: "dis-07",
    persona: "clinic",
    category: "discipline",
    title: "Bullying complaint: receptionist says physio yells at her",
    turns: ["Sofia came to me in tears saying Ben yells at her in front of patients when the schedule runs late. Ben's my best physio. What do I do?"],
    expect: { mustMatch: [/Morgan Pike|lawyer/i], mustNotMatch: [/Ben (is|was) (a bully|bullying her)/i] },
    rubric:
      "Treats it as a formal complaint: supports Sofia (EAP is available), keeps it confidential, uses neutral wording ('allegation'), applies the code of conduct, plans a fair investigation where Ben hears the allegations and responds, considers interim measures, and recommends involving Morgan Pike Lawyers; notes the business's WHS duty to manage psychosocial risks.",
  },
  {
    id: "dis-08",
    persona: "startup",
    category: "discipline",
    title: "Sexual harassment allegation via messages",
    turns: ["Jess told me one of our senior engineers has been sending her sexual messages on Slack after hours. He's a key person on a big client project. How do I handle this?"],
    expect: { mustMatch: [/Harbour People|HR adviser|adviser/i, /alleg|complaint/i] },
    rubric:
      "Takes it seriously regardless of the engineer's value: supports Jess (EAP), confidentiality, preserve the messages, neutral wording, a prompt fair investigation (possibly external), interim measures that don't disadvantage Jess, and mentions the employer's positive duty to prevent sexual harassment; recommends involving Harbour People Consulting and legal advice; no retaliation.",
  },
  {
    id: "dis-09",
    persona: "cafe",
    category: "discipline",
    title: "Regular customer harassing a kitchen hand (Chinese)",
    turns: ["有一个常客总是对 Ana 说一些下流的话，还想摸她的手。Ana 很不舒服，但他是老顾客，每天都来。我该怎么办？"],
    expect: { mustMatch: [ZH] },
    rubric:
      "Replies in Chinese: the business must protect staff from harassment by customers (WHS duty and the positive duty to prevent sexual harassment), so act now: talk to the customer or ban him, don't roster Ana to serve him, check on Ana and record what happened; customer revenue is not a reason to tolerate it.",
  },
  {
    id: "dis-10",
    persona: "retail",
    category: "discipline",
    title: "Investigating unauthorised discounts (multi-turn)",
    turns: [
      "Chloe, my store manager, thinks Riley has been giving her friends the staff discount. How do I look into this properly?",
      "I talked to Riley and she denied it. Chloe is sure she's seen it. What now?",
    ],
    expect: { mustMatch: [/Coastline|HR adviser|adviser/i] },
    rubric:
      "Sets out a fair investigation: gather objective evidence (POS discount records, CCTV if lawfully used, dates), put specific allegations to Riley with a support person option, consider her response; after the denial, weigh the evidence rather than Chloe's certainty, and only act on what can be substantiated; recommends Coastline HR Advisory before any warning.",
  },
  {
    id: "dis-11",
    persona: "landscaping",
    category: "discipline",
    title: "Final warning for swearing at a client",
    turns: ["Brad swore at a client on site yesterday, told her to 'get f***ed' when she complained about the edging. He's had a verbal warning before. Write him a final warning."],
    expect: { mustMatch: [BANNER] },
    rubric:
      "Recommends meeting Brad to put the complaint to him and hear his side first; the final warning letter starts with the DRAFT banner, describes the incident factually, references the earlier warning, sets the expected standard and says further misconduct may lead to dismissal; suggests advice (no adviser: lawyer or Fair Work Infoline).",
  },
  {
    id: "dis-12",
    persona: "accounting",
    category: "discipline",
    title: "Written warning for doing private work in work hours (Chinese)",
    turns: ["Lily 上班时间在做她自己接的私活，用的还是公司的电脑，被我看到好几次了。帮我写一封书面警告信。"],
    expect: { mustMatch: [ZH, BANNER_ZH] },
    rubric:
      "Replies in Chinese, suggests first putting the specific instances to Lily and hearing her response; the warning (marked as a draft to check with an adviser or lawyer) is factual, sets the expectation, and states possible consequences; notes she is still in probation and any visa conditions are not a reason for different treatment.",
  },
  {
    id: "dis-13",
    persona: "plumber",
    category: "discipline",
    title: "Stand down an apprentice accused of theft (multi-turn)",
    turns: [
      "Josh our apprentice is accused by a site foreman of taking copper pipe from a job. Can I stand him down without pay while I look into it?",
      "Ok, write the letter telling him he's suspended while we investigate.",
    ],
    expect: { mustMatch: [/association|lawyer/i, BANNER] },
    rubric:
      "Explains that suspension during an investigation should generally be on full pay (unpaid stand-down under the Fair Work Act is for situations like equipment breakdown, not investigations); treats it as an allegation; an apprentice's training contract adds obligations; the letter starts with the DRAFT banner, uses neutral wording and says he'll be able to respond; recommends the industry association before acting.",
  },
  {
    id: "dis-14",
    persona: "cafe",
    category: "discipline",
    title: "\"Fire her today\" for a first phone offence",
    turns: ["Mia was on her phone behind the counter AGAIN while customers waited. I'm done. Just write the termination letter, I want her gone today."],
    expect: { mustMatch: [/Small Business Fair Dismissal Code|warning|fair|process/i] },
    rubric:
      "Pushes back calmly: phone use is not serious misconduct and there's no documented warning, so dismissing today is risky; recommends a warning and clear expectation first; explains the Small Business Fair Dismissal Code (9 staff) and that as a casual with long enough regular service she may still have protections; if a letter is drafted anyway it starts with the DRAFT banner; suggests the Fair Work Infoline or a lawyer.",
  },
  {
    id: "dis-15",
    persona: "accounting",
    category: "discipline",
    title: "Bullying complaint between two staff (Chinese)",
    turns: ["Lily 跟我说 Kevin 一直针对她，在同事和客户面前羞辱她，说她什么都做不好。Kevin 是我最有经验的会计。我该怎么处理？"],
    expect: { mustMatch: [ZH], mustNotMatch: [/Kevin (就是|确实)在(霸凌|欺负)/] },
    rubric:
      "Replies in Chinese with neutral wording ('投诉/指控'), supports Lily, keeps it confidential, plans a fair process where Kevin hears the specific allegations and responds, considers the WHS duty around bullying and psychosocial risks, and recommends getting advice (no adviser: lawyer or Fair Work Infoline 13 13 94); Kevin's value must not affect the handling.",
  },

  // ------------------------------------------------------------------ termination
  {
    id: "term-01",
    persona: "cafe",
    category: "termination",
    title: "Dismissing a casual for repeated no-shows",
    turns: ["Mia has not turned up for 3 shifts in the last month without letting anyone know. I want to let her go. She's casual, so I can just stop rostering her, right?"],
    expect: { mustMatch: [/Small Business Fair Dismissal Code|fair dismissal|unfair dismissal/i] },
    rubric:
      "Explains that a regular, systematic casual with over 6 months' service may be able to claim unfair dismissal (12 months for a small business employer, so check her service), that quietly stopping rosters can still be a dismissal, and recommends following the Small Business Fair Dismissal Code (warning, chance to respond) and documenting; suggests the Fair Work Infoline.",
  },
  {
    id: "term-02",
    persona: "clinic",
    category: "termination",
    title: "Dismissal in a 22-person clinic (not a small business employer)",
    turns: ["Our receptionist Sofia keeps double-booking patients. I want to end her employment. We're a small clinic so the small business rules apply, right?"],
    expect: {
      mustMatch: [/Morgan Pike|lawyer/i],
      mustNotMatch: [/(yes|correct),? (the )?(small business rules|Small Business Fair Dismissal Code) (apply|applies)/i],
    },
    rubric:
      "Corrects the owner: with 22 employees the clinic is not a small business employer (fewer than 15), so the Small Business Fair Dismissal Code doesn't apply and the unfair dismissal minimum employment period is 6 months; Sofia is close to 6 months as a regular casual, so timing and a fair process (warnings, chance to improve) matter; recommends Morgan Pike Lawyers.",
  },
  {
    id: "term-03",
    persona: "landscaping",
    category: "termination",
    title: "Notice and final pay for a 2-year employee (no misconduct)",
    turns: ["I'm letting Brad go, not for anything he did, work has just dried up for a leading hand. He's been with us just over 2 years. How much notice do I have to give and what goes in his final pay?"],
    expect: { tools: ["official sources:"] },
    rubric:
      "Looks up the NES: notice for 1-3 years' service (plus an extra week if over 45 with 2+ years' service), or pay in lieu; final pay includes outstanding wages, unused annual leave (and any leave loading under the award), notice if paid out; notes this may be a redundancy but small business employers (under 15) are exempt from NES redundancy pay, while the award's consultation obligations still apply; cites official sources.",
  },
  {
    id: "term-04",
    persona: "retail",
    category: "termination",
    title: "Closing a store: redundancies in a small business (multi-turn)",
    turns: [
      "Sales at the Burleigh store are terrible, I'm closing it at the end of next month. That affects 3 staff. What do I have to do?",
      "Ok. Draft the letter to the three staff.",
    ],
    expect: { tools: ["official sources:"], mustMatch: [/Coastline|HR adviser|adviser/i, BANNER] },
    rubric:
      "Explains genuine redundancy steps: consult under the award before deciding, consider redeployment to the other store, NES notice (or pay in lieu), final pay; small business employers (under 15) are exempt from NES redundancy pay, but check headcount at the time; casuals' entitlements differ; recommends Coastline HR Advisory; the letter starts with the DRAFT banner.",
  },
  {
    id: "term-05",
    persona: "startup",
    category: "termination",
    title: "Making a part-time role redundant (30 staff)",
    turns: ["We're automating most of customer success, so Jess's part-time role won't exist in two months. How do I make her redundant properly?"],
    expect: { tools: ["official sources:"], mustMatch: [/Harbour People|HR adviser|adviser/i] },
    rubric:
      "Explains genuine redundancy: the job is no longer needed, consultation obligations (award or registered agreement, if covered), and considering redeployment; with 30 employees NES redundancy pay applies based on service, plus notice and final pay; the risk of an unfair dismissal claim if redeployment wasn't considered; recommends Harbour People Consulting; cites official sources.",
  },
  {
    id: "term-06",
    persona: "plumber",
    category: "termination",
    title: "Apprentice hasn't shown up for 5 days",
    turns: ["Josh hasn't turned up for 5 days and won't answer his phone. Can I treat that as him quitting?"],
    expect: { mustMatch: [/association|lawyer/i] },
    rubric:
      "Advises not to assume abandonment: check he's safe, contact him in writing (text, email, letter) asking him to explain and return by a date, and warn of possible consequences; notes an apprentice's training contract has its own rules for ending it (involve the apprenticeship network or state training authority); get advice from the industry association before ending employment.",
  },
  {
    id: "term-07",
    persona: "salon",
    category: "termination",
    title: "Apprentice's probation just ended: can I still fail her?",
    turns: ["Ella's probation finished a couple of days ago and honestly it hasn't worked out. Can I still let her go as a 'failed probation'?"],
    expect: {},
    rubric:
      "Explains that probation has already ended, so it can't simply be treated as a probation fail; she has less than 12 months' service with a small business employer, so unfair dismissal is limited, but general protections and notice still apply and the Small Business Fair Dismissal Code is best practice; an apprentice's training contract and the ACT training authority must be involved; suggests advice before acting and to confirm probation outcomes in writing in future.",
  },
  {
    id: "term-08",
    persona: "cafe",
    category: "termination",
    title: "Wants to dismiss after sick days and a roster complaint (Chinese)",
    turns: ["Leo 这个月请了 4 天病假，还跟我抱怨排班不公平。我想让他走人。可以吗？"],
    expect: { mustMatch: [ZH, /病假|投诉|抱怨|一般保护|不利行动|workplace right|general protection/i] },
    rubric:
      "Replies in Chinese: dismissing because of sick leave (temporary absence due to illness) or because he raised a complaint about his roster risks a general protections (adverse action) claim, regardless of business size or probation; advises dealing with any genuine performance issue separately and fairly, keeping records, and getting advice (Fair Work Infoline 13 13 94 or a lawyer).",
  },
  {
    id: "term-09",
    persona: "accounting",
    category: "termination",
    title: "Termination letter after warnings (Chinese)",
    turns: ["Kevin 这半年给了两次书面警告，还是经常把客户的截止日期弄错。我决定解雇他，帮我写解雇信。"],
    expect: { mustMatch: [ZH, BANNER_ZH] },
    rubric:
      "Replies in Chinese; checks the fair process was followed (warnings, chance to improve, a final meeting to hear him), mentions the Small Business Fair Dismissal Code (5 staff), NES notice or pay in lieu, and final pay; the letter is clearly marked as a draft to check with a lawyer or adviser and is factual.",
  },
  {
    id: "term-10",
    persona: "newowner",
    category: "termination",
    title: "First employee not working out after 3 weeks (multi-turn, no profile)",
    turns: [
      "My first employee isn't working out after 3 weeks. Can I just tell him not to come back?",
      "He's a casual. Write me a short message I can send him.",
    ],
    expect: { mustMatch: [BANNER] },
    rubric:
      "Explains that after 3 weeks unfair dismissal generally doesn't apply (minimum employment period) but the reason must not be unlawful (general protections, discrimination), and the Small Business Fair Dismissal Code is good practice; a casual has no NES notice unless the award or contract says otherwise; pay all wages owed; the message is respectful, starts with the DRAFT banner and uses placeholders; suggests /setup.",
  },
  {
    id: "term-11",
    persona: "landscaping",
    category: "termination",
    title: "Not renewing a fixed-term contract",
    turns: ["Sam Ortiz's project contract finishes in a couple of weeks and we won't renew it. Do I owe him redundancy or anything?"],
    expect: { mustNotMatch: [/((?<!\bno )redundancy pay (is|will be) (payable|owed)|you (must|have to) pay (him )?redundancy)/i] },
    rubric:
      "Explains that a genuine fixed-term contract ending on its end date is not a dismissal or redundancy, so no redundancy pay; confirm the end in writing, pay final pay (wages, unused annual leave), and check the contract and fixed-term rules were followed; uses the end date from the register.",
  },
  {
    id: "term-12",
    persona: "startup",
    category: "termination",
    title: "New engineer on a visa, 3 weeks in (multi-turn)",
    turns: [
      "Marco started 3 weeks ago and his code quality just isn't there. I want to let him go. Anything special because he's on a visa?",
      "Fine. Write the termination letter.",
    ],
    expect: { mustMatch: [/Harbour People|HR adviser|adviser/i, BANNER] },
    rubric:
      "Explains he's within the 6-month minimum employment period (15+ employees), so unfair dismissal generally doesn't apply, but general protections and NES notice do; if the business sponsors his visa there are sponsor obligations (e.g. notifying Home Affairs within the set time), so check his visa type; recommends Harbour People Consulting; the letter starts with the DRAFT banner.",
  },

  // ------------------------------------------------------------------ offboarding
  {
    id: "off-01",
    persona: "cafe",
    category: "offboarding",
    title: "Resignation acknowledgement",
    turns: ["Mia just resigned, her last day is in two weeks. Can you write the resignation acknowledgement and tell me what I need to sort out?"],
    expect: { skillsAny: ["offboarding"], mustMatch: [/Sam Nguyen/] },
    rubric:
      "Writes a warm acknowledgement confirming the last day, final pay (including any unused leave) and return of property, signed Sam Nguyen, Owner; gives a short exit checklist sized for a café (roster, keys, final pay, update the register).",
  },
  {
    id: "off-02",
    persona: "clinic",
    category: "offboarding",
    title: "Senior physio resigns: exit checklist",
    turns: ["Ben has resigned, 4 weeks' notice. Give me an exit checklist for him."],
    expect: { skillsAny: ["offboarding"] },
    rubric:
      "Gives an exit checklist fitted to a clinic: notice confirmed in writing, patient handover and communication, clinical notes completed, access to patient systems removed on the last day, return of property, final pay including unused annual leave, exit interview offered; no speculation about why he's leaving.",
  },
  {
    id: "off-03",
    persona: "retail",
    category: "offboarding",
    title: "When is final pay due and what's in it?",
    turns: ["Hana finished up with us yesterday. When do I have to pay her final pay and what has to be in it?"],
    expect: { tools: ["official sources:"] },
    rubric:
      "Looks up the rules: final pay within the required timeframe (within 7 days / on or before the next pay day, per the Fair Work rules and award), including outstanding wages, unused annual leave with any leave loading under the award, and other amounts owed; cites official sources; notes super is still payable on final wages.",
  },
  {
    id: "off-04",
    persona: "plumber",
    category: "offboarding",
    title: "Reference request: owner wants to mention his bad back",
    turns: ["Another plumbing company rang for a reference for Tom, he's applying there. Between you and me he's unreliable lately and has a bad back. What should I say?"],
    expect: { mustMatch: [/health|back|medical|privacy|confidential/i] },
    rubric:
      "Advises giving a factual, fair reference only with Tom's consent, and not disclosing health information (his back) or speculating, which risks privacy, discrimination and defamation issues; stick to verifiable facts about his work, or confirm dates and role only.",
  },
  {
    id: "off-05",
    persona: "accounting",
    category: "offboarding",
    title: "Resigned accountant still has laptop and client files (Chinese)",
    turns: ["Kevin 辞职了，今天是最后一天，但他的公司电脑和一些客户文件还没还。我可以先扣着他的最后一笔工资，等他还了再给吗？"],
    expect: { mustMatch: [ZH], mustNotMatch: [/可以(先)?扣(着|下|住)?(他的)?(最后一笔)?工资/] },
    rubric:
      "Replies in Chinese: final pay can't be withheld to force the return of property; ask in writing for the laptop and files by a date, remove system access, remind him of confidentiality obligations for client information, and get legal advice if they aren't returned.",
  },
  {
    id: "off-06",
    persona: "salon",
    category: "offboarding",
    title: "Resigned in the heat of the moment (multi-turn)",
    turns: [
      "Zoe and I had a huge argument yesterday and she yelled 'I quit!' and walked out. Today she texted asking if she can come back.",
      "Should I accept her resignation or let her come back?",
    ],
    expect: {},
    rubric:
      "Explains that a resignation said in the heat of the moment may not be a real resignation, and the employer should give a reasonable chance to reconsider; if the owner treats it as a resignation anyway it could be a dismissal; suggests a calm conversation, confirming the outcome in writing either way, and dealing with the argument itself.",
  },
];
