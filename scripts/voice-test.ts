// Voice checks (plan C): GPT-Live + client delegation to the HR assistant.
// A synthetic microphone streams Windows-TTS questions (then silence) in real time.
// Needs VOICE_OPENAI_API_KEY in .env, ffmpeg on PATH, and Windows speech voices.
import "./testHome"; // tests use codex_home_test/, not the user's codex_home/
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createAssistant, ROOT } from "../src/assistant";
import { seedBusiness } from "./fixtures/business";
import { LiveSession } from "../src/voice/liveSession";
import { VoiceBridge, selectUtterance } from "../src/voice/bridge";
import { CHUNK_BYTES } from "../src/voice/audio";

type Check = [string, boolean];
const results: { name: string; checks: Check[]; detail?: string }[] = [];
const record = (name: string, checks: Check[], detail?: string) => { results.push({ name, checks, detail }); process.stdout.write("."); };

// ------------------------------------------------------------ unit: which words are the request
{
  const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });
  const smallTalk = selectUtterance(
    [w(" Hi", 0, 200), w(" can you hear me", 300, 900), w(" What", 3000, 3200), w(" is the leave policy", 3300, 4200)],
    [{ startMs: 1200, endMs: 2500 }, { startMs: 4600, endMs: 5200 }],
    -1,
  );
  const bargeIn = selectUtterance(
    [w(" Actually", 10000, 10300), w(" never mind", 10400, 10900), w(" tell me the bonus", 11000, 12000)],
    [{ startMs: 9000, endMs: 10600 }],
    -1,
  );
  const pause = selectUtterance([w(" Can you check", 0, 800), w(" the parental leave", 2000, 3000)], [], -1);
  record("unit: request = last utterance", [
    ["small talk dropped", smallTalk.text === "What is the leave policy"],
    ["barge-in kept whole", bargeIn.text === "Actually never mind tell me the bonus"],
    ["pause without voice kept whole", pause.text === "Can you check the parental leave"],
    ["consumed up to the last word", smallTalk.consumedUntilMs === 4200],
  ], JSON.stringify([smallTalk, bargeIn, pause]));
}

try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* checked below */ }
const apiKey = process.env.VOICE_OPENAI_API_KEY;
if (!apiKey) { console.log("\nSKIP live checks: VOICE_OPENAI_API_KEY not set in .env"); process.exit(0); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ fixtures (Windows TTS → PCM 24 kHz)
const TMP = mkdtempSync(join(tmpdir(), "fx-voice-test-"));
function say(name: string, text: string, voice: string): Buffer {
  const wav = join(TMP, `${name}.wav`);
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('${voice}'); $s.SetOutputToWaveFile('${wav}'); $s.Speak('${text.replace(/'/g, "''")}'); $s.Dispose()`;
  spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
  const r = spawnSync("ffmpeg", ["-loglevel", "error", "-i", wav, "-ac", "1", "-ar", "24000", "-f", "s16le", "-"], { maxBuffer: 50 * 1024 * 1024 });
  return r.stdout;
}
const Q = {
  hi: say("hi", "Hi, can you hear me?", "Microsoft Zira Desktop"),
  leave: say("leave", "What paid parental leave do we offer?", "Microsoft Zira Desktop"),
  probation: say("probation", "And how long is probation for permanent staff?", "Microsoft Zira Desktop"),
  zh: say("zh", "员工每年有几天心理健康假？", "Microsoft Huihui Desktop"),
  wage: say("wage", "What is the national minimum wage in Australia right now?", "Microsoft Zira Desktop"),
  change: say("change", "Actually, never mind that. Tell me the employee referral bonus instead.", "Microsoft Zira Desktop"),
};

// ------------------------------------------------------------ setup
const MEM_ROOT = join(TMP, "memory");
const { engine, mem } = createAssistant({ userId: "voice-test", memoryRoot: MEM_ROOT, confirm: async () => false, serviceTier: "priority", clientVersion: "voice-test" });
seedBusiness(mem);
await engine.start();
await engine.newSession();

const live = new LiveSession({ apiKey, model: process.env.VOICE_MODEL || "gpt-live-1", voice: process.env.VOICE_NAME || "gleam", instructions: readFileSync(join(ROOT, "prompts/voice.md"), "utf8") });
let spoken = "";
let delegations = 0;
const requests: string[] = [];
const modes: string[] = [];
let firstAudioAfter: number | null = null;
let lastAudioAt = 0;
let lastTurnEndAt = 0;
let lastAnswer = "";
live.on("outputTranscript", (d) => { spoken += d.text; lastAudioAt = Date.now(); });
live.on("delegation", () => delegations++);
// GPT-Live bills per second (US$0.05/min); the final usage arrives with session.closed.
let billedSeconds = 0;
live.on("usage", (s) => (billedSeconds = s));
live.on("error", (m) => console.log("\nlive error:", m));
new VoiceBridge(live, engine, {
  onRequest: (t, mode) => { requests.push(t); modes.push(mode); },
  onEvent: (ev) => { if (ev.type === "turn_end") lastTurnEndAt = Date.now(); if (ev.type === "text_done") lastAnswer = ev.text; },
  onError: (m) => console.log("\nbridge error:", m),
});
await live.start();

// Synthetic mic: continuous 100 ms chunks, silence unless an utterance is queued.
let queue = Buffer.alloc(0);
const mic = setInterval(() => {
  const chunk = queue.length ? queue.subarray(0, CHUNK_BYTES) : Buffer.alloc(CHUNK_BYTES);
  queue = queue.subarray(Math.min(queue.length, CHUNK_BYTES));
  live.appendAudio(chunk.length === CHUNK_BYTES ? chunk : Buffer.concat([chunk, Buffer.alloc(CHUNK_BYTES - chunk.length)]));
}, 100);

/** Speak an utterance, then wait until GPT-Live has been quiet for `quietMs` (or the timeout). */
async function ask(pcm: Buffer, timeoutMs: number, quietMs = 4000) {
  spoken = "";
  const d0 = delegations;
  const r0 = requests.length;
  const t0 = Date.now();
  queue = Buffer.concat([queue, pcm]);
  await sleep(pcm.length / 48);
  firstAudioAfter = null;
  const done = Date.now() + timeoutMs;
  while (Date.now() < done) {
    await sleep(250);
    if (firstAudioAfter === null && lastAudioAt > t0) firstAudioAfter = lastAudioAt - (t0 + pcm.length / 48);
    const busy = engine.isBusy();
    const delegated = delegations > d0;
    const answered = !delegated || (lastTurnEndAt > t0 && lastAudioAt > lastTurnEndAt);
    if (!busy && answered && lastAudioAt > t0 && Date.now() - lastAudioAt > quietMs && Date.now() - t0 > 6000) break;
  }
  return { spoken: spoken.trim(), delegated: delegations - d0, newRequests: requests.slice(r0), ms: Date.now() - t0 };
}

let r = await ask(Q.hi, 15000, 2500);
record("small talk: no delegation", [["not delegated", r.delegated === 0], ["replied", r.spoken.length > 0]], r.spoken);

r = await ask(Q.leave, 60000);
record(`EN: parental leave via HR assistant (${(r.ms / 1000).toFixed(0)}s)`, [
  ["delegated", r.delegated >= 1],
  ["small talk not carried into the request", r.newRequests.every((t) => !/hear me/i.test(t))],
  ["request reached Codex", r.newRequests.some((t) => /parental/i.test(t))],
  ["spoke the profile answer", /(3|three) months/i.test(r.spoken)],
], `requests=${JSON.stringify(r.newRequests)} spoken=${r.spoken}`);

r = await ask(Q.probation, 60000);
const userTurns = engine.transcript().filter((m) => m.role === "user").length;
record("follow-up continues the same Codex thread", [
  ["delegated", r.delegated >= 1],
  ["same thread (2+ user turns)", userTurns >= 2],
  ["spoke 6 months", /(6|six)[ -]months?/i.test(r.spoken)],
], `turns=${userTurns} spoken=${r.spoken}`);

// Interrupt while the HR assistant is still working (official-source research takes 15-25 s).
{
  spoken = "";
  const m0 = modes.length;
  queue = Buffer.concat([queue, Q.wage]);
  const t0 = Date.now();
  while (!engine.isBusy() && Date.now() - t0 < 25000) await sleep(200);
  const busyWhenInterrupted = engine.isBusy();
  await sleep(3000);
  spoken = "";
  const r = await ask(Q.change, 90000, 5000);
  const newModes = modes.slice(m0);
  record("interrupt while working: steered or queued", [
    ["assistant was busy when the user spoke", busyWhenInterrupted],
    ["second request reached the assistant", requests.slice(-3).some((t) => /ref-?erral|bonus/i.test(t))],
    // Either the "never mind" reached the assistant with the new request, or the voice
    // acknowledged the cancellation itself before the user went on (both are correct).
    ["cancellation not lost", requests.slice(-3).some((t) => /never ?mind/i.test(t)) || /stop|drop|never ?mind|no problem|cancel/i.test(r.spoken)],
    ["it was a steer (or queued after the turn)", newModes.length >= 2],
    ["spoke the new answer (referral bonus)", /1[,.]?500|fifteen hundred|one thousand five hundred/i.test(r.spoken)],
  ], `modes=${JSON.stringify(newModes)} requests=${JSON.stringify(requests.slice(-3))} spoken=${r.spoken} || codex=${lastAnswer.slice(0, 200)}`);
}

r = await ask(Q.zh, 60000);
record("ZH: wellness day in Mandarin", [
  ["delegated", r.delegated >= 1],
  ["spoke one day in Chinese", /一天|1天|1 天/.test(r.spoken)],
], `requests=${JSON.stringify(r.newRequests)} spoken=${r.spoken}`);

clearInterval(mic);
live.close();
await sleep(2000); // wait for session.closed, which carries the final billed seconds
await engine.close();
rmSync(TMP, { recursive: true, force: true });

console.log();
let fail = 0;
for (const x of results) {
  const ok = x.checks.every(([, v]) => v);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${x.name}`);
  for (const [n, v] of x.checks) if (!v) console.log(`      x ${n}`);
  if (x.detail) console.log(`      ${ok ? "" : "detail: "}${x.detail.replace(/\n/g, " ").slice(0, 400)}`);
}
console.log(`COST: GPT-Live billed ${billedSeconds}s this run, about US$${((billedSeconds / 60) * 0.05).toFixed(2)}`);
process.exit(fail ? 1 : 0);
