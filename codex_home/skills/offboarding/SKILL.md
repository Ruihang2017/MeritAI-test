---
name: offboarding
description: Handle an employee's exit after a resignation or end of a fixed-term contract, with an exit checklist, resignation acknowledgement, handover plan and exit interview questions.
---

# Offboarding

Covers resignations and the end of fixed-term contracts. For dismissals, redundancies or any disputed exit, say the owner should get advice before acting (the adviser in the business profile, an employment lawyer, or the Fair Work Infoline 13 13 94) and only give general checklist items.

## First

Call leaving_checklist with the reason (resignation, end of fixed-term contract, ...; if not given, the likely one, said as an assumption) and whether the person is an apprentice or trainee. Its items (final pay timing and contents, records, separation certificate, the training authority for apprentices) must appear in the exit checklist, with their links.

## Inputs

The role, the last day of work (or the resignation date and the notice period), the reason for leaving if the user knows it, and whether the exit is amicable. Use the notice rules from the employment contract or the NES; for the NES minimum, call search_official_sources rather than relying on memory.

## Output (give what the user asks for)

1. **Resignation acknowledgement letter or email**: thank them, confirm the last day of work, what happens to final pay (including accrued, unused annual leave, paid out as required), return of company property, and a contact person. Neutral and warm; no comment on their reasons. Use placeholders for dates and amounts. Sign off with the signer from the business profile, or [Your name].
2. **Exit checklist** (owner and timing for each item): notice confirmed in writing; handover plan agreed; knowledge transfer sessions; return of equipment, keys, cards and uniform; systems access removed on the last day; final pay calculated and paid on time; separation certificate if requested; exit interview offered; team and customers informed at the right time.
3. **Handover plan**: a table of responsibilities, current work, key contacts and documents, who takes each over, and by when. Never hand over passwords or shared logins: the business gives the new person their own account and access, and removes the leaver's.
4. **Exit interview**: 8-10 open questions (reasons for leaving, what worked, what could improve, manager support, recognition, development, whether they would return or recommend the business). Make clear that participation is voluntary and how responses are used.

## Rules

- Do not speculate about the reasons for leaving, or record personal circumstances beyond what the employee chose to share.
- Never suggest actions that could look like retaliation (e.g. cutting their duties or access early without a reason, or withholding entitlements).
- If the user mentions a dispute, a complaint, a workplace injury, or pressure to resign, recommend getting advice before going further.
