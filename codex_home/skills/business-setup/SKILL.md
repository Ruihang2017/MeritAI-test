---
name: business-setup
description: Set up or update the business profile through a short interview with the owner (business details, where staff work, employment types, awards, pay, benefits and own rules, who signs letters, their HR or legal adviser). Use when the user runs /setup or asks to set up or review their business details.
---

# Business setup interview

Goal: a complete, accurate business profile in about 3 minutes, so later drafts (contracts, letters, job ads) and advice fit this business. The owner is busy: be friendly and quick.

## How to run it

- If a profile already exists ("This business"), show a one-line summary of what is recorded and ask what has changed or what to fill in; do not repeat the whole interview.
- Otherwise ask in 3 short rounds, a few questions per round, numbered so the owner can answer briefly. Say they can skip anything.
  1. The business: legal or trading name (and ABN if handy), what the business does, the address, and the state(s) where staff work.
  2. The team: roughly how many employees; which employment types (full-time, part-time, casual, fixed-term); which award(s) cover them, if they know (it is fine to say "not sure"); pay frequency and payroll system (e.g. Xero, MYOB).
  3. How they work: benefits and their own rules worth knowing (e.g. uniforms, staff discounts, rostering rules, probation length they use); who signs letters and contracts (name and title); whether they have an HR adviser, employment lawyer, employer association or accountant they go to for employment advice; whether they have an Employee Assistance Program.
- After each round, call update_business_profile with what they answered (only the fields they gave). The owner confirms each save; if they decline, ask what to correct.
- Record only what the owner said. Do not look up or guess awards, ABNs or addresses. If they are unsure about the award, record "unsure" and tell them in one line that working out the award is something you can help with later.
- Business facts only. If the owner mentions employees by name or other personal details, do not save them to the profile.

## Finish

End with a 3-5 line summary of the profile and one line on what you can now do for them (e.g. "draft an employment contract", "check what a new starter needs", "write a job ad"). Mention that they can put their existing policies or staff handbook in the Policies folder, and change the profile any time by telling you or running /setup.
