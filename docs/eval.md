# Evaluation (as built)

The test suites (`npm run test:*`) check that features work: one run per case, mostly keyword checks. The evaluation measures **how good and how reliable** the assistant is for small business owners: many realistic requests, each run several times, graded by rules and by a stronger model.

## 1 Run it

```
npm run eval -- [--set core|regression|full] [--runs 2] [--concurrency 8] [--only <regex>] [--out eval/results/<name>] [--no-judge] [--rejudge-only]
npm run eval:report -- --out eval/results/<name>
npm run eval:compare -- --before eval/results/<old> --after eval/results/<new>
```

Runs use `codex_home_test/` (its own sign-in: `npm run login:test` once), not the owner's `codex_home/`, so eval conversations never appear in the chat history.

**Sets** (`eval/sets.ts`):

- **`core`** (the default): 70 scenarios × 2 runs = 140 conversations plus 140 judge calls: 60 stratified scenarios plus 10 held-out checks for the round 1 fixes (`eval/scenarios/round1.ts`, new situations of the same kind, so the fixes are tested for generality). Sized to finish within one Codex 5-hour usage window (owner, 2026-09-26). It includes every category and business, the high-risk areas, and the `regression` set.
- **`regression`**: the 11 scenarios that failed at least once in the first evaluation.
- **`full`**: all 210 scenarios, for occasional runs across several windows. The first attempt at 3 runs stopped at the usage limit after 114 runs.

**`--rejudge-only`** re-grades existing runs with the current judge and never starts new conversations, so an old baseline is not mixed with answers from newer code.

**`eval:compare`** compares the pass rates and average scores of the scenarios two runs share, and flags scenarios graded by different judges.

- **Uses the owner's ChatGPT quota:** each run is a real assistant conversation plus one judge call. No paid API key; voice is not included.
- **Resumable:** results are appended to `<out>/results.jsonl`, and finished runs are skipped when the same command is run again. Runs graded by a different judge model (or not graded, e.g. after a usage-limit error) are re-graded without re-running the conversation. After 5 usage-limit errors in a row, the runner stops and says so; run it again later.
- **Output:** `eval/results/` is gitignored. The report is `<out>/report.md`, with numbers in `<out>/summary.json`.

## 2 What is in it

| File | Contents |
|---|---|
| `eval/personas.ts` | 9 synthetic businesses (see below). Each has a profile, policy documents and starting staff in the register; staff dates are relative to the run date, so reminders stay realistic |
| `eval/scenarios/*.ts` | About 200 scenarios: owner messages (1–3 turns), optional Inbox files, answers to `[y/n]` confirmations, hard checks, and a rubric for the judge |
| `eval/run.ts` | The runner. Each run gets a fresh workspace (profile, policies, register, Inbox) and the same wiring as the CLI (`createAssistant`) |
| `eval/checks.ts` | Hard checks |
| `eval/judge.ts` | The judge prompt and schema |
| `eval/report.ts` | The report |

**Businesses:**

| Business | Details |
|---|---|
| Café | NSW, 9 staff |
| Plumber | VIC, 6 staff, apprentice |
| Surf retail | QLD, 14 staff, 2 stores, HR adviser |
| Physio clinic | WA, 22 staff (not a small business employer), lawyer, EAP |
| Accounting practice | SA, 5 staff; the owner often writes in Chinese |
| Landscaper | QLD, 12 staff, casuals and fixed-term |
| Hair salon | ACT, 7 staff, apprentice |
| Software company | VIC/NSW, 30 staff, salaried, EAP |
| Food truck | TAS, no profile yet |

**Categories:**
- setup;
- recruitment, screening, contracts, onboarding;
- register, reminders;
- award and pay, leave, policies;
- performance, discipline, termination, offboarding;
- wellbeing and WHS, fairness, privacy and safety, boundaries, general.

About 20% of the scenarios are in Chinese.

## 3 How a run is graded

**Hard checks** (deterministic):

- **Global, on every run:**
  - every turn answered;
  - no unverified links (a shortened tool link that the engine corrected does not count; the correction is listed in the run activity);
  - only official links;
  - no pay calculation (unless the scenario allows money arithmetic).
  - weekdays match dates (`src/business/weekdayGuard.ts`; from 2026-09-29, so earlier rounds didn't have it).
- **Per scenario:**
  - skills loaded, tools used or not used;
  - patterns the reply must or must not contain;
  - whether a confirmation was asked;
  - the workspace state afterwards (profile and register).

**Judge:** `gpt-6-sol` (medium reasoning; stronger than the assistant's `gpt-5.6-luna` and cheaper than `gpt-6-astra`, owner 2026-09-26; override with `EVAL_JUDGE_MODEL` / `EVAL_JUDGE_EFFORT`), in an isolated ephemeral thread with no tools and no web.

- **It sees:**
  - the date and the business summary and profile;
  - the register and policies at the start of the run;
  - the confirmation prompts;
  - the scenario rubric;
  - the transcript with tool activity.
- **It scores six dimensions from 1 to 5:** correctness, completeness, actionability, clarity, safety, grounding.
- **It fails a run** for any critical issue or any score of 2 or below.
- **Limits:** it has no web access, so it may not know figures from after its training. It is told not to mark those down but to list them as "unverified". It also sees the register at the start; without that, it once flagged a document as missing when it had been recorded.

**Stability:** per scenario, all runs pass = "stable pass", some pass = "flaky", none pass = "stable fail".

## 4 Rules for scenarios

- A hard check must never fail a good answer. Use skills, tools and state checks, plus broad patterns only for things every good answer must contain (e.g. the DRAFT banner). Quality is left to the judge.
- Everything is synthetic, and persona data is marked as synthetic. The product code is frozen while an evaluation runs: findings go into the report first, then fixes are made, and the evaluation is run again to compare.
