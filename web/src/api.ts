import type { Method, Methods, ServerEvent, ServerMessage } from "../../src/server/protocol";

export type { ServerEvent };
export type Connection = "connecting" | "open" | "closed";

/**
 * The one WebSocket to the local server: requests with ids, pushed events, and
 * reconnecting after the server restarts. The token comes from the URL the server
 * opened (?t=...); it is kept in sessionStorage so a reload keeps working.
 */
export class Api {
  private ws: WebSocket | null = null;
  private next = 1;
  private readonly calls = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  private readonly eventListeners = new Set<(ev: ServerEvent) => void>();
  private readonly connListeners = new Set<(c: Connection) => void>();
  private retry = 0;
  connection: Connection = "connecting";

  constructor(private readonly token: string) {
    this.open();
  }

  static fromLocation(): Api | null {
    const fromUrl = new URLSearchParams(location.search).get("t");
    let token = fromUrl;
    try {
      if (fromUrl) sessionStorage.setItem("meritai.t", fromUrl);
      else token = sessionStorage.getItem("meritai.t");
    } catch {
      /* storage blocked: the URL token still works */
    }
    // Keep the token out of the address bar (and out of screenshots).
    if (fromUrl) history.replaceState(null, "", location.pathname);
    return token ? new Api(token) : null;
  }

  call<M extends Method>(method: M, ...params: Methods[M]["params"] extends void ? [] : [Methods[M]["params"]]): Promise<Methods[M]["result"]> {
    return new Promise((ok, fail) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        fail(new Error("Not connected to MeritAI. Is it still running?"));
        return;
      }
      const id = this.next++;
      this.calls.set(id, { ok: ok as (v: unknown) => void, fail });
      this.ws.send(JSON.stringify({ id, method, params: params[0] }));
    });
  }

  onEvent(f: (ev: ServerEvent) => void): () => void {
    this.eventListeners.add(f);
    return () => this.eventListeners.delete(f);
  }

  onConnection(f: (c: Connection) => void): () => void {
    this.connListeners.add(f);
    return () => this.connListeners.delete(f);
  }

  private setConnection(c: Connection) {
    this.connection = c;
    for (const f of this.connListeners) f(c);
  }

  private open() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    this.setConnection("connecting");
    ws.onopen = () => {
      this.retry = 0;
      this.setConnection("open");
    };
    ws.onmessage = (e) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if ("event" in m) {
        for (const f of this.eventListeners) f(m);
        return;
      }
      const c = this.calls.get(m.id);
      if (!c) return;
      this.calls.delete(m.id);
      if ("error" in m) c.fail(new Error(m.error));
      else c.ok(m.result);
    };
    ws.onclose = () => {
      for (const c of this.calls.values()) c.fail(new Error("Connection to MeritAI closed."));
      this.calls.clear();
      this.setConnection("closed");
      const wait = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), wait);
    };
  }
}
