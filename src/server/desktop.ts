// The desktop app's server (src/desktop/main.ts): the same local server as `npm run ui`, for the
// signed-in Windows user, with the engine, memory and default workspace in that user's own folders
// (set by the desktop app through FX_CODEX_HOME_PATH, FX_MEMORY_ROOT and FX_FILES_ROOT).
import { resolve } from "node:path";
import { userInfo } from "node:os";
import { AssistantApp, TIERS } from "../app/app";
import { ROOT } from "../assistant";
import { codexHomeFor, CODEX_HOME_DIRS, syncCodexHome } from "../engine/codexHome";
import { UiSession, type UpdatesHook } from "./session";
import { startUiServer } from "./server";

export async function startDesktopServer(o: { updates?: UpdatesHook } = {}): Promise<{ url: string; close(): Promise<void> }> {
  // Our config.toml and skills go into the user's engine folder on every start (updates apply; the sign-in stays).
  const home = codexHomeFor(ROOT);
  if (home !== resolve(ROOT, CODEX_HOME_DIRS.product)) syncCodexHome(resolve(ROOT, CODEX_HOME_DIRS.product), home);
  const userId = userInfo().username.toLowerCase().replace(/[^a-z0-9._-]/g, "") || "owner";
  const session = new UiSession({ engine: "codex", sampleData: false, updates: o.updates });
  const app = new AssistantApp({ userId, ui: { confirm: session.confirm, progress: session.progress }, format: "markdown", serviceTier: TIERS.fast, engine: "codex" });
  session.attach(app);
  const status = await app.start();
  if (status.loggedIn) await app.openSession();
  const ui = await startUiServer({ session, port: 0, staticDir: resolve(ROOT, "web", "dist") });
  return {
    url: ui.url,
    close: async () => {
      await ui.close();
      await app.close().catch(() => null);
    },
  };
}
