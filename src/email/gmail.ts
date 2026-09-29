import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { now } from "../clock";

/**
 * Sending from the owner's Gmail (owner, 2026-09-29; design: EmailRules, GmailConnect). One
 * permission, gmail.send (plus openid and email, to show which account is connected): MeritAI can
 * send, never read. Google's sign-in runs in the owner's browser (a desktop OAuth client: loopback
 * redirect with PKCE); the refresh token is kept on this computer, encrypted for the Windows user
 * like the voice key, and the access token only in memory. Only the app sends, after the owner
 * pressed Send: this is no tool of the adviser's.
 */

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "openid", "email"];
const SEND_SCOPE = GMAIL_SCOPES[0];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SEND_URL = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media";
/** How long the sign-in in the browser may take. */
export const CONNECT_TIMEOUT_MS = 5 * 60_000;

export interface GoogleClient {
  id: string;
  secret: string;
}

declare const __MERITAI_GOOGLE_CLIENT__: GoogleClient | undefined;

/**
 * The OAuth client MeritAI signs in with: built into the desktop app (scripts/build-desktop.mjs),
 * or GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from the environment (.env) when run from the
 * project. A desktop client's secret isn't confidential (Google's words), but it stays out of git.
 */
export function googleClient(env: NodeJS.ProcessEnv = process.env): GoogleClient | null {
  if (typeof __MERITAI_GOOGLE_CLIENT__ !== "undefined" && __MERITAI_GOOGLE_CLIENT__?.id) return __MERITAI_GOOGLE_CLIENT__;
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET } : null;
}

export interface GmailStatus {
  /** MeritAI has a Google client to sign in with. */
  configured: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  /** A sign-in is waiting in the browser. */
  connecting: boolean;
}

export type ConnectResult = { ok: true; email: string } | { ok: false; cancelled?: true; error: string };

interface Stored {
  email: string;
  connectedAt: string;
  /** The refresh token, encrypted for the Windows user. */
  cipher: string;
}

export interface GmailDeps {
  fetch: typeof fetch;
  protect: (plain: string) => Promise<string>;
  unprotect: (cipher: string) => Promise<string>;
}

export interface GmailSender {
  status(): GmailStatus;
  /** Opens Google's sign-in (`open` gets the URL) and waits for the owner. */
  connect(open: (url: string) => Promise<void>): Promise<ConnectResult>;
  cancelConnect(): boolean;
  disconnect(): Promise<void>;
  /** Sends one message (RFC 822 bytes) from the connected account; returns Gmail's message id. */
  send(mime: Buffer): Promise<string>;
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The email address in an ID token (it comes straight from Google over TLS, so its signature isn't checked here). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const part = idToken?.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>` +
  `<body style="margin:0;font-family:system-ui,sans-serif;background:#EEF2F7;color:#1B1F27;display:flex;align-items:center;justify-content:center;min-height:100vh">` +
  `<div style="background:#fff;border:1px solid #D9DEE7;border-radius:14px;padding:28px 32px;max-width:440px"><h1 style="font-size:22px;margin:0 0 8px">${title}</h1><p style="margin:0;color:#4A5363;line-height:1.5">${text}</p></div></body></html>`;

export class GmailAccount implements GmailSender {
  private access: { token: string; until: number } | null = null;
  private pending: { server: Server; finish: (r: ConnectResult) => void } | null = null;

  constructor(
    private readonly file: string,
    private readonly client: () => GoogleClient | null,
    private readonly deps: GmailDeps,
  ) {}

  private stored(): Stored | null {
    if (!existsSync(this.file)) return null;
    try {
      const s = JSON.parse(readFileSync(this.file, "utf8")) as Stored;
      return typeof s.cipher === "string" && typeof s.email === "string" ? s : null;
    } catch {
      return null;
    }
  }

  status(): GmailStatus {
    const s = this.stored();
    return { configured: !!this.client(), connected: !!s, email: s?.email ?? null, connectedAt: s?.connectedAt ?? null, connecting: !!this.pending };
  }

  async connect(open: (url: string) => Promise<void>): Promise<ConnectResult> {
    const client = this.client();
    if (!client) return { ok: false, error: "This copy of MeritAI has no Google sign-in set up." };
    this.cancelConnect();
    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(16));
    return new Promise<ConnectResult>((resolve) => {
      let redirect = "";
      let done = false;
      const finish = (r: ConnectResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        server.close();
        this.pending = null;
        resolve(r);
      };
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", redirect);
        if (url.pathname !== "/" || url.searchParams.get("state") !== state) {
          res.writeHead(404).end();
          return;
        }
        const reply = (ok: boolean, text: string) => res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE(ok ? "MeritAI is connected to Gmail" : "Gmail isn't connected", text));
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        if (error || !code) {
          reply(false, "You can close this tab and go back to MeritAI.");
          finish(error === "access_denied" ? { ok: false, cancelled: true, error: "You didn't allow MeritAI to send email." } : { ok: false, error: `Google said: ${error ?? "no code"}` });
          return;
        }
        this.exchange(client, code, verifier, redirect).then(
          (r) => {
            reply(r.ok, r.ok ? `It can send email as ${r.email}. You can close this tab and go back to MeritAI.` : `${r.error} You can close this tab and go back to MeritAI.`);
            finish(r);
          },
          (e: Error) => {
            reply(false, "Something went wrong. You can close this tab and go back to MeritAI.");
            finish({ ok: false, error: `Google sign-in failed: ${e.message}` });
          },
        );
      });
      const timer = setTimeout(() => finish({ ok: false, error: "The Google sign-in took too long. Try again." }), CONNECT_TIMEOUT_MS);
      server.on("error", (e) => finish({ ok: false, error: `Couldn't start the sign-in: ${e.message}` }));
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as { port: number }).port;
        redirect = `http://127.0.0.1:${port}/`;
        this.pending = { server, finish };
        const q = new URLSearchParams({
          client_id: client.id,
          redirect_uri: redirect,
          response_type: "code",
          scope: GMAIL_SCOPES.join(" "),
          code_challenge: b64url(createHash("sha256").update(verifier).digest()),
          code_challenge_method: "S256",
          state,
          access_type: "offline",
          // Always ask, so Google returns a refresh token even on a second connect.
          prompt: "consent",
        });
        open(`${AUTH_URL}?${q}`).catch((e: Error) => finish({ ok: false, error: `Couldn't open the browser: ${e.message}` }));
      });
    });
  }

  private async exchange(client: GoogleClient, code: string, verifier: string, redirect: string): Promise<ConnectResult> {
    const r = await this.deps.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, code_verifier: verifier, client_id: client.id, client_secret: client.secret, redirect_uri: redirect, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(20_000),
    });
    const t = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string };
    if (!r.ok || !t.access_token) return { ok: false, error: `Google didn't accept the sign-in (${t.error ?? r.status}).` };
    // Google lets people untick a permission on its page: without "send" there's nothing to connect.
    if (!(t.scope ?? "").split(" ").includes(SEND_SCOPE)) {
      await this.revoke(t.access_token);
      return { ok: false, error: "MeritAI wasn't allowed to send email. Connect again and tick “Send email on your behalf”." };
    }
    const email = emailFromIdToken(t.id_token);
    if (!t.refresh_token || !email) return { ok: false, error: "Google didn't return what MeritAI needs. Try again." };
    const stored: Stored = { email, connectedAt: now().toISOString(), cipher: await this.deps.protect(t.refresh_token) };
    writeFileSync(this.file, JSON.stringify(stored, null, 2) + "\n");
    this.access = { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 };
    return { ok: true, email };
  }

  cancelConnect(): boolean {
    if (!this.pending) return false;
    this.pending.finish({ ok: false, cancelled: true, error: "Sign-in cancelled." });
    return true;
  }

  async disconnect(): Promise<void> {
    const s = this.stored();
    this.access = null;
    rmSync(this.file, { force: true });
    // Also withdraw the permission at Google (best effort: the token is gone from this computer either way).
    if (s) await this.deps.unprotect(s.cipher).then((t) => this.revoke(t)).catch(() => null);
  }

  private async revoke(token: string): Promise<void> {
    await this.deps.fetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.until > Date.now()) return this.access.token;
    const s = this.stored();
    const client = this.client();
    if (!s || !client) throw new Error("Gmail isn't connected");
    const r = await this.deps.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: await this.deps.unprotect(s.cipher), grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(20_000),
    });
    const t = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (t.error === "invalid_grant") {
      // Removed at Google, or expired: the connection is gone.
      rmSync(this.file, { force: true });
      throw new Error("Gmail was disconnected (the permission was removed or expired). Connect it again in Connections");
    }
    if (!r.ok || !t.access_token) throw new Error(`Google couldn't be reached (${t.error ?? r.status})`);
    this.access = { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 };
    return t.access_token;
  }

  async send(mime: Buffer): Promise<string> {
    const post = async (token: string) =>
      this.deps.fetch(SEND_URL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "message/rfc822" }, body: new Uint8Array(mime), signal: AbortSignal.timeout(60_000) });
    let r = await post(await this.accessToken());
    if (r.status === 401) {
      this.access = null;
      r = await post(await this.accessToken());
    }
    const j = (await r.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!r.ok || !j.id) throw new Error(`Gmail didn't send it: ${j.error?.message ?? `error ${r.status}`}`);
    return j.id;
  }
}

/** The demo engine's stand-in (npm run ui:fake): connects at once, and "sends" to a list, not to Google. */
export class FakeGmail implements GmailSender {
  readonly sent: Buffer[] = [];
  private email: string | null = null;
  private at: string | null = null;
  status(): GmailStatus {
    return { configured: true, connected: !!this.email, email: this.email, connectedAt: this.at, connecting: false };
  }
  async connect(): Promise<ConnectResult> {
    this.email = "you@example.com";
    this.at = now().toISOString();
    return { ok: true, email: this.email };
  }
  cancelConnect(): boolean {
    return false;
  }
  async disconnect(): Promise<void> {
    this.email = this.at = null;
  }
  async send(mime: Buffer): Promise<string> {
    if (!this.email) throw new Error("Gmail isn't connected");
    this.sent.push(mime);
    return `demo-${this.sent.length}`;
  }
}
