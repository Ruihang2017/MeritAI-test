import WebSocket from "ws";
import { EventEmitter } from "node:events";

/**
 * GPT-Live session over WebSocket (verified against the API on 2026-09-25):
 * - endpoint wss://api.openai.com/v1/live/sessions, no query parameters;
 *   the first client event is session.start with the model inside it
 * - audio: PCM16 mono 24 kHz, base64, in session.input_audio.append / session.output_audio.delta ("delta")
 * - output audio is a continuous real-time stream (about one 100 ms delta per 100 ms, silence included)
 * - client delegation: session.delegation.created carries only {delegation.id, offset_ms};
 *   the user's words come from session.input_transcript.delta (with start_ms/end_ms)
 * - results: session.commentary.append (spoken, paraphrased, max 500 tokens);
 *   quiet progress: session.thinking.append. There is no completion or cancel event.
 */

export const LIVE_URL = "wss://api.openai.com/v1/live/sessions";
export const SAMPLE_RATE = 24000;
/** Characters per commentary append; stays well under the 500-token limit. */
export const MAX_COMMENTARY_CHARS = 1500;

export interface LiveConfig {
  apiKey: string;
  model: string;
  voice: string;
  instructions: string;
}

export interface TranscriptDelta {
  text: string;
  startMs: number;
  endMs: number;
}

export interface LiveEvents {
  started: [sessionId: string];
  audio: [pcm: Buffer];
  inputTranscript: [TranscriptDelta];
  outputTranscript: [TranscriptDelta];
  delegation: [id: string, offsetMs: number];
  usage: [seconds: number];
  error: [message: string];
  closed: [reason: string];
}

export class LiveSession extends EventEmitter<LiveEvents> {
  private ws: WebSocket | null = null;
  private seq = 0;
  /** Set once close() is called; late errors from the closing session are ignored. */
  private closing = false;

  constructor(private readonly cfg: LiveConfig) {
    super();
  }

  /** Opens the socket and starts the session; resolves on session.started. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(LIVE_URL, { headers: { Authorization: `Bearer ${this.cfg.apiKey}` } });
      this.ws = ws;
      let started = false;
      ws.on("unexpected-response", (_req, res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => reject(new Error(`GPT-Live HTTP ${res.statusCode}: ${body.slice(0, 200)}`)));
      });
      ws.on("error", (e) => (started ? this.warn(e.message) : reject(e)));
      ws.on("open", () => {
        this.send({
          type: "session.start",
          session: {
            model: this.cfg.model,
            instructions: this.cfg.instructions,
            audio: { format: { type: "audio/pcm", rate: SAMPLE_RATE }, output: { voice: this.cfg.voice } },
            delegation: { type: "client" },
          },
        });
      });
      ws.on("close", (_code, reason) => this.emit("closed", reason.toString() || "socket closed"));
      ws.on("message", (raw) => {
        let e: any;
        try {
          e = JSON.parse(raw.toString());
        } catch {
          return;
        }
        switch (e.type) {
          case "session.started":
            started = true;
            this.emit("started", e.session?.id ?? "");
            resolve();
            break;
          case "session.output_audio.delta":
            if (e.delta) this.emit("audio", Buffer.from(e.delta, "base64"));
            break;
          case "session.input_transcript.delta":
            this.emit("inputTranscript", { text: e.delta ?? "", startMs: e.start_ms ?? 0, endMs: e.end_ms ?? 0 });
            break;
          case "session.output_transcript.delta":
            this.emit("outputTranscript", { text: e.delta ?? "", startMs: e.start_ms ?? 0, endMs: e.end_ms ?? 0 });
            break;
          case "session.delegation.created":
            if (e.delegation?.target === "client") this.emit("delegation", e.delegation.id, e.offset_ms ?? 0);
            break;
          case "session.usage.updated":
            this.emit("usage", e.usage?.seconds ?? 0);
            break;
          case "error": {
            const msg = e.error?.message ?? "unknown error";
            if (!started) reject(new Error(msg));
            else this.warn(msg);
            break;
          }
          case "session.closed":
            if (typeof e.usage?.seconds === "number") this.emit("usage", e.usage.seconds);
            this.emit("closed", e.reason ?? "closed");
            break;
        }
      });
    });
  }

  appendAudio(pcm: Buffer): void {
    this.send({ type: "session.input_audio.append", audio: pcm.toString("base64") });
  }

  /** Something GPT-Live should say (paraphrased). */
  commentary(delegationId: string | null, content: string): void {
    this.send({ type: "session.commentary.append", event_id: this.nextId(), delegation_id: delegationId, content: content.slice(0, MAX_COMMENTARY_CHARS) });
  }

  /** Quiet progress for a running delegation; not spoken. */
  thinking(delegationId: string, content: string): void {
    this.send({ type: "session.thinking.append", event_id: this.nextId(), delegation_id: delegationId, content: content.slice(0, MAX_COMMENTARY_CHARS) });
  }

  close(): void {
    if (!this.ws) return;
    this.closing = true;
    try {
      this.send({ type: "session.close" });
    } finally {
      const ws = this.ws;
      this.ws = null;
      setTimeout(() => ws.close(), 500);
    }
  }

  /** Emits "error" only if someone listens and the session is not being closed (an unheard "error" would crash Node). */
  private warn(message: string): void {
    if (!this.closing && this.listenerCount("error") > 0) this.emit("error", message);
  }

  private nextId(): string {
    return `c${++this.seq}`;
  }

  private send(event: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }
}
