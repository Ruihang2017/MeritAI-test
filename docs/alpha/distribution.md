# MeritAI alpha: building and handing out the app

For the project owner. Testers get the installer and `tester-guide.docx` (built from `tester-guide.md`).

## Build

```
npm ci                      # once; then approve Electron's download if npm asks (node node_modules/electron/install.js)
npm run test:unit           # free, no model calls
npm run desktop:dist        # web UI + main process bundle + NSIS installer
npx tsx scripts/build-tester-guide.mjs   # release/MeritAI alpha tester guide.docx
```

Output in `release/` (gitignored): `MeritAI Setup <version>.exe` (about 200 MB: the codex engine is 320 MB unpacked) and the unpacked app in `win-unpacked/` (run `MeritAI.exe` there to try it without installing). `npm run desktop` runs the app from the project without packaging.

Raise `version` in `package.json` for each build you hand out; the feedback files carry it.

## What is inside

| Part | Where |
|---|---|
| Main process + local server + all TypeScript dependencies, one file | `dist-desktop/main.mjs` (esbuild, `scripts/build-desktop.mjs`) |
| Web UI, prompts, our `config.toml` and skills | `web/dist/`, `prompts/`, `codex_home/` |
| codex CLI (pinned 0.156.1, the version `src/protocol/` was generated for) | `resources/codex/` from `@openai/codex-win32-x64` |

On the tester's computer: sign-in, memory, conversations and the voice key (DPAPI) in `%APPDATA%\MeritAI`; the workspace in `%USERPROFILE%\MeritAI` (not Documents, which is often synced by OneDrive and doesn't suit the register's SQLite database); the sample business in `%USERPROFILE%\MeritAI (sample)`.

## Before handing it out

- The installer is **not code-signed**: Windows SmartScreen warns ("Windows protected your PC" › More info › Run anyway). Ask IT whether that is acceptable for the alpha, or for a code-signing certificate (electron-builder signs with it when `CSC_LINK` / `CSC_KEY_PASSWORD` are set).
- Testers sign in with their own ChatGPT accounts: their plan must include Codex, and usage counts against it.
- Voice needs each tester's own OpenAI API key with billing (about US$0.05 a minute).
- Fill in the test coordinator's name and email in `tester-guide.md`, then rebuild the guide.

## Collecting feedback

Testers send `MeritAI feedback <date time>.json` files (from Send feedback): their note, their ratings of replies (question, start of the reply, what went wrong), optionally the conversation, and technical details (app version, model, platform, recent errors). There is no server: nothing is collected automatically.
