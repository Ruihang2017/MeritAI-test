/**
 * Voice in the browser: the microphone goes to the local server (which talks to GPT-Live), and the
 * voice's audio comes back to play. PCM16 mono at 24 kHz both ways, about 100 ms per message.
 * The server streams output audio all the time (silence too), so playback stays a short queue:
 * when it falls behind (e.g. the tab was busy), it drops what is queued and catches up.
 */

export const SAMPLE_RATE = 24000;
const MAX_QUEUE_S = 0.6;
const MIC_KEY = "meritai.mic";

export function savedMicrophone(): string {
  try {
    return localStorage.getItem(MIC_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveMicrophone(id: string): void {
  try {
    localStorage.setItem(MIC_KEY, id);
  } catch {
    /* only a convenience */
  }
}

/** The microphones this browser can see (names appear once the page has been allowed to use one). */
export async function microphones(): Promise<{ id: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput").map((d, i) => ({ id: d.deviceId, label: d.label || (d.deviceId === "default" || i === 0 ? "Default microphone" : `Microphone ${i + 1}`) }));
}

/** Loudness of a PCM16 chunk, 0 to 1. */
function level(pcm: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return pcm.length ? Math.min(1, Math.sqrt(sum / pcm.length) / 8000) : 0;
}

function toBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Int16Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

export class BrowserVoice {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private next = 0;
  private playing: AudioBufferSourceNode[] = [];
  muted = false;

  constructor(
    /** A 100 ms microphone chunk (silence while muted) and its loudness. */
    private readonly onChunk: (b64: string, level: number) => void,
    /** Loudness of what the voice is saying. */
    private readonly onOutput: (level: number) => void,
  ) {}

  /** Asks for the microphone and starts capturing. Throws "mic" errors the page can explain. */
  async start(deviceId?: string): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("mic: this browser can't use a microphone here");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      throw new Error(`mic: ${(e as Error).message}`);
    }
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule("/pcm-capture.js");
    const node = new AudioWorkletNode(ctx, "pcm-capture");
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const pcm = this.muted ? new Int16Array(e.data.byteLength / 2) : new Int16Array(e.data);
      this.onChunk(toBase64(pcm), level(pcm));
    };
    ctx.createMediaStreamSource(this.stream).connect(node);
    // The worklet runs only when it reaches the destination; a silent gain keeps the mic out of the speakers.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
  }

  /** Plays one chunk of the voice's audio. */
  play(b64: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const pcm = fromBase64(b64);
    this.onOutput(level(pcm));
    const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const now = ctx.currentTime;
    if (this.next - now > MAX_QUEUE_S) {
      for (const s of this.playing) s.stop();
      this.playing = [];
      this.next = 0;
    }
    const at = Math.max(now + 0.03, this.next);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => (this.playing = this.playing.filter((x) => x !== src));
    src.start(at);
    this.playing.push(src);
    this.next = at + buf.duration;
  }

  stop(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    void this.ctx?.close().catch(() => null);
    this.ctx = null;
    this.playing = [];
  }
}
