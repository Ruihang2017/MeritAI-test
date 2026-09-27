import { useEffect, useRef, useState } from "react";
import type { SessionFrom, SessionRecord } from "../../../src/memory/store";
import type { ShellState } from "../../../src/server/protocol";
import type { Api } from "../api";
import { fromText, type Ask } from "../ask";
import { dayLabel, fmtTime } from "../format";
import type { Turn } from "../conversation";
import { Composer, TurnView, type ComposerHandle } from "./Conversation";
import { Icon } from "./Icon";
import type { Page } from "./Shell";

// The side panel (design: Dock, Dock*): the current conversation next to any page except
// Conversations, so asking MeritAI from a page doesn't leave it. Same conversation as the
// Conversations page; "Open in Conversations" only switches to the full view.

const SUGGESTIONS: Partial<Record<Page, { title: string; items: string[] }>> = {
  hiring: { title: "For Hiring", items: ["Write a job description with me", "What shouldn't I ask in an interview?", "How do I check someone can work in Australia?"] },
  staff: { title: "For Staff", items: ["What do I need to do this week?", "Someone is resigning. What do I need to do?", "Plan a difficult conversation with me"] },
  files: { title: "For Files", items: ["Write a letter from my notes", "Turn my notes into a policy", "What should I keep on file for each employee?"] },
  profile: { title: "For Profile & policies", items: ["Fill in the rest of my business profile with me", "Which award is likely to cover my staff?", "Write a policy from my notes"] },
};
const GENERAL = { title: "Ask about", items: ["What do I need to do this week?", "Someone is resigning. What do I need to do?", "I'm hiring a casual. What paperwork do I need?"] };

export interface DockNotice {
  /** What the new conversation is about, and the one it replaced (kept, with a way back). */
  about: string;
  prev: { title: string; threadId: string };
}

export function Dock(p: {
  api: Api;
  state: ShellState | null;
  page: Page;
  turns: Turn[];
  title: string | null;
  from: SessionFrom | null;
  recent: SessionRecord[];
  currentThread: string | null;
  running: boolean;
  waiting: boolean;
  queue: Ask[];
  notice: DockNotice | null;
  draft: string | null;
  floating: boolean;
  hidden: boolean;
  /** Voice is on (its bar is on Conversations): no typing here meanwhile. */
  voiceOn: boolean;
  onEndVoice: () => void;
  onDraftUsed: () => void;
  onSend: (text: string, skill?: string, attachments?: string[]) => void;
  onStop: () => void;
  onAnswer: (id: string, yes: boolean) => void;
  onNew: () => void;
  onResume: (threadId: string) => void;
  onCancelQueued: (i: number) => void;
  onFull: () => void;
  onClose: () => void;
  onGoFrom: (f: SessionFrom) => void;
}) {
  const { turns } = p;
  const [menu, setMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Follow the reply while it streams, unless the owner scrolled up to read.
  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    if (s.scrollHeight - s.scrollTop - s.clientHeight < 160) bottom.current?.scrollIntoView({ block: "end" });
  }, [turns, p.queue]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const empty = turns.length === 0;
  const title = empty && !p.title ? "New conversation" : (p.title ?? turns[0]?.user.text.slice(0, 60) ?? "Conversation");
  const status = p.waiting ? { cls: "warn", label: "Waiting on you" } : p.running ? { cls: "info", label: "Working" } : null;
  const sugg = SUGGESTIONS[p.page] ?? GENERAL;
  const others = p.recent.filter((r) => r.threadId !== p.currentThread);

  return (
    <aside
      className={`dock${p.floating ? " floating" : ""}`}
      hidden={p.hidden}
      aria-label="MeritAI side panel"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void composer.current?.addFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="dock-h">
        <button type="button" className={`dock-title${menu ? " on" : ""}`} aria-haspopup="menu" aria-expanded={menu} title="Switch conversation" onClick={() => setMenu(!menu)}>
          <span className="av sm" aria-hidden="true">
            M
          </span>
          <span className="ellipsis">{title}</span>
          <Icon name="down" size={15} stroke={2} />
        </button>
        <button type="button" className="ib sm" aria-label="New conversation" title="New conversation" disabled={p.running} onClick={p.onNew}>
          <Icon name="plus" size={18} stroke={2} />
        </button>
        <button type="button" className="ib sm" aria-label="Open in Conversations" title="Open in Conversations" onClick={p.onFull}>
          <Icon name="expand" size={17} />
        </button>
        <button type="button" className="ib sm" aria-label="Close side panel" title="Close (Ctrl J)" onClick={p.onClose}>
          <Icon name="close" size={18} />
        </button>
        {menu && (
          <>
            <div className="fill" style={{ zIndex: 29 }} onClick={() => setMenu(false)} />
            <div className="menu dock-menu" role="menu" aria-label="Switch conversation">
              <div className="cap" style={{ padding: "8px 10px 4px" }}>
                Switch conversation
              </div>
              {p.recent.slice(0, 6).map((r) => {
                const on = r.threadId === p.currentThread;
                return (
                  <button key={r.threadId} type="button" role="menuitem" className={`menu-item dock-conv${on ? " on" : ""}`} disabled={p.running && !on} onClick={() => (setMenu(false), on || p.onResume(r.threadId))}>
                    <span className="grow" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                      <b className="ellipsis">{r.title}</b>
                      <span className="meta ellipsis">{r.from ? `From ${fromText(r.from)}` : "Conversations"} · {whenOf(r.startedAt)}</span>
                    </span>
                    {on && <Icon name="check" size={15} stroke={2.2} />}
                  </button>
                );
              })}
              {p.recent.length === 0 && <div className="meta" style={{ padding: "6px 10px" }}>No earlier conversations yet.</div>}
              {p.running && p.recent.length > 1 && <div className="meta" style={{ padding: "6px 10px" }}>You can switch when this answer finishes.</div>}
              <div role="separator" className="menu-sep" />
              <button type="button" role="menuitem" className="menu-item" style={{ color: "#1A57CC", fontWeight: 700 }} onClick={() => (setMenu(false), p.onFull())}>
                All conversations
              </button>
            </div>
          </>
        )}
      </div>

      {(p.from || status) && !empty && (
        <div className="dock-ctx">
          {p.from && (
            <>
              <span>From</span>
              <button type="button" className="link-btn ellipsis" title={`Go to ${fromText(p.from)}`} onClick={() => p.onGoFrom(p.from!)}>
                {fromText(p.from)}
                <Icon name="goto" size={13} stroke={2} />
              </button>
            </>
          )}
          <span className="grow" />
          {status && (
            <span className={`pill ${status.cls}`} style={{ height: 22 }}>
              {status.cls === "info" ? <span className="spin" style={{ width: 10, height: 10 }} /> : <span className="dot" />}
              {status.label}
            </span>
          )}
        </div>
      )}

      <div className="dock-thread" ref={scroller}>
        <div className={`dock-thread-in${empty && !p.queue.length ? " top" : ""}`}>
          {p.notice && (
            <div className="banner info" role="status">
              <Icon name="conversations" size={16} />
              <span>
                <b>New conversation</b> about {p.notice.about}. Your conversation “{p.notice.prev.title}” is kept.{" "}
                <button type="button" className="link-btn" disabled={p.running} onClick={() => p.onResume(p.notice!.prev.threadId)}>
                  Go back to it
                </button>
              </span>
            </div>
          )}
          {empty && !p.queue.length && (
            <>
              <div className="dock-welcome">
                <b>What can I help with?</b>
                <span className="sub">Ask about anything, or drop a file here. The page stays open next to me.</span>
              </div>
              <div className="dock-sugg">
                <span className="cap">{sugg.title}</span>
                {sugg.items.map((t) => (
                  <button key={t} type="button" className="pick" disabled={!p.state?.account.loggedIn} onClick={() => p.onSend(t)}>
                    {t}
                  </button>
                ))}
              </div>
              {others.length > 0 && (
                <div className="dock-sugg">
                  <span className="cap">Pick up where you left off</span>
                  {others.slice(0, 2).map((r) => (
                    <button key={r.threadId} type="button" className="recent-item" onClick={() => p.onResume(r.threadId)}>
                      <span className="t">{r.title}</span>
                      <span className="w">
                        {r.from ? `From ${fromText(r.from)} · ` : ""}
                        {whenOf(r.startedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {turns.map((t, i) => (
            <TurnView key={t.id} turn={t} showDay={i > 0 && dayLabel(turns[i - 1].at) !== dayLabel(t.at)} onAnswer={p.onAnswer} api={p.api} domains={p.state?.officialDomains ?? []} compact />
          ))}
          {p.queue.map((q, i) => (
            <div key={i} className="you queued">
              <span className="cap">Next · sends when this answer finishes</span>
              <div className="bubble">{q.text}</div>
              <button type="button" className="link-btn" onClick={() => p.onCancelQueued(i)}>
                Cancel
              </button>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      </div>

      <div className="dock-composer">
        {p.voiceOn ? (
          <div className="banner info" style={{ alignItems: "center" }}>
            <Icon name="mic" size={16} />
            <span className="grow">
              <b>Voice is on.</b> Its controls are on Conversations.
            </span>
            <button type="button" className="btn sm" onClick={p.onFull}>
              Open
            </button>
            <button type="button" className="btn sm" onClick={p.onEndVoice}>
              End voice
            </button>
          </div>
        ) : (
        <Composer
          ref={composer}
          id="dock-msg"
          api={p.api}
          running={p.running}
          waiting={p.waiting}
          onSend={p.onSend}
          onStop={p.onStop}
          disabled={!p.state?.account.loggedIn}
          draft={p.draft}
          onDraftUsed={p.onDraftUsed}
          pending={p.state?.attachments ?? []}
          placeholder={empty ? "Ask MeritAI anything" : "Ask a follow-up"}
        />
        )}
        <div className="foot">Replies can be wrong. Only a receipt means something was saved.</div>
      </div>

      {dragging && (
        <div className="drop dots" style={{ inset: "56px 0 0" }}>
          <div className="drop-card" style={{ padding: "28px 24px", textAlign: "center" }}>
            <Icon name="attach" size={26} />
            <b>Drop files to add them to your Inbox</b>
            <span className="meta">They go with your next message.</span>
          </div>
        </div>
      )}
    </aside>
  );
}

function whenOf(iso: string): string {
  const d = new Date(iso);
  const day = dayLabel(d);
  return day === "Today" ? fmtTime(d) : day;
}
