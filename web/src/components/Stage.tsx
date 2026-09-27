import type { Api } from "../api";
import type { Turn, TurnChange } from "../conversation";
import { fmtDatesIn } from "../format";
import { ChangeCards } from "./Changes";

/**
 * Voice on: the right-hand panel shows what the conversation is about as it changes (design:
 * SyncVoice). A change that needs the owner's OK waits here: Yes, save, or say "yes" (deleting
 * needs a press). Below: the things this call changed, newest first.
 */
export function VoiceStage({ turns, api, onAnswer }: { turns: Turn[]; api: Api; onAnswer: (id: string, yes: boolean) => void }) {
  const open = turns.flatMap((t) => t.blocks.flatMap((b) => (b.kind === "confirm" && b.state === "open" ? [b] : [])));
  // One card per thing, the latest change first.
  const byKey = new Map<string, TurnChange>();
  for (const t of turns) for (const c of t.changes ?? []) byKey.set(c.key, byKey.has(c.key) ? { ...c, actions: [...byKey.get(c.key)!.actions, ...c.actions] } : c);
  const changes = [...byKey.values()].reverse();
  return (
    <aside className="attention stage" aria-label="On screen">
      <div className="attention-h" style={{ flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
        <h2 className="h2">On screen</h2>
        <span className="meta">What you're talking about, as it changes</span>
      </div>
      <div className="attention-list">
        {open.map((b) => (
          <section key={b.id} className={`confirm open${b.req.destructive ? " destructive" : ""}`} aria-label="Needs your OK">
            <div className="cap" style={{ color: b.req.destructive ? "#B3261E" : "#6B4E00" }}>
              Needs your OK
            </div>
            <div className="q" style={{ fontSize: 15 }}>
              {fmtDatesIn(b.req.title)}
            </div>
            {b.req.items?.length ? (
              <ul className="items" style={{ fontSize: 13 }}>
                {b.req.items.map((it, i) => (
                  <li key={i}>{fmtDatesIn(it)}</li>
                ))}
              </ul>
            ) : null}
            <div className="row-wrap">
              <button type="button" className={`btn ${b.req.destructive ? "d" : "p"}`} onClick={() => onAnswer(b.id, true)}>
                {b.req.destructive ? "Yes, delete" : "Yes, save"}
              </button>
              <button type="button" className="btn" onClick={() => onAnswer(b.id, false)}>
                No
              </button>
            </div>
            <span className="meta">{b.req.destructive ? "Deleting needs a press: saying yes isn't enough." : "Or say “yes”. Nothing changes until you do."}</span>
          </section>
        ))}
        {changes.length > 0 && <ChangeCards items={changes} api={api} compact />}
        {!open.length && !changes.length && (
          <div className="card empty-card">
            <b>Nothing here yet</b>
            <span className="meta">The people, jobs and documents you talk about show here as they change. A change that needs your OK waits here too: say “yes” or press Yes, save.</span>
          </div>
        )}
      </div>
      <p className="attention-foot">Only a receipt means something was saved.</p>
    </aside>
  );
}
