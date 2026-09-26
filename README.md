# FX Chatbot (HR assistant POC)

An HR adviser for **small business owners with no HR department**, as a CLI and as a browser UI (MeritAI, `npm run ui`). It tells them what to do and does as much of the work as it can. The AI engine is a local `codex app-server` with its own isolated configuration, running on the owner's own ChatGPT account. This is a proof of concept, tested internally by the HR team playing small business owners.

## What it helps with

| Area | How |
|---|---|
| Your business | `/setup`: a 3-minute interview that builds the business profile (name, states, employment types, awards, pay, benefits and rules, who signs letters, your HR or legal adviser). Your own policies go in `files/Policies` |
| Recruitment | `job-description`, `resume-screening`, `interview-kit`, `candidate-email`; bulk screening of a job folder (results in the chat; Word or Excel report on request) |
| Hiring | `employment-contract`: letter of offer + employment contract (full-time, part-time, casual, fixed-term) from the business profile, marked DRAFT; the new starter compliance checklist (information statements, TFN, super, right to work, pay records) with official links |
| Onboarding | `onboarding-plan` (includes the compliance checklist) |
| Reminders | Worked out from the register: paperwork not recorded, probation ends, visa expiries, fixed-term ends, casual information statements and the right to ask for permanent work, 1 July wage changes |
| Employee register | Who works here: role, type, dates, award, probation and visa expiry, and which starting documents they have received (no TFN, bank, address, date of birth or health data) |
| Performance | `performance-review` (with a bias check on wording) |
| Difficult conversations / ER | `difficult-conversation`: process guidance only; says where to get advice (your adviser, an employment lawyer, the Fair Work Infoline). Decision letters are marked DRAFT |
| Offboarding | `offboarding` |
| Award and pay | `award-finder`: the likely award and classification with reasons and official sources, plus the Fair Work tools to confirm pay. It never calculates pay: a warning shows if a reply contains pay arithmetic |
| Policy and law questions | Your business profile and policies, plus official Australian government sources |

## Run

```
npm install
npm run login        # first time only: device-code login for the chatbot's own account
npm start            # chat; on the first start it offers the business setup interview
npm start -- --user sarah --tier standard
```

Environment variables:

| Variable | Meaning |
|---|---|
| `FX_USER` | Same as `--user` |
| `FX_TIER` | `fast` (default) or `standard` |
| `FX_DEBUG=1` | Show Codex logs and token counts |
| `FX_SCREEN_LIMIT` / `FX_SCREEN_CONCURRENCY` | Resumes screened per run / in parallel (both default 20) |
| `FX_VOICE_IDLE_SECONDS` | Voice mode stops by itself after this much silence (default 60) |
| `OPENAI_API_KEY` | Log in with an API key instead of ChatGPT |

### Browser UI (MeritAI)

The same assistant in the browser, on this computer only (see `docs/ui.md`):

```
npm run ui:build     # once, and after UI changes
npm run ui           # real engine: opens http://127.0.0.1:<port>/?t=<one-time key> (same account, memory and workspace as the CLI)
npm run ui:fake      # demo: scripted replies, no model and no quota, a separate demo workspace with synthetic data
npm run ui:dev       # UI development: hot reload, fake engine
```

Demo options: `FX_FAKE_SIGNED_OUT=1` starts signed out (the first-run screens); `npm run ui:fake -- --fresh` starts from an empty workspace. Voice is not in the browser UI yet.

Voice mode reads `.env` (copy `.env.example`): `VOICE_OPENAI_API_KEY`, `VOICE_MODEL` (default `gpt-live-1`), `VOICE_NAME` (default `gleam`). It needs `ffmpeg` and `ffplay` on PATH. Voice is billed per minute to that key; it is not part of the ChatGPT subscription.

## Chat commands

| Command | What it does |
|---|---|
| `/help` | List commands |
| `/setup` | Set up or update the business profile (a short interview) |
| `/profile` | Show the business profile and the policy documents |
| `/reminders` | Compliance reminders due in the next 30 days or overdue (also shown at startup) |
| `/staff [all]` | List the employee register (`all` includes people who left). Add or change people by telling the assistant; every change is confirmed |
| `/new` | Start a new conversation (saves work notes from the current one) |
| `/history` | List your earlier conversations |
| `/resume <n>` | Continue conversation n from `/history` |
| `/skills` | List skills |
| `/<skill> <request>` | Use a skill explicitly; a unique prefix is enough (e.g. `/int`). Skills are also chosen automatically |
| *drag a file in* | Drag files (PDF, DOCX, TXT, MD, images) into the window: they are copied to the Inbox and attached to your message. Dragging a folder offers to import it as a job |
| `/files` | List your Inbox and show the Jobs/Inbox/Outbox/Policies folders |
| `/files open` | Open the folder in Explorer |
| `/files set <path>` / `/files reset` | Use another business workspace folder / back to the default (`<project>/files`) |
| `/jobs` | List job folders (one per role under `files/Jobs`) |
| `/import <path> [job]` | Copy a folder of resumes (and a JD file) into a job; the job defaults to the folder name |
| `/screen <job>` | Screen a job: draft criteria from its JD file, confirm `[y/n]`, screen up to 20 new resumes, show results in the terminal |
| `/report <job> [word\|excel\|both]` | Save a screening report to the Outbox (Word by default) |
| `/remember <text>` | Save a lasting preference |
| `/memories` | Show your preferences and work notes (with ids) |
| `/forget <id>` | Delete a preference or note |
| `/voice` | Talk instead of typing (GPT-Live); press Enter or Ctrl+C to stop. Headphones recommended |
| `/voice device [n]` | List microphones / pick one |
| `/tier fast\|standard` | Switch speed tier from the next message |
| `/exit` | Quit (saves work notes) |

**Ctrl+C:** while the assistant is replying, it stops the reply; at the prompt, it quits.

## Where to change things

| To change | Edit |
|---|---|
| Facts about the business | `/setup` or tell the assistant in the chat (stored in `files/.assistant/business.json`) |
| The business's own policies | Put documents in `files/Policies/` (PDF, DOCX, TXT, MD) |
| Assistant behaviour | `prompts/base.md` (style, boundaries), `prompts/developer.md` (small-business HR adviser role, HR principles), `prompts/memory.md` (profile, policy and memory rules) |
| Skills | `codex_home/skills/<name>/SKILL.md` |
| Model, sandbox, disabled Codex features | `codex_home/config.toml` |
| Official websites allowed for legal lookups | `OFFICIAL_DOMAINS` in `src/research/officialSources.ts` |

Changes take effect from the next conversation (`/new`) or the next start.

## Tests

These run against the real model and use synthetic data only. Apart from `test:business`, the suites use a synthetic test business (`scripts/fixtures/business.ts`).

Tests, `npm run eval` and the `ab:*` experiments use their own engine folder, `codex_home_test/` (gitignored), so their conversations never mix with yours. It has its own sign-in: run `npm run login:test` once (same account, a second device login). Our `config.toml` and skills are copied into it from `codex_home/` on every run.

| Command | Covers |
|---|---|
| `npm run e2e` | Streaming, multi-turn, interrupt, no command execution |
| `npm run test:business` | Business profile (setup interview, used in drafts, chat edits with confirmation), no-profile placeholders, advice referral without an adviser, drag and drop (files and images) |
| `npm run test:hiring` | New starter checklist per employment type, offers and contracts (banner, profile details, information statements, unlawful clauses refused), onboarding compliance |
| `npm run test:register` | Employee register: validation, add / update / record documents / leave / delete via the chat with confirmation, sensitive data refused |
| `npm run test:reminders` | Reminder date rules (CEIS, employee choice, probation, visa, fixed-term, paperwork, 1 July) and the owner asking what to do |
| `npm run test:award` | Award and level with reasons, no pay calculations (plus the client-side guard), recording the award, a café with unclear coverage |
| `npm run test:skills` | Skill routing, fairness in screening, no invented company claims, profile signer |
| `npm run test:memory` | Profile facts, policies on demand, preferences, proposals, session notes, resume, user isolation |
| `npm run test:screening` | Bulk screening: blind masking, ingest/dedupe, criteria confirmation, ranking, results in chat, Word/Excel on request, cache, batch limit, chat flow, retention |
| `npm run test:hr` | Onboarding, performance (bias), ER advice referral, termination drafts, wellbeing, policy + law, no names in notes |
| `npm run test:voice` | GPT-Live delegation to the HR assistant with synthetic speech (EN + ZH, follow-up, small talk); needs the voice key; **costs about US$0.10 per run** (prints the billed seconds) |
| `npm run test:files` | Inbox/Outbox guards, PDF/DOCX/TXT/MD parsing, docx output, screening from files, injection in documents |
| `npm run test:research` | Official-source lookups, domain allowlist, no URLs from memory, prompt injection |
| `npm run inspect` | Which skills, plugins, MCP servers, apps and features Codex exposes |
| `npm run test:unit` | Free unit checks (no model calls): apprentices, leaving checklist, fixed-term notes, reminder wording, small business status |
| `npm run typecheck` | Type check |

After upgrading `codex`, run `npm run gen:protocol`, then all of the above.

**Evaluation** (quality and reliability, not just "does it work"): `npm run eval` runs the core set (70 realistic owner scenarios across 9 synthetic businesses, 2 runs each, sized for one Codex 5-hour window) with hard checks and a stronger model as judge; `npm run eval:report` writes the report and `npm run eval:compare` compares two runs. The full set has 210 scenarios. Uses the ChatGPT quota; resumable. See [docs/eval.md](docs/eval.md).

## Data

- **`files/`** is the business workspace: Jobs, Inbox, Outbox, Policies, and `.assistant/` with the business profile, the screening catalog and the employee register.
- **`memory/`** holds per-user memory.
- **`codex_home/sessions/`** holds conversation transcripts, which are deleted after 30 days (the list of them is read from Codex's own index, `codex_home/state_5.sqlite`). Test and eval conversations go to `codex_home_test/` instead.

All three are local and not in git. The chatbot is currently logged into a personal ChatGPT account, so **do not paste real candidate or employee data** until it uses an approved account.

Australian employment law questions (pay, awards, leave, notice, visas, privacy, discrimination, WHS) are looked up on official government websites and answered with sources. This takes about 15-25 s.

**Jobs and files:** put each role's resumes (any subfolders; PDF, DOCX, TXT, MD) in `files/Jobs/<job>/`, optionally with a JD file named `JD...`, then ask "screen the <job> applicants" or run `/screen <job>`. You can also drag the folder into the chat. You confirm the criteria first, and the results appear in the chat. Ask for a report (Word by default, Excel on request) and it is saved to `files/Outbox`. Loose documents go in `files/Inbox`, or drag them into the chat. Nothing is ever overwritten.

Design notes: [docs/architecture.md](docs/architecture.md), [docs/business.md](docs/business.md), [docs/screening.md](docs/screening.md), [docs/memory.md](docs/memory.md), [docs/research.md](docs/research.md), [docs/files.md](docs/files.md), [docs/voice.md](docs/voice.md). Step-by-step manual test: [docs/manual-test.md](docs/manual-test.md).
