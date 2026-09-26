import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { AppEvent, AssistantApp } from "../app/app";
import type { Confirm, ConfirmRequest } from "../engine/types";
import { DOCUMENTS, expectedDocuments } from "../business/register";
import { documentTiming } from "../business/reminders";
import { LEAVING_REASONS } from "../business/leaving";
import type { ClientMessage, Method, Methods, ServerEvent, Settings, ShellState, StaffRow } from "./protocol";

/**
 * Connects UI messages to one AssistantApp: an allowlist of methods, the reply
 * stream as events, and confirmation questions answered from the browser.
 * No network code here (server.ts does that), so it is unit-tested directly.
 */
export class UiSession {
  private app!: AssistantApp;
  private readonly listeners = new Set<(ev: ServerEvent) => void>();
  private readonly waiting = new Map<string, { req: ConfirmRequest; resolve: (yes: boolean) => void }>();
  private turn: string | null = null;

  constructor(private readonly opts: { engine: "codex" | "fake" }) {}

  /** The confirm to give AssistantApp's ui: the question goes to every connected UI. */
  readonly confirm: Confirm = (req, ctx) =>
    new Promise<boolean>((resolve) => {
      const id = ctx?.id ?? randomUUID();
      this.waiting.set(id, { req, resolve });
      ctx?.signal.addEventListener(
        "abort",
        () => {
          if (this.waiting.delete(id)) this.emit({ event: "confirmWithdrawn", id });
          resolve(false);
        },
        { once: true },
      );
      this.emit({ event: "confirm", id, req });
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
    return fn(msg.params);
  }

  private readonly handlers: { [M in Method]: (p: Methods[M]["params"]) => Promise<Methods[M]["result"]> } = {
    state: async () => this.state(),
    send: async (p) => {
      const text = str(p?.text, "text", 20_000);
      const skill = p?.skill === undefined ? undefined : str(p.skill, "skill", 80);
      if (this.turn || this.app.isBusy()) throw new Error("A reply is still running.");
      const turnId = str(p?.turnId, "turnId", 100);
      this.turn = turnId;
      void this.run(turnId, p.mode === "setup" ? this.app.setup() : this.app.send(text, skill ? { skill } : {}));
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
      return { ok: true };
    },
    newConversation: async () => {
      this.busyCheck();
      await this.app.newConversation();
      return null;
    },
    history: async () => this.app.history(),
    resume: async (p) => {
      this.busyCheck();
      const threadId = str(p?.threadId, "threadId", 100);
      const record = (await this.app.history()).find((r) => r.threadId === threadId);
      if (!record) throw new Error("That conversation is no longer stored.");
      const r = await this.app.resume(record);
      return { alreadyOpen: r.alreadyOpen };
    },
    transcript: async () => this.app.conversation(),
    reminders: async () => this.app.reminders(),
    skills: async () => this.app.skills().map((s) => ({ name: s.name, description: s.description })),
    attach: async (p) => {
      if (!Array.isArray(p?.files) || p.files.length > 200) throw new Error("files must be a list (at most 200)");
      return this.app.attachBytes(
        p.files.map((f) => ({ name: str(f?.name, "name", 300), data: Buffer.from(str(f?.base64, "base64", 70_000_000), "base64"), ...(f?.relPath ? { relPath: str(f.relPath, "relPath", 1000) } : {}) })),
      );
    },
    staff: async (p) => this.staffRows(p?.includeLeft === true),
    addEmployee: async (p) =>
      this.app.addEmployee(obj(p?.details, "details"), { mayNeedVisaCheck: p?.mayNeedVisaCheck !== false, apprentice: p?.apprentice === true, constructionSite: p?.constructionSite === true }),
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
    jobs: async () => this.app.jobs().map(({ job, files, criteria }) => ({ job, files, criteria })),
    createJob: async (p) => {
      const job = str(p?.job, "job", 80).trim();
      if (!job) throw new Error("give the job a name");
      const file = (u: unknown) => {
        const x = obj(u, "file");
        return { name: str(x.name, "name", 300), data: Buffer.from(str(x.base64, "base64", 70_000_000), "base64") };
      };
      if (!Array.isArray(p?.applications) || p.applications.length > 200) throw new Error("applications must be a list (at most 200)");
      return this.app.importJobFiles(job, p.jd ? file(p.jd) : null, p.applications.map(file));
    },
    screen: async (p) => {
      this.busyCheck();
      return this.app.screen(this.jobName(p?.job));
    },
    screenResults: async (p) => this.app.screenResults(this.jobName(p?.job)),
    report: async (p) => {
      if (!["docx", "xlsx", "both"].includes(p?.format)) throw new Error("format must be docx, xlsx or both");
      return this.app.report(this.jobName(p.job), p.format);
    },
    files: async () => this.app.workspaceFiles(),
    profile: async () => {
      const p = this.app.profile();
      return { exists: p.exists, profile: p.profile, policies: p.policies };
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
    setWorkspace: async (p) => {
      this.busyCheck();
      if (p?.path === null) this.app.resetFilesRoot();
      else this.app.setFilesRoot(str(p?.path, "path", 1000));
      return this.settings();
    },
    login: async () => {
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
    },
    openFile: async (p) => this.app.openFile(str(p?.path, "path", 2000)),
    revealFile: async (p) => this.app.revealFile(str(p?.path, "path", 2000)),
  };

  private busyCheck(): void {
    if (this.turn || this.app.isBusy()) throw new Error("A reply is still running.");
  }

  private async run(turnId: string, events: AsyncIterable<AppEvent>): Promise<void> {
    let error: string | undefined;
    try {
      for await (const ev of events) this.emit({ event: "turn", turnId, ev });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      this.turn = null;
      this.emit({ event: "turnDone", turnId, ...(error ? { error } : {}) });
    }
  }

  private tier: "fast" | "standard" | null = null;

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

  private staffRows(includeLeft: boolean): StaffRow[] {
    const rs = this.app.reminders();
    const soon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    return this.app.staff(includeLeft).map((e) => {
      const mine = rs.filter((r) => r.employeeId === e.id).sort((a, b) => a.due.localeCompare(b.due))[0];
      const next: StaffRow["next"] =
        e.status === "left"
          ? e.leftDate
            ? { text: `Left ${e.leftDate}`, due: e.leftDate, tone: "n" }
            : null
          : mine
            ? { text: withoutName(mine.title, e.name), due: mine.due, tone: mine.overdue ? "red" : mine.due <= soon ? "amber" : "n" }
            : null;
      const done = new Map(e.documents.map((d) => [d.id, d.date]));
      const timing = documentTiming(e.startDate);
      return { ...e, next, documentsExpected: expectedDocuments(e).map((id) => ({ id, label: DOCUMENTS[id], timing: timing[id], recorded: done.get(id) ?? null })) };
    });
  }

  async state(): Promise<ShellState> {
    const account = await this.app.account();
    const p = this.app.profile();
    const f = this.app.folders();
    const rs = this.app.reminders();
    const today = new Date();
    const week = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const threadId = this.app.sessionInfo()?.threadId;
    const title = threadId ? ((await this.app.history()).find((r) => r.threadId === threadId)?.title ?? null) : null;
    return {
      account,
      engine: this.opts.engine,
      business: { name: p.profile.tradingName ?? p.profile.legalName ?? "Your business", needsSetup: this.app.needsSetup() },
      workspace: basename(f.root),
      workspacePath: f.root,
      busy: this.turn !== null || this.app.isBusy(),
      tier: this.app.sessionInfo()?.serviceTier ?? null,
      hasConversation: this.app.hasConversation(),
      title,
      attention: { overdue: rs.filter((r) => r.overdue).length, soon: rs.filter((r) => !r.overdue && r.due <= week).length },
      confirms: [...this.waiting].map(([id, w]) => ({ id, req: w.req })),
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

/** "Probation ends 2026-10-02: Leo Tran (Cleaner)" → "Probation ends 2026-10-02" (the row already shows the name). */
export function withoutName(title: string, name: string): string {
  const i = title.indexOf(name);
  if (i <= 0) return title;
  return (title.slice(0, i).replace(/(:|\s+for)\s*$/, "") + title.slice(i + name.length).replace(/^\s*\([^)]*\)/, "")).trim();
}

function str(v: unknown, name: string, max: number): string {
  if (typeof v !== "string") throw new Error(`${name} must be text`);
  if (v.length > max) throw new Error(`${name} is too long`);
  return v;
}
