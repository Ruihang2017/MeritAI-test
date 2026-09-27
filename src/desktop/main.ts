// MeritAI for Windows (Electron): the local server in this process and one window on it.
// Built with `npm run desktop:build` (scripts/build-desktop.mjs), tried with `npm run desktop`.
// The user's data stays in their own folders: the engine's sign-in and conversations and the
// memory in %APPDATA%\MeritAI, the workspace in %USERPROFILE%\MeritAI (changeable in the app).
import { app, BrowserWindow, Menu, session, shell } from "electron";
import { join } from "node:path";

app.setName("MeritAI");
// %APPDATA%\MeritAI, also when run from the project (where the package name would be used).
app.setPath("userData", join(app.getPath("appData"), "MeritAI"));
const data = app.getPath("userData");
// One window: a second start focuses the first (the lock lives in the user data folder, so after setPath).
if (!app.requestSingleInstanceLock()) app.quit();
process.env.FX_CODEX_HOME_PATH ??= join(data, "codex_home");
process.env.FX_MEMORY_ROOT ??= join(data, "memory");
// Not in Documents: it is often synced (OneDrive), which doesn't suit the register's database. The owner can move it in Settings.
process.env.FX_FILES_ROOT ??= join(app.getPath("home"), "MeritAI");
process.env.FX_ENGINE_CWD ??= join(data, "engine");
// The codex engine ships with the app (the pinned version the protocol was generated for).
// The whole vendor folder is shipped (codex looks for its helpers beside it).
if (app.isPackaged) process.env.CODEX_BIN = join(process.resourcesPath, "codex", "bin", process.platform === "win32" ? "codex.exe" : "codex");

let win: BrowserWindow | null = null;
let stop: (() => Promise<void>) | null = null;

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // After the paths are set: the server reads them when it starts.
  const { startDesktopServer } = await import("../server/desktop");
  const server = await startDesktopServer();
  stop = server.close;
  const origin = new URL(server.url).origin;
  // The page may use the microphone (voice) and nothing else.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    const d = details as { requestingUrl?: string; mediaTypes?: string[] };
    cb(permission === "media" && (d.requestingUrl ?? "").startsWith(origin) && (d.mediaTypes ?? []).every((t) => t === "audio"));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permission === "media" && requestingOrigin === origin);

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "MeritAI",
    backgroundColor: "#EEF2F7",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Links out (official sources, the sign-in page) open in the user's browser; the window stays on MeritAI.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(origin)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(origin)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  win.on("closed", () => (win = null));
  await win.loadURL(server.url);
});

let quitting = false;
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (e) => {
  if (quitting || !stop) return;
  // Save the conversation notes and stop the engine before exiting.
  e.preventDefault();
  quitting = true;
  void stop().finally(() => app.quit());
});
