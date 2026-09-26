import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { correctUrl, extractUrls } from "./appServer";
import type {
  AccountStatus,
  ClientTool,
  Engine,
  EngineEvent,
  EphemeralResult,
  SessionInfo,
  SkillInfo,
  StoredSession,
  ToolOutcome,
  TranscriptEntry,
} from "./types";

/**
 * A scripted engine for building and testing front ends without the model
 * (FX_ENGINE=fake). It streams canned replies and calls the REAL client tools
 * (register, checklists, reminders), so confirmation questions, receipts and
 * official sources are the app's own. Replies are picked by keywords in the
 * user's message; nothing here is advice. Never used by the CLI unless asked.
 */
export class FakeEngine implements Engine {
  private busy = false;
  private stopRequested = false;
  private log: TranscriptEntry[] = [];
  private toolUrls = new Set<string>();
  private threadId: string = randomUUID();
  /** Conversations started in this process (a fake engine stores nothing on disk). */
  private readonly stored = new Map<string, Date>();
  /** Every message of each conversation (readTranscript). */
  private readonly threads = new Map<string, TranscriptEntry[]>();

  constructor(
    private readonly opts: {
      tools: () => ClientTool[];
      codexHome: string;
      /** Milliseconds between streamed chunks (0 in tests). */
      delayMs?: number;
    },
  ) {}

  async start(): Promise<void> {}
  async account(): Promise<AccountStatus> {
    return { loggedIn: true, description: "Demo (fake engine: scripted replies, no model)" };
  }
  async login(onPrompt: (message: string) => void): Promise<void> {
    onPrompt("Open https://auth.openai.com/codex/device and enter code: DEMO-12345");
    await sleep(1500);
  }
  async newSession(): Promise<SessionInfo> {
    this.threadId = randomUUID();
    this.stored.set(this.threadId, new Date());
    this.log = [];
    this.toolUrls.clear();
    return this.info();
  }
  async resumeSession(threadId: string): Promise<SessionInfo> {
    this.threadId = threadId;
    this.log = [];
    return this.info();
  }
  listSkills(): SkillInfo[] {
    const dir = join(this.opts.codexHome, "skills");
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
      .map((d) => {
        const md = readFileSync(join(dir, d.name, "SKILL.md"), "utf8");
        return { name: d.name, description: /^description:\s*(.*)$/m.exec(md)?.[1] ?? "", path: join(dir, d.name, "SKILL.md") };
      });
  }
  isBusy(): boolean {
    return this.busy;
  }
  async steer(): Promise<boolean> {
    return false;
  }
  async readTranscript(threadId: string): Promise<TranscriptEntry[]> {
    return [...(this.threads.get(threadId) ?? [])];
  }
  private thread(): TranscriptEntry[] {
    let t = this.threads.get(this.threadId);
    if (!t) this.threads.set(this.threadId, (t = []));
    return t;
  }
  transcript(): TranscriptEntry[] {
    return [...this.log];
  }
  async runEphemeral(_prompt: string, opts: { outputSchema?: object }): Promise<EphemeralResult> {
    const props = (opts.outputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
    // search_official_sources expects {answer, sources}; session summaries expect {items}.
    if ("answer" in props)
      return {
        text: JSON.stringify({
          answer: "(Demo answer from the fake engine: not checked.) Final pay is usually due within 7 days of the last day under most awards.",
          sources: [{ title: "Fair Work: Final pay", url: "https://www.fairwork.gov.au/ending-employment/final-pay" }],
        }),
        webSearches: [],
      };
    return { text: JSON.stringify({ items: [] }), webSearches: [] };
  }
  async listStoredSessions(): Promise<StoredSession[]> {
    return [...this.stored].map(([threadId, updatedAt]) => ({ threadId, preview: "", updatedAt }));
  }
  async deleteStoredSession(threadId: string): Promise<void> {
    this.stored.delete(threadId);
  }
  setServiceTier(): void {}
  async interrupt(): Promise<void> {
    this.stopRequested = true;
  }
  async close(): Promise<void> {}

  async *send(text: string, opts: { skill?: string } = {}): AsyncIterable<EngineEvent> {
    this.busy = true;
    this.stopRequested = false;
    this.log.push({ role: "user", text });
    this.thread().push({ role: "user", text });
    const out: EngineEvent[] = [];
    const parts: string[] = [];
    let status: "completed" | "interrupted" | "failed" = "completed";
    try {
      if (opts.skill) yield { type: "skill_loaded", name: opts.skill };
      for await (const ev of this.script(text)) {
        if (this.stopRequested) {
          status = "interrupted";
          break;
        }
        if (ev.type === "text_done") parts.push(ev.text);
        if (ev.type === "turn_end") {
          status = ev.status;
          break;
        }
        yield ev;
      }
    } finally {
      this.busy = false;
    }
    if (this.stopRequested && status === "completed") status = "interrupted";
    if (parts.length) {
      // Same guard as the real engine: links no tool returned are flagged; shortened ones corrected.
      const reply = parts.join("\n\n");
      this.log.push({ role: "assistant", text: reply });
      this.thread().push({ role: "assistant", text: reply });
      const fixes: { from: string; to: string }[] = [];
      const unverified: string[] = [];
      for (const u of new Set(extractUrls(reply).filter((u) => !this.toolUrls.has(u)))) {
        const to = correctUrl(u, this.toolUrls);
        if (to) fixes.push({ from: u, to });
        else unverified.push(u);
      }
      if (fixes.length) out.push({ type: "links_corrected", fixes });
      if (unverified.length) out.push({ type: "unverified_links", urls: unverified });
    }
    for (const ev of out) yield ev;
    yield { type: "usage", inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    yield { type: "turn_end", status };
  }

  // ------------------------------------------------------------------ scripts

  private async *script(text: string): AsyncIterable<EngineEvent> {
    const t = text.toLowerCase();
    if (/\berror\b|出错/.test(t)) {
      yield* this.say("Let me look at that…");
      yield { type: "error", message: "Demo error: the fake engine was asked to fail.", willRetry: false };
      yield { type: "turn_end", status: "failed", error: "demo failure" };
      return;
    }
    if (/resign|quit|leaving|辞职|离职/.test(t)) return yield* this.leaving(text);
    if (/this week|remind|what('s| is) due|提醒|到期/.test(t) && !/final pay|最终工资/.test(t)) return yield* this.reminders();
    if (/calculat|算一下|总共/.test(t)) {
      yield* this.say("A Saturday shift of 8 hours at $32.10 an hour is 8 × $32.10 × 1.5 = $385.20 before tax.\n\nCheck the rate in the Pay and Conditions Tool before you rely on it.");
      return;
    }
    if (/\blink|链接/.test(t)) {
      yield* this.say("Here is a page that explains it: https://www.fairwork.gov.au/made-up-page-for-the-demo\n\n(The fake engine invented this link on purpose, to show the unverified-link warning.)");
      return;
    }
    if (/final pay|最终工资/.test(t)) {
      const r = yield* this.tool("search_official_sources", { question: "When is final pay due and what does it include?" });
      const src = extractUrls(r?.text ?? "")[0];
      yield* this.say(`**Final pay** is usually due within 7 days of the last day under most awards${src ? ` ([Fair Work: Final pay](${src}))` : ""}.\n\nIt includes:\n- wages for hours worked up to the last day;\n- unused annual leave (with loading, if the award has it);\n- notice paid in lieu, if they don't work the notice.\n\n_Demo reply from the fake engine._`);
      return;
    }
    yield* this.say(
      `**Demo mode** (fake engine: scripted replies, no model, no quota).\n\nYou said: "${text.slice(0, 200)}"\n\nTry one of these to see the screens:\n- "Priya is resigning, last day Friday 9 Oct" (checklist, register change to confirm, sources)\n- "What do I need to do this week?" (reminders)\n- "When is final pay due?" (official sources)\n- "calculate a Saturday shift" (pay calculation warning)\n- "send me a link" (unverified link warning)\n- "error" (a failed reply)`,
    );
  }

  private async *leaving(text: string): AsyncIterable<EngineEvent> {
    const list = yield* this.tool("list_employees", { include_left: false });
    const people = [...(list?.text ?? "").matchAll(/\[(\d+)\] ([^|\n]+)/g)].map((m) => ({ id: Number(m[1]), name: m[2].trim() }));
    const who = people.find((p) => text.toLowerCase().includes(p.name.split(" ")[0].toLowerCase()));
    const checklist = yield* this.tool("leaving_checklist", { reason: "resignation", is_apprentice_or_trainee: false, is_casual: false, is_sponsored_visa: false });
    const urls = extractUrls(checklist?.text ?? "");
    const finalPay = urls.find((u) => u.includes("final-pay"));
    const separation = urls.find((u) => u.includes("separation"));
    const name = who?.name.split(" ")[0] ?? "they";
    const last = /(\d{1,2})\s*(oct|october|十月)/i.exec(text) ? "2026-10-09" : null;
    yield* this.say(
      `Thanks for letting me know. Here's what to do before ${name === "they" ? "their" : `${name}'s`} last day:\n\n` +
        "1. **Confirm in writing.** Acknowledge the resignation and the last day. I can draft the letter.\n" +
        `2. **Final pay.** Pay it within the time the award sets (most say within 7 days). Include unused annual leave with loading; personal/carer's leave isn't paid out.${finalPay ? ` [Fair Work: Final pay](${finalPay})` : ""}\n` +
        `3. **Records and certificates.** Keep the records for 7 years; complete a separation certificate if asked.${separation ? ` [Services Australia](${separation})` : ""}\n`,
    );
    if (who) {
      const saved = yield* this.tool("update_employee", { id: who.id, changes: { status: "left", ...(last ? { leftDate: last } : {}) } });
      yield* this.say(saved?.display?.includes("not saved") ? "Okay, I haven't changed the register." : `Done: ${who.name} is marked as left in the register.`);
    } else {
      yield* this.say("I couldn't find them in the register, so I haven't changed it.");
    }
  }

  private async *reminders(): AsyncIterable<EngineEvent> {
    const r = yield* this.tool("get_reminders", {});
    const lines = (r?.text ?? "").split("\n").filter((l) => l.startsWith("- ")).slice(0, 5);
    yield* this.say(lines.length ? `Here's what needs your attention:\n\n${lines.map((l) => l.replace(/ Source: .*$/, "")).join("\n")}\n\n_Demo reply from the fake engine._` : "Nothing is due in the next 30 days.");
  }

  /** Calls a real client tool, like the model would, and reports its activity. */
  private async *tool(name: string, args: unknown): AsyncGenerator<EngineEvent, ToolOutcome | null> {
    const tool = this.opts.tools().find((x) => x.name === name);
    if (!tool) return null;
    await sleep(this.opts.delayMs === 0 ? 0 : 250);
    const out = await tool.handle(args).catch((e: Error): ToolOutcome => ({ success: false, text: `tool failed: ${e.message}` }));
    for (const u of extractUrls(out.text)) this.toolUrls.add(u);
    if (out.display) yield { type: "tool_activity", summary: out.display, ...(out.files?.length ? { files: out.files } : {}) };
    return out;
  }

  /** Streams one message in small chunks, then its full text. */
  private async *say(text: string): AsyncIterable<EngineEvent> {
    const delay = this.opts.delayMs ?? 18;
    for (let i = 0; i < text.length; ) {
      if (this.stopRequested) return;
      const n = 3 + Math.floor(Math.random() * 5);
      yield { type: "text_delta", text: text.slice(i, i + n) };
      i += n;
      if (delay) await sleep(delay);
    }
    yield { type: "text_done", text };
  }

  private info(): SessionInfo {
    return { threadId: this.threadId, model: "fake", reasoningEffort: null, serviceTier: null, sandbox: "none", approvalPolicy: "never" };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
