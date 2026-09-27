import type * as React from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AttachOutcome } from "../../../src/app/app";
import type { SessionFrom, SessionRecord } from "../../../src/memory/store";
import { fromText } from "../ask";
import type { ShellState } from "../../../src/server/protocol";
import type { Api } from "../api";
import { flaggedLinks, isOfficial, sources, UNREPORTED, type Block, type Turn } from "../conversation";
import { dayLabel, fmtDatesIn, fmtTime } from "../format";
import { Icon } from "./Icon";
import { MicButton, VoiceBanner, VoiceBar, type VoiceLevels, type VoiceNote, type VoiceUi } from "./Voice";
import { ReplyFeedback } from "./Feedback";
import { ChangeCards } from "./Changes";
import { EmailCard } from "./Email";

/** Voice in the browser, as the Conversations page shows it. */
export interface VoiceProps {
  ui: VoiceUi | null;
  levels: { current: VoiceLevels };
  note: VoiceNote | null;
  keySet: boolean;
  /** The demo engine: the stand-in voice, free. */
  demo: boolean;
  onStart: () => void;
  onMute: () => void;
  onEnd: () => void;
  onMic: (id: string) => void;
  onSettings: () => void;
  onCloseNote: () => void;
}

const KIND_LABEL: Record<string, string> = {
  profile: "business profile",
  register: "employee register",
  memory: "memory",
  "folder-import": "import",
  criteria: "screening criteria",
  setup: "setup",
};

export function ConversationPage(props: {
  api: Api;
  state: ShellState | null;
  turns: Turn[];
  title: string | null;
  onSend: (text: string, skill?: string, attachments?: string[]) => void;
  onStop: () => void;
  onAnswer: (id: string, yes: boolean) => void;
  onNew: () => void;
  onResume: (threadId: string) => void;
  resumedTitle: string | null;
  /** Text to put in the composer (e.g. "Ask the adviser" from the Staff page). */
  draft: string | null;
  onDraftUsed: () => void;
  /** The page this conversation was started from (a side panel button), with a link back. */
  from: SessionFrom | null;
  onGoFrom: (f: SessionFrom) => void;
  voice: VoiceProps;
  /** "Review and save" on a change declined during voice: puts it in the message box. */
  onRedo: (text: string) => void;
}) {
  const { api, state, turns } = props;
  const running = turns.some((t) => t.status === "running");
  const waiting = turns.some((t) => t.blocks.some((b) => b.kind === "confirm" && b.state === "open"));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the reply while it streams, unless the user scrolled up to read.
  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    if (s.scrollHeight - s.scrollTop - s.clientHeight < 160) bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && running) props.onStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, props]);

  const title = props.title ?? (turns[0]?.user.text.slice(0, 60) || "New conversation");
  return (
    <main
      className="main"
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
      <div className="page-h">
        <nav className="crumb" aria-label="Breadcrumb" style={{ flexGrow: 1, minWidth: 0 }}>
          <span>Conversations</span>
          <Icon name="chevron" size={16} />
          <b className="ellipsis">{turns.length || props.resumedTitle ? title : "New conversation"}</b>
          {waiting && (
            <span className="pill warn">
              <span className="dot" />
              Waiting on you
            </span>
          )}
          {props.voice.ui && (
            <span className="pill info">
              <span className="dot" />
              Voice on
            </span>
          )}
        </nav>
        {props.from && (turns.length > 0 || props.resumedTitle) && (
          <span className="meta from-link">
            From{" "}
            <button type="button" className="link-btn" onClick={() => props.onGoFrom(props.from!)}>
              {fromText(props.from)}
            </button>
          </span>
        )}
        <button type="button" className="ib" aria-label="Conversation history" title="Conversation history" onClick={() => setHistoryOpen(true)}>
          <Icon name="history" />
        </button>
        <button type="button" className="btn sm" onClick={props.onNew} disabled={running}>
          <Icon name="plus" size={16} />
          New
        </button>
      </div>

      <div className="thread" ref={scroller}>
        <div className="thread-in">
          {turns.length === 0 && <Welcome resumed={props.resumedTitle} onPick={(t) => props.onSend(t)} demo={state?.engine === "fake"} />}
          {turns.map((t, i) => (
            <TurnView key={t.id} turn={t} showDay={i === 0 || dayLabel(turns[i - 1].at) !== dayLabel(t.at)} onAnswer={props.onAnswer} api={api} domains={state?.officialDomains ?? []} onRedo={props.voice.ui ? undefined : props.onRedo} />
          ))}
          <div ref={bottom} />
        </div>
      </div>

      <div className="composer-wrap">
        {props.voice.note && !props.voice.ui && <VoiceBanner note={props.voice.note} onAgain={props.voice.onStart} onSettings={props.voice.onSettings} onClose={props.voice.onCloseNote} />}
        {props.voice.ui ? (
          <VoiceBar v={props.voice.ui} levels={props.voice.levels} demo={props.voice.demo} onMute={props.voice.onMute} onEnd={props.voice.onEnd} onMic={props.voice.onMic} />
        ) : (
          <Composer
            ref={composer}
            api={api}
            running={running}
            waiting={waiting}
            onSend={props.onSend}
            onStop={props.onStop}
            disabled={!state?.account.loggedIn}
            draft={props.draft}
            onDraftUsed={props.onDraftUsed}
            pending={state?.attachments ?? []}
            mic={<MicButton keySet={props.voice.keySet} demo={props.voice.demo} disabled={running || !state?.account.loggedIn} onStart={props.voice.onStart} onSettings={props.voice.onSettings} />}
          />
        )}
        <div className="foot">Replies can be wrong. Only a receipt means something was saved.</div>
      </div>

      {dragging && (
        <div className="drop dots">
          <div className="drop-card">
            <Icon name="attach" size={28} />
            <b>Drop files to add them to your Inbox</b>
            <span className="meta">They go with your next message. PDF, Word, text and images.</span>
          </div>
        </div>
      )}
      {historyOpen && <HistoryDrawer api={api} onClose={() => setHistoryOpen(false)} onResume={(id) => (setHistoryOpen(false), props.onResume(id))} />}
    </main>
  );
}

function Welcome({ resumed, onPick, demo }: { resumed: string | null; onPick: (t: string) => void; demo: boolean }) {
  if (resumed)
    return (
      <div className="welcome">
        <h1 className="h1">Continuing “{resumed}”</h1>
        <p className="sub">The adviser remembers this conversation. Carry on where you left off.</p>
      </div>
    );
  const picks = demo
    ? ["Priya is resigning, her last day is Friday 9 Oct", "What do I need to do this week?", "When is final pay due?", "Can you calculate a Saturday shift?"]
    : ["Someone is resigning. What do I need to do?", "What do I need to do this week?", "I'm hiring a casual. What paperwork do I need?", "How do I handle a difficult conversation?"];
  return (
    <div className="welcome">
      <h1 className="h1">What's happening at work?</h1>
      <p className="sub">Tell me in your own words. I'll tell you what to do, and help get the paperwork done.</p>
      <div className="picks">
        {picks.map((p) => (
          <button key={p} type="button" className="pick" onClick={() => onPick(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TurnView({ turn, showDay, onAnswer, api, domains, onRedo, compact }: { turn: Turn; showDay: boolean; onAnswer: (id: string, yes: boolean) => void; api: Api; domains: string[]; onRedo?: (text: string) => void; compact?: boolean }) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const src = sources(turn, domains);
  const flagged = flaggedLinks(turn);
  const all = turn.steps.flatMap((s) => s.files ?? []);
  // Email drafts get their own card (design: EmailDraft); other saved files are chips.
  const emails = all.filter((f) => f.toLowerCase().endsWith(".eml"));
  const files = all.filter((f) => !f.toLowerCase().endsWith(".eml"));
  return (
    <>
      {showDay && (
        <div className="day">
          <span />
          {dayLabel(turn.at)}
          <span />
        </div>
      )}
      {(turn.user.text || turn.user.attachments.length > 0) && (
      <div className="you">
        <span className="meta" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {turn.voice && <Icon name="mic" size={14} />}
          {turn.voice ? "You said" : "You"} · {turn.userOnly ? "added to the current task" : fmtTime(turn.at)}
        </span>
        {turn.user.attachments.map((a) => (
          <span key={a} className="chip">
            <Icon name="file" size={15} />
            <b style={{ color: "#1B1F27", fontWeight: 600 }}>{a}</b> in Inbox
          </span>
        ))}
        {turn.user.text && <div className="bubble">{turn.user.text}</div>}
      </div>
      )}
      {!turn.userOnly && (
      <div className="adviser">
        <span className="av" aria-hidden="true">
          M
        </span>
        <div className="adviser-body">
          <div className="meta">
            <b style={{ color: "#1B1F27" }}>MeritAI</b> · {fmtTime(turn.at)}
            {turn.skill && <> · {turn.skill.replace(/-/g, " ")} guide</>}
          </div>
          {turn.steps.length > 0 && (
            <div className="tools">
              <button type="button" className="row" onClick={() => setStepsOpen(!stepsOpen)} aria-expanded={stepsOpen}>
                {turn.status === "running" ? <span className="spin" /> : <Icon name="check" size={16} />}
                <b style={{ color: "#1B1F27" }}>
                  {turn.steps.length} step{turn.steps.length > 1 ? "s" : ""} in this answer
                </b>
                <span className="grow" />
                <Icon name="chevron" size={16} className={stepsOpen ? "rot" : ""} />
              </button>
              {stepsOpen &&
                turn.steps.map((s, i) => (
                  <div key={i} className="step">
                    <Icon name="check" size={14} />
                    {fmtDatesIn(s.summary)}
                  </div>
                ))}
            </div>
          )}
          {turn.blocks.map((b, i) => (
            <BlockView key={i} block={b} onAnswer={onAnswer} onRedo={onRedo} running={turn.status === "running"} last={i === turn.blocks.length - 1} linkState={(u) => (flagged.has(u) ? "unverified" : isOfficial(u, domains) ? "ok" : "other")} />
          ))}
          {turn.status === "running" && turn.blocks.length === 0 && (
            <div className="thinking">
              <span className="spin" /> Working on it…
            </div>
          )}
          {turn.status === "interrupted" && <span className="pill n">Stopped</span>}
          {files.length > 0 && (
            <div className="row-wrap">
              {files.map((f) => (
                <span key={f} className="chip">
                  <Icon name="file" size={15} />
                  {f.split(/[\\/]/).pop()}
                  <button type="button" className="link-btn" onClick={() => void api.call("openFile", { path: f })}>
                    Open
                  </button>
                  <button type="button" className="link-btn" onClick={() => void api.call("revealFile", { path: f })}>
                    Show in folder
                  </button>
                </span>
              ))}
            </div>
          )}
          {emails.map((f) => (
            <EmailCard key={f} path={f} api={api} />
          ))}
          {turn.changes?.length ? <ChangeCards items={turn.changes} api={api} compact={compact} /> : null}
          {turn.status === "completed" && turn.blocks.some((b) => b.kind === "text") && <ReplyFeedback turn={turn} api={api} />}
          {src.length > 0 && turn.status !== "running" && (
            <div className="row-wrap">
              {src.map((s) => (
                <a key={s.url} className="chip" href={s.url} target="_blank" rel="noreferrer noopener" title={s.url}>
                  <Icon name="shield" size={14} />
                  {s.title}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </>
  );
}

function BlockView({ block: b, onAnswer, onRedo, running, last, linkState }: { block: Block; onAnswer: (id: string, yes: boolean) => void; onRedo?: (text: string) => void; running: boolean; last: boolean; linkState: (url: string) => LinkState }) {
  switch (b.kind) {
    case "skipped":
      return (
        <section className="confirm skipped" aria-label="Not saved during voice">
          <div className="grow" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="cap" style={{ color: "#6B4E00" }}>
              Not saved during voice · needs your OK
            </div>
            <div className="q" style={{ fontSize: 15 }}>
              {fmtDatesIn(b.req.title)}
            </div>
            {b.req.items?.length ? <div className="meta">{b.req.items.map((x) => fmtDatesIn(x)).join(" · ")}</div> : null}
          </div>
          <button type="button" className="btn" disabled={!onRedo} title={onRedo ? undefined : "After voice ends"} onClick={() => onRedo?.(`Please make this change now: ${b.req.title}${b.req.items?.length ? ` (${b.req.items.join("; ")})` : ""}`)}>
            Review and save
          </button>
        </section>
      );
    case "text":
      return (
        <div className="md">
          <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ href, children }) => <SafeLink href={href ?? ""} state={linkState(href ?? "")}>{children}</SafeLink>, img: ({ alt }) => <span className="meta">[image{alt ? `: ${alt}` : ""}]</span> }}>
            {fmtDatesIn(b.text)}
          </Markdown>
          {!b.done && running && last && <span className="caret" />}
        </div>
      );
    case "confirm": {
      const destructive = b.req.destructive === true;
      return (
        <section className={`confirm${b.state === "open" ? " open" : ""}${destructive ? " destructive" : ""}`} aria-label="Needs your OK">
          <div className="cap" style={{ color: destructive ? "#B3261E" : "#6B4E00" }}>
            Needs your OK · {KIND_LABEL[b.req.kind] ?? b.req.kind}
          </div>
          <div className="q">{fmtDatesIn(b.req.title)}</div>
          {b.req.items?.length ? (
            <ul className="items">
              {b.req.items.map((it, i) => (
                <li key={i}>{fmtDatesIn(it)}</li>
              ))}
            </ul>
          ) : null}
          {b.state === "open" && (
            <div className="row-wrap" style={{ alignItems: "center" }}>
              <button type="button" className={`btn lg ${destructive ? "d" : "p"}`} onClick={() => onAnswer(b.id, true)}>
                {destructive ? "Yes, delete" : "Yes, save"}
              </button>
              <button type="button" className="btn lg" onClick={() => onAnswer(b.id, false)}>
                No
              </button>
              <span className="meta">Nothing changes until you say yes.</span>
            </div>
          )}
          {b.state === "yes" && (
            <div className={`receipt${b.receipt === UNREPORTED || !b.receipt ? " off" : ""}`}>
              <Icon name="check" size={18} stroke={2.2} />
              <span>
                <b>{b.receipt === UNREPORTED ? "You said yes" : b.receipt ? `Saved to the ${KIND_LABEL[b.req.kind] ?? b.req.kind}` : "Saving…"}</b>
                {b.receipt === UNREPORTED ? ". No save was reported: check the reply, or the page it belongs to." : b.receipt ? ` · ${receiptDetail(b.receipt)}` : ""}
              </span>
            </div>
          )}
          {b.state === "no" && <div className="receipt off">Not saved. Nothing changed.</div>}
          {b.state === "withdrawn" && <div className="receipt off">Not saved: the reply was stopped before you answered.</div>}
        </section>
      );
    }
    case "warning":
      return (
        <div className="banner warn" role="note">
          <Icon name="alert" size={18} />
          <span>{b.message}</span>
        </div>
      );
    case "unverified":
      return (
        <div className="banner warn" role="note">
          <Icon name="alert" size={18} />
          <span>
            <b>Check these links before relying on them.</b> No official source in this conversation returned them: {b.urls.join(", ")}
          </span>
        </div>
      );
    case "limit":
      return (
        <div className="banner warn" role="alert">
          <Icon name="alert" size={18} />
          <span>
            <b>Usage limit reached{b.resetAt ? ` until ${b.resetAt}` : ""}.</b> Your ChatGPT plan&apos;s usage for MeritAI has run out, so the adviser can&apos;t answer until then. Still working without the adviser: the staff register and its forms, reminders, files, the business profile and memory.
          </span>
        </div>
      );
    case "error":
      return (
        <div className="banner bad" role="alert">
          <Icon name="alert" size={18} />
          <span>
            <b>The adviser stopped responding.</b> {b.message}
          </span>
        </div>
      );
  }
}

/** A link in a reply: clickable only for official sources not flagged; otherwise the text and the real site, not clickable. */
type LinkState = "ok" | "unverified" | "other";

function SafeLink({ href, state, children }: { href: string; state: LinkState; children: React.ReactNode }) {
  if (state === "ok")
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" title={href}>
        {children}
      </a>
    );
  let host = href;
  try {
    host = new URL(href).host;
  } catch {
    /* not a URL: show as given */
  }
  return (
    <span className="unlinked" title={href}>
      {children} <span className="meta">({host}: {state === "unverified" ? "not checked, no source returned this page" : "not an official source"})</span>
    </span>
  );
}

/** "register: updated [3] Priya Nair" → "Priya Nair updated". */
function receiptDetail(summary: string): string {
  const s = summary.replace(/^[a-z ]+:\s*/i, "").replace(/\[\d+\]\s*/, "");
  const m = /^(updated|added|removed|recorded|saved)\s+(.*)$/i.exec(s);
  return fmtDatesIn(m ? `${m[2]} ${m[1].toLowerCase()}` : s);
}

export interface ComposerHandle {
  addFiles(files: File[]): Promise<void>;
}


export const Composer = forwardRef<ComposerHandle, { api: Api; running: boolean; waiting: boolean; disabled: boolean; onSend: (text: string, skill?: string, attachments?: string[]) => void; onStop: () => void; draft: string | null; onDraftUsed: () => void; pending: string[]; id?: string; placeholder?: string; mic?: React.ReactNode }>(
  function Composer({ api, running, waiting, disabled, onSend, onStop, draft, onDraftUsed, pending, id = "msg", placeholder, mic }, ref) {
    const [text, setText] = useState("");
    const [attached, setAttached] = useState<{ name: string; note: string; ok: boolean }[]>([]);
    const [uploading, setUploading] = useState(false);
    const [skill, setSkill] = useState<string | null>(null);
    const [skills, setSkills] = useState<{ name: string; description: string }[] | null>(null);
    const [guidesOpen, setGuidesOpen] = useState(false);
    const [warnPending, setWarnPending] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const area = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
      if (!draft) return;
      setText(draft);
      onDraftUsed();
      setTimeout(() => {
        area.current?.focus();
        area.current?.setSelectionRange(draft.length, draft.length);
      }, 0);
    }, [draft, onDraftUsed]);

    // Files attached on the server (e.g. uploaded from the Files page) show too; removing one takes it off the next message.
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const pendingKey = pending.join(" ");
    useEffect(() => setHidden(new Set()), [pendingKey]);
    const chips = [...attached, ...pending.filter((n) => !hidden.has(n) && !attached.some((a) => a.name === n)).map((name) => ({ name, note: "in Inbox", ok: true }))];
    const remove = async (a: { name: string; ok: boolean }) => {
      setAttached((xs) => xs.filter((x) => x !== a && x.name !== a.name));
      setHidden((h) => new Set([...h, a.name]));
      if (a.ok) await api.call("detach", { name: a.name }).catch(() => null);
    };
    const addFiles = async (files: File[]) => {
      if (!files.length) return;
      setUploading(true);
      try {
        const payload = await Promise.all(
          files.map(async (f) => ({ name: f.name, base64: await toBase64(f), ...((f as File & { webkitRelativePath?: string }).webkitRelativePath ? { relPath: (f as File & { webkitRelativePath: string }).webkitRelativePath } : {}) })),
        );
        const out = await api.call("attach", { files: payload });
        setAttached((a) => [...a, ...out.map(describe)]);
      } catch (e) {
        setAttached((a) => [...a, { name: files.map((f) => f.name).join(", "), note: (e as Error).message, ok: false }]);
      } finally {
        setUploading(false);
      }
    };
    useImperativeHandle(ref, () => ({ addFiles }));

    useEffect(() => {
      const a = area.current;
      if (!a) return;
      a.style.height = "auto";
      a.style.height = `${Math.min(200, a.scrollHeight)}px`;
    }, [text]);

    const submit = () => {
      const t = text.trim();
      if (!t || running || disabled) return;
      if (waiting && !warnPending) {
        setWarnPending(true);
        return;
      }
      onSend(t, skill ?? undefined, [...new Set([...attached.filter((x) => x.ok).map((x) => x.name), ...pending])]);
      setText("");
      setHidden(new Set(pending));
      setAttached([]);
      setSkill(null);
      setWarnPending(false);
    };

    return (
      <div className="composer">
        {warnPending && (
          <div className="banner warn" style={{ alignItems: "center" }}>
            <span className="grow">A change is waiting for your OK above. If you send now, it won't be saved.</span>
            <button type="button" className="btn sm" onClick={() => setWarnPending(false)}>
              Answer it first
            </button>
            <button type="button" className="btn sm p" onClick={submit}>
              Skip and send
            </button>
          </div>
        )}
        {(chips.length > 0 || uploading || skill) && (
          <div className="row-wrap">
            {skill && (
              <span className="chip" style={{ background: "#EEF3FC", color: "#1446A6" }}>
                <Icon name="book" size={15} />
                {skill.replace(/-/g, " ")} guide
                <button type="button" className="x" aria-label="Remove guide" onClick={() => setSkill(null)}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            )}
            {chips.map((a, i) => (
              <span key={i} className="chip" style={a.ok ? undefined : { background: "#FCE8E6", color: "#7A1C15", borderColor: "#F1B8B2" }}>
                <Icon name="file" size={15} />
                <b style={{ fontWeight: 600 }}>{a.name}</b> {a.note}
                <button type="button" className="x" aria-label="Remove attachment" onClick={() => void remove(a)}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}
            {uploading && (
              <span className="chip">
                <span className="spin" /> Adding to Inbox…
              </span>
            )}
          </div>
        )}
        <label htmlFor={id} className="sr">
          Message
        </label>
        <textarea
          id={id}
          ref={area}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={disabled ? "Sign in first (Settings, or `npm run login`)" : running ? "Answering… press Stop to change your question" : (placeholder ?? "Tell me what happened, or ask what to do next")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-row">
          <input ref={input} type="file" multiple hidden onChange={(e) => (void addFiles([...(e.target.files ?? [])]), (e.target.value = ""))} />
          <button type="button" className="ib" aria-label="Attach files" title="Attach files" onClick={() => input.current?.click()}>
            <Icon name="attach" />
          </button>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="btn sm"
              style={{ borderRadius: 999 }}
              aria-haspopup="menu"
              aria-expanded={guidesOpen}
              onClick={async () => {
                setGuidesOpen(!guidesOpen);
                if (!skills) setSkills(await api.call("skills").catch(() => []));
              }}
            >
              <Icon name="book" size={16} />
              Guides
            </button>
            {guidesOpen && (
              <div className="menu" role="menu">
                {(skills ?? []).filter((s) => s.name !== "business-setup").map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setSkill(s.name);
                      setGuidesOpen(false);
                      area.current?.focus();
                    }}
                  >
                    <b>{s.name.replace(/-/g, " ")}</b>
                    <span className="meta ellipsis2">{s.description}</span>
                  </button>
                ))}
                {skills === null && <div className="meta" style={{ padding: 10 }}>Loading…</div>}
              </div>
            )}
          </div>
          <span className="grow" />
          {mic}
          {running ? (
            <button type="button" className="btn sm" onClick={onStop} title="Stop (Esc)">
              <Icon name="stop" size={14} stroke={2.4} />
              Stop
            </button>
          ) : (
            <button type="button" className="send" aria-label="Send" onClick={submit} disabled={!text.trim() || disabled}>
              <Icon name="send" size={18} stroke={2.2} />
            </button>
          )}
        </div>
      </div>
    );
  },
);

function describe(o: AttachOutcome): { name: string; note: string; ok: boolean } {
  switch (o.kind) {
    case "attached":
      return { name: o.name, note: o.reused ? "already in Inbox" : "in Inbox", ok: true };
    case "imported":
      return { name: o.job, note: "imported as a job", ok: true };
    case "not-imported":
      return { name: o.path, note: "not imported", ok: false };
    case "refused":
      return { name: o.path, note: o.reason, ok: false };
    case "error":
      return { name: o.path, note: o.message, ok: false };
  }
}

function toBase64(f: File): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => fail(new Error(`Couldn't read ${f.name}`));
    r.readAsDataURL(f);
  });
}

function HistoryDrawer({ api, onClose, onResume }: { api: Api; onClose: () => void; onResume: (threadId: string) => void }) {
  const [items, setItems] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.call("history").then(setItems, (e: Error) => setError(e.message));
  }, [api]);
  return (
    <>
      <div className="scrim fill" onClick={onClose} />
      <aside className="drawer side" aria-label="Conversation history">
        <div className="drawer-h">
          <h2 className="h2" style={{ flexGrow: 1 }}>
            Conversations
          </h2>
          <button type="button" className="ib" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-b">
          {error && <div className="banner bad">{error}</div>}
          {items === null && !error && <div className="meta">Loading…</div>}
          {items?.length === 0 && <div className="meta">No earlier conversations yet. Conversations are kept for 30 days.</div>}
          {items?.map((r) => (
            <button key={r.threadId} type="button" className="hist" onClick={() => onResume(r.threadId)}>
              <b className="ellipsis">{r.title}</b>
              <span className="meta">
                {r.from ? `From ${fromText(r.from)} · ` : ""}
                {dayLabel(new Date(r.startedAt))}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}
