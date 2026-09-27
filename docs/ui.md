# Browser UI (MeritAI, as built)

The same assistant as the CLI, in the browser, on this computer only. Built on 2026-09-26/27 (plan: `docs/plans/frontend.md`; design: `docs/plans/ui-design.md` and the design canvas). No desktop shell yet (Electron or Tauri comes later and reuses all of this).

```
browser  http://127.0.0.1:<port>/?t=<token>
  web/          React 19 + TypeScript + Vite; plain CSS with the canvas tokens (web/src/tokens.css)
     │  one WebSocket (/ws), JSON messages; types in src/server/protocol.ts (the web app imports types only)
src/server/     main.ts (start), server.ts (HTTP + WebSocket, local security), session.ts (method allowlist → AssistantApp)
     │
AssistantApp (unchanged layering: behaviour stays in the app layer, the UI only renders)
     │
engine: codex app-server (default) or FakeEngine (FX_ENGINE=fake / --fake)
```

## 1 Run

| Command | What |
|---|---|
| `npm run ui:build` | Builds `web/` into `web/dist` (needed before `npm run ui`) |
| `npm run ui` | Real engine; same user, memory and workspace as the CLI (`--user`, `FX_USER`, `--tier`, `FX_TIER` as in the CLI); opens the browser |
| `npm run ui:demo` | Real engine on the demo workspace (`workspace-demo/Wattle Lane/`, `memory-demo/`, gitignored, user `demo`), seeded on first use with the design canvas's sample data (`scripts/fixtures/demo.ts`, synthetic): the Wattle Lane Cleaning profile, 9 staff + 1 left, 3 policies, Inbox and Outbox files, three jobs (Team leader screened: 13 ranked, 1 unreadable, 1 duplicate; Weekend cleaner with criteria to confirm; Office admin without a JD) and 3 preferences + 3 work notes. The design assumes today is 26 Sep 2026, so the dates are absolute. Conversations are not seeded (they only come from real chats). Uses the Codex quota |
| `npm run ui:fake` | Fake engine on the same demo workspace (no model, no quota) |
| `npm run ui:dev` | Vite dev server with hot reload (5173) proxying `/ws` to the server (5174), fake engine |

Options: `--no-open`, `--port <n>`; demo: `--reseed` (back to the design's sample data), `--fresh` (an empty demo workspace, for the first-run screens), `FX_FAKE_SIGNED_OUT=1` (start signed out), `FX_FAKE_DELAY_MS` (streaming speed; tests use 0–2).

## 2 Local security

Other web pages in the same browser can reach `localhost`, so the server:
- listens on 127.0.0.1 only;
- makes a random token at each start; the socket needs it (`/ws?t=`). The page moves it from the address bar to `sessionStorage`;
- accepts the socket only from its own Origin (or the Vite dev server in dev mode) and only with Host `127.0.0.1` or `localhost` (DNS rebinding);
- answers only allowlisted methods, with parameters checked (ids, document ids, leaving reasons, job names, sizes); business checks stay in the app layer;
- serves static files only from `web/dist` (no path traversal), with a Content Security Policy (`self` only, plus Google Fonts), `nosniff`, no referrer, no framing.

Markdown in replies is rendered without raw HTML or images. Only links to official sites (`OFFICIAL_DOMAINS`, sent in the state) that were not flagged are clickable (new tab, `noopener`); other links show their text and real site, not clickable, so a link planted through a resume cannot pass as a source. The source chips list official links only. "Open" starts documents, images and folders only (never shortcuts or programs in the workspace); "Show in folder" works for any file. The Vite dev server serves only `web/` and denies `codex_home`, memory, workspaces and sqlite files.

**Switching conversations:** the UI starts a new conversation or opens an earlier one at once; the work notes of the one it leaves are written in the background (a model call of several seconds; the CLI still waits for them and prints them). A conversation can be open in one place only: if the CLI (or another UI) has it open, opening it here says so instead of the engine's "active writer" error.

**Consistency:** one operation at a time (a reply, screening, an import, a report, switching conversation or workspace, sign-in); another is refused with what is running. Each question says where it came from: a reply (its turnId; a card in that reply) or a form action (a dialog); answers are broadcast (`confirmAnswered`) so other tabs close them. A receipt shows only when the tool reports that kind of save; a "yes" with no save reported says so, not "Saved". After a page reload the running reply is followed again (Stop works) and its full text is reloaded when it ends. Removing an attachment chip takes the file off the next message (`detach`).

## 3 Protocol (`src/server/protocol.ts`)

Requests `{id, method, params}` → `{id, result}` or `{id, error}`. Pushed events:

| Event | When |
|---|---|
| `turn {turnId, ev}` | Every `AppEvent` of a reply; the UI chooses the `turnId` (so no event arrives before it knows it) |
| `turnDone {turnId, error?}` | The reply ended |
| `confirm {id, req}` / `confirmWithdrawn {id}` | A structured question (`ConfirmRequest`); answered with `answerConfirm`. During a reply it is a card in it; otherwise (delete, screening criteria) a dialog |
| `progress {message}` | Long work (screening, imports) |
| `login {url, code, message}` | Sign-in: the device-code link and code, parsed from the engine's prompt |

Methods: `state` (shell snapshot: account, business, workspace, busy, attention counts, usage limit, open questions), `send` (`mode: "setup"` runs the setup interview), `stop`, `answerConfirm`, `newConversation`, `history`, `resume`, `transcript`, `reminders`, `skills`, `attach`; Staff: `staff`, `addEmployee`, `updateEmployee`, `recordDocuments`, `markLeft`, `removeEmployee`; Hiring: `jobs`, `createJob`, `screen`, `screenResults`, `report`; `files`, `profile`, `updateProfile`, `memories`, `forget`, `settings`, `setTier`, `setWorkspace`, `login`, `openFile`, `revealFile`.

## 4 Pages

| Page | What it does |
|---|---|
| Conversations | Streaming markdown; the steps of a reply; confirm cards with receipts; official sources as chips; warnings (pay calculation, unverified links), errors, usage limit; stop (Esc); new conversation; history and resume (earlier messages shown again, also after a page reload); attachments (button or drag and drop into the Inbox); guides picker; "a change is waiting" when sending over an open card |
| All conversations | Search by title, grouped Today / This week / Earlier; opening one resumes it with its messages |
| Attention | Reminders panel (≥ 1280 px) or an app-bar button and drawer on other pages |
| Staff | Register table (search, type, people who left), row menu, detail drawer (dates, starting documents with timing), add and edit forms (errors shown by the form, e.g. personal data refused), new starter checklist after adding, fixed-term note after an end-date change, record documents, mark as left with the leaving checklist, delete (destructive dialog); "Ask the adviser" prefills the composer |
| Hiring | Jobs, new job (JD + applications; submitting is the OK), steps, criteria confirmed in a dialog, results table (band, scores, flags), candidate drawer (criteria verdicts and evidence, strengths, gaps, questions, flags explained), Report menu (Word top 10, Excel everyone, candidate emails with the adviser) |
| Profile & policies | Profile view and form (only changed fields sent; receipt "old → new"); policies list; set up with the adviser |
| Files | Inbox, Outbox, Jobs, Policies; open, show in folder, ask about it; upload to the Inbox |
| Memory | Preferences and work notes; forget (with a dialog) |
| Settings | Account and sign-in (device code), speed, workspace folder, about |
| First run | Sign in (device code with copy) → workspace folder → business (set up with the adviser, fill in the form, or skip) |

Dates show as "Fri 9 Oct" (the year only when not this year), also inside replies and reminder titles, but never inside URLs.

## 5 Fake engine (`src/engine/fakeEngine.ts`)

For UI work without the model (the Codex quota is limited). Scripted replies picked by keywords call the **real** client tools, so confirmations, receipts, checklists and sources are the app's own. Scripts: someone resigning (register change to confirm), this week's reminders, final pay (official sources), "calculate" (pay warning), "link" (unverified link), "error", "limit" (usage limit), "remember …". Screening: demo criteria, a deterministic evaluation per resume (the hidden-instruction flag), a short comparison. It keeps the conversations of the process for history and resume. Never used unless asked.

## 6 App-layer additions for the UI

`conversation()` (the current conversation's messages from the start, via `Engine.readTranscript` = `thread/read` with turns; no model call), `workspaceFiles()`, `workspaceIsDefault()`, `importJobFiles(job, jd, applications)`, `screenResults(job)` (the job's state without new evaluations; criteria may not exist yet), the `usage_limit` AppEvent (`usageLimit()` reads the reset time from Codex's message), plain labels and "old → new" in register confirmations.

## 7 Tests

`npm run test:unit` (no model): the server protocol and local security (allowlist, token, Origin, Host, static paths), the reply stream, confirmations answered from the UI, stop, the Staff methods, files, profile, memory, settings, hiring with the fake engine, transcripts, usage-limit parsing. The pages were also checked in Chrome with the fake engine (all flows above), and the real engine was started to check the shell state, staff, settings and history without sending any message.

Not built yet: voice in the browser (microphone as the audio source; paid, needs the owner's OK), the desktop shell, a real "Cancel" for sign-in, voice mute.
