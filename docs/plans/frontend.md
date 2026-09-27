# Frontend: what is left (MeritAI)

Status: M1–M5 built on 2026-09-27: the browser UI, voice in the browser and the Electron desktop app (as built: `docs/ui.md`, `docs/alpha/distribution.md`). Open: the small items below.


## Later: small items (owner, 2026-09-27)

| Item | Why it waits |
|---|---|
| Cancel during sign-in | The engine's device-code login cannot be cancelled yet (`account/login/cancel` exists in the protocol but is not wired); today the page waits until sign-in finishes or fails |
| The side panel knows what is open | MeritAI would know the employee, job, candidate or file open on the page, shown as a removable chip ("Looking at: Marco Silva · Staff"; design: Later board). Kept for later by the owner (2026-09-27): each page would need to report what is open, and a safe way to send it with the message. Today it knows only what a button sends |
| Dark mode | Not in the design; needs dark tokens designed first |
