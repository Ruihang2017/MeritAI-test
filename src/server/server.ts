import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "./protocol";
import type { UiSession } from "./session";

/**
 * The local server for the browser UI: the built web app (static files) and one
 * WebSocket for the API. Local only:
 * - it listens on 127.0.0.1;
 * - the socket needs the random token of this start (it is in the URL the server opens);
 * - the socket's Origin must be this server (or the Vite dev server in dev mode), and
 *   the Host header must be 127.0.0.1 or localhost (against DNS rebinding).
 * Other web pages in the same browser can reach localhost; these checks keep them out.
 */
export interface UiServer {
  server: Server;
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

/** Base64 of the 25 MB attachment limit, plus room for a few files in one request. */
const MAX_MESSAGE = 120 * 1024 * 1024;

export async function startUiServer(opts: {
  session: UiSession;
  /** Folder with the built web app (web/dist); absent in dev mode (Vite serves it). */
  staticDir?: string;
  port?: number;
  /** Extra allowed Origin for the socket (the Vite dev server). */
  devOrigin?: string;
  token?: string;
}): Promise<UiServer> {
  const token = opts.token ?? randomBytes(24).toString("hex");
  const server = createServer((req, res) => {
    if (!hostOk(req)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const file = opts.staticDir ? staticFile(opts.staticDir, req.url ?? "/") : null;
    if (!file) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
      // The page talks only to this server; no framing, no inline scripts from elsewhere.
      "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    res.end(readFileSync(file));
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const origin = req.headers.origin ?? "";
    const allowed = [`http://127.0.0.1:${port()}`, `http://localhost:${port()}`, ...(opts.devOrigin ? [opts.devOrigin] : [])];
    if (url.pathname !== "/ws" || url.searchParams.get("t") !== token || !allowed.includes(origin) || !hostOk(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => connection(ws));
  });

  const connection = (ws: WebSocket) => {
    const send = (m: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
    const off = opts.session.subscribe(send);
    ws.on("close", off);
    ws.on("message", async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (typeof msg?.id !== "number") return;
      try {
        send({ id: msg.id, result: await opts.session.handle(msg) });
      } catch (e) {
        send({ id: msg.id, error: (e as Error).message });
      }
    });
  };

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, "127.0.0.1", () => ok());
  });
  const port = () => (server.address() as { port: number }).port;
  return {
    server,
    port: port(),
    token,
    url: `http://127.0.0.1:${port()}/?t=${token}`,
    close: () =>
      new Promise((ok) => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => ok());
      }),
  };
}

function hostOk(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  return host === "127.0.0.1" || host === "localhost";
}

/** A file inside `dir` for a URL path; "/" and unknown app routes get index.html. */
export function staticFile(dir: string, urlPath: string): string | null {
  const root = resolve(dir);
  let p: string;
  try {
    p = decodeURIComponent(new URL(urlPath, "http://x").pathname);
  } catch {
    return null;
  }
  const target = resolve(root, "." + normalize(p));
  if (target !== root && !target.startsWith(root + sep)) return null;
  if (existsSync(target) && statSync(target).isFile()) return target;
  // Client-side routes (no file extension) load the app.
  if (!extname(p)) {
    const index = join(root, "index.html");
    return existsSync(index) ? index : null;
  }
  return null;
}
