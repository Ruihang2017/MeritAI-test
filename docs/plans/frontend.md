# Frontend: what is left (MeritAI)

Status: M1–M4 built on 2026-09-27 on branch `ui/m1` (as built: `docs/ui.md`). Open: M5 below, and the owner's review of the browser UI.

| # | Scope | Notes |
|---|---|---|
| M5a | Voice in the browser: the microphone and speaker as the `audio` source and sink of `startVoice` (PCM16 24 kHz through the WebSocket), the voice states of the design (listening, working, ended, not saved during voice) | Paid API (GPT-Live): one test run only with the owner's OK. Voice mute needs app support (the voice API has only stop) |
| M5b | Desktop shell: Electron (runs `src/server` in its main process) or Tauri (Node as a sidecar); the web app is reused as is | Owner decision after using the browser version |
| — | Smaller gaps found while building | A real "Cancel" for sign-in (the engine login cannot be cancelled yet); dark mode is not designed |
