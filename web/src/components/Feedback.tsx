import { useEffect, useState } from "react";
import type { ShellState } from "../../../src/server/protocol";
import type { Api } from "../api";
import type { Turn } from "../conversation";
import { Icon } from "./Icon";

// Testers' feedback (design: FeedbackReply, FeedbackSend). Kept on this computer; the tester sends
// the feedback file to the MeritAI team (the app is local only).

const REASONS = ["Wrong or out of date", "Missed something", "Not what I asked", "Too long or unclear", "Something else"];

/** "Was this helpful?" under a finished reply. */
export function ReplyFeedback({ turn, api }: { turn: Turn; api: Api }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const answer = turn.blocks.flatMap((b) => (b.kind === "text" ? [b.text] : [])).join("\n\n");
  const save = async (r: "up" | "down") => {
    setErr(null);
    try {
      await api.call("rateReply", { rating: r, reasons: r === "down" ? reasons : [], note: r === "down" ? note : "", question: turn.user.text, answer });
      setSaved(true);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  if (saved)
    return (
      <div className="fb-row">
        <span className="meta">{rating === "up" ? "Thanks: marked helpful." : "Thanks: noted what went wrong."}</span>
      </div>
    );
  return (
    <>
      <div className="fb-row">
        <span className="meta">Was this helpful?</span>
        <button type="button" className={`ib fb${rating === "up" ? " up" : ""}`} aria-label="Helpful" aria-pressed={rating === "up"} onClick={() => (setRating("up"), void save("up"))}>
          <Icon name="thumbUp" size={17} />
        </button>
        <button type="button" className={`ib fb${rating === "down" ? " down" : ""}`} aria-label="Not helpful" aria-pressed={rating === "down"} onClick={() => (setRating("down"), setOpen(true))}>
          <Icon name="thumbDown" size={17} />
        </button>
      </div>
      {open && (
        <section className="card fb-form" aria-label="What went wrong">
          <b style={{ fontSize: 14.5 }}>What went wrong?</b>
          <div className="row-wrap" style={{ gap: 6 }}>
            {REASONS.map((r) => {
              const on = reasons.includes(r);
              return (
                <button key={r} type="button" className={`fb-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setReasons(on ? reasons.filter((x) => x !== r) : [...reasons, r])}>
                  {r}
                </button>
              );
            })}
          </div>
          <label className="sr" htmlFor={`fb-${turn.id}`}>
            What happened
          </label>
          <textarea id={`fb-${turn.id}`} className="input" rows={2} style={{ height: "auto", padding: "8px 12px", resize: "vertical" }} placeholder="What should it have said? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row-wrap" style={{ alignItems: "center" }}>
            <button type="button" className="btn p sm" onClick={() => void save("down")}>
              Save feedback
            </button>
            <button type="button" className="btn g sm" onClick={() => (setOpen(false), setRating(null))}>
              Cancel
            </button>
            <span className="meta">Kept on this computer. It reaches the MeritAI team only in a feedback file you send.</span>
          </div>
          {err && <div className="banner bad">{err}</div>}
        </section>
      )}
    </>
  );
}

/** "Send feedback" from the account menu: one file to send to the MeritAI team. */
export function FeedbackDialog({ api, state, onClose }: { api: Api; state: ShellState | null; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [ratings, setRatings] = useState(true);
  const [conversation, setConversation] = useState(true);
  const [technical, setTechnical] = useState(true);
  const [summary, setSummary] = useState<{ up: number; down: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.call("feedbackSummary").then(setSummary, () => null);
  }, [api]);
  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      setPath((await api.call("exportFeedback", { note, ratings, conversation, technical })).path);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const box = (label: string, hint: string, on: boolean, set: (v: boolean) => void, disabled = false) => (
    <label className="fb-box">
      <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={(e) => set(e.target.checked)} />
      <span>
        <b>{label}</b>
        <span className="meta">{hint}</span>
      </span>
    </label>
  );
  return (
    <>
      <div className="scrim fill" onClick={onClose} />
      <div className="modal dialog fb-dialog" role="dialog" aria-modal="true" aria-label="Send feedback">
        <h2 className="h2" style={{ fontSize: 20 }}>
          Send feedback
        </h2>
        <p className="sub" style={{ margin: 0 }}>
          MeritAI runs only on this computer, so feedback goes in a file you send to the MeritAI team (email or Teams).
        </p>
        <label className="field">
          What happened, or what would make it better?
          <textarea className="input" rows={4} style={{ height: "auto", padding: "10px 12px", resize: "vertical" }} placeholder="For example: I asked about a resignation and it didn't mention the final pay date." value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {box("Your ratings of replies", summary ? `${summary.up} helpful, ${summary.down} not helpful` : "…", ratings, setRatings)}
          {box("This conversation", state?.title ? `“${state.title}”: your messages and the replies` : "No conversation open", conversation, setConversation, !state?.title)}
          {box("Technical details", "App version, model, engine and recent errors; no passwords or keys", technical, setTechnical)}
        </div>
        {state?.sampleData ? null : <div className="banner warn" style={{ fontSize: 13, padding: "10px 12px" }}>Sample data only: don't include real people's details while testing.</div>}
        {err && <div className="banner bad">{err}</div>}
        {path ? (
          <div className="receipt" style={{ fontSize: 13.5 }}>
            <Icon name="check" size={16} stroke={2.2} />
            <span className="grow" style={{ overflowWrap: "anywhere" }}>
              <b>Saved</b> · Feedback/{path.split(/[\\/]/).pop()}
            </span>
            <button type="button" className="btn g sm" style={{ color: "#14532D" }} onClick={() => void api.call("revealFile", { path })}>
              Show in folder
            </button>
          </div>
        ) : null}
        <div className="row-wrap">
          {path ? (
            <button type="button" className="btn p" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn p" disabled={saving || (!note.trim() && !ratings && !conversation)} onClick={() => void save()}>
                {saving ? "Saving…" : "Save the feedback file"}
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
