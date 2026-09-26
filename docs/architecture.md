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
  - The app calls `ui.confirm(req, {id, signal})` (`src/app/confirms.ts`): `id` is unique, and `signal` aborts when the question is withdrawn. A confirm that only takes `req` still works.
  - `stop()`, `close()` and `cancelPendingConfirms()` withdraw open questions; a withdrawn question resolves to false (declined), even if the UI never answers. `pendingConfirms()` lists the open ones, so a reconnecting UI can show them again.
  - In voice mode, questions are still declined at once and reported through `onConfirmSkipped`.
- **Everything a turn produces is an `AppEvent`:**
  - the engine events: text deltas and done, tool activity, skill loaded, unverified links, links corrected, usage, errors, turn end;
  - plus app warnings (`pay_calculation`).
  - `tool_activity` carries `files` (absolute paths) when a tool saved something, so a UI can offer "open".

## 2 AssistantApp API

| Area | Methods |
|---|---|
| Account and session | `start()`, `login(onPrompt)`, `account()`, `openSession()` (with retention cleanup), `sessionInfo()`, `newConversation()` (saves work notes), `history()`, `resume(record)` (with the current memory), `hasConversation()`, `saveNotes()`, `close()` |
| Conversation | `send(text, {skill, title})` → `AsyncIterable<AppEvent>`, `stop()` (also declines open confirmations), `isBusy()`, `setup()`, `remember(text)`, `skills()`, `resolveSkill(prefix)`, `setTier(name)` |
| Confirmations | `pendingConfirms()` → `{id, req}[]`, `cancelPendingConfirms()` → how many were withdrawn |
| Attachments | `attach(paths)` (files copied to the Inbox; folders offered as a job import), `attachBytes(files)` (a browser UI: `{name, data, relPath?}[]`, see below), `takeDroppedPaths(line)` (terminals: paths inside typed text), `hasPendingAttachments()`; attachments go with the next `send` |
| Business | `needsSetup()`, `profile()`, `staff(includeLeft)`, `reminders()` |
| Forms (no model) | `updateProfile(changes)`, `addEmployee(details, {mayNeedVisaCheck, apprentice})` → + new starter checklist, `updateEmployee(id, changes)` → + notes (fixed-term limits), `recordDocuments(id, docs, date)`, `markLeft(id, leftDate, reason)` → + leaving checklist, `removeEmployee(id)` (destructive confirm). Each returns `FormResult`: `{ok: true, lines, ...}` for the receipt or `{ok: false, error}` to show by the form. Same validation as the chat tools; submitting is the confirmation |
| Memory | `memories()`, `forget(id)` |
| Files and jobs | `folders()`, `files()`, `setFilesRoot(path)`, `resetFilesRoot()`, `jobs()`, `importJob(path, job)`, `screen(job)` → `no-jd` / `not-confirmed` / `done` + summary, `report(job, format)` → saved paths, `openFile(path)` / `revealFile(path)` → `{ok: true}` or `{ok: false, error}` |
| Voice | `microphones()`, `setMicrophone(device)`, `startVoice(handlers, audio?)` → controller with `stop()`. Handlers: `onRequest`, `onEvent`, `onSaid`, `onConfirmSkipped`, `onError`, `onEnded({reason, byUser, billedSeconds})`. `audio` defaults to the local mic and speaker (ffmpeg/ffplay); a UI can pass its own PCM16 24 kHz source and sink |

Constructor options:
- `userId` and `ui` (`confirm`, `progress`, `log`);
- `serviceTier`, `memoryRoot`;
- `filesRoot` (a workspace chosen by the host application);
- `format`: `"plain"` (default) or `"markdown"` (see section 3);
- `launcher`: starts the open / reveal command (default: spawn; tests pass a fake).

**Uploads (`attachBytes`)** behave like drag and drop (`src/app/uploads.ts`):
- The bytes are written to a staging folder in the OS temp folder (`fx-upload-*`), go through `attach()`, and the staging folder is deleted afterwards.
- A file with no folder in `relPath` goes to the Inbox, like a dropped file. Its name is sanitised: the last segment only, characters Windows refuses become `_`, trailing dots and spaces go, and device names (`CON`, `NUL`, ...) get a `_` prefix.
- Files whose `relPath` (like `webkitRelativePath`, including the file name) has folders keep that structure. Each top-level folder is offered as a job import (the same confirm and `importIntoJob`).
- Refused before anything is written: `relPath` with `..` or an absolute path, files over the attachment limit (`MAX_ATTACH_BYTES`), and the same path twice.
- There is one outcome per loose file, per top-level folder and per refused upload, in upload order. `path` is the uploaded name.

**Opening files (`openFile`, `revealFile`)** (`src/app/launch.ts`):
- Only an existing file or folder inside the current workspace root, after resolving links, and never inside `.assistant/`. Relative paths are taken from the root.
- Windows uses `explorer.exe "<path>"` and `explorer.exe /select,"<path>"`, not `cmd /c start`, so `%` and `&` in names are never interpreted.
- macOS uses `open` and `open -R`. Linux uses `xdg-open`; reveal opens the containing folder there.

## 3 What a new front end still has to decide

- **Formatting (provided):** `format: "markdown"` swaps the two raw-text lines of `prompts/base.md` for a rule allowing GitHub-flavoured markdown (headings, lists, bold, links to tool-returned URLs), in `src/basePrompt.ts`. `base.md` itself stays the plain version, and an edit that breaks the swap fails loudly. The UI still has to render the markdown safely, for example with no raw HTML.
- **Uploads, opening files, cancellable confirmations (provided):** `attachBytes`, `openFile` / `revealFile`, and the confirmation id, signal and `pendingConfirms()`. The UI still decides how to show them.
- **Audio:** for a browser-based UI, pass `audio` from the UI instead of ffmpeg.
- **Transport:** how the UI talks to this Node process (Electron IPC, a local WebSocket, ...) is not chosen yet; the API above is plain async methods and callbacks.
- **Identity and multi-user:** one `AssistantApp` per user and process (desktop). A shared web server would also need authentication, and one app-server per user, before real data is used (see the constraints in `CLAUDE.md`).

## 4 Tests

- **`npm run test:unit`** (free) covers the application layer without starting the engine:
  - attachments, a declined folder import, refused paths, the query methods, the host workspace and tiers;
  - the reply format (plain = `base.md`; markdown changes only the formatting lines);
  - cancellable confirmations (listed, cancelled → declined, answered → removed; also through a folder import in the app);
  - open and reveal (a fake launcher; outside the root, `..`, missing and `.assistant` refused; the per-platform commands);
  - uploads (Inbox, reuse, sanitised names, `..` and absolute paths refused, oversize refused, folder import asked, staging deleted);
  - forms:
    - profile saved without a yes/no; date of birth refused;
    - add returns the checklist; a duplicate or a date of birth in the notes is refused;
    - a fixed-term end date change returns the limits note; leaving only through `markLeft`, which returns the leaving checklist;
    - bad dates and reasons are refused;
    - delete asks the destructive confirmation (declined keeps the record, confirmed removes it).
- **The live suites and the evaluation** use `createAssistant()` directly, so they test the same wiring.
- **The CLI itself** is covered by a smoke test of the non-model commands. It was run after the refactor on 2026-09-26, with the same output as before.
