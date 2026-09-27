import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

// Two isolated CODEX_HOMEs under the project, each with its own ChatGPT sign-in:
// codex_home/ for real use (npm start, npm run ui) and codex_home_test/ for test
// suites, evals and experiments, so their conversations never pile up where the
// history is listed. scripts/testHome.ts switches a script to the test one.
export const CODEX_HOME_DIRS = { product: "codex_home", test: "codex_home_test" } as const;

/**
 * The CODEX_HOME this process uses: the test one when FX_CODEX_HOME=test; the desktop app sets
 * FX_CODEX_HOME_PATH to one in the user's own app data (its sign-in and conversations stay there).
 */
export function codexHomeFor(projectRoot: string): string {
  if (process.env.FX_CODEX_HOME_PATH) return resolve(process.env.FX_CODEX_HOME_PATH);
  return resolve(projectRoot, process.env.FX_CODEX_HOME === "test" ? CODEX_HOME_DIRS.test : CODEX_HOME_DIRS.product);
}

/** Every home (each holds credentials), for the folder guards. */
export function allCodexHomes(projectRoot: string): string[] {
  return [...Object.values(CODEX_HOME_DIRS).map((d) => resolve(projectRoot, d)), ...(process.env.FX_CODEX_HOME_PATH ? [resolve(process.env.FX_CODEX_HOME_PATH)] : [])];
}

/** Copies our config.toml and skills into another home (tests, the desktop app), keeping its sign-in and Codex's own .system skills. */
export function syncCodexHome(from: string, to: string): void {
  mkdirSync(join(to, "skills"), { recursive: true });
  cpSync(join(from, "config.toml"), join(to, "config.toml"));
  const ours = readdirSync(join(from, "skills")).filter((n) => n !== ".system");
  for (const n of readdirSync(join(to, "skills"))) if (n !== ".system" && !ours.includes(n)) rmSync(join(to, "skills", n), { recursive: true, force: true });
  for (const n of ours) cpSync(join(from, "skills", n), join(to, "skills", n), { recursive: true, force: true });
}
