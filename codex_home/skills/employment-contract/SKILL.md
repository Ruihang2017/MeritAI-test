---
name: employment-contract
description: Draft a letter of offer and a written employment contract for a new employee (full-time, part-time, casual or fixed-term), filled in from the business profile, together with the new starter compliance checklist. Use when the owner is making someone an offer or asks for a contract.
---

# Letter of offer and employment contract

The owner is hiring and has no HR team or lawyer on hand. Give them a clear, fair draft they can check and use, plus everything they must do around it.

## 1 The terms (draft first; list what is missing after the draft)

Do not hold the draft back to ask for these. Draft with what you have, using a placeholder for each missing term, and after the draft list the missing terms in one short numbered list.


- Role title, and the main duties in a line.
- Employment type: full-time, part-time, casual or fixed-term.
  - Part-time: the regular hours and days.
  - Fixed-term: the end date, or the end of the task or season.
- Start date and place of work.
- Pay: the hourly rate or annual salary. Also the award and classification level, if they know them.
- Probation length, if the business uses one (check the profile and policies first).
- Anything special: licences, uniforms, tools, travel.

Take the business details (legal name, ABN, address, signer, pay frequency, super arrangements, benefits and rules) from "This business". Use placeholders for anything not recorded. Never invent a pay rate, award or classification: if they are unknown, write [Award] and [Classification level] and [Hourly rate: check with the Pay and Conditions Tool].

## 2 Check the rules before drafting

- Call new_starter_checklist for the employment type. Set may_need_visa_check to false only if the owner said the person is an Australian citizen or permanent resident. Set is_apprentice_or_trainee for an apprentice or trainee.
- Apprentices and trainees: besides the employment contract, a training contract must be signed and registered with the state training authority (the checklist names it). Say so at the top, use the award's apprentice pay provisions (from official sources), and make the probation clause defer to the training contract.
- Call search_official_sources for rules the contract must get right for this employment type, when relevant: e.g. the definition of casual employment and casual conversion, part-time hours rules, the fixed-term limits, the notice periods under the NES. Keep the question general, with no personal details.
- If the owner gives a pay rate and an award, do not state that it is compliant; say to check it with the Pay and Conditions Tool.

## 3 Output

Start with this line, exactly:

"DRAFT: not legal advice. Check the award, classification and pay rate with the Fair Work Pay and Conditions Tool, and have your HR adviser or an employment lawyer review it before it is signed."

If the profile names an adviser, add their name to that line.

**Letter of offer** (short, warm, one page):
- the offer: role, type, start date, place;
- the pay and how often it is paid;
- that the attached contract sets out the terms;
- how to accept, and by when [Acceptance date];
- the documents they will receive (the information statements from the checklist);
- the signer from the profile.

**Employment contract**, with numbered clauses in plain English:
1. Parties: business legal name, ABN and address; [Employee name] and [Employee address].
2. Position and duties; reporting to [Manager]; the place of work.
3. Commencement, and the employment type. Fixed-term: the end date or event, and the reason.
4. Hours of work:
   - full-time: 38 ordinary hours a week plus reasonable additional hours;
   - part-time: the agreed regular hours and days, and how they can be changed (in writing);
   - casual: no firm advance commitment to ongoing work, and work is offered and accepted as needed. Use wording consistent with the official definition you found.
5. Pay:
   - the rate or salary, the award and classification, and the pay frequency;
   - pay will never be less than the applicable award and the NES;
   - casual: the casual loading is included in the hourly rate, stated separately.
6. Superannuation: paid as required by law into the employee's chosen fund.
7. Leave: as provided by the NES and the award. Casuals: no paid annual or personal leave, but the unpaid NES entitlements apply. Add any extra leave from the business profile.
8. Probation (only if the business uses one): its length, check-ins, and that the NES still applies.
9. Policies: the employee must follow the business's reasonable policies (name those listed under "Business policies"); policies do not form part of the contract.
10. Confidentiality and business property.
11. Ending employment: notice by either party as required by the NES and the award (no less than the NES minimum); summary dismissal for serious misconduct; return of property; final pay.
12. Casual employees: their rights under the casual employment rules, including the pathway to permanent employment, as described in the CEIS.
13. Entire agreement, and changes only in writing; the law of the state where they work.
14. Signatures: the signer from the profile, and the employee, with dates.

**After the contract**, add a short "Before they start" section:
- the checklist from new_starter_checklist, grouped by timing, with its links;
- that the business.gov.au Employment Contract Tool can build an official award-based contract for hourly or weekly paid employees, if they prefer that.

## Rules

- Fair and lawful terms only. Never draft clauses that:
  - pay below the award;
  - remove NES entitlements;
  - make a casual a "casual" in name only (fixed regular hours with a firm commitment);
  - hold back final pay;
  - impose unreasonable restraints;
  - deduct from pay, or charge the employee, for the business's own costs (breakages and repairs, till shortfalls, uniforms or equipment the job requires). Written consent does not make these lawful (see "Deductions from pay" in your instructions), so do not offer a "with the employee's written consent" version;
  - deduct pay for notice not given, unless the award allows it (some do, with limits): say to check the award's notice clause.

  If the owner asks for one of these, leave it out and say so at the top, before the draft, in one line: what you left out and why it is unlawful or risky (e.g. "I left out holding back final pay until property is returned: final pay can't be withheld for that.").
- Placeholders in square brackets for every personal detail of the employee. Do not ask for their address, date of birth, TFN or bank details: they go on the employee's own forms.
- Offer to save the letter and the contract to the Outbox as Word documents (save only when asked).
