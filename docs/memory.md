# Memory system (as built)

This document describes what exists today and why. Update it when the implementation changes; do not add plans here.

## 1 What "memory" covers

Two independent dimensions:

- **What the content is:** facts about the business, user preferences, conversation history, people data.
- **How long it lives:** short-term (the current turn), session (one conversation), long-term (across conversations).

| | Short-term | Session | Long-term |
|---|---|---|---|
| Conversation | Model context for this turn | The thread, until `/new` | Stored threads (`/history`, `/resume`) and work notes |
| User preferences | "Keep this one short" | Stated earlier in the thread | `memory/users/<user>/preferences.jsonl` |
| The business | A policy read this turn | - | Business profile + `Policies/` (see `docs/business.md`) |
| People data (candidates, employees) | Pasted into the chat | - | **Never stored as memory.** The screening catalog (and later the employee register) hold it in the business workspace |

## 2 Storage

```
memory/users/<user>/              runtime; not in git
  preferences.jsonl               {id, text, source: explicit|proposed, createdAt}; max 20
  tasks.jsonl                     work notes {id, text, createdAt, expiresAt}; expire after 30 days
  sessions.jsonl                  this user's threads, for /history and /resume
codex_home/sessions/              Codex's own transcripts of every thread; deleted after 30 days
```

Facts about the business are not memory: they live in the business profile and the Policies folder of the business workspace (`docs/business.md`). The repo-level `knowledge/` folder (synthetic company data) was removed on 2026-09-25.

## 3 What the model sees in each session

Built per session and wired in `src/assistant.ts`:

```
base.md             behaviour and boundaries (replaces Codex's coding prompt)
developer.md        small-business HR adviser role and HR principles
This business       the business profile (src/business/profile.ts)
Business policies   index of Policies/ (src/business/policies.ts)
memory.md           rules for using the profile and policies, and for saving memory
user section        preferences (with ids) + up to 5 recent work notes (src/memory/context.ts)
tools               load_skill, read_policy, update_business_profile, remember, propose_memory, search_official_sources, file and screening tools
```

**Priority when sources conflict:** principles and boundaries > the law (official sources) > business profile and policies > user preferences > work notes.

Instructions are rebuilt on `/new`. Profile and policy changes and new memories therefore apply from the next conversation.

## 4 How memory is written

| # | Mechanism | Trigger | Code |
|---|---|---|---|
| 1 | Human edit | The owner puts policy documents in `Policies/`; the business profile is set up and edited through the chat (`docs/business.md`) | |
| 2 | Explicit | `/remember <text>`, or the user says "remember..." | The model calls the `remember` tool (`src/memory/tools.ts`). `/remember` goes through the model on purpose, so preferences that break the recruitment principles are refused |
| 3 | Proposed | The user states a lasting preference ("from now on...") or corrects the same thing twice | The model calls `propose_memory`. The CLI asks `[y/n]`; the preference is saved only on yes. At most one proposal per conversation |
| 4 | Session summary | `/new`, `/resume`, `/exit`, Ctrl+C at the prompt | `src/memory/summarize.ts` runs an ephemeral thread (never written to disk) with a JSON output schema. It saves up to 3 work notes, which expire after 30 days |

Guardrails on every write:

- A PII pattern check (email, AU phone number, TFN, "DOB") in `store.ts`. This is a backstop behind the model instructions, not a complete PII detector.
- A length limit of 300 characters.
- `replaces`: a conflicting preference replaces the old one instead of being added next to it.

## 5 Maintenance

| Memory | Owner | How |
|---|---|---|
| Business profile and policies | The owner | `/setup`, the chat, the Policies folder |
| Preferences | The user | `/memories`, `/forget <id>` |
| Work notes | Nobody; they expire | 30-day TTL |
| Stored conversations | Nobody; they expire | Deleted at startup after 30 days (`thread/delete`) |

## 6 Known limits

- Resuming a thread keeps the instructions it was started with; the Codex server ignores new developer instructions on `thread/resume`. The CLI prepends the user's current memory to the next message instead.
- `thread/list` returns every user's threads, so `/history` uses the per-user `sessions.jsonl` as the index.
- User identity is the OS user name or `--user`. There is no authentication. This is fine for the POC; replace it with SSO before real use.
- No RAG. Knowledge is "always injected + load on demand". Revisit when the total size makes that impractical.
- Legal and policy lookups go through the isolated research tool, not memory; see `docs/research.md`.

## 7 Tests

`npm run test:memory` runs store unit checks plus live checks:

- core fact recall
- a topic loaded on demand
- no invented company facts
- remember, and the preference applied in a new session
- a discriminatory preference refused
- a proposal declined, and a proposal accepted
- a summary saved without PII, and recalled in the next session
- resume
- per-user isolation

It uses a throwaway memory dir and synthetic users.
