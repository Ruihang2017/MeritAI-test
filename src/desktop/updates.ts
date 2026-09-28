// Updates for the desktop app (owner, 2026-09-28; design: UpdateRules, UpdateReady, UpdateSettings):
// new versions come from the repository's GitHub releases (package.json build.publish), download in
// the background and install when the owner restarts MeritAI, or the next time it closes. It never
// restarts by itself. MERITAI_UPDATE_URL points it at another feed (a local rehearsal of an update).
import electronUpdater from "electron-updater";
import { app } from "electron";
import type { UpdateState } from "../server/protocol";
import type { UpdatesHook } from "../server/session";
import { notesOf } from "./notes";

const { autoUpdater } = electronUpdater;
const EVERY = 6 * 3_600_000;
const FIRST_CHECK_MS = 10_000;

/**
 * Starts checking (a few seconds after start, then every 6 hours). `beforeInstall` stops the local
 * server first (the conversation is saved, the engine stopped), then the installer runs.
 */
export function startUpdates(o: { beforeInstall: () => Promise<void> }): UpdatesHook {
  const supported = app.isPackaged;
  let state: UpdateState = { supported, version: app.getVersion(), status: "idle", available: null, percent: null, notes: [], checkedAt: null, error: null };
  const listeners = new Set<(s: UpdateState) => void>();
  const set = (p: Partial<UpdateState>) => {
    state = { ...state, ...p };
    for (const f of listeners) f(state);
  };
  const hook: UpdatesHook = {
    state: () => state,
    onChange: (f) => void listeners.add(f),
    check: () => {
      if (!supported || state.status === "checking" || state.status === "downloading" || state.status === "ready") return;
      void autoUpdater.checkForUpdates().catch(() => null);
    },
    install: async () => {
      if (state.status !== "ready") return;
      await o.beforeInstall();
      // Silent (the version the owner chose to install), then MeritAI starts again.
      autoUpdater.quitAndInstall(true, true);
    },
  };
  if (!supported) return hook;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  if (process.env.MERITAI_UPDATE_URL) autoUpdater.setFeedURL({ provider: "generic", url: process.env.MERITAI_UPDATE_URL });
  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: null }));
  autoUpdater.on("update-not-available", () => set({ status: "uptodate", checkedAt: new Date().toISOString(), error: null }));
  autoUpdater.on("update-available", (i) => set({ status: "downloading", available: i.version, percent: 0, notes: notesOf(i.releaseNotes), error: null }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => set({ status: "ready", available: i.version, percent: 100, notes: notesOf(i.releaseNotes), checkedAt: new Date().toISOString() }));
  autoUpdater.on("error", (e) => {
    // A downloaded update stays ready; otherwise say so and try again at the next check.
    if (state.status !== "ready") set({ status: "error", checkedAt: new Date().toISOString(), error: String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200) });
  });
  setTimeout(hook.check, FIRST_CHECK_MS);
  setInterval(hook.check, EVERY).unref?.();
  return hook;
}
