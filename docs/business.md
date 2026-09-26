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

| Reminder | When it shows | Rule (checked 2026-09-25) |
|---|---|---|
| Starting paperwork not recorded | From the start date (super choice alone: 28 days after the start) until it is recorded | Information statements and TFN by the start; super choice within 28 days |
| Probation ends | 14 days before the end, and up to 21 days after | Confirm the outcome in writing |
| Visa / work rights expire | 30 days before | Re-check VEVO |
| Fixed-term contract ends | 28 days before | Renew (within the limits) or end it |
| CEIS again (casuals) | On the due date, until a newer CEIS is recorded | Small business employer (headcount under 15): after 12 months. Otherwise: after 6 and 12 months, then every 12 months |
| Casual may ask to become permanent | At 6 months (12 for a small business employer) | Employee choice pathway; the employer must respond in writing within 21 days |
| New minimum wages and award rates | From 15 June to mid-July | From the first full pay period on or after 1 July |

- Reminders are due within 30 days or overdue, and sorted by date. People who have left are ignored.
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
