// The browser UI: `npm run ui` (real engine) or `npm run ui:fake` (scripted engine, demo workspace).
// Starts one AssistantApp for this user, the local server, and opens the browser.
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { userInfo } from "node:os";
import { AssistantApp } from "../app/app";
import { ROOT } from "../assistant";
import { BusinessStore } from "../business/profile";
import { Register } from "../business/register";
import { ensureFolders } from "../files/folders";
import { TEST_PROFILE } from "../../scripts/fixtures/business";
import { UiSession } from "./session";
import { startUiServer } from "./server";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const value = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const fake = flag("--fake") || process.env.FX_ENGINE === "fake";
const dev = flag("--dev");
const port = Number(value("--port") ?? (dev ? 5174 : 0));

/** POC identity, as in the CLI: --user beats the OS user name. */
function userId(): string {
  const raw = value("--user") ?? process.env.FX_USER ?? userInfo().username;
  const id = raw.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!id) throw new Error(`invalid user id "${raw}"`);
  return id;
}

/**
 * Demo mode never touches the real memory/ and files/: it uses workspace-demo/ and
 * memory-demo/ (gitignored), seeded once with the SYNTHETIC test business and a few
 * synthetic employees from the design (not real people).
 */
function demoWorkspace(): { filesRoot: string; memoryRoot: string } {
  // --fresh: an empty demo workspace (no profile, no staff) to try the first-run screens.
  if (flag("--fresh")) {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    return { filesRoot: ensureFolders(resolve(ROOT, "workspace-demo", "fresh", stamp)).root, memoryRoot: resolve(ROOT, "memory-demo", "fresh", stamp) };
  }
  const filesRoot = resolve(ROOT, "workspace-demo");
  const memoryRoot = resolve(ROOT, "memory-demo");
  if (!existsSync(resolve(filesRoot, ".assistant", "business.json"))) {
    const f = ensureFolders(filesRoot);
    new BusinessStore(f.data).update(TEST_PROFILE);
    cpSync(resolve(ROOT, "scripts", "fixtures", "policies"), f.policies, { recursive: true });
    const reg = new Register(f.data);
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const priya = reg.add({ name: "Priya Nair", role: "Cleaner", employmentType: "part-time", startDate: day(-600), award: "Cleaning Services Award", notes: "Synthetic demo employee" });
    const leo = reg.add({ name: "Leo Tran", role: "Cleaner", employmentType: "full-time", startDate: day(-176), probationEnd: day(6), notes: "Synthetic demo employee" });
    reg.recordDocuments(priya.id, ["contract", "fwis", "tfn", "super_choice", "induction"], day(-600));
    reg.recordDocuments(leo.id, ["contract", "fwis", "tfn", "super_choice", "induction"], day(-176));
    reg.add({ name: "Marco Silva", role: "Cleaner", employmentType: "casual", startDate: day(-3), notes: "Synthetic demo employee" });
    reg.close();
  }
  return { filesRoot, memoryRoot };
}

const session = new UiSession({ engine: fake ? "fake" : "codex" });
const demo = fake ? demoWorkspace() : null;
const app = new AssistantApp({
  userId: fake ? "demo" : userId(),
  ui: { confirm: session.confirm, progress: session.progress },
  format: "markdown",
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
console.log(`MeritAI ${fake ? "(demo: fake engine, workspace-demo/)" : ""} at ${url}`);
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
  // The URL is ours (hex token only), so no shell metacharacters reach the command.
  const [cmd, argv] =
    process.platform === "win32" ? ["explorer.exe", [u]] : process.platform === "darwin" ? ["open", [u]] : ["xdg-open", [u]];
  spawn(cmd, argv, { detached: true, stdio: "ignore" }).unref();
}
