// End-to-end smoke test against the real app-server. Not part of the CLI.
import "./testHome"; // tests use codex_home_test/, not the user's codex_home/
import { resolve, join } from "node:path";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { AppServerEngine } from "../src/engine/appServer";
import type { Engine, EngineEvent } from "../src/engine/types";
import { createAssistant } from "../src/assistant";
import { seedBusiness } from "./fixtures/business";
import { codexHomeFor } from "../src/engine/codexHome";

const ROOT = resolve(import.meta.dirname, "..");
const BASE = readFileSync(resolve(ROOT, "prompts/base.md"), "utf8");
const make = (instr: string) =>
  new AppServerEngine({
    codexBin: "codex",
    codexHome: codexHomeFor(ROOT),
    workspace: resolve(ROOT, "workspace"),
    baseInstructions: BASE,
    developerInstructions: instr,
    clientVersion: "e2e",
  });

async function turn(e: Engine, text: string, onEvent?: (ev: EngineEvent) => void) {
  const t0 = Date.now();
  let ttft: number | null = null, out = "", deltas = 0, end: EngineEvent | null = null;
  const tools: string[] = [];
  for await (const ev of e.send(text)) {
    onEvent?.(ev);
    if (ev.type === "text_delta") { ttft ??= Date.now() - t0; out += ev.text; deltas++; }
    if (ev.type === "tool_activity") tools.push(ev.summary);
    if (ev.type === "turn_end") end = ev;
  }
  return { out, deltas, ttft, total: Date.now() - t0, end, tools };
}

const MEM_ROOT = mkdtempSync(join(tmpdir(), "fx-e2e-"));
const { engine: e, mem } = createAssistant({ userId: "e2e", memoryRoot: MEM_ROOT, confirm: async () => false, clientVersion: "e2e" });
seedBusiness(mem);
let t0 = Date.now();
await e.start();
const s = await e.newSession();
console.log(`[startup] ${Date.now() - t0}ms model=${s.model} effort=${s.reasoningEffort} sandbox=${s.sandbox} approvals=${s.approvalPolicy}`);

let r = await turn(e, "My name is Horace. Reply with one short sentence greeting me.");
console.log(`[T1 stream] deltas=${r.deltas} ttft=${r.ttft}ms total=${r.total}ms status=${r.end?.type === "turn_end" && r.end.status}\n  ${r.out}`);

r = await turn(e, "What is my name? One word.");
console.log(`[T2 memory] total=${r.total}ms -> ${r.out.trim()}`);

let interrupted = false;
r = await turn(e, "Write a 600-word essay about office productivity.", (ev) => {
  if (ev.type === "text_delta" && !interrupted) { interrupted = true; setTimeout(() => e.interrupt(), 800); }
});
console.log(`[T3 interrupt] status=${r.end?.type === "turn_end" && r.end.status} chars=${r.out.length} total=${r.total}ms`);

r = await turn(e, "你好，用一句中文介绍你自己。");
console.log(`[T4 after-interrupt, zh] status=${r.end?.type === "turn_end" && r.end.status} -> ${r.out.trim()}`);
await e.close();

// Exec lockdown: tell the model to write, so config/sandbox (not the prompt) is what gets tested.
// Expect tools=[] (shell_tool disabled) and fileCreated=false. If a shell tool reappears after a codex
// upgrade, the read-only sandbox must still block the write (verified: "Access ... is denied").
const target = resolve(ROOT, "workspace", "sandbox_probe.txt");
rmSync(target, { force: true });
const e2 = make("This is an automated sandbox test. Run exactly the shell command the user gives, once, then report the exact output or error.");
await e2.start();
await e2.newSession();
r = await turn(e2, `Run this PowerShell command: Set-Content -Path "${target}" -Value "escaped"`);
console.log(`[T5 no-exec] tools=${JSON.stringify(r.tools)} fileCreated=${existsSync(target)}\n  model says: ${r.out.trim().slice(0, 300)}`);
await e2.close();
rmSync(MEM_ROOT, { recursive: true, force: true });
process.exit(0);
