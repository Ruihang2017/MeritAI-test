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
- The test coordinator (in `tester-guide.md`, and where Send feedback's email goes: `meritai.feedbackTo` in package.json) is Horace, ruihang2017@gmail.com. Change both together, then rebuild the guide.

## Publishing (GitHub)

The repo is public (`Ruihang2017/MeritAI-test`, synthetic data only; keys and `auth.json` are gitignored). There is no CI: build and try the installer on this computer first.

- **Release**: raise `version` in package.json; put the new version and installer name in `docs/alpha/tester-guide.md` (then `npx tsx scripts/build-tester-guide.mjs`) and `docs/alpha/owner-test.md` (A1, G4, and a section for what is new); `npm run desktop:dist` (it never publishes by itself), try `release/win-unpacked/MeritAI.exe`, then tag `vX.Y.Z` and create the release **as a draft** with the three update files and the guide: `gh release create vX.Y.Z --draft --notes "…what's new, a few lines…" release/MeritAI-Setup-X.Y.Z.exe release/MeritAI-Setup-X.Y.Z.exe.blockmap release/latest.yml "release/MeritAI alpha tester guide.docx"`. The notes become "What's new" in the app. Publish the draft (`gh release edit vX.Y.Z --draft=false`) only when it's right: from then on every tester's MeritAI downloads it. A bad version is replaced by publishing a higher one.
- **Updates** (from 0.2.2; `src/desktop/updates.ts`): the app reads `latest.yml` of the latest published release. Versions before 0.2.2 have no updater: hand 0.2.2 out as an installer once. Unsigned builds update fine (tried on 2026-09-28).
- **Rehearsing an update** without publishing or touching an installed MeritAI: build two versions under another name, e.g. `npx electron-builder --win nsis --publish never -c.extraMetadata.version=0.2.90 -c.extraMetadata.name=meritai-rehearsal -c.appId=au.meritai.rehearsal "-c.productName=MeritAI Rehearsal" "-c.nsis.shortcutName=MeritAI Rehearsal" -c.nsis.createDesktopShortcut=false -c.nsis.createStartMenuShortcut=false '-c.nsis.artifactName=MeritAI-Rehearsal-Setup-${version}.${ext}' -c.directories.output=release/rehearsal-0.2.90` (and 0.2.91), install the first with `/S`, serve the second's folder over HTTP and start the installed app with `MERITAI_UPDATE_URL=http://127.0.0.1:<port>/`. Its folders are "MeritAI Rehearsal" ones (%APPDATA%, %USERPROFILE%), because they follow the app's name. Afterwards: its uninstaller with `/S`, and delete %APPDATA%\MeritAI Rehearsal, %USERPROFILE%\MeritAI Rehearsal and %LOCALAPPDATA%\meritai-rehearsal-updater.
- **Product page**: `docs/index.html` on GitHub Pages (branch `main`, folder `/docs`), https://ruihang2017.github.io/MeritAI-test/. After a release, update its download links and version (they name the file: `MeritAI.Setup.0.2.1.exe` up to 0.2.1, `MeritAI-Setup-X.Y.Z.exe` from 0.2.2). Its feature videos and the README's screenshots come from `scripts/docs-media.cjs` (see its header): stills and the hire video by default, one clip per feature with `--clips`.

## Collecting feedback

Testers send `MeritAI feedback <date time>.json` files (from Send feedback): their name if they gave it, the app version, their note, their ratings of replies (question, start of the reply, what went wrong), optionally the conversation, and technical details (model, platform, recent errors). There is no server: nothing is collected automatically. **Email it to the MeritAI team** opens a draft to the address in `package.json` (`meritai.feedbackTo`: ruihang2017@gmail.com) with the file attached; the tester presses Send.

Put the files you receive in one folder (subfolders are fine) and run `npx tsx scripts/feedback-report.ts <folder>`: a summary in the terminal and `MeritAI feedback report <date>.xlsx` in that folder (Overview, Not helpful, Notes, Errors). A file sent twice counts once.
