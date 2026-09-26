// Switches this script to codex_home_test/ (see src/engine/codexHome.ts): import it first in
// every test suite, eval and experiment. Our config.toml and skills are copied from
// codex_home/ on each run, so tests always use what users get; the sign-in is separate
// (npm run login:test).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_HOME_DIRS } from "../src/engine/codexHome";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const product = join(ROOT, CODEX_HOME_DIRS.product);
const test = join(ROOT, CODEX_HOME_DIRS.test);

process.env.FX_CODEX_HOME = "test";
mkdirSync(join(test, "skills"), { recursive: true });
cpSync(join(product, "config.toml"), join(test, "config.toml"));
// Ours only: .system holds Codex's own skills, which each home manages itself.
const ours = readdirSync(join(product, "skills")).filter((n) => n !== ".system");
for (const n of readdirSync(join(test, "skills"))) if (n !== ".system" && !ours.includes(n)) rmSync(join(test, "skills", n), { recursive: true, force: true });
for (const n of ours) cpSync(join(product, "skills", n), join(test, "skills", n), { recursive: true, force: true });

if (!existsSync(join(test, "auth.json")) && !process.argv[1]?.endsWith("login-test.ts"))
  console.log("codex_home_test/ is not signed in yet: run `npm run login:test` once.");
