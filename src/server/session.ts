import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AssistantApp, type AppEvent, type VoiceController } from "../app/app";
import { DEMO_TODAY, seedDemo } from "../../scripts/fixtures/demo";
import pkg from "../../package.json" with { type: "json" };

const APP_VERSION = pkg.version;
import type { Confirm, ConfirmRequest } from "../engine/types";
import { DOCUMENTS } from "../business/register";
import { LEAVING_REASONS } from "../business/leaving";
import { OFFICIAL_DOMAINS } from "../research/officialSources";
import { todayIso } from "../clock";
import type { ClientMessage, Method, Methods, ServerEvent, Settings, ShellState } from "./protocol";
import { RULES_CHECKED_ON } from "../business/reminders";
import type { SessionFrom } from "../memory/store";

/**
 * Connects UI messages to one AssistantApp: an allowlist of methods, the reply
 * stream as events, and confirmation questions answered from the browser.
 * No network code here (server.ts does that), so it is unit-tested directly.
 *
 * - One operation at a time (a reply, screening, an import, a report, switching
 *   conversation or workspace, sign-in); others are refused until it ends.
 * - Each question carries where it came from: a reply (its turnId), or a form action
 *   (null: the UI shows a dialog). Requests run in an async context that says so;
 *   tool calls of the real engine arrive outside it and belong to the running reply.
 */
export class UiSession {
  private app!: AssistantApp;
  private readonly listeners = new Set<(ev: ServerEvent) => void>();
  private readonly waiting = new Map<string, { req: ConfirmRequest; turnId: string | null; resolve: (yes: boolean) => void }>();
  private readonly origin = new AsyncLocalStorage<{ turnId: string | null }>();
  private turn: string | null = null;
  private op: string | null = null;
  /** The connection a request came from (voice audio goes only to the page that started voice). */
  private readonly caller = new AsyncLocalStorage<((ev: ServerEvent) => void) | null>();
  private voice: { ctl: VoiceController; source: PushSource; owner: (ev: ServerEvent) => void } | null = null;
  private voiceTurn: string | null = null;
  /** The last errors (replies, voice), for the technical details of a feedback file. */
  private readonly recentErrors: { at: string; message: string }[] = [];
  private noteError(message: string): void {
    this.recentErrors.push({ at: new Date().toISOString(), message: message.slice(0, 500) });
    if (this.recentErrors.length > 20) this.recentErrors.shift();
  }
  private tier: "fast" | "standard" | null = null;
  private limit: { resetAt: string | null } | null = null;

  constructor(private readonly opts: { engine: "codex" | "fake"; sampleData?: boolean }) {}

  /** The confirm to give AssistantApp's ui: the question goes to every connected UI. */
  readonly confirm: Confirm = (req, ctx) =>
    new Promise<boolean>((resolve) => {
      const id = ctx?.id ?? randomUUID();
      const store = this.origin.getStore();
      // A voice reply's questions belong to its turn (voice has no send request).
      const turnId = store ? store.turnId : (this.turn ?? this.voiceTurn);
      this.waiting.set(id, { req, turnId, resolve });
      ctx?.signal.addEventListener(
        "abort",
        () => {
          // Answered by voice ("yes"): every tab shows the answer; otherwise the question was withdrawn.
          const reason = ctx.signal.reason as { answered?: boolean } | undefined;
          if (this.waiting.delete(id)) this.emit(typeof reason?.answered === "boolean" ? { event: "confirmAnswered", id, yes: reason.answered } : { event: "confirmWithdrawn", id });
          resolve(typeof reason?.answered === "boolean" ? reason.answered : false);
        },
        { once: true },
      );
      this.emit({ event: "confirm", id, req, turnId });
    });

  readonly progress = (message: string) => this.emit({ event: "progress", message });

  attach(app: AssistantApp): this {
    this.app = app;
    // A form request runs with turnId null; the adviser's tool calls run in a reply (or outside any request: the real engine).
    app.onChange((change) => {
      const store = this.origin.getStore();
      const by = store && store.turnId === null ? "you" : "adviser";
      this.emit({ event: "changed", change, by, turnId: by === "adviser" ? (store?.turnId ?? this.turn ?? this.voiceTurn) : null });
    });
    return this;
  }

  subscribe(f: (ev: ServerEvent) => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit(ev: ServerEvent): void {
    for (const f of this.listeners) f(ev);
  }

  /** Runs one request. Unknown methods and bad params are refused. */
  async handle(msg: ClientMessage, from?: (ev: ServerEvent) => void): Promise<unknown> {
    const fn = this.handlers[msg.method as Method] as ((p: unknown) => Promise<unknown>) | undefined;
    if (!fn || !Object.hasOwn(this.handlers, msg.method)) throw new Error(`unknown method: ${String(msg.method)}`);
    // Questions asked while handling a request (delete, screening criteria, imports) are not part of a reply.
    return this.caller.run(from ?? null, () => this.origin.run({ turnId: null }, () => fn(msg.params)));
  }

  /** A page closed: voice it started stops (its microphone and speaker are gone). */
  disconnected(from: (ev: ServerEvent) => void): void {
    if (this.voice?.owner === from) this.voice.ctl.stop("the page was closed");
  }

  /** What is running now, if anything (a reply or another operation). */
  private running(): string | null {
    if (this.voice) return "Voice is on: end it first.";
    if (this.turn || this.app.isBusy()) return "A reply is still running.";
    if (this.op) return `${this.op} is still running.`;
    return null;
  }

  /** Runs one operation that must not overlap with a reply or another operation. */
  private async exclusive<T>(name: string, f: () => Promise<T>): Promise<T> {
    const busy = this.running();
    if (busy) throw new Error(busy);
    this.op = name;
    try {
      return await f();
    } finally {
      this.op = null;
    }
  }

  private readonly handlers: { [M in Method]: (p: Methods[M]["params"]) => Promise<Methods[M]["result"]> } = {
    state: async () => this.state(),
    send: async (p) => {
      const text = str(p?.text, "text", 20_000);
      const skill = p?.skill === undefined ? undefined : str(p.skill, "skill", 80);
      const turnId = str(p?.turnId, "turnId", 100);
      const from = p.from === undefined ? undefined : sessionFrom(p.from);
      const busy = this.running();
      if (busy) throw new Error(busy);
      this.turn = turnId;
      // The reply's own questions (fake engine tools) belong to this turn.
      this.origin.run({ turnId }, () => void this.run(turnId, p.mode === "setup" ? this.app.setup(from) : this.app.send(text, { ...(skill ? { skill } : {}), ...(from ? { from } : {}) })));
      return { turnId };
    },
    stop: async () => {
      await this.app.stop();
      return null;
    },
    answerConfirm: async (p) => {
      const id = str(p?.id, "id", 100);
      const w = this.waiting.get(id);
      if (!w) return { ok: false };
      this.waiting.delete(id);
      w.resolve(p.yes === true);
      // Other tabs close the same question.
      this.emit({ event: "confirmAnswered", id, yes: p.yes === true });
      return { ok: true };
    },
    newConversation: async () =>
      this.exclusive("Starting a new conversation", async () => {
        await this.app.newConversation({ notes: "background" });
        return null;
      }),
    history: async () => this.app.history(),
    resume: async (p) =>
      this.exclusive("Opening a conversation", async () => {
        const threadId = str(p?.threadId, "threadId", 100);
        const record = (await this.app.history()).find((r) => r.threadId === threadId);
        if (!record) throw new Error("That conversation is no longer stored.");
        const r = await this.app.resume(record, { notes: "background" });
        return { alreadyOpen: r.alreadyOpen };
      }),
    transcript: async () => this.app.conversation(),
    reminders: async () => this.app.reminders(),
    skills: async () => this.app.skills().map((s) => ({ name: s.name, description: s.description })),
    attach: async (p) => {
      if (!Array.isArray(p?.files) || p.files.length > 200) throw new Error("files must be a list (at most 200)");
      const files = p.files.map((f) => ({ name: str(f?.name, "name", 300), data: Buffer.from(str(f?.base64, "base64", 70_000_000), "base64"), ...(f?.relPath ? { relPath: str(f.relPath, "relPath", 1000) } : {}) }));
      return this.exclusive("Adding files", () => this.app.attachBytes(files));
    },
    detach: async (p) => ({ detached: this.app.detach(str(p?.name, "name", 300)) }),
    staff: async (p) => this.app.staffOverview(p?.includeLeft === true),
    addEmployee: async (p) =>
      this.app.addEmployee(obj(p?.details, "details"), {
        mayNeedVisaCheck: p?.mayNeedVisaCheck !== false,
        apprentice: p?.apprentice === true ? true : undefined,
        constructionSite: p?.constructionSite === true,
        // Opened from Hiring's "Add to Staff": the candidate becomes a hire of that job.
        ...(p?.hireFrom ? { hireFrom: { job: this.jobName(p.hireFrom.job), file: str(p.hireFrom.file, "file", 1000) } } : {}),
      }),
    updateEmployee: async (p) => this.app.updateEmployee(int(p?.id), obj(p?.changes, "changes")),
    recordDocuments: async (p) => {
      if (!Array.isArray(p?.documents) || p.documents.some((d) => typeof d !== "string" || !Object.hasOwn(DOCUMENTS, d))) throw new Error("documents must be known document ids");
      return this.app.recordDocuments(int(p.id), p.documents, str(p.date, "date", 10));
    },
    markLeft: async (p) => {
      if (!LEAVING_REASONS.includes(p?.reason)) throw new Error("unknown reason");
      return this.app.markLeft(int(p.id), str(p.leftDate, "leftDate", 10), p.reason);
    },
    removeEmployee: async (p) => this.app.removeEmployee(int(p?.id)),
    jobs: async () => this.app.jobs(),
    createJob: async (p) => {
      const job = str(p?.job, "job", 80).trim();
      if (!job) throw new Error("give the job a name");
      const file = (u: unknown) => {
        const x = obj(u, "file");
        return { name: str(x.name, "name", 300), data: Buffer.from(str(x.base64, "base64", 70_000_000), "base64") };
      };
      if (!Array.isArray(p?.applications) || p.applications.length > 200) throw new Error("applications must be a list (at most 200)");
      const jd = p.jd ? file(p.jd) : null;
      const apps = p.applications.map(file);
      const openings = p.openings === undefined ? undefined : int(p.openings);
      return this.exclusive("Importing applications", () => this.app.importJobFiles(job, jd, apps, { openings }));
    },
    screen: async (p) => {
      const job = this.jobName(p?.job);
      return this.exclusive(`Screening "${job}"`, () => this.app.screen(job));
    },
    screenResults: async (p) => this.app.screenResults(this.jobName(p?.job)),
    draftCriteria: async (p) => {
      const job = this.jobName(p?.job);
      return this.exclusive(`Drafting criteria for "${job}"`, () => this.app.draftCriteria(job));
    },
    decide: async (p) => {
      if (p?.decision !== "shortlist" && p?.decision !== "not" && p?.decision !== null) throw new Error("decision must be shortlist, not or null");
      this.app.decide(this.jobName(p?.job), str(p?.file, "file", 1000), p.decision);
      return { ok: true };
    },
    decideRest: async (p) => ({ marked: this.app.decideRest(this.jobName(p?.job)) }),
    setOpenings: async (p) => {
      this.app.setOpenings(this.jobName(p?.job), int(p?.openings));
      return { ok: true };
    },
    closeJob: async (p) => {
      this.app.setJobClosed(this.jobName(p?.job), true);
      return { ok: true };
    },
    reopenJob: async (p) => {
      this.app.setJobClosed(this.jobName(p?.job), false);
      return { ok: true };
    },
    duplicateJob: async (p) => this.app.duplicateJob(this.jobName(p?.job), str(p?.name, "name", 80), int(p?.openings)),
    confirmCriteria: async (p) => {
      this.app.confirmCriteria(this.jobName(p?.job), int(p?.version));
      return { ok: true };
    },
    report: async (p) => {
      if (!["docx", "xlsx", "both"].includes(p?.format)) throw new Error("format must be docx, xlsx or both");
      const job = this.jobName(p.job);
      return this.exclusive("Writing the report", () => this.app.report(job, p.format));
    },
    files: async () => this.app.workspaceFiles(),
    profile: async () => {
      const p = this.app.profile();
      return { exists: p.exists, profile: p.profile, smallBusiness: p.smallBusiness, policies: p.policies };
    },
    updateProfile: async (p) => this.app.updateProfile(obj(p?.changes, "changes")),
    memories: async () => this.app.memories(),
    forget: async (p) => ({ forgotten: this.app.forget(str(p?.id, "id", 100)) !== null }),
    settings: async () => this.settings(),
    setTier: async (p) => {
      if (p?.tier !== "fast" && p?.tier !== "standard") throw new Error("tier must be fast or standard");
      this.app.setTier(p.tier);
      this.tier = p.tier;
      return this.settings();
    },
    setWorkspace: async (p) =>
      this.exclusive("Changing the workspace", async () => {
        if (p?.path === null) this.app.resetFilesRoot();
        else this.app.setFilesRoot(str(p?.path, "path", 1000));
        return this.settings();
      }),
    rateReply: async (p) => {
      if (p?.rating !== "up" && p?.rating !== "down") throw new Error("rating must be up or down");
      const reasons = Array.isArray(p.reasons) ? p.reasons.slice(0, 5).map((r) => str(r, "reason", 60)) : [];
      await this.app.rateReply({ rating: p.rating, reasons, note: str(p.note ?? "", "note", 2000), question: str(p.question ?? "", "question", 4000).slice(0, 2000), answer: str(p.answer ?? "", "answer", 20_000).slice(0, 4000) });
      return null;
    },
    feedbackSummary: async () => this.app.feedbackSummary(),
    exportFeedback: async (p) => {
      const info = this.app.sessionInfo();
      const technical = p?.technical
        ? { app: APP_VERSION, engine: this.opts.engine, model: info?.model ?? null, reasoning: info?.reasoningEffort ?? null, tier: info?.serviceTier ?? null, platform: `${process.platform} ${process.arch}`, node: process.versions.node, electron: process.versions.electron ?? null, today: todayIso(), sampleData: this.app.sampleDay() !== null, recentErrors: this.recentErrors.slice(-20) }
        : null;
      return { path: await this.app.exportFeedback({ note: str(p?.note ?? "", "note", 10_000), ratings: p?.ratings === true, conversation: p?.conversation === true, technical }) };
    },
    useSampleBusiness: async () =>
      this.exclusive("Preparing the sample business", async () => {
        const root = this.app.sampleRoot();
        if (!existsSync(join(root, ".assistant", "business.json"))) {
          // Seeded on the design's day (its dates are written for it); the user's own memory is left alone.
          const before = process.env.FX_TODAY;
          process.env.FX_TODAY = DEMO_TODAY;
          try {
            await seedDemo({ filesRoot: root, memoryRoot: this.app.memoryRoot(), userId: this.app.userId, memory: false });
          } finally {
            if (before === undefined) delete process.env.FX_TODAY;
            else process.env.FX_TODAY = before;
          }
          AssistantApp.markSample(root, DEMO_TODAY);
        }
        this.app.setFilesRoot(root);
        return this.settings();
      }),
    voiceStart: async () => {
      const owner = this.caller.getStore();
      if (!owner) throw new Error("Voice needs the browser page.");
      return this.exclusive("Starting voice", async () => {
        const source = new PushSource();
        const sink = { start() {}, stop() {}, play: (pcm: Buffer) => owner({ event: "voiceAudio", pcm: pcm.toString("base64") }) };
        // Voice's own work (the live session, its delegations and replies) runs outside this request, so
        // its questions and changes belong to the voice reply, not to a form (see `origin`).
        const ctl = await this.origin.exit(() => this.app.startVoice(
          {
            onRequest: (text, mode) => {
              if (mode === "new" || !this.voiceTurn) this.voiceTurn = randomUUID();
              this.emit({ event: "voice", kind: "request", text, mode, turnId: this.voiceTurn });
            },
            onEvent: (ev) => {
              const id = this.voiceTurn;
              if (!id) return;
              this.emit({ event: "turn", turnId: id, ev });
              if (ev.type === "turn_end") this.emit({ event: "turnDone", turnId: id });
            },
            onSaid: (text) => this.emit({ event: "voice", kind: "said", text }),
            onConfirmSkipped: (req) => this.emit({ event: "voice", kind: "skipped", req, turnId: this.voiceTurn }),
            onError: (message) => (this.noteError(`voice: ${message}`), this.emit({ event: "voice", kind: "error", message })),
            onEnded: (info) => {
              this.voice = null;
              this.voiceTurn = null;
              this.emit({ event: "voice", kind: "ended", ...info });
            },
          },
          { source, sink },
          // The page shows questions during voice: a click or a spoken "yes" answers them.
          { confirmOnScreen: true },
        ));
        this.voice = { ctl, source, owner };
        return { started: true as const };
      });
    },
    voiceAudio: async (p) => {
      const v = this.voice;
      if (!v || this.caller.getStore() !== v.owner) return null;
      const pcm = Buffer.from(str(p?.pcm, "pcm", 40_000), "base64");
      this.origin.exit(() => v.source.push(pcm));
      return null;
    },
    voiceStop: async () => {
      this.voice?.ctl.stop();
      return null;
    },
    voiceUsage: async () => this.app.voiceUsage(),
    setVoiceLimit: async (p) => {
      if (p?.usd !== null && typeof p?.usd !== "number") throw new Error("usd must be a number or null");
      return this.app.setVoiceLimit(p.usd);
    },
    voiceKey: async () => this.app.voiceKeyStatus(),
    setVoiceKey: async (p) => this.app.setVoiceKey(str(p?.key, "key", 400)),
    removeVoiceKey: async () => this.app.removeVoiceKey(),
    login: async () =>
      this.exclusive("Signing in", async () => {
        try {
          await this.app.login((message) => {
            const url = /https?:\/\/\S+/.exec(message)?.[0]?.replace(/[.,;]$/, "") ?? null;
            const code = /code:?\s*([A-Z0-9]{3,}(?:-[A-Z0-9]{3,})*)/i.exec(message)?.[1] ?? null;
            this.emit({ event: "login", url, code, message });
          });
          if ((await this.app.account()).loggedIn) await this.app.openSession();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      }),
    openFile: async (p) => this.app.openFile(str(p?.path, "path", 2000)),
    revealFile: async (p) => this.app.revealFile(str(p?.path, "path", 2000)),
    emailDraft: async (p) => this.app.emailDraft(str(p?.path, "path", 2000)),
    connections: async () => ({ wanted: this.app.wantedConnections() }),
    wantConnection: async (p) => ({ wanted: this.app.wantConnection(str(p?.name, "name", 100), p?.want === true) }),
  };

  private async run(turnId: string, events: AsyncIterable<AppEvent>): Promise<void> {
    let error: string | undefined;
    try {
      for await (const ev of events) {
        if (ev.type === "usage_limit") this.limit = { resetAt: ev.resetAt };
        else if (ev.type === "text_delta") this.limit = null;
        else if (ev.type === "error") this.noteError(ev.message);
        this.emit({ event: "turn", turnId, ev });
      }
    } catch (e) {
      error = (e as Error).message;
      this.noteError(error);
    } finally {
      this.turn = null;
      this.emit({ event: "turnDone", turnId, ...(error ? { error } : {}) });
    }
  }

  /** Only an existing job's name (it becomes a folder name in the app). */
  private jobName(v: unknown): string {
    const job = str(v, "job", 80);
    if (!this.app.jobs().some((j) => j.job === job)) throw new Error(`no job called "${job}"`);
    return job;
  }

  private async settings(): Promise<Settings> {
    const info = this.app.sessionInfo();
    return {
      account: await this.app.account(),
      engine: this.opts.engine,
      model: info?.model ?? null,
      tier: this.tier ?? (info?.serviceTier === "priority" ? "fast" : info ? "standard" : "fast"),
      workspace: this.app.folders().root,
      workspaceIsDefault: this.app.workspaceIsDefault(),
    };
  }

  async state(): Promise<ShellState> {
    const account = await this.app.account();
    const p = this.app.profile();
    const f = this.app.folders();
    const threadId = this.app.sessionInfo()?.threadId;
    const rec = threadId ? ((await this.app.history()).find((r) => r.threadId === threadId) ?? null) : null;
    return {
      account,
      engine: this.opts.engine,
      sampleData: (this.opts.sampleData ?? false) || this.app.sampleDay() !== null,
      sampleSwitch: !this.opts.sampleData && this.app.sampleDay() !== null,
      today: todayIso(),
      rulesChecked: RULES_CHECKED_ON,
      business: { name: p.profile.tradingName ?? p.profile.legalName ?? "Your business", needsSetup: this.app.needsSetup() },
      workspace: basename(f.root),
      workspacePath: f.root,
      busy: this.running() !== null,
      turnId: this.turn,
      operation: this.op,
      tier: this.app.sessionInfo()?.serviceTier ?? null,
      hasConversation: this.app.hasConversation(),
      title: rec?.title ?? null,
      threadId: threadId ?? null,
      from: rec?.from ?? null,
      voice: { keySet: this.app.voiceKeyStatus().set, on: this.voice !== null },
      attention: this.app.attentionSummary(),
      usageLimit: this.limit,
      attachments: this.app.pendingAttachments(),
      officialDomains: OFFICIAL_DOMAINS,
      confirms: [...this.waiting].map(([id, w]) => ({ id, req: w.req, turnId: w.turnId })),
    };
  }
}

function int(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new Error("id must be a whole number");
  return v;
}

function obj(v: unknown, name: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${name} must be an object`);
  return v as Record<string, unknown>;
}

const FROM_PAGES = new Set<SessionFrom["page"]>(["hiring", "staff", "files", "profile"]);

/** The page a conversation is started from, as sent by the UI: checked field by field. */
function sessionFrom(v: unknown): SessionFrom {
  const o = (v ?? {}) as Record<string, unknown>;
  const page = str(o.page, "from.page", 20) as SessionFrom["page"];
  if (!FROM_PAGES.has(page)) throw new Error("from.page is not a page");
  const out: SessionFrom = { page, key: str(o.key, "from.key", 300), label: str(o.label, "from.label", 200) };
  if (o.job !== undefined) out.job = str(o.job, "from.job", 200);
  if (o.employeeId !== undefined) {
    if (!Number.isInteger(o.employeeId)) throw new Error("from.employeeId must be a number");
    out.employeeId = o.employeeId as number;
  }
  return out;
}

/** The browser's microphone, pushed in by voiceAudio messages. */
class PushSource extends EventEmitter {
  private on_ = false;
  start(): void {
    this.on_ = true;
  }
  stop(): void {
    this.on_ = false;
  }
  push(pcm: Buffer): void {
    if (this.on_) this.emit("chunk", pcm);
  }
}

function str(v: unknown, name: string, max: number): string {
  if (typeof v !== "string") throw new Error(`${name} must be text`);
  if (v.length > max) throw new Error(`${name} is too long`);
  return v;
}
