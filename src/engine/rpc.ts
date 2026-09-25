import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import type { ClientRequest } from "../protocol/ClientRequest";
import type { ServerNotification } from "../protocol/ServerNotification";
import type { ServerRequest } from "../protocol/ServerRequest";
import type { RequestId } from "../protocol/RequestId";

// Method name -> params type, derived from the generated protocol union.
type Method = ClientRequest["method"];
type ParamsOf<M extends Method> = Extract<ClientRequest, { method: M }>["params"];

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export interface RpcEvents {
  notification: [ServerNotification];
  request: [ServerRequest];
  stderr: [string];
  exit: [number | null];
}

/**
 * JSON-RPC over newline-delimited JSON on the stdio of `codex app-server`.
 * Owns the child process; one instance == one app-server.
 */
export class AppServerConnection extends EventEmitter<RpcEvents> {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<RequestId, Pending>();
  private closed = false;

  constructor(opts: { codexBin: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string }) {
    super();
    // Each concurrent ephemeral thread (e.g. bulk screening) listens for its own notifications.
    this.setMaxListeners(100);
    this.proc = spawn(opts.codexBin, ["app-server", ...opts.args], {
      env: opts.env,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    createInterface({ input: this.proc.stdout }).on("line", (line) => this.onLine(line));
    createInterface({ input: this.proc.stderr }).on("line", (line) => this.emit("stderr", line));

    this.proc.on("exit", (code) => {
      this.closed = true;
      const err = new Error(`codex app-server exited (code ${code})`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.emit("exit", code);
    });
    this.proc.on("error", (err) => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  request<M extends Method>(method: M, params: ParamsOf<M>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("codex app-server is not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  respond(id: RequestId, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: RequestId, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  close(): void {
    if (this.closed) return;
    this.proc.stdin.end();
    this.proc.kill();
  }

  private write(msg: unknown): void {
    if (this.closed) return;
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      this.emit("stderr", `[non-JSON stdout] ${line}`);
      return;
    }

    const hasId = msg.id !== undefined && msg.id !== null;
    if (hasId && msg.method === undefined) {
      // Response to one of our requests.
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new RpcError(msg.error.code, msg.error.message, msg.error.data));
      else p.resolve(msg.result);
    } else if (hasId) {
      this.emit("request", msg as ServerRequest);
    } else if (msg.method) {
      this.emit("notification", msg as ServerNotification);
    }
  }
}
