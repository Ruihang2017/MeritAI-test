import { EventEmitter } from "node:events";
import type { LiveEvents } from "./liveSession";
import { SAMPLE_RATE } from "./liveSession";

/**
 * A stand-in for GPT-Live, for the demo engine (npm run ui:fake): no API key use, no cost.
 * Like the real session it streams output audio all the time (silence, and a soft tone while it
 * "speaks"). It listens for the owner's voice by loudness: after about half a second of speech
 * followed by a pause, it "hears" the next scripted request and delegates it to the assistant,
 * so the voice bar, the chat and the confirmation handling can be tried without paying.
 */

const CHUNK_MS = 100;
const SCRIPT = [
  "What do I need to do this week?",
  "Daniel Ortiz accepted the Team leader offer, he starts Monday.",
  "Priya is resigning, her last day is Friday 9 October.",
  "When is final pay due?",
];

export class FakeLiveSession extends EventEmitter<LiveEvents> {
  private timer: NodeJS.Timeout | null = null;
  private clock = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private next = 0;
  private toneLeft = 0;
  private delegations = 0;
  private closed = false;

  start(): Promise<void> {
    this.timer = setInterval(() => this.tick(), CHUNK_MS);
    queueMicrotask(() => this.emit("started", "fake-voice"));
    return Promise.resolve();
  }

  /** One chunk of the owner's microphone: speech is anything louder than a quiet room. */
  appendAudio(pcm: Buffer): void {
    if (this.closed) return;
    let sum = 0;
    const n = Math.floor(pcm.length / 2);
    for (let i = 0; i < n; i++) sum += pcm.readInt16LE(i * 2) ** 2;
    const rms = n ? Math.sqrt(sum / n) / 32768 : 0;
    if (rms > 0.02) {
      this.speechMs += CHUNK_MS;
      this.silenceMs = 0;
    } else {
      this.silenceMs += CHUNK_MS;
      if (this.speechMs >= 500 && this.silenceMs >= 800) this.heard();
      if (this.silenceMs >= 800) this.speechMs = 0;
    }
  }

  /** The app asked for the owner's OK on screen: the next thing "heard" is a yes. */
  private okAsked = false;

  private heard(): void {
    this.speechMs = 0;
    const text = this.okAsked ? "Yes, save it." : SCRIPT[this.next++ % SCRIPT.length];
    this.okAsked = false;
    const start = this.clock;
    this.emit("inputTranscript", { text: `${text} `, startMs: start, endMs: start + 2000 });
    this.emit("delegation", `fake-${++this.delegations}`, start + 2000);
  }

  commentary(_delegationId: string | null, content: string): void {
    if (/needs the owner's OK/.test(content)) this.okAsked = true;
    // What the real voice would paraphrase: its first sentence, marked as the demo.
    const line = (content.split(/(?<=[.!?])\s/)[0] ?? content).slice(0, 160);
    this.say(`(Demo voice) ${line}`);
  }

  thinking(_delegationId: string, _content: string): void {
    /* quiet progress: nothing is spoken */
  }

  private say(text: string): void {
    const start = this.clock;
    this.toneLeft = Math.min(3000, 400 + text.length * 25);
    this.emit("outputTranscript", { text, startMs: start, endMs: start + this.toneLeft });
  }

  private tick(): void {
    this.clock += CHUNK_MS;
    const samples = (SAMPLE_RATE * CHUNK_MS) / 1000;
    const pcm = Buffer.alloc(samples * 2);
    if (this.toneLeft > 0) {
      this.toneLeft -= CHUNK_MS;
      for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * i) / SAMPLE_RATE) * 1500), i * 2);
    }
    this.emit("audio", pcm);
    if (this.clock % 1000 === 0) this.emit("usage", this.clock / 1000);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    queueMicrotask(() => this.emit("closed", "stopped"));
  }
}
