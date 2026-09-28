# Small business HR: profile, policies, hiring, register, reminders, award (as built)

The assistant is an HR adviser for **a small business with no HR department**. Its user is the owner or a trusted manager. The internal HR team tests it by playing a small business owner. Everything it knows about the business comes from the **business profile** and the business's own **policy documents**; nothing is hard-coded.

## 1 Business workspace

One files root is one business:

```
files/                      (default <project>/files; per user: /files set <path>)
  Jobs/  Inbox/  Outbox/    see docs/files.md and docs/screening.md
  Policies/                 the business's own policies / handbook (PDF, DOCX, TXT, MD); read-only to the model
  .assistant/
    business.json           the business profile
    catalog.sqlite          screening catalog
    register.sqlite         employee register
```

`.assistant/` is never reachable through a model tool.

## 2 Business profile

`src/business/profile.ts` (store, validation, rendering) and `src/business/tools.ts` (`update_business_profile`).

| Field | Notes |
|---|---|
| `legalName`, `tradingName`, `abn`, `industry`, `address` | The ABN is validated (11 digits) and formatted |
| `states` | AU states and territories where staff work (validated: NSW, VIC, QLD, WA, SA, TAS, ACT, NT) |
| `headcount`, `employmentTypes` | full-time, part-time, casual, fixed-term |
| `awards` | As the owner named them, or "unsure". Not looked up or guessed during setup |
| `payFrequency`, `payrollSystem` | |
| `benefitsAndRules` | Short lines (benefits and the business's own rules) |
| `signer` | Who signs letters and contracts (e.g. "Sam Nguyen, Owner") |
| `adviser` | `{kind: hr-adviser \| employment-lawyer \| employer-association \| accountant \| none, name, contact}` |
| `hasEap` | Whether to suggest an Employee Assistance Program |
| `notes`, `updatedAt` | |

How it is written:

- **Setup interview:** `/setup`, or offered with `[y/n]` on the first start in a workspace without a profile. The `business-setup` skill asks 3 short rounds and saves after each round.
- **Chat edits:** "we've opened a second café in Melbourne" → `update_business_profile` with only the changed fields.
- **Always confirmed:** the tool validates the patch, shows the changes (`Label: old → new`) and saves only after `[y/n]`. In voice mode the confirmation is skipped as not saved, like memory proposals.
- **Business facts only:** a TFN or date-of-birth pattern is refused. Business contact details are allowed.

How it is read:

- **Rendered into each new session as "# This business".** Fields that are not recorded are listed, so the model uses placeholders instead of guessing.
- **Without a profile, the model is told it knows nothing about the business.** It does the task with placeholders and ends with a one-line tip to run `/setup`.
- **`/profile`** shows the profile, its file path and the policy documents.

## 3 Policies

`src/business/policies.ts`.

- **Index:** each document in `Policies/` (any subfolder; PDF, DOCX, TXT, MD) is listed in the instructions ("# Business policies"). A markdown file can describe itself with front matter (`title`, `description`); otherwise the file name is shown. The index is capped at 50 entries.
- **Reading:** `read_policy(id)` reads one document with the same guards and parsers as the Inbox (see `docs/files.md`). Markdown front matter and HTML comments are stripped.
- **Empty folder:** the model says the business has not recorded a policy and offers to draft one. Drafts are saved to the Outbox; the owner moves them into `Policies/`.

This replaces the old repo-level `knowledge/` folder (synthetic company data), which was removed on 2026-09-25.

## 4 Owner audience and getting advice

`prompts/developer.md` and the skills:

- Plain language, with a few-word explanation of each HR or legal term. Lead with what to do, then a one-line why for legal requirements and real risks, then offer to do the work. Point out legal obligations the owner may not know about, when relevant.
- **Getting advice:** employee relations and other legal-risk matters go to the adviser in the profile, by name. Without one: an employment lawyer, an employer or industry association, and the Fair Work Infoline (13 13 94) for free general guidance.
- Decision letters (warning, PIP, stand-down, termination, complaint outcome) start with "DRAFT: check with your HR adviser or an employment lawyer before sending."
- **Wellbeing:** an EAP is mentioned only if `hasEap` is true. Otherwise: their GP, Beyond Blue (1300 22 4636), Lifeline (13 11 14); 000 for immediate risk.
- Skills take the signer, business name, benefits and policies from the profile and `Policies/`, never from fixed text.

## 5 Hiring: offers, contracts and the new starter checklist

**Checklist.** `src/business/onboarding.ts` provides `new_starter_checklist(employment_type, may_need_visa_check)`. Code decides which legal items apply, so none is forgotten; the model personalises the list and drafts the documents.

| When | Item | Applies to |
|---|---|---|
| Before start | Find the award and classification; work out pay with the Pay and Conditions Tool | All |
| Before start | Written offer and contract (the business.gov.au Employment Contract Tool for award-covered hourly or weekly employees) | All |
| Before start | Fixed-term limits (length, renewals) | Fixed-term |
| Before start | Regular hours and days agreed in writing | Part-time |
| Before start | Right to work / visa conditions in VEVO | Unless the owner says the person is a citizen or permanent resident |
| Day one | Fair Work Information Statement | All |
| Day one | Casual Employment Information Statement, and again later: after 12 months for a small business employer (headcount under 15 in the profile); otherwise after 6 and 12 months, then every 12 months | Casual |
| Day one | Fixed Term Contract Information Statement | Fixed-term |
| Day one | TFN declaration; induction including WHS | All |
| First weeks | Super standard choice form within 28 days; request the stapled fund if no choice | All |
| Ongoing | Time and wages records; pay slip within 1 working day; payday super (within 7 business days after payday from 1 July 2026; 20 for the first contribution); probation check-ins | All |

- **Sources:** each item links to its official page (Fair Work, ATO, Home Affairs, business.gov.au). The URLs and the rules were checked against those pages on 2026-09-25 (`CHECKED_ON`). URLs the tool returns count as verified for the unverified-link guard.
- **No figures:** pay rates, casual loading and the super percentage are deliberately left out. They come from `search_official_sources` or the Pay and Conditions Tool.
- **Official sites:** `business.gov.au` was added to `OFFICIAL_DOMAINS`.

**Letters of offer and contracts.** The `employment-contract` skill:

- **Asks** only for missing terms in one numbered list: role, type, hours, start date, place, pay, award, probation.
- **Checks the rules first:** calls the checklist and `search_official_sources` for type-specific rules (the casual definition, part-time hours, fixed-term limits, NES notice).
- **Output:**
  - a letter of offer;
  - a 14-clause plain-English contract, with the business details taken from the profile and placeholders for the employee's details;
  - a "Before they start" checklist with links.
- **Starts with a banner:** "DRAFT: not legal advice. Check the award, classification and pay rate with the Fair Work Pay and Conditions Tool, and have your HR adviser or an employment lawyer review it before it is signed." It adds the adviser's name if the profile has one.
- **Refuses unlawful clauses**, with a one-line reason:
  - pay below the award;
  - removing NES entitlements;
  - "casual" in name only;
  - withholding final pay;
  - unlawful deductions.
- **Never states that a pay rate is compliant.**

The `onboarding-plan` skill also calls the checklist for its pre-start items. `developer.md` tells the model to call it whenever the owner is hiring.

### Hiring in the chat = hiring on the page (2026-09-27)

The adviser has the Hiring page's actions (`src/screening/hiringTools.ts`, every write confirmed by the tool itself, kind "hiring"): `list_candidates` (a job's readable applications: screened or not, decision, hired), `decide_candidates` (Shortlist / Not this time / clear, only decisions the owner stated, screened candidates, open jobs), `record_hire` (link an employee already in the register), `update_job` (people to hire, close, reopen), `create_job` (with an approved JD saved as "<job> JD.docx"), `set_job_description` (a JD for a job without one; never replaces an existing JD file). `add_employee` takes `hiredFrom {job, candidate}`: the confirmation shows "Hired from: <job> (<name>'s application)", and saving links the hire exactly as Add to Staff on the Hiring page does (`src/business/hiring.ts`: `findCandidate` by file or name, `linkHire`); the reply learns "N of M hired" and to suggest closing a filled job. Without `hiredFrom`, if the new employee's name matches a candidate of an open job, the tool says so and points to `record_hire`. A hire can link any readable application (screened or not). New employees' confirmations list only the fields given.

### Job templates (2026-09-27)

`src/business/jobTemplates.ts`: 35 generic roles in 10 industries (hospitality, retail, cleaning, trades and construction, office, health, care and childcare, hair, beauty and fitness, transport and warehouse, automotive, gardening), each with duties, essential and desirable requirements (no protected attributes), typical employment types, licences and checks to confirm ("the rules differ by state"), and the likely award with its code (checked on the Fair Work list of awards, 2026-09-28): a hint for the Award finder, never a pay figure. `jobDescription()` turns a template and the owner's choices into markdown with bracketed placeholders. Nothing in the templates is about a particular business.

## 6 Employee register

`src/business/register.ts` (store, validation) and `src/business/registerTools.ts` (tools). One SQLite file per business workspace, `.assistant/register.sqlite`.

| Kept | Never kept |
|---|---|
| Name, role, employment type, start date, contract end (fixed-term), award and classification, probation end, visa / work-rights expiry (only for visa holders), status (active / left) and last day, a short work note | TFN, bank details, home address, date of birth, health, disability, pregnancy, family or complaint details |

- **Starting documents per employee:**
  - tracked: contract signed, FWIS, CEIS, FTCIS, TFN declaration, super choice form, VEVO check, induction, each with its date;
  - expected per employee: everyone needs the contract, FWIS, TFN, super choice and induction; casuals also need the CEIS; fixed-term employees need the FTCIS; visa holders need a VEVO check;
  - the difference is shown as "outstanding".
- **Tools:** `list_employees`, `add_employee`, `update_employee`, `record_documents`, `remove_employee`.
  - **Every write is confirmed by the owner:** the tool shows what it will save and asks `[y/n]` in the CLI. The descriptions tell the model to call the tool directly instead of asking in the chat. (In testing it first asked "shall I save?" in the chat, which doubled the confirmation.)
  - Same name as an existing active employee: the add is refused, and the model must update the record or ask.
- **Forms (for a UI, agreed with the owner 2026-09-26):** `AssistantApp.addEmployee`, `updateEmployee`, `recordDocuments`, `markLeft(id, leftDate, reason)`, `removeEmployee`, and `updateProfile` for the business profile.
  - They use the same checks as the tools (`src/business/registerOps.ts`, `checkProfilePatch` in `tools.ts`), so a form can't save what a tool would refuse.
  - Submitting the form is the owner's confirmation, so there is no second yes/no. Deleting still shows the destructive confirmation the tool uses.
  - They return what a UI shows after saving:
    - adding someone returns their new starter checklist;
    - `markLeft` returns the leaving checklist for the reason (leaving always goes through it);
    - changing a fixed-term end date returns the limits note with its Fair Work source.
  - The chat path is unchanged. The model reads the register fresh every time, so both paths stay in step.
- **Validation (code, not only the prompt):**
  - dates must be `YYYY-MM-DD`;
  - employment types must be known;
  - text fields are capped at 200 characters;
  - text fields are checked for personal data: the memory PII patterns, plus TFN, bank, address, date-of-birth and health words. A match is refused.
- **Leaving and deleting:** someone who leaves is set to "left" with their last day, because final pay and record obligations continue. `remove_employee` deletes the person and their document records, only when the owner asks.
- **Access:**
  - `/staff` lists the active employees, and `/staff all` includes people who left;
  - the register is not injected into the instructions. The model reads it with `list_employees` when a task needs it.
- **Not encrypted in the POC** (agreed with the owner). Encrypt it before any real use.

## 7 Compliance reminders

`src/business/reminders.ts`. Code works out the reminders from the register and the business profile. The CLI shows them:

- at startup ("N reminder(s), M overdue", with the first 5);
- in full with `/reminders`;
- to the model through `get_reminders`, e.g. when the owner asks "what do I need to do?".

A local CLI cannot notify while it is closed, so reminders appear when it starts.

Each reminder is dated the day itself (the end of probation, the expiry, the end of the contract, 1 July), not the day to start acting; it appears ahead of that date. "Overdue" means the date has passed.

| Reminder | When it shows | Rule (checked 2026-09-25) |
|---|---|---|
| Starting paperwork not recorded | From the start date (super choice alone: 28 days after the start) until it is recorded; dated the start date (or the super deadline) | Information statements and TFN by the start; super choice within 28 days |
| Probation ends | From about 6 weeks before the end until a week after | Have the review conversation before the date |
| Visa / work rights expire | From 60 days before until a month after | Re-check VEVO |
| Fixed-term contract ends | From about 8 weeks before until a week after | Extend (2 years in total, at most one extension) or let it end |
| CEIS again (casuals) | On the due date, until a newer CEIS is recorded | Small business employer (headcount under 15): after 12 months. Otherwise: after 6 and 12 months, then every 12 months |
| Casual may ask to become permanent | At 6 months (12 for a small business employer) | Employee choice pathway; the employer must respond in writing within 21 days |
| New minimum wages and award rates | From mid-May to mid-July, dated 1 July | From the first full pay period on or after 1 July |

- Sorted by date. People who have left are ignored. Titles name the person (no role).
- **Staff page "Next date"** (`nextKeyDate()`): one date per person whatever the reminder window: overdue paperwork (or an expired visa) first, else the soonest of start, last day, probation end, contract end and visa expiry (amber within 7 days); for people who left, the date and the year their records can go (kept 7 years). An active employee can have a last day (`leftDate`) set before they leave.
- **Unknown headcount:** the rules for 15 or more employees are used, because they remind earlier.
- **Clearing a reminder:** record the document, or update the date, in the register. Reminders are recomputed every time, so nothing is stored.

## 8 Award and pay (assistive only)

The owner agreed that the POC helps narrow down the award and level, and does not calculate pay.

**The `award-finder` skill:**

- **Inputs:** the industry and state from the profile, plus the role's duties, qualifications, supervision and employment type.
- **Research:** `pay_check_tools` returns the verified links to Find my award, the Pay and Conditions Tool and the Fair Work Infoline (13 13 94). `search_official_sources` answers coverage, classification definitions and, only if asked, the base rate.
- **Output:**
  - the most likely award, with the reason, and the other candidates if coverage is unclear;
  - the most likely level, with the matching definition;
  - a base rate only if the official sources returned it, with its date;
  - what to check in the Pay and Conditions Tool (penalties, overtime, casual loading, allowances);
  - this closing line: "Confirm the award, level and pay with the Fair Work Pay and Conditions Tool before you pay, or call the Fair Work Infoline on 13 13 94.";
  - an offer to record the award in the profile and the level in the register (both confirmed).
- **"How much do I owe for these hours?"** No multiplying or totals, even if asked. It lists what the tool will ask for, and may quote sourced hourly rates.
- Enterprise agreements and award-free roles are called out.

**Backstop:** `src/business/payGuard.ts`. In testing, the model once multiplied "6 hours × $60.93 = $365.58" when asked directly. The skill now forbids it, and if a reply still contains pay arithmetic, the CLI shows a yellow warning to check the amount with the Pay and Conditions Tool. It flags the reply; it does not block it. A quoted rate ("base rate = $26.44") is not flagged.

## 9 Changes from the first evaluation (round 1, 2026-09-26)

The first evaluation (`docs/eval.md`; 114 runs before the usage limit) found gaps, mostly things left out rather than things stated wrongly. Legal-obligation fixes are code, with links checked against official pages on 2026-09-26.

| Finding | Fix |
|---|---|
| **Apprentices:** training contract and state training authority not mentioned at start, probation or exit | `new_starter_checklist(is_apprentice_or_trainee)` adds signing and registering the training contract with the authority for the business's states (`TRAINING_AUTHORITIES`, from Fair Work's list), and the leaving checklist adds contacting the authority. Apprentice probation reminders defer to the training contract. `developer.md` has an apprentices rule. The authorities' sites and `apprenticeships.gov.au` were added to `OFFICIAL_DOMAINS` |
| **Final pay and exit steps left out** | New `leaving_checklist(reason, is_apprentice_or_trainee)` (`src/business/leaving.ts`): notice, return of property and access, final pay timing (the award; most awards within 7 days; otherwise at least monthly), what final pay includes (annual leave with loading; personal leave not paid out), tax and super, pay slip and 7-year records, the Services Australia separation certificate, and advice first for dismissal or redundancy. Marking someone as left in the register returns it automatically; the offboarding skill and `developer.md` call it |
| **Fixed-term extension** without the limits | Changing a fixed-term end date in the register returns the rules: at most 2 years including extensions, at most one extension or renewal, and limits on consecutive contracts (for contracts from 6 Dec 2023, unless an exception applies). It adds: check earlier contracts, put the extension in writing, and offer to draft the letter |
| **Recorded documents reported as missing; the super deadline called overdue** | Register lines show "recorded: ... (date)" and "not recorded yet: ..." (it may be done, just not recorded). The paperwork reminder lists only unrecorded items, each with its own timing (FWIS "before, or as soon as possible after, they start"; super choice "by <date>"). `developer.md`: never call a recorded document outstanding |
| **Small business rules mixed up** (the 6-month casual rule applied to a business with 14 staff) | Worked out by code in "This business": whether the business is a small business employer (fewer than 15), how the count works (associated entities; casuals only if regular and systematic), and which rules depend on it |
| **Casual definition paraphrased wrongly** ("irregular hours") | `developer.md`: only the official terms (no firm advance commitment; a regular pattern alone does not make someone permanent) |
| **An accountant used as the employment-law referral** | "This business" and `developer.md`: an accountant or bookkeeper adviser covers payroll, tax and super only; legal risk goes to an employment lawyer, an association or the Fair Work Infoline |
| **A pretext rejection drafted for an age-based decision** | `developer.md` and the candidate-email skill: say it would be unlawful discrimination, never cover the reason with a made-up one, never invent decisions such as "we chose another candidate" |

The probation reminder also says probation is set by the business, not by law, so it is not a legal deadline. `npm run test:unit` (free, no model calls) covers all of the code fixes.

Deferred to a later round (owner to decide, see the conversation of 2026-09-26):
- overseas employees are outside the scope;
- under-18 employees (state child employment laws, junior rates);
- the language of candidate-facing documents when the owner writes in Chinese.

### Round 2 (2026-09-26, from the core evaluation of 140 runs)

**Before the fixes:**
- **Overall:** 65% of runs passed both the hard checks and the judge.
- **The 11 regression scenarios:** from 6/46 before round 1 to 13/22.
- **The 10 held-out scenarios:** 12/20.
- **Two failure patterns fixed here:**
  - answering with only questions instead of doing the work;
  - leaving out deadlines the code already knew.

| Problem | Fix |
|---|---|
| **Only questions, no work** (offer letters, contract drafts, comparing two resumes, "when is final pay due") | `developer.md`, "Do the work first": deliver the draft, comparison or answer in the same reply. Gaps become placeholders, or a stated assumption about which rule applies (never about facts on a person). Then at most three questions. `employment-contract`: draft first, then list what is missing. `resume-screening` and `developer.md`: with no criteria, assess against labelled "criteria I assumed". `leaving_checklist`: if no reason is given, assume the likely one instead of asking |
| **Deadlines left out** (final pay within 7 days, super choice form by date) | `developer.md`, "Deadlines": state any known time limit, with the date. The `leaving_checklist` output says the final pay deadline must appear in the answer, and to pay off-cycle if the next pay run is too late. `list_employees` adds "when due" (with dates) for each starting document not recorded yet (`documentTiming()` in `reminders.ts`). `get_reminders` asks for each item's timing |
| **Casual leaving** (checklist said to pay out annual leave) | `leavingChecklist({casual})`: casuals have no paid annual or personal leave to pay out and no NES notice; long service leave may still apply (Fair Work, checked 2026-09-26). The tool takes `is_casual`; the register and `markLeft` pass it from the employment type |
| **FTCIS timing** | Given when the fixed-term contract is entered into (usually when signed), not when it starts (Fair Work, checked 2026-09-26) |
| Handover plans listed passwords; refused contract clauses were not flagged clearly | `offboarding`: never hand over passwords or shared logins. `employment-contract`: a refused clause is named at the top, before the draft |

**Check:** the same 19 scenarios × 2 (13 affected plus 6 controls where asking or refusing is right) went from 17/38 → 27/38. Every control still passed (setup interview, criteria confirmation, TFN refusal, prompt injection).

**What's left:** mostly legal knowledge gaps, for the owner to choose from. Examples:
- Payday Super;
- casuals' leave entitlements;
- the Small Business Fair Dismissal Code;
- procedural fairness in warning letters;
- state schemes.

### Round 3 (2026-09-26, legal knowledge)

Chosen by the owner from the round 2 list (★1-★5). Facts checked on ato.gov.au and fairwork.gov.au on 2026-09-26 (the Code from Fair Work's copy of the Small Business Fair Dismissal Code).

| Topic | Change |
|---|---|
| **Payday Super** (from 1 July 2026): super guarantee must reach the fund within 7 business days after payday (20 for a new employee's first contribution) | Leaving checklist: a separate super item with the deadline. The new starter item now cites the ATO's payment deadlines page. `developer.md`: never give the old quarterly due dates |
| **Casual leave entitlements** (NES): 10 days of paid family and domestic violence leave a year; 2 days of unpaid carer's leave and 2 of unpaid compassionate leave per occasion; unpaid community service leave | New starter checklist for casuals lists them. `developer.md`: never leave them out of a casual contract or answer |
| **Small Business Fair Dismissal Code** | Leaving checklist, reason "dismissal": with fewer than 15 employees (or unknown size, worded conditionally), except for serious misconduct: <br>• give a valid reason; <br>• warn, preferably in writing; <br>• let them respond; <br>• give a reasonable chance to improve; <br>• keep the evidence. <br>`developer.md` says so whenever an owner wants to dismiss |
| **Fair process in letters** | `developer.md` and `difficult-conversation`: the meeting invitation comes first (the concerns, no decision made, a chance to respond, a support person). The outcome letter is a separate draft for after their response. An apprentice stand-down doesn't change the training contract |
| **Unsupported impressions in reviews** | `performance-review`: only concerns with a work-related example go in. Impressions are listed as "needs an example before it can go in" |
| **Family and domestic violence leave on pay slips** | `developer.md`: must not appear on pay slips (record it as ordinary hours or another pay item). Keep it confidential and check payroll settings |

Core evaluation after round 3 (70 × 2, `eval/results/round3`): 106 of 140 runs pass both the hard checks and the judge (round 1: 91); stable failures 14 → 8.

### Round 4 (2026-09-26, from the round 3 evaluation)

| Topic | Change |
|---|---|
| **Deductions from pay** (Fair Work "Deducting pay", checked 2026-09-26): only with the employee's written agreement *and* mainly for their benefit, or when a law, an order, the award or a registered agreement allows it | `developer.md`: the rule, and that the business's own costs (breakages, repairs, till shortfalls, required uniforms or tools) can't be deducted even with written consent. `employment-contract`: no "with written consent" version of such a clause; a deduction for notice not given only if the award allows it. Round 2's "draft first" had turned "without lawful authorisation" into consent-based clauses (con-10: 2/2 → 0/2). Targeted re-run of the 6 deduction scenarios plus a contract control, × 2: 13/14 (con-10 2/2; the one fail is unrelated) |
| **Parental leave** (Fair Work parental leave pages and Services Australia's employer pages, checked 2026-09-26) | New `parental_leave_checklist(is_birth_parent, is_casual, start_date, expected_date)` (`src/business/parentalLeave.ts`), called by `developer.md` whenever an employee or their partner is expecting, on leave, extending or coming back. Items by stage (now, before, during, coming back), each with its official page: no discrimination or adverse action; safe job, no safe job leave and unpaid special parental leave (pregnant employee only); eligibility computed from the start date and the expected or actual birth date (12 months; casuals regular and systematic); notice (10 weeks, confirm 4 weeks before, evidence); 12 months unpaid plus a request for 12 more, flexible days (130 for a child from 1 July 2026); Parental Leave Pay (26 weeks from 1 July 2026, government-funded; the employer's Employer Determination, 14 days, PRODA, normal pay cycle); the ATO pays super on it; keeping in touch days (10), consultation, accrual; extensions (within 12 months by notice, beyond 12 months by request: written reply in 21 days, reasonable business grounds, what a refusal must contain); the return to work guarantee; breastfeeding. **Not eligible** (under 12 months of service): the NES-only items are left out and replaced by "leave by agreement or policy", and the tool text starts with that, because the model kept presenting NES rights anyway. The dated rules change on 1 July: re-check them then |
| **Apprentices** (DEWR, Fair Work, Safe Work Australia, Apprenticeships Victoria and Queensland pages, checked 2026-09-26) | New starter checklist for an apprentice or trainee: contact an Apprentice Connect Australia Provider first (they organise the training contract, lodge it for registration and explain incentives); the training contract signed and registered within the state's time frame (e.g. within 14 days of starting in Victoria and Queensland); training time is paid time, and many awards require reimbursing fees and textbooks. New option `works_on_construction_sites` (tool) / `constructionSite` (form): a White Card before the first day on site, for anyone, not only apprentices. `dewr.gov.au` added to `OFFICIAL_DOMAINS` |
| **Evaluation** | `tools` expectations accept alternatives (`"a|b"`): lv-09 and lv-17 pass with the parental leave checklist or official sources, off-03 with the leaving checklist or official sources (the checklists carry checked official links). lv-17 now describes an eligible employee (the register's Jess, 300 days' service, could not be on NES leave, so the scenario contradicted itself). Targeted re-run of 12 parental leave, apprentice and control scenarios × 2: 21/24 fully passing (onb-04 2/2, was 0/2 in round 3; con-05, r1-02 held), then lv-17 fixes: 1/2 (the miss left out the dispute process in a refusal) |
| **Shortened links** | The model often wrote the ATO leaving page without its `-your-business` ending (a dead link). The engine now corrects a tool URL cut at a hyphen in its last segment (`links_corrected`, see `docs/research.md`); other unknown links stay flagged |

### Round 5 (2026-09-27, alpha focus: hiring, onboarding, offboarding)

Evaluation of the 80 recruitment, screening, contract, onboarding, register, termination and offboarding scenarios × 2 (`eval/results/round5-alpha`): 94% of runs passed the hard checks, 81% the judge, 76% both; onboarding was weakest (63%).

| Topic | Change |
|---|---|
| **First employer registrations** (business.gov.au "Register for PAYG withholding", ATO "What is Single Touch Payroll", checked 2026-09-27) | `new_starter_checklist` has `first_employee`: register for PAYG withholding before the first pay you withhold tax from; STP Phase 2 payroll software (report each time you pay). The Staff add form sets it for the register's first employee |
| **Workers compensation** (business.gov.au "Types of business insurance", checked 2026-09-27) | On every checklist: cover in place before they start, from an authorised insurer under the state or territory scheme; for someone working in another state (e.g. from home), ask the insurer or that state's regulator which scheme covers them |
| **TFN declaration, the payer's part** (ATO "TFN declaration: payer information and obligations", checked 2026-09-27) | The item now says: they complete it (online, giving you the printed summary, or on paper); you enter the details and keep it securely; with STP you don't send it to the ATO; only a paper form without STP-enabled software needs Section B and posting within 14 days; the top rate after 28 days without a TFN |
| **Working holiday makers** (ATO "Working holiday makers", checked 2026-09-27) | `working_holiday_maker` (visa 417 or 462): register with the ATO as a working holiday maker employer before paying them, otherwise the higher foreign resident rates apply |
| **Right to work after recording documents** | `record_documents` now says what is still not recorded and asks the model to tell the owner; an unchecked VEVO for someone with a visa expiry is spelled out (check before their next shift). A New Zealand citizen counts as `may_need_visa_check` (usually a Special Category visa, checked in VEVO) |
| **Workers under 18** | `developer.md`: junior rates (a percentage of the adult rate, from the award) via the Pay and Conditions Tool, no dollar figure; state rules on employing young people checked through official sources before rostering |

Targeted re-run of the 9 scenarios behind these fixes × 2 (`eval/results/round5-fix-abcd`): judge 15/18, was 3/18 (onb-01, con-09, onb-03, onb-08, onb-12, reg-02, onb-11 now 2/2; scr-10 1/2; con-06 0/2: the contract draft still gave pay figures, fixed below).

Leaving and contracts (the owner reviewed each rule first, 2026-09-27; Fair Work pages checked 2026-09-27):

| Topic | Change |
|---|---|
| **NES notice on dismissal or redundancy** (Fair Work "Dismissal") | `leaving_checklist` (not casuals): the notice table by service, plus 1 week if over 45 with at least 2 years' service (unknown age: say so, don't assume); the award or contract may require more; pay in lieu includes loadings, penalties and allowances |
| **Genuine redundancy** (Fair Work "Redundancy") | The job no longer needed by anyone, the award's consultation requirements followed, redeployment considered; otherwise an unfair dismissal claim may be possible |
| **Unfair dismissal vs general protections** (Fair Work "Unfair dismissal") | Dismissal: unfair dismissal needs 6 months' service (12 for a small business employer); general protections and discrimination apply from day one |
| **Resignation** (Fair Work "Resignation") | An employer can't accept or reject a resignation; not working the notice: agree an earlier last day, or end it and pay the rest; withholding for short notice only if the award allows (most: up to a week, 18 or over), never from leave. Final pay: notice in lieu only when the employer ended the employment or the notice early |
| **Apprentices leaving** | The tool description asks for the checklist also when the owner is considering ending someone's employment (e.g. no-shows), and for `is_apprentice_or_trainee` from the register role; the apprentice items were already there |
| **Heat-of-the-moment resignation; references** (no official page: practice) | `developer.md`: check with them and give time to confirm, get advice, keep rostering and paying meanwhile (no unpaid stand-down). References: consent first, job-related facts only, never health or personal circumstances |
| **Contracts** (Fair Work "Annualised wage arrangements") | `employment-contract`: under 18 → a placeholder for the junior rate, no figure, and the state's rules; part-time → start and finish times and unpaid breaks so the hours add up; a salary covering overtime only as an annualised wage the award allows (named entitlements, hours covered, 12-monthly review and shortfall paid), checked by the profile's adviser |
| **Fixed-term extension** | `update_employee` adds the length from the start to the new end date against the 2-year limit (over it: get advice; under it: this is the one extension allowed), and asks the reply to state the limits, not just "comply with the limits" |

Targeted re-run of the 13 scenarios behind these × 2 (`eval/results/round5-fix-ef`): judge 19/26, was 10/26; all hard checks pass. reg-06 then 2/2 after the last change (`round5-fix-reg06`). Still 1 of 2: con-03 (hours vs breaks), term-04, term-06, term-09 (didn't draft the letter), term-12.

### Round 6 (2026-09-28, regression before 0.2.2)

The same 80 scenarios as round 5 × 2 (`eval/results/round6-regression`), after the evening of 2026-09-27 (email drafts, hiring actions for the adviser, new job, the app's today, Chinese replies) and 2026-09-28 (voice in the side panel, `ConfirmRequest.about`): 95% of runs passed the hard checks, 87% the judge, **83% both (round 5: 76%)**; 16 scenarios fixed, 10 worse, 7 of them contracts (judge 69%). One reply (1 of 600 runs in rounds 1, 3, 5 and 6) ended with the model's own planning notes; the rec-06 hard check caught it, the judge didn't.

| Topic | Change |
|---|---|
| **Contracts** (`employment-contract`) | Hours arithmetic (paid hours = time at work minus unpaid breaks; say so before the draft if they don't add up); weekends, public holidays, evenings and overtime paid at the award's rates, named in the pay clause, never one flat rate (except an annualised wage); notice and approval rules for annual leave only, never personal/carer's, compassionate or family and domestic violence leave; only listed policies named, never a rule presented as an existing policy; parental-leave cover: the early return doesn't end the fixed term by itself (an express early-termination clause, still some unfair dismissal risk, adviser check) and the fixed-term limits; deductions for notice not given only where the award allows, 18 or over, about a week, never under 18; no dollar amounts except the owner's rate |
| **Service facts on leaving** (Fair Work "Unfair dismissal", "Dismissal", "Redundancy pay and entitlements", checked 2026-09-27/28) | `leaving_checklist` takes `employee_id` (the register's start date and type win over what the model passes: a start year was misread), `start_date` for people not in the register, and `last_day`. For a dismissal or redundancy, code works out the service at the last day (or today), the NES minimum notice for it, NES redundancy pay (none under 1 year, with the date it becomes 4 weeks; most small business employers exempt) and when the unfair dismissal minimum employment period is reached (6 or 12 months; within 30 days: still a fair process, not timed to beat it), and asks the reply to use them as they are |
| **Working holiday makers' 6 months** (Home Affairs "Permission to work longer than 6 months with one employer", checked 2026-09-28) | `new_starter_checklist` for a working holiday maker: at most 6 months with any one employer (condition 8547), earlier work counts; check VEVO, note the end date, no longer without an exemption or permission |
| **Evaluation** | con-13 answers no to every register question (the assistant now offers the add after "he said yes", as a hire said in the chat; the second question got the runner's default yes); rec-09 accepts a curly apostrophe |

Re-runs: contracts, onboarding, termination and rec-06/09 × 2 (`round6-fix`): contracts 62% → 85% both (con-03, con-04, con-10, con-13 now 2/2); term-02 and onb-03 2/2. Termination × 2 after the service facts (`round6-fix2`): 83% both, all hard checks pass (term-05 back to 2/2). Onboarding × 2 (`round6-fix3`) stopped at the usage limit after 18 runs. Still open: a first day on a public holiday is not flagged (5 Oct 2026 is Labour Day in several states; the judge noticed it in some runs only); term-04 assumes which staff a store closure affects; term-09 restricts the support person and assumes an uncertain award; onboarding knowledge details (the TFN form's lodgement, casual conversion refusal grounds, the casual minimum engagement) vary between runs.

## 10 Tests

`npm run test:business`:

- **unit, profile:** validation, formatting, change lines, rendering with missing fields;
- **unit, drag and drop:** see `docs/files.md`;
- **live, no profile:** placeholders and the `/setup` tip;
- **live, setup interview:** a scripted owner answers 3 rounds, and the profile gets the name, NSW, casual, fortnightly and the signer, with the award not guessed;
- **live, the profile is used** in a new draft (business name and signer);
- **live, chat edits:** a change in the chat is saved after confirmation, and a declined change is not saved;
- **live, ER without an adviser:** Fair Work Infoline or a lawyer, plus the draft banner;
- **live, drag and drop:** a dropped resume is read, and a dropped roster screenshot (an image) is read.

`npm run test:hiring`:

- **unit:** the checklist per employment type: FWIS for all, CEIS only for casuals (both timing variants), FTCIS only for fixed-term, fixed-term limits, the part-time hours agreement, VEVO only when needed, TFN, super choice and stapled fund, pay slips and payday super, and all sources official;
- **live, casual offer and contract:** skill and checklist called, banner with the adviser's name, business details from the profile, CEIS and FWIS, the casual definition, the Pay and Conditions Tool, and no unverified or non-official links;
- **live, part-time new starter on a student visa:** VEVO, FWIS, no CEIS, TFN, super choice, hours in writing;
- **live, fixed-term contract:** FTCIS, and an unlawful "keep the last week's pay" clause is flagged and left out;
- **live, onboarding plan:** includes the compliance items.

`npm run test:register`:

- **unit:** validation (required fields, dates, types, TFN, date of birth and health words, unknown fields), outstanding documents per type, left status, and cascading delete;
- **live:** add a casual (confirmed, no visa date invented); record FWIS, CEIS and TFN with the date; refuse to store a TFN and date of birth, with a reason; add a visa holder with a 3-month probation (end date calculated); list outstanding paperwork; a declined change is not saved; mark someone as left; delete on request.

`npm run test:reminders`:

- **unit:** month arithmetic; CEIS due dates for both employer sizes; the employee choice date; recording a new CEIS clears the reminder; probation, visa and fixed-term windows; paperwork and super due dates; far-off dates and people who left are ignored; the 1 July reminder only in June and July;
- **live:** "what do I need to take care of?" is answered from `get_reminders` (probation, visa, paperwork).

`npm run test:award`:

- **unit:** the pay guard (flags hours × rate, rate × hours, totals and "you owe her $"; ignores quoted rates and hours without money);
- **live, office cleaner:** award-finder is loaded and researched, with the pay tools; the Cleaning Services Award, a level, the confirmation line, the Infoline, no pay arithmetic, and only official, verified links;
- **live, "how much for 6 hours on Sunday":** no arithmetic; the Pay and Conditions Tool with the Sunday penalty and casual loading to check;
- **live, recording the award and level** in the register, after confirmation;
- **live, café kitchen hand with no award in the profile:** a hospitality-type award, hedged ("likely"), with the confirmation line.

The other suites use a synthetic test business (`scripts/fixtures/business.ts`, "Wattle Lane Cleaning", with policy documents in `scripts/fixtures/policies/`) in a throwaway workspace.
