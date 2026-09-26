import type { ServerNotification } from "../protocol/ServerNotification";
import type { ServerRequest } from "../protocol/ServerRequest";
import type { InitializeResponse } from "../protocol/InitializeResponse";
import type { GetAccountResponse } from "../protocol/v2/GetAccountResponse";
import type { LoginAccountResponse } from "../protocol/v2/LoginAccountResponse";
import type { ThreadStartResponse } from "../protocol/v2/ThreadStartResponse";
import type { ThreadResumeResponse } from "../protocol/v2/ThreadResumeResponse";
import type { ThreadListResponse } from "../protocol/v2/ThreadListResponse";
import type { ThreadReadResponse } from "../protocol/v2/ThreadReadResponse";
import type { TurnStartResponse } from "../protocol/v2/TurnStartResponse";
import type { ThreadItem } from "../protocol/v2/ThreadItem";
import type { SkillsListResponse } from "../protocol/v2/SkillsListResponse";
import type { DynamicToolSpec } from "../protocol/v2/DynamicToolSpec";
import type { DynamicToolCallResponse } from "../protocol/v2/DynamicToolCallResponse";
import type { UserInput } from "../protocol/v2/UserInput";
import type { AskForApproval } from "../protocol/v2/AskForApproval";
import type { SandboxPolicy } from "../protocol/v2/SandboxPolicy";
import type { JsonValue } from "../protocol/serde_json/JsonValue";
import { readFile } from "node:fs/promises";
import { AppServerConnection } from "./rpc";
import type {
  AccountStatus,
  ClientTool,
  Engine,
  EngineEvent,
  SessionInfo,
  SkillInfo,
  StoredSession,
  ToolOutcome,
  TranscriptEntry,
  EphemeralResult,
  WebSearchRecord,
} from "./types";

export interface AppServerEngineOptions {
  codexBin: string;
  /** Isolated CODEX_HOME: our config.toml + our own auth, never the user's ~/.codex. */
  codexHome: string;
  /** Working directory the agent sees (and, in read-only mode, can only read). */
  workspace: string;
  /** Replaces Codex's built-in (coding-agent) system prompt. Omit to keep Codex's. */
  baseInstructions?: string;
  /** Developer instructions; a function is re-evaluated for every new session (e.g. fresh memory). */
  developerInstructions: string | (() => string);
  /** Extra client-implemented tools, rebuilt for every new session. load_skill is built in. */
  tools?: () => ClientTool[];
  /** "priority" (Fast: ~1.5x speed, more usage) or "default" (standard). Omit for the server default. */
  serviceTier?: string;
  clientVersion: string;
  onLog?: (line: string) => void;
}

/** Async queue bridging push-style notifications into an AsyncIterable. */
class EventQueue<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private done = false;

  push(item: T): void {
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.items.length) yield this.items.shift()!;
      else if (this.done) return;
      else {
        const r = await new Promise<IteratorResult<T>>((res) => this.waiters.push(res));
        if (r.done) return;
        yield r.value;
      }
    }
  }
}

interface ActiveTurn {
  turnId: string | null;
  queue: EventQueue<EngineEvent>;
  replyParts: string[];
}

const LOAD_SKILL = "load_skill";
const EPHEMERAL_TIMEOUT_MS = 90_000;

export class AppServerEngine implements Engine {
  private conn!: AppServerConnection;
  private threadId: string | null = null;
  private active: ActiveTurn | null = null;
  private serviceTier: string | null;
  /** Tier change to send with the next turn/start (applies to that and later turns). */
  private pendingTier: string | null = null;
  /** Text prepended to the next user message (fresh memory after a resume). */
  private pendingContext: string | null = null;
  private log: TranscriptEntry[] = [];
  /** URLs that tools returned in this session; replies may cite only these. */
  private toolUrls = new Set<string>();
  /**
   * Skill allowlist: enabled, user-scope skills in CODEX_HOME/skills (Codex's own
   * system skills are excluded). load_skill and explicit invocation only accept these.
   */
  private skills = new Map<string, SkillInfo>();
  /** Client tools for the current session, by name. */
  private tools = new Map<string, ClientTool>();

  constructor(private readonly opts: AppServerEngineOptions) {
    this.serviceTier = opts.serviceTier ?? null;
  }

  async start(): Promise<void> {
    this.conn = new AppServerConnection({
      codexBin: this.opts.codexBin,
      args: [],
      cwd: this.opts.workspace,
      env: { ...process.env, CODEX_HOME: this.opts.codexHome },
    });
    this.conn.on("stderr", (l) => this.opts.onLog?.(l));
    this.conn.on("notification", (n) => this.onNotification(n));
    this.conn.on("request", (r) => this.onServerRequest(r));
    this.conn.on("exit", (code) => {
      if (this.active) {
        this.active.queue.push({ type: "turn_end", status: "failed", error: `engine exited (${code})` });
        this.active.queue.end();
        this.active = null;
      }
    });

    (await this.conn.request("initialize", {
      clientInfo: { name: "fx-chatbot", title: "FX Chatbot", version: this.opts.clientVersion },
      // Needed for dynamicTools (client-implemented tools such as load_skill).
      capabilities: { experimentalApi: true, requestAttestation: false },
    })) as InitializeResponse;
    this.conn.notify("initialized");
    await this.refreshSkills();
  }

  // ---------------------------------------------------------------- account

  async account(): Promise<AccountStatus> {
    const res = (await this.conn.request("account/read", {})) as GetAccountResponse;
    const a = res.account;
    if (!a) return { loggedIn: !res.requiresOpenaiAuth, description: "not logged in" };
    if (a.type === "chatgpt") return { loggedIn: true, description: `ChatGPT ${a.email ?? ""} (${a.planType})` };
    return { loggedIn: true, description: a.type };
  }

  async login(onPrompt: (message: string) => void): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      await this.conn.request("account/login/start", { type: "apiKey", apiKey });
      return;
    }
    // Device-code flow: works from a headless CLI, no local callback server needed.
    const completed = new Promise<void>((resolve, reject) => {
      const onN = (n: ServerNotification) => {
        if (n.method !== "account/login/completed") return;
        this.conn.off("notification", onN);
        n.params.success ? resolve() : reject(new Error(n.params.error ?? "login failed"));
      };
      this.conn.on("notification", onN);
    });
    const res = (await this.conn.request("account/login/start", {
      type: "chatgptDeviceCode",
    })) as LoginAccountResponse;
    if (res.type !== "chatgptDeviceCode") throw new Error(`unexpected login response: ${res.type}`);
    onPrompt(`Open ${res.verificationUrl} and enter code: ${res.userCode}`);
    await completed;
  }

  // ----------------------------------------------------------------- skills

  listSkills(): SkillInfo[] {
    return [...this.skills.values()];
  }

  private async refreshSkills(): Promise<void> {
    const res = (await this.conn.request("skills/list", {
      cwds: [this.opts.workspace],
      forceReload: true,
    })) as SkillsListResponse;
    this.skills.clear();
    for (const entry of res.data) {
      for (const s of entry.skills) {
        if (s.scope === "user" && s.enabled) {
          this.skills.set(s.name, { name: s.name, description: s.description, path: s.path });
        }
      }
      for (const e of entry.errors) this.opts.onLog?.(`[skill error] ${JSON.stringify(e)}`);
    }
  }

  private loadSkillTool(): ClientTool {
    return {
      name: LOAD_SKILL,
      description:
        "Load the full instructions of one of the available skills listed under '## Skills'. " +
        "Call this before answering whenever the user's request matches a skill's description.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", enum: [...this.skills.keys()], description: "Skill name" } },
        required: ["name"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const name = (args as { name?: unknown } | null)?.name;
        // Only allowlisted skills; the path comes from our own skills/list result, never from the model.
        const skill = typeof name === "string" ? this.skills.get(name) : undefined;
        if (!skill) {
          const available = [...this.skills.keys()].join(", ") || "none";
          return { success: false, text: `unknown skill "${String(name)}". Available: ${available}` };
        }
        const body = await readFile(skill.path, "utf8");
        this.active?.queue.push({ type: "skill_loaded", name: skill.name });
        return { success: true, text: `<skill name="${skill.name}">\n${body}\n</skill>` };
      },
    };
  }

  // --------------------------------------------------------------- sessions

  private developerInstructions(): string {
    const d = this.opts.developerInstructions;
    return typeof d === "function" ? d() : d;
  }

  async newSession(): Promise<SessionInfo> {
    const tools = [...(this.skills.size ? [this.loadSkillTool()] : []), ...(this.opts.tools?.() ?? [])];
    const res = (await this.conn.request("thread/start", {
      cwd: this.opts.workspace,
      // Hard boundary: enforced by the OS sandbox, independent of what the model is told.
      sandbox: "read-only",
      approvalPolicy: "never",
      baseInstructions: this.opts.baseInstructions ?? null,
      serviceTier: this.serviceTier,
      developerInstructions: this.developerInstructions(),
      dynamicTools: tools.length ? tools.map(toSpec) : null,
    })) as ThreadStartResponse;
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.enterThread(res.thread.id);
    return sessionInfo(res.thread.id, res);
  }

  async resumeSession(threadId: string, contextUpdate?: string): Promise<SessionInfo> {
    let res: ThreadResumeResponse;
    try {
      res = (await this.conn.request("thread/resume", {
        threadId,
        excludeTurns: true,
        serviceTier: this.serviceTier,
      })) as ThreadResumeResponse;
    } catch (e) {
      // Another app-server (the CLI and the browser UI at once, or two UIs) has this conversation open.
      if (/active writer/i.test((e as Error).message))
        throw new Error("This conversation is open in another MeritAI window or in the terminal (npm start). Close it there, or start a new conversation here.");
      throw e;
    }
    // The thread keeps the tool definitions it was created with; route calls to
    // this session's current handlers for the same names.
    const tools = [this.loadSkillTool(), ...(this.opts.tools?.() ?? [])];
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.enterThread(res.thread.id);
    this.pendingContext = contextUpdate ?? null;
    return sessionInfo(res.thread.id, res);
  }

  private enterThread(id: string): void {
    this.threadId = id;
    this.pendingTier = null;
    this.pendingContext = null;
    this.log = [];
    this.toolUrls = new Set();
  }

  transcript(): TranscriptEntry[] {
    return [...this.log];
  }

  async readTranscript(threadId: string): Promise<TranscriptEntry[]> {
    const res = (await this.conn.request("thread/read", { threadId, includeTurns: true })) as ThreadReadResponse;
    return transcriptOf(res.thread.turns ?? []);
  }

  async listStoredSessions(): Promise<StoredSession[]> {
    const out: StoredSession[] = [];
    let cursor: string | null = null;
    do {
      const page = (await this.conn.request("thread/list", {
        cursor,
        limit: 100,
        sortKey: "updated_at",
      })) as ThreadListResponse;
      for (const t of page.data) out.push({ threadId: t.id, preview: t.preview, updatedAt: new Date(t.updatedAt * 1000) });
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  }

  async deleteStoredSession(threadId: string): Promise<void> {
    await this.conn.request("thread/delete", { threadId });
  }

  // ------------------------------------------------------------------ turns

  send(text: string, opts: { skill?: string; images?: string[] } = {}): AsyncIterable<EngineEvent> {
    if (!this.threadId) throw new Error("no session; call newSession() first");
    if (this.active) throw new Error("a turn is already in progress");
    const input: UserInput[] = [];
    if (this.pendingContext) {
      input.push({ type: "text", text: this.pendingContext, text_elements: [] });
      this.pendingContext = null;
    }
    if (opts.skill) {
      const s = this.skills.get(opts.skill);
      if (!s) throw new Error(`unknown skill: ${opts.skill}`);
      // Explicit invocation: the server injects SKILL.md into the turn; no tool call needed.
      input.push({ type: "skill", name: s.name, path: s.path });
    }
    input.push({ type: "text", text, text_elements: [] });
    // Images the user attached (already copied into their Inbox by the client).
    for (const path of opts.images ?? []) input.push({ type: "localImage", path });
    this.log.push({ role: "user", text });

    const queue = new EventQueue<EngineEvent>();
    const turn: ActiveTurn = { turnId: null, queue, replyParts: [] };
    this.active = turn;
    const tierForTurn = this.pendingTier;

    this.conn
      .request("turn/start", {
        threadId: this.threadId,
        input,
        ...(tierForTurn ? { serviceTier: tierForTurn } : {}),
      })
      .then((r) => {
        turn.turnId ??= (r as TurnStartResponse).turn.id;
        if (tierForTurn && this.pendingTier === tierForTurn) this.pendingTier = null;
      })
      .catch((err: Error) => {
        queue.push({ type: "turn_end", status: "failed", error: err.message });
        queue.end();
        if (this.active === turn) this.active = null;
      });

    return queue;
  }

  async runEphemeral(
    prompt: string,
    opts: { instructions: string; outputSchema?: object; config?: Record<string, unknown> },
  ): Promise<EphemeralResult> {
    const res = (await this.conn.request("thread/start", {
      cwd: this.opts.workspace,
      sandbox: "read-only",
      approvalPolicy: "never",
      ephemeral: true,
      baseInstructions: opts.instructions,
      serviceTier: this.serviceTier,
      config: (opts.config ?? null) as { [key: string]: JsonValue } | null,
    })) as ThreadStartResponse;
    const threadId = res.thread.id;

    let reply = "";
    const webSearches: WebSearchRecord[] = [];
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.conn.off("notification", onN);
        reject(new Error("background request timed out"));
      }, EPHEMERAL_TIMEOUT_MS);
      const onN = (n: ServerNotification) => {
        if (n.method === "item/completed" && n.params.threadId === threadId) {
          const item = n.params.item;
          if (item.type === "agentMessage") reply = item.text;
          if (item.type === "webSearch") webSearches.push(toWebSearchRecord(item));
        }
        if (n.method === "turn/completed" && n.params.threadId === threadId) {
          clearTimeout(timer);
          this.conn.off("notification", onN);
          const t = n.params.turn;
          t.status === "completed" ? resolve() : reject(new Error(t.error?.message ?? `turn ${t.status}`));
        }
      };
      this.conn.on("notification", onN);
    });
    await this.conn.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      outputSchema: (opts.outputSchema ?? null) as JsonValue,
    });
    await done;
    return { text: reply, webSearches };
  }

  isBusy(): boolean {
    return this.active !== null;
  }

  async steer(text: string): Promise<boolean> {
    const turn = this.active;
    if (!turn?.turnId || !this.threadId) return false;
    try {
      await this.conn.request("turn/steer", {
        threadId: this.threadId,
        expectedTurnId: turn.turnId,
        input: [{ type: "text", text, text_elements: [] }],
      });
    } catch (e) {
      // The turn may have just finished; the caller falls back to send().
      this.opts.onLog?.(`[steer failed] ${(e as Error).message}`);
      return false;
    }
    this.log.push({ role: "user", text });
    return true;
  }

  setServiceTier(tier: string): void {
    this.serviceTier = tier;
    if (this.threadId) this.pendingTier = tier;
  }

  async interrupt(): Promise<void> {
    const turn = this.active;
    if (!turn?.turnId || !this.threadId) return;
    await this.conn.request("turn/interrupt", { threadId: this.threadId, turnId: turn.turnId });
  }

  async close(): Promise<void> {
    this.conn?.close();
  }

  // --------------------------------------------------------- server events

  private onNotification(n: ServerNotification): void {
    if (n.method === "thread/settings/updated" && n.params.threadId === this.threadId) {
      const s = n.params.threadSettings;
      this.opts.onLog?.(`[settings] model=${s.model} effort=${s.effort} serviceTier=${s.serviceTier}`);
    }
    const turn = this.active;
    if (!turn) return;
    // Ignore events from other threads (e.g. ephemeral background requests).
    if ("params" in n && n.params && typeof n.params === "object" && "threadId" in n.params) {
      if ((n.params as { threadId: string }).threadId !== this.threadId) return;
    }

    switch (n.method) {
      case "turn/started":
        turn.turnId ??= n.params.turn.id;
        break;
      case "item/agentMessage/delta":
        turn.queue.push({ type: "text_delta", text: n.params.delta });
        break;
      case "item/started": {
        const s = describeToolItem(n.params.item);
        if (s) turn.queue.push({ type: "tool_activity", summary: s });
        break;
      }
      case "item/completed":
        if (n.params.item.type === "agentMessage") {
          turn.replyParts.push(n.params.item.text);
          turn.queue.push({ type: "text_done", text: n.params.item.text });
        }
        break;
      case "thread/tokenUsage/updated": {
        const u = n.params.tokenUsage.last;
        turn.queue.push({
          type: "usage",
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          cachedInputTokens: u.cachedInputTokens,
        });
        break;
      }
      case "error":
        turn.queue.push({ type: "error", message: n.params.error.message, willRetry: n.params.willRetry });
        break;
      case "turn/completed": {
        const t = n.params.turn;
        const status = t.status === "inProgress" ? "failed" : t.status;
        if (turn.replyParts.length) {
          let reply = turn.replyParts.join("\n\n");
          const fixes: { from: string; to: string }[] = [];
          const unverified: string[] = [];
          for (const u of new Set(extractUrls(reply).filter((u) => !this.toolUrls.has(u)))) {
            const to = correctUrl(u, this.toolUrls);
            if (to) fixes.push({ from: u, to });
            else unverified.push(u);
          }
          for (const f of fixes) reply = reply.split(f.from).join(f.to);
          this.log.push({ role: "assistant", text: reply });
          if (fixes.length) turn.queue.push({ type: "links_corrected", fixes });
          if (unverified.length) turn.queue.push({ type: "unverified_links", urls: unverified });
        }
        turn.queue.push({ type: "turn_end", status, error: t.error?.message });
        turn.queue.end();
        this.active = null;
        break;
      }
    }
  }

  /**
   * Client-implemented tools are answered here. Everything else is refused:
   * with approvalPolicy "never" approval requests should not arrive, but if
   * they do, nothing is approved from the client side.
   */
  private onServerRequest(r: ServerRequest): void {
    if (r.method === "item/tool/call") {
      const tool = this.tools.get(r.params.tool);
      const run: Promise<ToolOutcome> = tool
        ? tool.handle(r.params.arguments)
        : Promise.resolve({ success: false, text: `unknown tool: ${r.params.tool}` });
      run
        .catch((err: Error): ToolOutcome => ({ success: false, text: `tool failed: ${err.message}` }))
        .then((out) => {
          for (const u of extractUrls(out.text)) this.toolUrls.add(u);
          if (out.display) this.active?.queue.push({ type: "tool_activity", summary: out.display, ...(out.files?.length ? { files: out.files } : {}) });
          this.conn.respond(r.id, toolResult(out));
        });
      return;
    }
    switch (r.method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        this.conn.respond(r.id, { decision: "decline" });
        break;
      case "execCommandApproval":
      case "applyPatchApproval":
        this.conn.respond(r.id, { decision: { denied: { rejection: "not permitted" } } });
        break;
      case "mcpServer/elicitation/request":
        this.conn.respond(r.id, { action: "decline", content: null, _meta: null });
        break;
      default:
        this.conn.respondError(r.id, -32601, `${r.method} not supported by this client`);
    }
    this.opts.onLog?.(`[denied server request] ${r.method}`);
  }
}

/** URLs in text, normalised (trailing punctuation removed) so tool output and replies compare equal. */
/**
 * User and assistant messages of stored turns (for a UI showing a resumed conversation).
 * The <memory_update> sent on resume is an extra text input, left out here.
 */
export function transcriptOf(turns: { items: ThreadItem[] }[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const t of turns)
    for (const it of t.items) {
      if (it.type === "userMessage") {
        const text = it.content
          .flatMap((c) => (c.type === "text" && !c.text.startsWith("<memory_update>") ? [c.text] : []))
          .join("\n")
          .trim();
        if (text) out.push({ role: "user", text });
      } else if (it.type === "agentMessage" && it.text.trim()) out.push({ role: "assistant", text: it.text });
    }
  return out;
}

export function extractUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s)\]>"'`]+/g)].map((m) => m[0].replace(/[.,;:!?]+$/, ""));
}

/**
 * The model sometimes cuts the last path segment of a URL a tool gave it
 * (".../when-a-worker-leaves" for ".../when-a-worker-leaves-your-business"): a dead link.
 * Returns the one tool URL that `url` is such a truncation of, else null. Only the last
 * segment may differ, and only by a cut at a hyphen, so a parent page is never rewritten.
 */
export function correctUrl(url: string, known: Iterable<string>): string | null {
  const hits = new Set<string>();
  for (const k of known) {
    const rest = k.startsWith(url) ? k.slice(url.length) : "";
    if (/^-[^/?#]+$/.test(rest)) hits.add(k);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

function toWebSearchRecord(item: Extract<ThreadItem, { type: "webSearch" }>): WebSearchRecord {
  const a = item.action;
  const url = a && (a.type === "openPage" || a.type === "findInPage") ? a.url : null;
  const resultDomains = (item.results ?? []).flatMap((r) =>
    r && typeof r === "object" && !Array.isArray(r) && typeof r.domain === "string" ? [r.domain] : [],
  );
  return { action: a?.type ?? "other", query: item.query, url, resultDomains };
}

function toSpec(t: ClientTool): DynamicToolSpec {
  return { type: "function", name: t.name, description: t.description, inputSchema: t.inputSchema as JsonValue };
}

function toolResult(out: ToolOutcome): DynamicToolCallResponse {
  return { success: out.success, contentItems: [{ type: "inputText", text: out.text }] };
}

function sessionInfo(
  threadId: string,
  res: {
    model: string;
    reasoningEffort: string | null;
    serviceTier: string | null;
    sandbox: SandboxPolicy;
    approvalPolicy: AskForApproval;
  },
): SessionInfo {
  return {
    threadId,
    model: res.model,
    reasoningEffort: res.reasoningEffort,
    serviceTier: res.serviceTier,
    sandbox: res.sandbox.type,
    approvalPolicy: typeof res.approvalPolicy === "string" ? res.approvalPolicy : "granular",
  };
}

function describeToolItem(item: ThreadItem): string | null {
  switch (item.type) {
    case "commandExecution":
      return `running: ${item.command}`;
    case "fileChange":
      return "editing files";
    case "mcpToolCall":
      return `tool: ${item.server}.${item.tool}`;
    case "webSearch":
      return "searching the web";
    case "dynamicToolCall":
      // Slow client tools announce themselves at start so the user knows something is happening.
      return item.tool === "search_official_sources" ? "searching official sources (15-25s)..." : null;
    default:
      return null;
  }
}
