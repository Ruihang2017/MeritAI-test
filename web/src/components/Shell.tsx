import type { Reminder } from "../../../src/business/reminders";
import type { ShellState } from "../../../src/server/protocol";
import type { Connection } from "../api";
import { fmtDate, fmtDatesIn } from "../format";
import { Icon, type IconName } from "./Icon";

export type Page = "conversations" | "staff" | "hiring" | "profile" | "files" | "memory" | "settings";

export function AppBar({ state, connection, onAttention, showAttention }: { state: ShellState | null; connection: Connection; onAttention: () => void; showAttention: boolean }) {
  const status =
    connection !== "open"
      ? { word: connection === "connecting" ? "Connecting" : "Offline", dot: "#B3261E" }
      : !state?.account.loggedIn
        ? { word: "Not signed in", dot: "#B3261E" }
        : state.usageLimit
          ? { word: state.usageLimit.resetAt ? `Usage limit until ${state.usageLimit.resetAt}` : "Usage limit", dot: "#D9A400" }
          : state.busy
          ? { word: "Working", dot: "#1A57CC" }
          : { word: "Ready", dot: "#2E9D5B" };
  return (
    <header className="appbar">
      <div className="logo">M</div>
      <div className="brand">MeritAI</div>
      <div className="vr" />
      <Icon name="building" size={18} />
      <div className="biz">{state?.business.name ?? "Your business"}</div>
      {state?.engine === "fake" && <span className="sample">Demo · sample data</span>}
      <span className="grow" />
      {showAttention && state && (state.attention.overdue > 0 || state.attention.soon > 0) && (
        <button type="button" className="attn-btn" onClick={onAttention}>
          <span className="dot" style={{ color: state.attention.overdue ? "#B3261E" : "#D9A400" }} />
          Attention {state.attention.overdue > 0 && <b style={{ color: "#B3261E" }}>{state.attention.overdue} overdue</b>}
          {state.attention.soon > 0 && <span> · {state.attention.soon} this week</span>}
        </button>
      )}
      <span className="status-pill">
        <span className="dot" style={{ color: status.dot }} />
        Adviser <b>{status.word}</b>
      </span>
      {state && (
        <span className="status-pill" title={state.workspacePath}>
          <Icon name="folder" size={14} />
          Workspace <b>{state.workspace}</b>
        </span>
      )}
    </header>
  );
}

const MAIN: { key: Page; label: string; icon: IconName }[] = [
  { key: "conversations", label: "Conversations", icon: "conversations" },
  { key: "staff", label: "Staff", icon: "staff" },
  { key: "hiring", label: "Hiring", icon: "hiring" },
  { key: "profile", label: "Profile & policies", icon: "profile" },
  { key: "files", label: "Files", icon: "files" },
];
const SYSTEM: { key: Page; label: string; icon: IconName }[] = [
  { key: "memory", label: "Memory", icon: "memory" },
  { key: "settings", label: "Settings", icon: "settings" },
];

export function Nav({
  page,
  onPage,
  onNew,
  recent,
  onRecent,
  currentThread,
  state,
}: {
  page: Page;
  onPage: (p: Page) => void;
  onNew: () => void;
  recent: { threadId: string; title: string; startedAt: string }[];
  onRecent: (threadId: string) => void;
  currentThread: string | null;
  state: ShellState | null;
}) {
  const item = (it: (typeof MAIN)[number]) => {
    const on = it.key === page;
    const badge = it.key === "conversations" && state?.confirms.length ? { n: state.confirms.length, bg: "#F0D58A", fg: "#4A3600" } : it.key === "staff" && state?.attention.overdue ? { n: state.attention.overdue, bg: "#B3261E", fg: "#FFFFFF" } : null;
    return (
      <button key={it.key} type="button" className={`nav-item${on ? " on" : ""}`} aria-current={on ? "page" : undefined} onClick={() => onPage(it.key)}>
        <Icon name={it.icon} />
        <span className="grow">{it.label}</span>
        {badge && (
          <span className="badge" style={{ background: badge.bg, color: badge.fg }}>
            {badge.n}
          </span>
        )}
      </button>
    );
  };
  return (
    <nav className="nav" aria-label="Main">
      <button type="button" className="btn p new-conv" onClick={onNew}>
        <Icon name="plus" size={16} stroke={2} />
        New conversation
      </button>
      <div className="nav-list">
        {MAIN.map(item)}
        <div role="separator" className="nav-sep" />
        {SYSTEM.map(item)}
      </div>
      {recent.length > 0 && (
        <div className="recent">
          <div className="cap" style={{ padding: "4px 12px" }}>
            Recent
          </div>
          {recent.slice(0, 3).map((r) => (
            <button key={r.threadId} type="button" className={`recent-item${r.threadId === currentThread ? " on" : ""}`} onClick={() => onRecent(r.threadId)}>
              <span className="t">{r.title}</span>
              <span className="w">{new Date(r.startedAt).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}</span>
            </button>
          ))}
          <button type="button" className="all-conv" onClick={() => onPage("conversations")}>
            All conversations
          </button>
        </div>
      )}
      <div className="grow" />
      <div className="me">
        <div className="av" style={{ background: "#DCE6FA", color: "#1446A6", width: 32, height: 32, borderRadius: 999, fontSize: 13 }}>
          {state?.engine === "fake" ? "D" : "Me"}
        </div>
        <div className="me-t">
          <span>{state?.engine === "fake" ? "Demo user" : "Owner"}</span>
          <span className="meta" style={{ fontSize: 12 }}>
            {state?.account.loggedIn ? "signed in" : "not signed in"}
          </span>
        </div>
      </div>
    </nav>
  );
}

export function AttentionPanel({ reminders, onClose, onAsk }: { reminders: Reminder[] | null; onClose?: () => void; onAsk: (text: string) => void }) {
  const overdue = reminders?.filter((r) => r.overdue) ?? [];
  const rest = reminders?.filter((r) => !r.overdue) ?? [];
  return (
    <aside className="attention" aria-label="Attention">
      <div className="attention-h">
        <h2 className="h2" style={{ flexGrow: 1 }}>
          Attention
        </h2>
        {overdue.length > 0 && <span className="pill bad">{overdue.length} overdue</span>}
        {onClose && (
          <button type="button" className="ib" aria-label="Close attention" onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="attention-list">
        {reminders === null && <div className="meta">Loading…</div>}
        {reminders?.length === 0 && (
          <div className="card empty-card">
            <b>Nothing due in the next 30 days</b>
            <span className="meta">Worked out from your staff register and business profile.</span>
          </div>
        )}
        {[...overdue, ...rest].map((r, i) => (
          <article key={i} className={`rem${r.overdue ? " over" : ""}`}>
            <div className="rem-top">
              <span className={`pill ${r.overdue ? "bad" : "warn"}`}>{r.overdue ? `Overdue · was due ${fmtDate(r.due)}` : `By ${fmtDate(r.due)}`}</span>
            </div>
            <b className="rem-t">{fmtDatesIn(r.title)}</b>
            <p className="rem-d">{fmtDatesIn(r.detail)}</p>
            <div className="rem-a">
              {r.source && (
                <a className="chip" href={r.source.url} target="_blank" rel="noreferrer noopener">
                  <Icon name="shield" size={14} />
                  {r.source.title}
                </a>
              )}
              <button type="button" className="btn g sm" onClick={() => onAsk(`Help me with this: ${r.title}`)}>
                Ask about this
              </button>
            </div>
          </article>
        ))}
      </div>
      <p className="attention-foot">Worked out from your register and profile each time; rules checked against Fair Work and the ATO. Check anything important with an adviser.</p>
    </aside>
  );
}
