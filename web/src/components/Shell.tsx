import type { Reminder } from "../../../src/business/reminders";
import type { ShellState } from "../../../src/server/protocol";
import type { Connection } from "../api";
import { useEffect, useState } from "react";
import { now } from "../clock";
import { dayLabel, fmtDate, fmtDatesIn, fmtDay, fmtTime } from "../format";

/** "Today 9:42 am", "Yesterday" or "Fri 25 Sep", as in the design's Recent list. */
const whenStarted = (iso: string) => {
  const d = new Date(iso);
  const day = dayLabel(d);
  return day === "Today" ? `Today ${fmtTime(d)}` : day;
};
import { Icon, type IconName } from "./Icon";

export type Page = "conversations" | "all" | "staff" | "hiring" | "profile" | "files" | "memory" | "settings";

/** The side panel's button in the app bar (every page except Conversations). */
export type AskButton = "none" | "closed" | "open" | "working" | "waiting";

export function AppBar({ state, connection, onAttention, showAttention, ask, onAskToggle, onLeaveSample }: { state: ShellState | null; connection: Connection; onAttention: () => void; showAttention: boolean; ask: AskButton; onAskToggle: () => void; onLeaveSample: () => void }) {
  const [sampleOpen, setSampleOpen] = useState(false);
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
      {state?.sampleData &&
        (state.sampleSwitch ? (
          <span className="sample-wrap">
            <button type="button" className="sample" aria-expanded={sampleOpen} onClick={() => setSampleOpen(!sampleOpen)}>
              Sample data
            </button>
            {sampleOpen && (
              <>
                <div className="fill" style={{ zIndex: 29 }} onClick={() => setSampleOpen(false)} />
                <div className="sample-pop" role="dialog" aria-label="Sample business">
                  <div className="cap" style={{ color: "#6B4E00" }}>
                    Sample business
                  </div>
                  <div>
                    <b>{state.business.name} is made up.</b> Its staff, jobs and applications are synthetic, and the app runs on its date, {fmtDay(state.today, { year: true })}, so the reminders read as intended.
                  </div>
                  <div className="meta">Your own business uses its own folder; switching doesn't change either.</div>
                  <div className="row-wrap">
                    <button type="button" className="btn p sm" onClick={() => (setSampleOpen(false), onLeaveSample())}>
                      Switch to my own business
                    </button>
                    <button type="button" className="btn g sm" onClick={() => setSampleOpen(false)}>
                      Keep trying it
                    </button>
                  </div>
                </div>
              </>
            )}
          </span>
        ) : (
          <span className="sample">Sample data</span>
        ))}
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
      {ask !== "none" && (
        <>
          <div className="vr" />
          <button type="button" className={`ask-btn ${ask}`} aria-pressed={ask === "open"} title="Ask MeritAI (Ctrl J)" onClick={onAskToggle}>
            {ask === "working" ? <span className="spin" style={{ width: 12, height: 12 }} /> : ask === "waiting" ? <span className="dot" style={{ color: "#D9A400" }} /> : <Icon name="conversations" size={15} stroke={2} />}
            {ask === "working" ? "MeritAI is working" : ask === "waiting" ? "Waiting on you" : "Ask MeritAI"}
            {(ask === "closed" || ask === "open") && <span className="kbd">Ctrl J</span>}
          </button>
        </>
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
/** Under the owner's name, not in the list (owner, 2026-09-27; design: ShellAccountMenu). */
const ACCOUNT: { key: Page; label: string; hint: string; icon: IconName }[] = [
  { key: "memory", label: "Memory", hint: "What I remember between conversations", icon: "memory" },
  { key: "settings", label: "Settings", hint: "Account, voice key, workspace, speed", icon: "settings" },
];

export function Nav({
  page,
  onPage,
  onNew,
  recent,
  onRecent,
  currentThread,
  state,
  collapsed = false,
}: {
  /** Icons only (the side panel is open and needs the room). */
  collapsed?: boolean;
  page: Page;
  onPage: (p: Page) => void;
  onNew: () => void;
  recent: { threadId: string; title: string; startedAt: string }[];
  onRecent: (threadId: string) => void;
  currentThread: string | null;
  state: ShellState | null;
}) {
  const [acctOpen, setAcctOpen] = useState(false);
  useEffect(() => {
    if (!acctOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAcctOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [acctOpen]);
  const acctOn = page === "memory" || page === "settings";
  const name = state?.sampleData ? "Jo Kim" : "Owner";
  const initials = state?.sampleData ? "JK" : "Me";
  const acctMenu = acctOpen && (
    <>
      <div className="fill" style={{ zIndex: 29 }} onClick={() => setAcctOpen(false)} />
      <div className={`menu acct-menu${collapsed ? " acct-side" : ""}`} role="menu" aria-label="Your account">
        {ACCOUNT.map((it) => (
          <button key={it.key} type="button" role="menuitem" className={`menu-item acct-item${page === it.key ? " on" : ""}`} onClick={() => (setAcctOpen(false), onPage(it.key))}>
            <Icon name={it.icon} />
            <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <b>{it.label}</b>
              <span className="meta">{it.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
  const item = (it: (typeof MAIN)[number]) => {
    const on = it.key === page || (it.key === "conversations" && page === "all");
    const badge = it.key === "conversations" && state?.confirms.length ? { n: state.confirms.length, bg: "#F0D58A", fg: "#4A3600" } : it.key === "staff" && state?.attention.overdue ? { n: state.attention.overdue, bg: "#B3261E", fg: "#FFFFFF" } : null;
    if (collapsed)
      return (
        <button key={it.key} type="button" className={`nav-icon${on ? " on" : ""}`} aria-current={on ? "page" : undefined} aria-label={it.label} title={badge ? `${it.label} · ${badge.n}` : it.label} onClick={() => onPage(it.key)}>
          <Icon name={it.icon} />
          {badge && (
            <span className="badge" style={{ background: badge.bg, color: badge.fg }}>
              {badge.n}
            </span>
          )}
        </button>
      );
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
  if (collapsed)
    return (
      <nav className="nav collapsed" aria-label="Main">
        <button type="button" className="btn p nav-new" aria-label="New conversation" title="New conversation" onClick={onNew}>
          <Icon name="plus" size={18} stroke={2} />
        </button>
        <div className="nav-list">{MAIN.map(item)}</div>
        <div className="grow" />
        <div className="me-wrap">
          {acctMenu}
          <button type="button" className={`nav-icon me-icon${acctOn || acctOpen ? " on" : ""}`} aria-haspopup="menu" aria-expanded={acctOpen} aria-label={`${name}: Memory, Settings`} title={`${name} · Memory, Settings`} onClick={() => setAcctOpen(!acctOpen)}>
            <span className="av me-av">{initials}</span>
          </button>
        </div>
      </nav>
    );
  return (
    <nav className="nav" aria-label="Main">
      <button type="button" className="btn p new-conv" onClick={onNew}>
        <Icon name="plus" size={16} stroke={2} />
        New conversation
      </button>
      <div className="nav-list">{MAIN.map(item)}</div>
      {recent.length > 0 && (
        <div className="recent">
          <div className="cap" style={{ padding: "4px 12px" }}>
            Recent
          </div>
          {recent.slice(0, 3).map((r) => (
            <button key={r.threadId} type="button" className={`recent-item${r.threadId === currentThread ? " on" : ""}`} onClick={() => onRecent(r.threadId)}>
              <span className="t">{r.title}</span>
              <span className="w">{whenStarted(r.startedAt)}</span>
            </button>
          ))}
          <button type="button" className="all-conv" onClick={() => onPage("all")}>
            All conversations
          </button>
        </div>
      )}
      <div className="grow" />
      <div className="me-wrap">
        {acctMenu}
        <button type="button" className={`me${acctOn || acctOpen ? " on" : ""}`} aria-haspopup="menu" aria-expanded={acctOpen} title="Memory, Settings" onClick={() => setAcctOpen(!acctOpen)}>
          <span className="av me-av">{initials}</span>
          <span className="me-t">
            {/* The demo is the design's owner, Jo Kim (synthetic sample data). */}
            <span>{name}</span>
            <span className="meta ellipsis" style={{ fontSize: 12, fontWeight: 400 }}>
              {state?.account.loggedIn ? (state.engine === "fake" ? "Owner · demo engine" : "Owner · signed in with ChatGPT") : "not signed in"}
            </span>
          </span>
          <Icon name="up" size={16} stroke={2} />
        </button>
      </div>
    </nav>
  );
}

type When = "overdue" | "week" | "month";
const FILTERS: [When | "all", string][] = [
  ["all", "All"],
  ["overdue", "Overdue"],
  ["week", "This week"],
  ["month", "This month"],
];

/** Overdue, due within a week (the Attention button's "this week"), or later in the 30 days shown. */
function whenOf(r: Reminder): When {
  if (r.overdue) return "overdue";
  const soon = now();
  soon.setDate(soon.getDate() + 7);
  const iso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
  return r.due <= iso ? "week" : "month";
}

export function AttentionPanel({
  reminders,
  rulesChecked,
  onClose,
  onAsk,
  onOpenEmployee,
}: {
  reminders: Reminder[] | null;
  rulesChecked: string | null;
  onClose?: () => void;
  onAsk: (r: Reminder) => void;
  onOpenEmployee: (id: number) => void;
}) {
  const [filter, setFilter] = useState<When | "all">("all");
  const items = (reminders ?? []).map((r) => ({ r, when: whenOf(r) }));
  const count = (w: When) => items.filter((x) => x.when === w).length;
  const order: Record<When, number> = { overdue: 0, week: 1, month: 2 };
  const shown = items.filter((x) => filter === "all" || x.when === filter).sort((a, b) => order[a.when] - order[b.when] || a.r.due.localeCompare(b.r.due));
  const status = (x: { r: Reminder; when: When }) =>
    x.when === "overdue" ? `Overdue · since ${fmtDay(x.r.due)}` : x.when === "week" ? `Due ${fmtDate(x.r.due)}` : fmtDate(x.r.due);
  return (
    <aside className="attention" aria-label="Attention">
      <div className="attention-h">
        <h2 className="h2" style={{ flexGrow: 1 }}>
          Attention
        </h2>
        {count("overdue") > 0 && <span className="pill bad">{count("overdue")} overdue</span>}
        {count("week") > 0 && <span className="pill warn">{count("week")} this week</span>}
        {onClose && (
          <button type="button" className="ib" aria-label="Close attention" onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {items.length > 0 && (
        <div className="att-tabs" role="tablist" aria-label="Filter">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="attention-list">
        {reminders === null && <div className="meta">Loading…</div>}
        {reminders?.length === 0 && (
          <div className="card empty-card">
            <b>Nothing due in the next 30 days</b>
            <span className="meta">Worked out from your staff register and business profile.</span>
          </div>
        )}
        {reminders !== null && reminders.length > 0 && shown.length === 0 && <div className="meta">Nothing here.</div>}
        {shown.map((x, i) => (
          <article key={i} className="rem">
            <div className={`rem-s ${x.when === "overdue" ? "over" : x.when}`}>{status(x)}</div>
            <b className="rem-t">{fmtDatesIn(x.r.title)}</b>
            <p className="rem-d">{fmtDatesIn(x.r.detail, { short: true })}</p>
            {x.r.source && (
              <a className="rem-src" href={x.r.source.url} target="_blank" rel="noreferrer noopener">
                <Icon name="shield" size={13} stroke={2} />
                {x.r.source.title}
              </a>
            )}
            <div className="rem-a">
              <button type="button" onClick={() => onAsk(x.r)}>
                Ask about this
              </button>
              {x.r.employeeId !== null && (
                <button type="button" onClick={() => onOpenEmployee(x.r.employeeId!)}>
                  Open employee
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <p className="attention-foot">Worked out from your register and business profile each time you open MeritAI.{rulesChecked ? ` Rules checked ${fmtDay(rulesChecked, { year: true })}.` : ""}</p>
    </aside>
  );
}
