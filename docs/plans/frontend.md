# Frontend: browser version first (MeritAI)

Status: agreed by the owner on 2026-09-26 ("先做浏览器版，外壳以后再选"); M1 in progress. The desktop shell (Electron or Tauri) is chosen after the UI is stable. Design: `ui-design.md` and the canvas (Version 11).

## 1 Shape

```
browser (http://127.0.0.1:<port>/?t=<token>)
  web/            React + TypeScript + Vite; the canvas designs as components
     │  one WebSocket, JSON messages (src/server/protocol.ts, shared types)
src/server/       Node: a thin local service around one AssistantApp (the existing app layer, unchanged)
     │
AssistantApp → createAssistant → engine: codex app-server (real) or FakeEngine (scripted, no quota)
```

- **The core stays TypeScript and unchanged.** The server only translates messages into `AssistantApp` calls; behaviour stays in the app layer (the CLI and the UI share it).
- **One user, one machine** (like the CLI): one `AssistantApp` per server process, the same `memory/` and workspace as the CLI. Multi-user and a shared server are out of scope (`docs/architecture.md` §3).
- **Later desktop shell:** Electron runs the same server in its main process; Tauri runs it as a Node sidecar. The web code is reused as is.

## 2 Decisions (my recommendation; the owner can change them)

| Topic | Decision | Why |
|---|---|---|
| UI stack | React 19 + TypeScript + Vite, plain CSS with the canvas tokens (`_tokens.css`) | Mainstream, fast to build, and the canvas is already HTML/CSS; no CSS framework to fight the tokens |
| Markdown | `react-markdown` + `remark-gfm`, no raw HTML; links open in a new tab | Replies use `format: "markdown"`; raw HTML is never rendered (injection through a resume or a tool) |
| Transport | One WebSocket; requests `{id, method, params}` → `{id, result}` or `{id, error}`; pushed events `{event, ...}` (turn events, confirm questions, progress) | Streaming and confirmations are server-initiated; one socket is simpler than HTTP + SSE |
| Methods | An explicit allowlist mapped to `AssistantApp` methods; nothing else is callable | The browser must not reach arbitrary code |
| Local security | Bind 127.0.0.1 only; a random token per start (in the opened URL, checked on the socket and the API); `Origin` must be the server's own; no CORS | Other web pages in the same browser can reach localhost; HR data must not leak to them |
| Confirmations | App `ui.confirm` → pushed `confirm {id, req}` → the UI answers `answerConfirm(id, yes)`; `pendingConfirms()` re-sent on reconnect; withdrawn questions pushed as `confirmWithdrawn` | Uses the cancellable confirmations built for this |
| Uploads | Drag and drop and file pickers send bytes (base64 in a request) to `attachBytes` | Built for a browser UI; limit `MAX_ATTACH_BYTES` |
| Engine for development | `FX_ENGINE=fake`: a scripted engine that streams replies and calls the real client tools (register, checklists, reminders), so confirm cards, receipts and sources are real | Codex quota is used up until about 2026-09-29; UI work must not need the model. The real engine is the default |
| Voice | Later milestone: the browser microphone as the `audio` source/sink (no ffmpeg) | Paid API; do it once the rest works |

## 3 Milestones

| # | Scope | Done when |
|---|---|---|
| M1 | Server (token, origin check, allowlist, confirm bridge), FakeEngine, web shell (app bar, nav, Attention panel), Conversations: streaming markdown, tool activity, sources, confirm cards and receipts, stop, new conversation, history, attachments | A scripted conversation works end to end in the browser with the fake engine; unit tests for the server protocol and security |
| M2 | Staff: register table, detail drawer, add / edit / record documents / mark as left / delete (the forms), checklists after saving; Attention drawer on other pages | The staff boards of the canvas work against a real register |
| M3 | Hiring (jobs, import, criteria, screening progress, results, report) and Files (Inbox / Outbox / Jobs / Policies, open and reveal, uploads) | Screening runs end to end (fake engine for the model parts) |
| M4 | Profile and policies (form), Memory, Settings (account, speed, workspace, microphone), first run (sign-in with the device code, workspace, setup), system states (usage limit, offline, not signed in), empty and error states | A new workspace can be set up from the browser |
| M5 | Voice with the browser microphone; the desktop shell decision | Owner decision; paid voice tests only with the owner's OK |

App-layer gaps found by the design review stay listed in `ui-design.md` §11 (voice mute, usage-limit reset time, structured sign-in details) and are built in the milestone that needs them.

## 4 Commands (M1)

- `npm run ui` : starts the server (real engine) and opens the browser.
- `npm run ui:fake` : the same with the fake engine.
- `npm run ui:dev` : Vite dev server with hot reload, proxied to the server.
- Tests: `npm run test:unit` covers the server protocol, the allowlist and the token/origin checks (no model).
