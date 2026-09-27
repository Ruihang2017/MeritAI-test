import type { Engine, EngineEvent } from "../engine/types";
import type { LiveLike, TranscriptDelta } from "./liveSession";

/**
 * Connects GPT-Live's client delegations to the Codex HR assistant.
 *
 * - session.delegation.created has no text, so the user's request is taken
 *   from the input transcript since the previous delegation (up to offset_ms,
 *   plus a short grace period for late transcript deltas).
 * - No turn running → engine.send(); a turn running → engine.steer() (the
 *   base prompt decides whether it adds to or replaces the current request).
 * - Codex progress → session.thinking.append (quiet); slow official-source
 *   research → a spoken "checking" note; the final answer → a speakable
 *   summary via session.commentary.append with the latest delegation id.
 */

/** Wait for transcript deltas that arrive just after the delegation event. */
const TRANSCRIPT_GRACE_MS = 400;

export interface BridgeCallbacks {
  /** The user's spoken request as sent to the assistant. */
  onRequest: (text: string, mode: "new" | "steer") => void;
  /** Every assistant event, for on-screen display. */
  onEvent: (ev: EngineEvent) => void;
  onError: (message: string) => void;
}

export class VoiceBridge {
  private deltas: TranscriptDelta[] = [];
  private consumedUntilMs = -1;
  /** The delegation GPT-Live is currently waiting on (the latest one). */
  private currentDelegation: string | null = null;
  private turnRunning = false;
  /** Requests that arrived while a turn was starting or ending (steer not possible). */
  private queued: string[] = [];

  constructor(
    private readonly live: LiveLike,
    private readonly engine: Engine,
    private readonly cb: BridgeCallbacks,
  ) {
    live.on("inputTranscript", (d) => this.deltas.push(d));
    live.on("outputTranscript", (d) => this.spoken.push({ startMs: d.startMs, endMs: d.endMs }));
    live.on("delegation", (id, offsetMs) => {
      setTimeout(() => this.onDelegation(id, offsetMs).catch((e) => this.cb.onError((e as Error).message)), TRANSCRIPT_GRACE_MS);
    });
  }

  /** When GPT-Live spoke, on the same session timeline as the transcripts. */
  private spoken: { startMs: number; endMs: number }[] = [];

  private takeUtterance(): string {
    const { text, consumedUntilMs } = selectUtterance(this.deltas, this.spoken, this.consumedUntilMs);
    this.consumedUntilMs = consumedUntilMs;
    return text;
  }

  private async onDelegation(id: string, _offsetMs: number): Promise<void> {
    const text = this.takeUtterance();
    this.currentDelegation = id;
    if (!text) {
      this.live.commentary(id, "The backend did not receive any words from the user. Ask the user to repeat the request.");
      return;
    }
    if (this.turnRunning) {
      if (await this.engine.steer(text)) {
        this.cb.onRequest(text, "steer");
        this.live.thinking(id, "Added the user's new words to the task already in progress.");
      } else {
        // The turn is just starting or finishing; handle this right after it.
        this.queued.push(text);
      }
      return;
    }
    await this.runTurn(text);
  }

  private async runTurn(text: string): Promise<void> {
    this.turnRunning = true;
    this.cb.onRequest(text, "new");
    const replies: string[] = [];
    let status: string = "completed";
    try {
      for await (const ev of this.engine.send(text)) {
        this.cb.onEvent(ev);
        const id = this.currentDelegation;
        switch (ev.type) {
          case "tool_activity":
            if (!id) break;
            if (ev.summary.startsWith("searching official sources")) {
              this.live.commentary(id, "Tell the user you are checking official government sources and it takes about twenty seconds.");
            } else {
              this.live.thinking(id, ev.summary);
            }
            break;
          case "skill_loaded":
            if (id) this.live.thinking(id, `Using the ${ev.name} playbook.`);
            break;
          case "text_done":
            replies.push(ev.text);
            break;
          case "turn_end":
            status = ev.status;
            break;
        }
      }
    } finally {
      this.turnRunning = false;
    }
    const id = this.currentDelegation;
    if (!id) return;
    if (status === "completed" && replies.length) {
      this.live.commentary(id, speakable(replies[replies.length - 1]));
    } else if (status === "failed") {
      this.live.commentary(id, "Something went wrong on the backend. Apologise briefly and ask the user to try again.");
    }
    if (this.queued.length) await this.runTurn(this.queued.splice(0).join(" "));
  }
}

/** A pause at least this long, with the voice speaking in it, separates two user utterances. */
const TURN_GAP_MS = 700;

/**
 * The user's latest request from the input transcript (all times on the
 * session timeline). Unconsumed words are split into utterances only where the
 * user paused AND GPT-Live spoke in that pause; the last utterance is the request.
 * - small talk then a question ("hi, can you hear me" / voice answers / "what is ...")
 *   → only the question
 * - barge-in (the user talks over the voice: "actually, never mind, ...")
 *   → kept whole, because there is no pause
 * - the user pausing mid-sentence while the voice stays quiet → kept whole
 */
export function selectUtterance(
  deltas: TranscriptDelta[],
  spoken: { startMs: number; endMs: number }[],
  consumedUntilMs: number,
): { text: string; consumedUntilMs: number } {
  const fresh = deltas.filter((d) => d.endMs > consumedUntilMs).sort((a, b) => a.startMs - b.startMs);
  if (!fresh.length) return { text: "", consumedUntilMs };
  let start = 0;
  for (let i = 1; i < fresh.length; i++) {
    const gapStart = fresh[i - 1].endMs;
    const gapEnd = fresh[i].startMs;
    const voiceInGap = spoken.some((s) => s.endMs > gapStart && s.startMs < gapEnd);
    if (gapEnd - gapStart >= TURN_GAP_MS && voiceInGap) start = i;
  }
  return {
    text: fresh.slice(start).map((d) => d.text).join("").replace(/\s+/g, " ").trim(),
    consumedUntilMs: Math.max(...fresh.map((d) => d.endMs)),
  };
}

/**
 * Turns an on-screen answer into material for a short spoken reply: no
 * markdown, no URLs, capped length, with a pointer to the screen.
 */
export function speakable(answer: string): string {
  const long = answer.length > 600 || /https?:\/\//.test(answer) || /\n\s*([-*]|\d+\.)\s/.test(answer);
  let t = answer
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (t.length > 1200) t = t.slice(0, 1200) + " ...";
  return (
    `Answer from the HR assistant. Say the key facts (figures, durations, amounts, document names) in 2-4 short spoken sentences; do not read links or long lists aloud. ` +
    `Say every number, amount, date and duration exactly as written here (e.g. "$1,500" is "one thousand five hundred dollars"); never round, convert or reword figures:\n${t}` +
    (long ? "\nAfter saying the key facts, mention that the full answer, including any sources, is on the user's screen. Never say only 'it is on your screen'." : "")
  );
}
