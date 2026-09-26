// npm run login:test: signs codex_home_test/ (tests, evals) in to ChatGPT, separately from codex_home/.
import "./testHome";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistant } from "../src/assistant";

const { engine } = createAssistant({ userId: "login-test", memoryRoot: join(tmpdir(), "fx-login-test"), confirm: async () => false, clientVersion: "login-test" });
await engine.start();
if (!(await engine.account()).loggedIn) await engine.login((msg) => console.log(msg));
console.log(`test home account: ${(await engine.account()).description}`);
await engine.close();
process.exit(0);
