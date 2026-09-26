import { resolve } from "node:path";

// Two isolated CODEX_HOMEs under the project, each with its own ChatGPT sign-in:
// codex_home/ for real use (npm start, npm run ui) and codex_home_test/ for test
// suites, evals and experiments, so their conversations never pile up where the
// history is listed. scripts/testHome.ts switches a script to the test one.
export const CODEX_HOME_DIRS = { product: "codex_home", test: "codex_home_test" } as const;

/** The CODEX_HOME this process uses: the test one when FX_CODEX_HOME=test. */
export function codexHomeFor(projectRoot: string): string {
  return resolve(projectRoot, process.env.FX_CODEX_HOME === "test" ? CODEX_HOME_DIRS.test : CODEX_HOME_DIRS.product);
}

/** Both homes (each holds credentials), for the folder guards. */
export function allCodexHomes(projectRoot: string): string[] {
  return Object.values(CODEX_HOME_DIRS).map((d) => resolve(projectRoot, d));
}
