import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { SAMPLE_RATE } from "./liveSession";

/**
 * Audio I/O through ffmpeg/ffplay (must be on PATH): DirectShow microphone
 * capture and low-latency playback of raw PCM16 mono at 24 kHz.
 */

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const FFPLAY = process.env.FFPLAY_BIN ?? "ffplay";
/** 100 ms of PCM16 mono at 24 kHz. */
export const CHUNK_BYTES = (SAMPLE_RATE * 2) / 10;

export function ffmpegAvailable(): boolean {
  return spawnSync(FFMPEG, ["-version"], { stdio: "ignore" }).status === 0 && spawnSync(FFPLAY, ["-version"], { stdio: "ignore" }).status === 0;
}

/** DirectShow audio input device names. */
export function listMicrophones(): string[] {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return [...out.matchAll(/"([^"]+)"\s+\(audio\)/g)].map((m) => m[1]);
}

export interface MicEvents {
  chunk: [pcm: Buffer];
  error: [message: string];
}

/** Captures the microphone and emits 100 ms PCM chunks. */
export class Microphone extends EventEmitter<MicEvents> {
  private proc: ChildProcess | null = null;
  private pending = Buffer.alloc(0);

  constructor(private readonly device: string) {
    super();
  }

  start(): void {
    this.proc = spawn(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-f", "dshow", "-audio_buffer_size", "50", "-i", `audio=${this.device}`, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    this.proc.stdout!.on("data", (d: Buffer) => {
      this.pending = Buffer.concat([this.pending, d]);
      while (this.pending.length >= CHUNK_BYTES) {
        this.emit("chunk", this.pending.subarray(0, CHUNK_BYTES));
        this.pending = this.pending.subarray(CHUNK_BYTES);
      }
    });
    let err = "";
    this.proc.stderr!.on("data", (d) => (err += d));
    this.proc.on("exit", (code) => {
      if (code && this.proc) this.emit("error", `microphone stopped (${code}): ${err.trim().slice(0, 200)}`);
    });
  }

  stop(): void {
    const p = this.proc;
    this.proc = null;
    p?.kill();
  }
}

/** Streams PCM to ffplay with minimal buffering, so barge-in cuts speech quickly. */
export class Speaker {
  private proc: ChildProcess | null = null;

  start(): void {
    this.proc = spawn(
      FFPLAY,
      ["-hide_banner", "-loglevel", "error", "-nodisp", "-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "32", "-analyzeduration", "0", "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ch_layout", "mono", "-i", "-"],
      { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
    );
    this.proc.stdin!.on("error", () => {}); // ignore EPIPE when stopping
  }

  play(pcm: Buffer): void {
    if (this.proc?.stdin?.writable) this.proc.stdin.write(pcm);
  }

  stop(): void {
    const p = this.proc;
    this.proc = null;
    p?.stdin?.end();
    p?.kill();
  }
}
