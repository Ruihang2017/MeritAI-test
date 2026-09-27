import { useEffect, useState } from "react";
import { microphones, saveMicrophone } from "../voice";
import { Icon } from "./Icon";

// Voice in the browser, as on the design canvas (Voice, VoiceEnded, VoiceStates, VoiceNoKey).

export type VoicePhase = "connecting" | "listening" | "speaking" | "working" | "muted";

export interface VoiceUi {
  /** False while the microphone and the voice service are starting. */
  started: boolean;
  muted: boolean;
  /** The adviser is working on a spoken request. */
  working: boolean;
  /** What was heard or said last. */
  line: string;
  startedAt: number;
  micId: string;
}

/** Loudness, updated by the audio code without re-rendering the page (the bar reads it on a timer). */
export interface VoiceLevels {
  mic: number;
  out: number;
  /** When the voice last made a sound (ms). */
  outAt: number;
}

const STATUS: Record<VoicePhase, string> = { connecting: "Connecting…", listening: "Listening", speaking: "Speaking", working: "Working", muted: "Muted" };
const RATE_PER_MIN = 0.05;

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const cost = (s: number) => `about US$${Math.max(0.01, (s / 60) * RATE_PER_MIN).toFixed(2)}`;

/** Replaces the message box while voice is on (design: Voice). */
export function VoiceBar({ v, levels, demo, onMute, onEnd, onMic }: { v: VoiceUi; levels: { current: VoiceLevels }; demo: boolean; onMute: () => void; onEnd: () => void; onMic: (id: string) => void }) {
  const [now, setNow] = useState(Date.now());
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (v.started) microphones().then(setMics, () => null);
  }, [v.started]);
  const phase: VoicePhase = !v.started ? "connecting" : v.muted ? "muted" : now - levels.current.outAt < 400 ? "speaking" : v.working ? "working" : "listening";
  const secs = (now - v.startedAt) / 1000;
  const lvl = phase === "speaking" ? levels.current.out : phase === "listening" ? levels.current.mic : 0;
  const core = phase === "muted" ? 18 : phase === "connecting" ? 14 : Math.round(24 + lvl * 18);
  const muted = phase === "muted";
  return (
    <section className={`voice-bar${muted ? " muted" : ""}`} aria-label="Voice">
      <div className="voice-top">
        <div className="orb" aria-hidden="true">
          <div className="orb-mid">
            <div className="orb-core" style={{ width: core, height: core, opacity: phase === "connecting" || muted ? 0.6 : 1 }} />
          </div>
        </div>
        <div className="voice-text">
          <div role="status" className="voice-status">
            {(phase === "working" || phase === "connecting") && <span className="spin light" />}
            {STATUS[phase]}
          </div>
          <div className="voice-line">{v.line}</div>
        </div>
      </div>
      <div className="voice-row">
        {mics.length > 1 && (
          <label className="voice-mic">
            Microphone
            <select
              value={v.micId || mics[0]?.id}
              onChange={(e) => {
                saveMicrophone(e.target.value);
                onMic(e.target.value);
              }}
            >
              {mics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="grow" />
        <span className="voice-meta">{phase === "connecting" ? (demo ? "Demo voice: a stand-in, no cost" : "Paid voice, about US$0.05 a minute") : `${mmss(secs)} · stops after 60 s of silence`}</span>
        <button type="button" className="voice-btn" aria-pressed={muted} onClick={onMute} disabled={phase === "connecting"}>
          {muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" className="voice-end" onClick={onEnd}>
          <Icon name="stop" size={14} stroke={2.4} />
          End voice
        </button>
      </div>
    </section>
  );
}

/** The microphone in the message box; without a key it is off and points to Settings (design: VoiceNoKey). */
export function MicButton({ keySet, demo, disabled, onStart, onSettings }: { keySet: boolean; demo: boolean; disabled: boolean; onStart: () => void; onSettings: () => void }) {
  if (keySet)
    return (
      <button type="button" className="ib mic" aria-label="Start voice" title={demo ? "Start voice (demo: a stand-in voice, no cost)" : "Start voice (paid, about US$0.05 a minute)"} disabled={disabled} onClick={onStart}>
        <Icon name="mic" />
      </button>
    );
  return (
    <span className="mic-off">
      <span role="tooltip" id="mic-tip" className="mic-tip">
        <span>
          <b>Voice is off.</b> It needs your OpenAI API key.
        </span>
        <button type="button" className="link-btn" onClick={onSettings}>
          Add it in Settings
        </button>
      </span>
      <button type="button" className="ib mic" aria-disabled="true" aria-describedby="mic-tip" aria-label="Start voice (needs an API key)" onClick={onSettings}>
        <Icon name="micOff" />
      </button>
    </span>
  );
}

export type VoiceNote =
  | { kind: "ended"; seconds: number; byUser: boolean; reason: string }
  | { kind: "mic"; message: string }
  | { kind: "service"; message: string };

/** After voice, or when it couldn't start (design: VoiceStates). */
export function VoiceBanner({ note, onAgain, onSettings, onClose, demo = false }: { note: VoiceNote; onAgain: () => void; onSettings: () => void; onClose: () => void; /** The demo's stand-in voice: nothing is billed. */ demo?: boolean }) {
  if (note.kind === "ended")
    return note.byUser ? (
      <div className="banner n voice-note" style={{ alignItems: "center" }}>
        <span className="grow">
          <b>Voice ended</b> · {demo ? `${mmss(note.seconds)} · demo voice, not billed` : `${mmss(note.seconds)} billed, ${cost(note.seconds)}`}
        </span>
        <button type="button" className="btn g sm" onClick={onAgain}>
          Talk again
        </button>
        <button type="button" className="ib sm" aria-label="Dismiss" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
    ) : (
      <div className="banner warn voice-note" style={{ alignItems: "center" }}>
        <span className="grow">
          <b>Voice stopped: {note.reason}</b> after {mmss(note.seconds)} ({cost(note.seconds)}). What you said so far is in the chat.
        </span>
        <button type="button" className="btn g sm" onClick={onAgain}>
          {/connection|closed|socket/i.test(note.reason) ? "Reconnect" : "Talk again"}
        </button>
        <button type="button" className="ib sm" aria-label="Dismiss" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  return (
    <div className="banner bad voice-note" role="alert" style={{ alignItems: "center" }}>
      <Icon name="alert" size={18} />
      <span className="grow">
        {note.kind === "mic" ? (
          <>
            <b>No microphone found, or access was blocked.</b> Plug one in or allow microphone access, then try again. You can keep typing meanwhile.
          </>
        ) : (
          <>
            <b>Voice isn't available right now.</b> {note.message} Typing still works.
          </>
        )}
      </span>
      {note.kind === "mic" ? (
        <button type="button" className="btn sm" onClick={onSettings}>
          Choose microphone
        </button>
      ) : (
        <button type="button" className="btn sm" onClick={onAgain}>
          Try again
        </button>
      )}
      <button type="button" className="ib sm" aria-label="Dismiss" onClick={onClose}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
