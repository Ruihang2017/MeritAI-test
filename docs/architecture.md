# Architecture: core, application layer, front ends (as built)

The terminal is one front end. Everything a front end needs lives below it, so a desktop or web UI can be added without re-implementing behaviour.

```
front ends      src/cli.ts (terminal)              [later: desktop UI, e.g. Electron/Tauri + this Node process]
                    │ renders data and events, asks yes/no, reads input
application     src/app/app.ts  AssistantApp       session flows, attachments, screening, voice, guards
                    │
wiring          src/assistant.ts createAssistant()  engine + prompts + profile + policies + memory + tools
                    │
core            src/business  src/files  src/screening  src/memory  src/research  src/voice
engine          src/engine (Engine interface; AppServerEngine = local codex app-server over JSON-RPC)
```

## 1 Rules

- **Behaviour goes in the core or in `AssistantApp`.** `cli.ts` only parses commands, renders results and events, and answers confirmations.
- **User decisions are structured `ConfirmRequest`s** (`src/engine/types.ts`): `{kind, title, items?, destructive?}`, with kind one of profile, register, memory, folder-import, criteria or setup. A UI shows them as a dialog; `confirmText()` renders them for a terminal.
- **Everything a turn produces is an `AppEvent`:**
  - the engine events: text deltas and done, tool activity, skill loaded, unverified links, usage, errors, turn end;
  - plus app warnings (`pay_calculation`).
  - `tool_activity` carries `files` (absolute paths) when a tool saved something, so a UI can offer "open".

## 2 AssistantApp API

| Area | Methods |
|---|---|
| Account and session | `start()`, `login(onPrompt)`, `account()`, `openSession()` (with retention cleanup), `sessionInfo()`, `newConversation()` (saves work notes), `history()`, `resume(record)` (with the current memory), `hasConversation()`, `saveNotes()`, `close()` |
| Conversation | `send(text, {skill, title})` → `AsyncIterable<AppEvent>`, `stop()`, `isBusy()`, `setup()`, `remember(text)`, `skills()`, `resolveSkill(prefix)`, `setTier(name)` |
| Attachments | `attach(paths)` (files copied to the Inbox; folders offered as a job import), `takeDroppedPaths(line)` (terminals: paths inside typed text), `hasPendingAttachments()`; attachments go with the next `send` |
| Business | `needsSetup()`, `profile()`, `staff(includeLeft)`, `reminders()` |
| Memory | `memories()`, `forget(id)` |
| Files and jobs | `folders()`, `files()`, `setFilesRoot(path)`, `resetFilesRoot()`, `jobs()`, `importJob(path, job)`, `screen(job)` → `no-jd` / `not-confirmed` / `done` + summary, `report(job, format)` → saved paths |
| Voice | `microphones()`, `setMicrophone(device)`, `startVoice(handlers, audio?)` → controller with `stop()`. Handlers: `onRequest`, `onEvent`, `onSaid`, `onConfirmSkipped`, `onError`, `onEnded({reason, byUser, billedSeconds})`. `audio` defaults to the local mic and speaker (ffmpeg/ffplay); a UI can pass its own PCM16 24 kHz source and sink |

Constructor options:
- `userId` and `ui` (`confirm`, `progress`, `log`);
- `serviceTier`, `memoryRoot`;
- `filesRoot` (a workspace chosen by the host application).

## 3 What a new front end still has to decide

- **Formatting:** `prompts/base.md` asks for plain text because the terminal shows raw text. A UI that renders markdown should switch that rule.
- **Audio:** for a browser-based UI, pass `audio` from the UI instead of ffmpeg.
- **Identity and multi-user:** one `AssistantApp` per user and process (desktop). A shared web server would also need authentication, and one app-server per user, before real data is used (see the constraints in `CLAUDE.md`).

## 4 Tests

- **`npm run test:unit`** (free) covers the application layer without starting the engine: attachments, a declined folder import, refused paths, the query methods, the host workspace and tiers.
- **The live suites and the evaluation** use `createAssistant()` directly, so they test the same wiring.
- **The CLI itself** is covered by a smoke test of the non-model commands. It was run after the refactor on 2026-09-26, with the same output as before.
