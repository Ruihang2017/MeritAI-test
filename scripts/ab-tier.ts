// A/B: standard vs "priority" (Fast) service tier. Variants are interleaved per rep
// so both see the same network/server conditions. Fresh thread per request.
import "./testHome"; // tests use codex_home_test/, not the user's codex_home/
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { AppServerEngine } from "../src/engine/appServer";
import { codexHomeFor } from "../src/engine/codexHome";

const ROOT = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const REPS = Number(process.env.AB_REPS ?? 5);

const CASES = [
  { id: "short", text: "hi" },
  { id: "medium", text: "帮我写一封邮件给客户，说明他们租的挖掘机要延迟两天交付，语气礼貌。" },
  { id: "long", text: "Write a ~400-word internal announcement introducing a new equipment booking process for site managers: why it's changing, the three new steps, the go-live date [Date], and who to contact." },
];
const TIERS = ["default", "priority"] as const;

const engines = new Map<string | undefined, AppServerEngine>();
for (const t of TIERS) {
  const e = new AppServerEngine({
    codexBin: "codex", codexHome: codexHomeFor(ROOT), workspace: resolve(ROOT, "workspace"),
    baseInstructions: read("prompts/base.md"), developerInstructions: read("prompts/developer.md"),
    serviceTier: t, clientVersion: "ab-tier",
  });
  await e.start();
  engines.set(t, e);
}

type R = { tier: string; id: string; ttft: number; total: number; out: number; applied: string };
const rows: R[] = [];
for (let rep = 0; rep < REPS; rep++) {
  for (const c of CASES) {
    const order = rep % 2 ? [...TIERS].reverse() : TIERS;
    for (const t of order) {
      const e = engines.get(t)!;
      const s = await e.newSession();
      const t0 = Date.now();
      let ttft = -1, out = 0;
      for await (const ev of e.send(c.text)) {
        if (ev.type === "text_delta" && ttft < 0) ttft = Date.now() - t0;
        if (ev.type === "usage") out += ev.outputTokens;
      }
      rows.push({ tier: t ?? "standard", id: c.id, ttft, total: Date.now() - t0, out, applied: s.serviceTier ?? "null" });
      process.stdout.write(".");
    }
  }
}
for (const e of engines.values()) await e.close();
console.log();

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log(`reps=${REPS}  (median / p80, ms)   applied tiers: ${[...new Set(rows.map((r) => `${r.tier}->${r.applied}`))].join(", ")}`);
console.log("case    tier       ttft_med  ttft_p80  total_med  total_p80  out_tok  gen_tok/s");
for (const c of CASES) for (const t of TIERS) {
  const rs = rows.filter((r) => r.id === c.id && r.tier === (t ?? "standard"));
  const gen = rs.map((r) => r.out / Math.max(0.001, (r.total - r.ttft) / 1000));
  console.log(`${c.id.padEnd(7)} ${(t ?? "standard").padEnd(9)} ${String(q(rs.map((r) => r.ttft), 0.5)).padStart(9)} ${String(q(rs.map((r) => r.ttft), 0.8)).padStart(9)} ${String(q(rs.map((r) => r.total), 0.5)).padStart(10)} ${String(q(rs.map((r) => r.total), 0.8)).padStart(10)} ${String(q(rs.map((r) => r.out), 0.5)).padStart(8)} ${q(gen, 0.5).toFixed(0).padStart(10)}`);
}
process.exit(0);
