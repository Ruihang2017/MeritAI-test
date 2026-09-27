import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { AppEvent, AssistantApp } from "../app/app";
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
  private tier: "fast" | "standard" | null = null;
  private limit: { resetAt: string | null } | null = null;

  constructor(private readonly opts: { engine: "codex" | "fake"; sampleData?: boolean }) {}

  /** The confirm to give AssistantApp's ui: the question goes to every connected UI. */
  readonly confirm: Confirm = (req, ctx) =>
    new Promise<boolean>((resolve) => {
      const id = ctx?.id ?? randomUUID();
      const store = this.origin.getStore();
      const turnId = store ? store.turnId : this.turn;
      this.waiting.set(id, { req, turnId, resolve });
      ctx?.signal.addEventListener(
        "abort",
        () => {
          if (this.waiting.delete(id)) this.emit({ event: "confirmWithdrawn", id });
          resolve(false);
        },
        { once: true },
      );
      this.emit({ event: "confirm", id, req, turnId });
    });

  readonly progress = (message: string) => this.emit({ event: "progress", message });

  attach(app: AssistantApp): this {
    this.app = app;
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
  async handle(msg: ClientMessage): Promise<unknown> {
    const fn = this.handlers[msg.method as Method] as ((p: unknown) => Promise<unknown>) | undefined;
    if (!fn || !Object.hasOwn(this.handlers, msg.method)) throw new Error(`unknown method: ${String(msg.method)}`);
    // Questions asked while handling a request (delete, screening criteria, imports) are not part of a reply.
    return this.origin.run({ turnId: null }, () => fn(msg.params));
  }

  /** What is running now, if anything (a reply or another operation). */
  private running(): string | null {
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
  };

  private async run(turnId: string, events: AsyncIterable<AppEvent>): Promise<void> {
    let error: string | undefined;
    try {
      for await (const ev of events) {
        if (ev.type === "usage_limit") this.limit = { resetAt: ev.resetAt };
        else if (ev.type === "text_delta") this.limit = null;
        this.emit({ event: "turn", turnId, ev });
      }
    } catch (e) {
      error = (e as Error).message;
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
      sampleData: this.opts.sampleData ?? false,
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
      voice: { keySet: this.app.voiceKeyStatus().set },
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

function str(v: unknown, name: string, max: number): string {
  if (typeof v !== "string") throw new Error(`${name} must be text`);
  if (v.length > max) throw new Error(`${name} is too long`);
  return v;
}
