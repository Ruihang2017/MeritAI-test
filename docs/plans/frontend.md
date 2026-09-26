# Frontend: what is left (MeritAI)

Status: M1–M4 built on 2026-09-27 on branch `ui/m1` (as built: `docs/ui.md`). Open: M5 below, and the owner's review of the browser UI.

| # | Scope | Notes |
|---|---|---|
| M5a | Voice in the browser: the microphone and speaker as the `audio` source and sink of `startVoice` (PCM16 24 kHz through the WebSocket), the voice states of the design (listening, working, ended, not saved during voice) | Paid API (GPT-Live): one test run only with the owner's OK. Voice mute needs app support (the voice API has only stop) |
| M5b | Desktop shell: Electron (runs `src/server` in its main process) or Tauri (Node as a sidecar); the web app is reused as is | Owner decision after using the browser version |


## Later: small items (owner, 2026-09-27)

| Item | Why it waits |
|---|---|
| Cancel during sign-in | The engine's device-code login cannot be cancelled yet (`account/login/cancel` exists in the protocol but is not wired); today the page waits until sign-in finishes or fails |
| Voice mute | The voice API has only stop; mute needs app support (with M5a) |
| Dark mode | Not in the design; needs dark tokens designed first |
