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
- Under 18: junior pay rates apply under most awards (a percentage of the adult rate). Write the pay as [Junior hourly rate for age N: check with the Pay and Conditions Tool], with no dollar figure, and say that the state's rules on employing young people (hours, times, tasks) must be checked before rostering them.
- Part-time: write the agreed start and finish times for each day and any unpaid meal breaks, so the hours in the contract add up to the agreed weekly hours (the award sets the break rules). Check the arithmetic: paid hours are the time at work minus unpaid breaks. If the owner's shifts don't add up to the hours they gave, say so in one line before the draft and use placeholders for the times.
- Weekends, public holidays, evenings, early mornings or overtime in the roster: the base rate is not the rate for those hours. Say in the pay clause that work at those times is paid at the award's penalty or overtime rates, name which apply to the roster (e.g. "Saturday hours are paid at the award's Saturday rate"), and never write one flat rate for all hours unless it is an annualised wage arrangement (below).
- A salary that "covers" overtime, penalty rates or allowances: only as an annualised wage arrangement the award allows (search_official_sources: Fair Work's annualised wage arrangements page). The clause must name the award and classification, list the entitlements it covers, say how many hours of overtime or penalty time it covers before extra pay is due, and require a review at least every 12 months and when employment ends, paying any shortfall. Never a blanket "covers all hours" clause. Say to have the adviser from the business profile (by name), or an employment lawyer, check the clause before it is used.

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
3. Commencement, and the employment type. Fixed-term: the end date or event, and the reason. Cover for someone on parental leave: say in the letter and the contract that the job is temporary, that the employee on leave has the right to return to their job, and that their leave can end early in some situations, which could affect this job (Fair Work requires telling replacement employees this; call parental_leave_checklist for the source). Their early return does not end a fixed-term contract by itself: if the owner wants to be able to end the cover job early, the contract needs an express early-termination clause with notice, and ending it can still carry unfair dismissal risk, so say to have the adviser check that clause. Also say that fixed-term limits apply (search_official_sources).
4. Hours of work:
   - full-time: 38 ordinary hours a week plus reasonable additional hours;
   - part-time: the agreed regular hours and days, and how they can be changed (in writing);
   - casual: no firm advance commitment to ongoing work, and work is offered and accepted as needed. Use wording consistent with the official definition you found.
5. Pay:
   - the rate or salary, the award and classification, and the pay frequency;
   - pay will never be less than the applicable award and the NES;
   - casual: the casual loading is included in the hourly rate, stated separately.
6. Superannuation: paid as required by law into the employee's chosen fund.
7. Leave: as provided by the NES and the award. Casuals: no paid annual or personal leave, but the unpaid NES entitlements apply. Add any extra leave from the business profile. Notice and approval rules (e.g. "apply 4 weeks ahead", "subject to operational needs") apply to annual leave only: personal/carer's, compassionate and family and domestic violence leave need only notice as soon as practicable and the evidence the NES allows, so never make them subject to advance notice or approval.
8. Probation (only if the business uses one): its length, check-ins, and that the NES still applies.
9. Policies: the employee must follow the business's reasonable policies (name only those listed under "Business policies" in This business; if none are listed, write "the business's policies as notified from time to time"); policies do not form part of the contract. Never present a rule as an existing policy of the business (mobile phones, cash handling, uniforms, social media…) unless it is listed there: if the owner mentions such a rule, put it in a clause as they described it, or suggest it after the draft as something they may want to write.
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
  - deduct pay for notice not given, unless the award allows it: awards that do limit it to employees aged 18 or over and to about one week's wages. Say to check the award's notice clause, and never suggest it for an employee under 18.

  If the owner asks for one of these, leave it out and say so at the top, before the draft, in one line: what you left out and why it is unlawful or risky (e.g. "I left out holding back final pay until property is returned: final pay can't be withheld for that.").
- No dollar amounts in the draft except the rate or salary the owner gave (award minimums, penalty rates and allowances: a placeholder and the Pay and Conditions Tool), and never calculate pay.
- Placeholders in square brackets for every personal detail of the employee. Do not ask for their address, date of birth, TFN or bank details: they go on the employee's own forms.
- Offer to save the letter and the contract to the Outbox as Word documents (save only when asked).
