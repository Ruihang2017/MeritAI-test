import { useEffect, useMemo, useState } from "react";
import type { SessionRecord } from "../../../src/memory/store";
import type { Api } from "../api";
import { dayLabel } from "../format";
import { Icon } from "./Icon";

/** All stored conversations (design board "Conversations"): search, grouped by day, click to continue. */
export function AllConversations({ api, onResume, onNew }: { api: Api; onResume: (threadId: string) => void; onNew: () => void }) {
  const [items, setItems] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    api.call("history").then(setItems, (e: Error) => setError(e.message));
  }, [api]);
  const groups = useMemo(() => {
    const now = new Date();
    const week = now.getTime() - 7 * 86_400_000;
    const out: { title: string; items: SessionRecord[] }[] = [
      { title: "Today", items: [] },
      { title: "This week", items: [] },
      { title: "Earlier", items: [] },
    ];
    for (const r of (items ?? []).filter((x) => !q || x.title.toLowerCase().includes(q.toLowerCase()))) {
      const d = new Date(r.startedAt);
      out[dayLabel(d, now) === "Today" ? 0 : d.getTime() >= week ? 1 : 2].items.push(r);
    }
    return out.filter((g) => g.items.length);
  }, [items, q]);
  return (
    <main className="main" style={{ background: "#EEF2F7" }}>
      <div className="page-h">
        <div style={{ flexGrow: 1, display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 className="h1">Conversations</h1>
          <span className="sub">Kept for 30 days</span>
        </div>
        <button type="button" className="btn p" onClick={onNew}>
          <Icon name="plus" size={16} stroke={2} />
          New conversation
        </button>
      </div>
      <div className="staff-body" style={{ maxWidth: 920 }}>
        {error && <div className="banner bad">{error}</div>}
        <label htmlFor="cq" className="sr">
          Search conversations
        </label>
        <div className="search" style={{ width: "100%" }}>
          <Icon name="search" size={16} />
          <input id="cq" className="input" placeholder="Search by title" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {items?.length === 0 && (
          <div className="card empty-card" style={{ maxWidth: "none" }}>
            <b>No conversations yet</b>
            <span className="meta">Ask about hiring, someone leaving, a difficult conversation or anything else.</span>
            <button type="button" className="btn p" onClick={onNew}>
              Start a conversation
            </button>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.title} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h2 className="cap" style={{ margin: "4px 0 0" }}>
              {g.title}
            </h2>
            <div className="card" style={{ overflow: "hidden" }}>
              {g.items.map((r, i) => (
                <button key={r.threadId} type="button" className="conv-row" style={i ? undefined : { borderTop: 0 }} onClick={() => onResume(r.threadId)}>
                  <Icon name="conversations" size={18} />
                  <span className="grow ellipsis">{r.title}</span>
                  <span className="meta">{g.title === "Today" ? new Date(r.startedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).toLowerCase() : dayLabel(new Date(r.startedAt))}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {items && items.length > 0 && groups.length === 0 && <p className="meta">No conversation title matches “{q}”.</p>}
      </div>
    </main>
  );
}
