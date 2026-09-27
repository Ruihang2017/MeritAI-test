// The browser UI: `npm run ui` (real engine), `npm run ui:demo` (real engine, demo workspace) or
// `npm run ui:fake` (scripted engine, demo workspace).
// Starts one AssistantApp for this user, the local server, and opens the browser.
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { userInfo } from "node:os";
import { AssistantApp, TIERS } from "../app/app";
import { ROOT } from "../assistant";
import { ensureFolders } from "../files/folders";
import { seedDemo } from "../../scripts/fixtures/demo";
import { UiSession } from "./session";
import { startUiServer } from "./server";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const value = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const fake = flag("--fake") || process.env.FX_ENGINE === "fake";
// --demo: the real engine on the demo workspace (the design's sample data); --fake implies it.
const demoMode = flag("--demo");
const dev = flag("--dev");
const port = Number(value("--port") ?? (dev ? 5174 : 0));

/** POC identity, as in the CLI: --user beats the OS user name. */
function userId(): string {
  const raw = value("--user") ?? process.env.FX_USER ?? userInfo().username;
  const id = raw.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!id) throw new Error(`invalid user id "${raw}"`);
  return id;
}

const DEMO_USER = "demo";

/**
 * Demo mode never touches the real memory/ and files/: it uses workspace-demo/Wattle Lane/
 * and memory-demo/ (gitignored), seeded once with the design canvas's SYNTHETIC sample data
 * (scripts/fixtures/demo.ts). --reseed starts it again from the design's state.
 */
async function demoWorkspace(): Promise<{ filesRoot: string; memoryRoot: string }> {
  // --fresh: an empty demo workspace (no profile, no staff) to try the first-run screens.
  if (flag("--fresh")) {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    return { filesRoot: ensureFolders(resolve(ROOT, "workspace-demo", "fresh", stamp)).root, memoryRoot: resolve(ROOT, "memory-demo", "fresh", stamp) };
  }
  const filesRoot = resolve(ROOT, "workspace-demo", "Wattle Lane");
  const memoryRoot = resolve(ROOT, "memory-demo");
  if (flag("--reseed")) {
    rmSync(filesRoot, { recursive: true, force: true });
    rmSync(resolve(memoryRoot, "users", DEMO_USER), { recursive: true, force: true });
  }
  if (!existsSync(resolve(filesRoot, ".assistant", "business.json"))) {
    await seedDemo({ filesRoot, memoryRoot, userId: DEMO_USER });
    console.log(`Demo workspace seeded with the design's sample data (synthetic): ${filesRoot}`);
  }
  return { filesRoot, memoryRoot };
}

/** As in the CLI: --tier beats FX_TIER; default fast (priority). */
const tierName = value("--tier") ?? process.env.FX_TIER ?? "fast";
const serviceTier = TIERS[tierName.toLowerCase()];
if (!serviceTier) throw new Error(`unknown tier "${tierName}" (use fast or standard)`);

const session = new UiSession({ engine: fake ? "fake" : "codex" });
const demo = fake || demoMode ? await demoWorkspace() : null;
const app = new AssistantApp({
  userId: demo ? DEMO_USER : userId(),
  ui: { confirm: session.confirm, progress: session.progress },
  format: "markdown",
  serviceTier,
  engine: fake ? "fake" : "codex",
  ...(demo ?? {}),
});
session.attach(app);

const status = await app.start();
if (status.loggedIn) await app.openSession();

const staticDir = resolve(ROOT, "web", "dist");
if (!dev && !existsSync(resolve(staticDir, "index.html"))) {
  console.error("The web app is not built: run `npm run ui:build` first (or `npm run ui:dev`).");
  process.exit(1);
}
const ui = await startUiServer({ session, port, ...(dev ? { devOrigin: "http://127.0.0.1:5173" } : { staticDir }) });
const url = dev ? `http://127.0.0.1:5173/?t=${ui.token}` : ui.url;
console.log(`MeritAI ${fake ? "(demo: fake engine, workspace-demo/) " : demo ? "(demo workspace: workspace-demo/) " : ""}at ${url}`);
console.log(`account: ${status.description}${status.loggedIn ? "" : "  (not signed in: run `npm run login`)"}`);
if (dev) {
  // Vite serves web/ with hot reload and proxies /ws to this server (web/vite.config.ts).
  const vite = spawn(process.execPath, [resolve(ROOT, "node_modules", "vite", "bin", "vite.js"), "web"], { cwd: ROOT, stdio: "inherit" });
  process.on("exit", () => vite.kill());
  setTimeout(() => !flag("--no-open") && openBrowser(url), 1500);
} else if (!flag("--no-open")) openBrowser(url);

const shutdown = async () => {
  await ui.close();
  await app.close().catch(() => null);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function openBrowser(u: string): void {
  // The URL is ours (hex token only), so no shell metacharacters reach the command. On Windows,
  // explorer.exe mishandles a URL with a query string and opens the Documents folder instead;
  // url.dll's FileProtocolHandler hands it to the default browser.
  const [cmd, argv] =
    process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", u]]
      : process.platform === "darwin" ? ["open", [u]] : ["xdg-open", [u]];
  const child = spawn(cmd, argv, { detached: true, stdio: "ignore" });
  child.on("error", () => console.log(`Couldn't open a browser; open this link yourself: ${u}`));
  child.unref();
}
