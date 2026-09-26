import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Reminder } from "../../src/business/reminders";
import type { SessionRecord } from "../../src/memory/store";
import type { ShellState } from "../../src/server/protocol";
import type { ConfirmRequest } from "../../src/engine/types";
import { fmtDatesIn } from "./format";
import { Api, type Connection } from "./api";
import { addConfirm, applyEvent, setConfirm, turnsFromTranscript, type Turn } from "./conversation";
import { ConversationPage } from "./components/Conversation";
import { Icon } from "./components/Icon";
import { AppBar, AttentionPanel, Nav, type Page } from "./components/Shell";
import { StaffPage } from "./components/Staff";
import { FilesPage, MemoryPage, ProfilePage, SettingsPage } from "./components/Pages";
import { HiringPage } from "./components/Hiring";

export function App() {
  const api = useMemo(() => Api.fromLocation(), []);
  if (!api) return <NoToken />;
  return <Shell api={api} />;
}

function NoToken() {
  return (
    <div className="center-page dots">
      <div className="card" style={{ padding: 32, maxWidth: 520, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="logo lg">M</div>
        <h1 className="h1">Open MeritAI from its link</h1>
        <p className="sub">For your privacy, MeritAI only answers the link it printed when it started (it contains a one-time key). Run <span className="mono">npm run ui</span> and use the link it opens.</p>
      </div>
    </div>
  );
}

const WIDE = 1280;

function Shell({ api }: { api: Api }) {
  const [connection, setConnection] = useState<Connection>(api.connection);
  const [state, setState] = useState<ShellState | null>(null);
  const [page, setPage] = useState<Page>("conversations");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [recent, setRecent] = useState<SessionRecord[]>([]);
  const [resumedTitle, setResumedTitle] = useState<string | null>(null);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [wide, setWide] = useState(window.innerWidth >= WIDE);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const restored = useRef(false);
  const pageRef = useRef<Page>("conversations");
  pageRef.current = page;
  const [dialog, setDialog] = useState<{ id: string; req: ConfirmRequest } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [lastProgress, setLastProgress] = useState<string | null>(null);
  const [login, setLogin] = useState<{ url: string | null; code: string | null; message: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.call("state");
      setState(s);
      // After a page reload the conversation is still open on the server: show its messages again.
      if (!restored.current) {
        restored.current = true;
        if (s.hasConversation && !turnsRef.current.length) {
          const entries = await api.call("transcript").catch(() => []);
          if (entries.length && !turnsRef.current.length) setTurns(turnsFromTranscript(entries, new Date()));
        }
      }
      // Questions still open on the server (e.g. after a reload) are shown again.
      if (s.confirms.length)
        setTurns((ts) => {
          if (!ts.length) return ts;
          let last = ts[ts.length - 1];
          for (const c of s.confirms) if (!ts.some((t) => t.blocks.some((b) => b.kind === "confirm" && b.id === c.id))) last = addConfirm(last, c.id, c.req);
          return [...ts.slice(0, -1), last];
        });
      api.call("reminders").then(setReminders, () => null);
      api.call("history").then(setRecent, () => null);
    } catch {
      /* not connected: the connection listener retries */
    }
  }, [api]);

  useEffect(() => api.onConnection((c) => (setConnection(c), c === "open" && void refresh())), [api, refresh]);
  useEffect(() => {
    if (api.connection === "open") void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [api, refresh]);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= WIDE);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(
    () =>
      api.onEvent((m) => {
        switch (m.event) {
          case "turn":
            setTurns((ts) => ts.map((t) => (t.id === m.turnId ? applyEvent(t, m.ev) : t)));
            break;
          case "turnDone":
            setTurns((ts) => ts.map((t) => (t.id === m.turnId && t.status === "running" ? applyEvent(t, { type: "turn_end", status: m.error ? "failed" : "completed", ...(m.error ? { error: m.error } : {}) }) : t)));
            void refresh();
            break;
          case "confirm": {
            // During a reply the question is a card in it; otherwise (e.g. deleting from the Staff page) a dialog.
            const i = turnsRef.current.map((t) => t.status).lastIndexOf("running");
            if (i >= 0) setTurns((ts) => ts.map((t, j) => (j === i ? addConfirm(t, m.id, m.req) : t)));
            else setDialog({ id: m.id, req: m.req });
            setState((s) => (s ? { ...s, confirms: [...s.confirms.filter((c) => c.id !== m.id), { id: m.id, req: m.req }] } : s));
            break;
          }
          case "confirmWithdrawn":
            setDialog((d) => (d?.id === m.id ? null : d));
            setTurns((ts) => ts.map((t) => setConfirm(t, m.id, "withdrawn")));
            setState((s) => (s ? { ...s, confirms: s.confirms.filter((c) => c.id !== m.id) } : s));
            break;
          case "progress":
            setLastProgress(m.message);
            if (pageRef.current !== "hiring") setToast(m.message);
            break;
          case "login":
            setLogin({ url: m.url, code: m.code, message: m.message });
            break;
        }
      }),
    [api, refresh],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const send = async (text: string, skill?: string, attachments: string[] = [], mode?: "setup") => {
    const turnId = crypto.randomUUID();
    setPage("conversations");
    setTurns((ts) => [...ts, { id: turnId, at: new Date(), user: { text, attachments }, ...(skill ? { skill } : {}), steps: [], blocks: [], status: "running" }]);
    try {
      await api.call("send", { text, turnId, ...(skill ? { skill } : {}), ...(mode ? { mode } : {}) });
      setState((s) => (s ? { ...s, busy: true } : s));
    } catch (e) {
      setTurns((ts) => ts.map((t) => (t.id === turnId ? applyEvent(t, { type: "turn_end", status: "failed", error: (e as Error).message }) : t)));
    }
  };

  const answer = async (id: string, yes: boolean) => {
    setTurns((ts) => ts.map((t) => setConfirm(t, id, yes ? "yes" : "no")));
    try {
      const r = await api.call("answerConfirm", { id, yes });
      if (!r.ok) setError("That question had already closed, so nothing was saved.");
    } catch (e) {
      setError((e as Error).message);
    }
    setState((s) => (s ? { ...s, confirms: s.confirms.filter((c) => c.id !== id) } : s));
  };

  const newConversation = async () => {
    try {
      await api.call("newConversation");
      setTurns([]);
      setResumedTitle(null);
      setPage("conversations");
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const resume = async (threadId: string) => {
    try {
      const r = await api.call("resume", { threadId });
      setPage("conversations");
      if (!r.alreadyOpen) {
        const rec = recent.find((x) => x.threadId === threadId);
        setResumedTitle(rec?.title ?? "an earlier conversation");
        const entries = await api.call("transcript").catch(() => []);
        setTurns(turnsFromTranscript(entries, rec ? new Date(rec.startedAt) : new Date()));
      }
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const currentThread = recent.find((r) => r.title === state?.title)?.threadId ?? null;
  const showPanel = page === "conversations" && wide;

  return (
    <div className="m app">
      <AppBar state={state} connection={connection} showAttention={!showPanel} onAttention={() => setAttentionOpen(true)} />
      {connection !== "open" && (
        <div className="banner bad conn" role="alert">
          <Icon name="alert" size={18} />
          <span>
            <b>{connection === "connecting" ? "Connecting to MeritAI…" : "MeritAI isn't reachable."}</b> {connection === "closed" && "It may have been closed. Start it again with npm run ui; this page reconnects by itself."}
          </span>
        </div>
      )}
      <div className="body">
        <Nav page={page} onPage={setPage} onNew={() => void newConversation()} recent={recent} onRecent={(id) => void resume(id)} currentThread={currentThread} state={state} />
        {page === "conversations" && (
          <ConversationPage
            api={api}
            state={state}
            turns={turns}
            title={state?.title ?? null}
            onSend={(t, s, a) => void send(t, s, a)}
            onStop={() => void api.call("stop").catch(() => null)}
            onAnswer={(id, yes) => void answer(id, yes)}
            onNew={() => void newConversation()}
            onResume={(id) => void resume(id)}
            resumedTitle={resumedTitle}
            draft={draft}
            onDraftUsed={() => setDraft(null)}
          />
        )}
        {page === "staff" && <StaffPage api={api} onAsk={(t) => (setDraft(t), setPage("conversations"))} onChanged={() => void refresh()} />}
        {page === "files" && <FilesPage api={api} onAsk={(t) => (setDraft(t), setPage("conversations"))} />}
        {page === "profile" && <ProfilePage api={api} onAsk={() => void send("Set up my business profile", undefined, [], "setup")} onChanged={() => void refresh()} />}
        {page === "memory" && <MemoryPage api={api} />}
        {page === "settings" && <SettingsPage api={api} login={login} onChanged={() => void refresh()} />}
        {page === "hiring" && <HiringPage api={api} progress={lastProgress} onAsk={(t) => (setDraft(t), setPage("conversations"))} />}
        {showPanel && <AttentionPanel reminders={reminders} onAsk={(t) => void send(t)} />}
      </div>
      {attentionOpen && !showPanel && (
        <>
          <div className="scrim fill" onClick={() => setAttentionOpen(false)} />
          <div className="attention-drawer">
            <AttentionPanel reminders={reminders} onClose={() => setAttentionOpen(false)} onAsk={(t) => (setAttentionOpen(false), void send(t))} />
          </div>
        </>
      )}
      {dialog && (
        <>
          <div className="scrim fill" />
          <div className="modal dialog" role="alertdialog" aria-modal="true" aria-label={dialog.req.title}>
            <h2 className="h2" style={{ fontSize: 19 }}>
              {fmtDatesIn(dialog.req.title)}
            </h2>
            {dialog.req.items?.length ? (
              <ul className="items-plain">
                {dialog.req.items.map((it, i) => (
                  <li key={i}>{fmtDatesIn(it)}</li>
                ))}
              </ul>
            ) : null}
            <div className="row-wrap">
              <button type="button" className={`btn lg ${dialog.req.destructive ? "d" : "p"}`} onClick={() => (void answer(dialog.id, true), setDialog(null))}>
                {dialog.req.destructive ? "Yes, delete" : "Yes"}
              </button>
              <button type="button" className="btn lg" autoFocus onClick={() => (void answer(dialog.id, false), setDialog(null))}>
                {dialog.req.destructive ? "Keep" : "No"}
              </button>
            </div>
          </div>
        </>
      )}
      {(toast || error) && (
        <div className={`toast${error ? " bad" : ""}`} role="status">
          <span className="grow">{error ?? toast}</span>
          {error && (
            <button type="button" className="ib" aria-label="Dismiss" onClick={() => setError(null)}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
