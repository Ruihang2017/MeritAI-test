import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Reminder } from "../../src/business/reminders";
import type { SessionFrom, SessionRecord } from "../../src/memory/store";
import type { ShellState } from "../../src/server/protocol";
import type { ConfirmRequest } from "../../src/engine/types";
import { fmtDatesIn } from "./format";
import { Api, type Connection } from "./api";
import { addChange, addConfirm, applyEvent, setConfirm, turnsFromTranscript, withExtras, type Turn } from "./conversation";
import { LiveContext, pageOf, RECENT_MS, type Live, type OpenTarget, type Seen } from "./live";
import { refKey } from "../../src/changes";
import { ArrivalNote } from "./components/Changes";
import { VoiceStage } from "./components/Stage";
import { ConnectionsPage } from "./components/Connections";
import { applyLanguage } from "./i18n";
import { ConversationPage } from "./components/Conversation";
import { Icon } from "./components/Icon";
import { AppBar, AttentionPanel, Nav, type AskButton, type Page } from "./components/Shell";
import { Dock, type DockNotice } from "./components/Dock";
import { FROM_PROFILE, fromReminder, type Ask } from "./ask";
import { FeedbackDialog } from "./components/Feedback";
import { BrowserVoice, savedMicrophone } from "./voice";
import type { VoiceLevels, VoiceNote, VoiceUi } from "./components/Voice";
import { StaffPage } from "./components/Staff";
import { FilesPage, MemoryPage, ProfilePage, SettingsPage } from "./components/Pages";
import { HiringPage } from "./components/Hiring";
import { FirstRun } from "./components/FirstRun";
import { AllConversations } from "./components/AllConversations";
import { now, setAppToday } from "./clock";

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
  /** An employee to open on the Staff page (Attention's "Open employee"). */
  const [staffOpen, setStaffOpen] = useState<{ id: number; docs: boolean; n: number } | null>(null);
  const openEmployee = (id: number, docs = false) => (setStaffAdd(null), setStaffOpen((o) => ({ id, docs, n: (o?.n ?? 0) + 1 })), setPage("staff"));
  /** Someone hired from Hiring: the Staff page's add form, with their name and role filled in; saving records the hire. */
  const [staffAdd, setStaffAdd] = useState<{ name: string; role: string; hireFrom?: { job: string; file: string } } | null>(null);
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
  const [firstRunDone, setFirstRunDone] = useState(() => {
    try {
      return sessionStorage.getItem("meritai.firstRun") === "done";
    } catch {
      return false;
    }
  });
  const finishFirstRun = () => {
    setFirstRunDone(true);
    try {
      sessionStorage.setItem("meritai.firstRun", "done");
    } catch {
      /* the flag only lasts for this tab anyway */
    }
  };
  const [login, setLogin] = useState<{ url: string | null; code: string | null; message: string } | null>(null);

  // ---- the side panel (design: Dock*): the current conversation next to any page except Conversations
  const [dockOpen, setDockOpen] = useState(() => {
    try {
      return localStorage.getItem("meritai.dock") === "open";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("meritai.dock", dockOpen ? "open" : "closed");
    } catch {
      /* only a convenience */
    }
  }, [dockOpen]);
  /** Page requests waiting for the running answer to finish ("Next"). */
  const [queue, setQueue] = useState<Ask[]>([]);
  /** The topic of a request put in the box for the owner to finish: applied when it is sent. */
  const [pendingFrom, setPendingFrom] = useState<SessionFrom | null>(null);
  /** The page the current conversation was started from (a new topic starts a new conversation). */
  const [convFrom, setConvFrom] = useState<SessionFrom | null>(null);
  const convFromRef = useRef(convFrom);
  convFromRef.current = convFrom;
  const [notice, setNotice] = useState<DockNotice | null>(null);
  /** A question waiting for the owner's OK while the panel is closed. */
  const [askPopup, setAskPopup] = useState<string | null>(null);
  /** Bumped after a reply or an answered question: open pages reload what the adviser may have changed. */
  const [refreshKey, setRefreshKey] = useState(0);
  // ---- the conversation and the pages in step (design: SyncRules)
  /** The adviser's recent changes (rows marked "New · MeritAI"). */
  const [recentChanges, setRecentChanges] = useState<Seen[]>([]);
  /** The adviser's changes to pages the owner wasn't on (a dot in the navigation until they look). */
  const [unseen, setUnseen] = useState<Seen[]>([]);
  /** What changed on this page while the owner was elsewhere (its note), until dismissed or they leave. */
  const [arrivals, setArrivals] = useState<{ page: Page; items: Seen[] } | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The shell's refresh (reminders, badges), set once it is defined below. */
  const refreshShell = useRef<() => Promise<void>>(async () => {});
  /** Pages, reminders and badges reload shortly after a change (several changes in a row: once). */
  const bumpRefresh = () => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      setRefreshKey((k) => k + 1);
      void refreshShell.current();
    }, 250);
  };
  const [hiringJob, setHiringJob] = useState<{ job: string } | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // ---- voice in the browser (design: Voice, VoiceStates): the microphone and speaker here, GPT-Live on the server
  const [voiceUi, setVoiceUi] = useState<VoiceUi | null>(null);
  const [voiceNote, setVoiceNote] = useState<VoiceNote | null>(null);
  const bv = useRef<BrowserVoice | null>(null);
  const voiceLive = useRef(false);
  const levels = useRef<VoiceLevels>({ mic: 0, out: 0, outAt: 0 });
  const newBrowserVoice = () =>
    new BrowserVoice(
      (pcm, lvl) => {
        levels.current.mic = lvl;
        if (voiceLive.current) void api.call("voiceAudio", { pcm }).catch(() => null);
      },
      (lvl) => {
        levels.current.out = lvl;
        if (lvl > 0.04) levels.current.outAt = Date.now();
      },
    );
  const stopBrowserVoice = () => {
    bv.current?.stop();
    bv.current = null;
    voiceLive.current = false;
  };
  /** The turns of this voice call start here (the On screen panel shows only them). */
  const voiceFrom = useRef(0);
  const startVoice = async () => {
    if (bv.current) return;
    voiceFrom.current = turnsRef.current.length;
    const micId = savedMicrophone();
    setVoiceNote(null);
    setPage("conversations");
    setVoiceUi({ started: false, muted: false, working: false, line: "Getting the microphone and voice ready", startedAt: Date.now(), micId });
    const b = newBrowserVoice();
    bv.current = b;
    try {
      await b.start(micId || undefined);
    } catch (e) {
      stopBrowserVoice();
      setVoiceUi(null);
      setVoiceNote({ kind: "mic", message: (e as Error).message });
      return;
    }
    try {
      await api.call("voiceStart");
      voiceLive.current = true;
      setVoiceUi((v) => (v ? { ...v, started: true, line: "Listening…", startedAt: Date.now() } : v));
      void refresh();
    } catch (e) {
      stopBrowserVoice();
      setVoiceUi(null);
      setVoiceNote({ kind: "service", message: (e as Error).message.replace(/^could not start voice: /, "") });
    }
  };
  const switchMic = async (id: string) => {
    const old = bv.current;
    if (!old) return;
    const b = newBrowserVoice();
    b.muted = old.muted;
    try {
      await b.start(id);
      old.stop();
      bv.current = b;
      setVoiceUi((v) => (v ? { ...v, micId: id } : v));
    } catch (e) {
      b.stop();
      setError(`That microphone didn't start: ${(e as Error).message.replace(/^mic: /, "")}`);
    }
  };
  const voiceProps = {
    ui: voiceUi,
    levels,
    note: voiceNote,
    keySet: state?.voice.keySet ?? false,
    demo: state?.engine === "fake",
    onStart: () => void startVoice(),
    onMute: () => {
      if (!bv.current) return;
      bv.current.muted = !bv.current.muted;
      setVoiceUi((v) => (v ? { ...v, muted: !v.muted } : v));
    },
    onEnd: () => void api.call("voiceStop").catch(() => null),
    onMic: (id: string) => void switchMic(id),
    onSettings: () => setPage("settings"),
    onCloseNote: () => setVoiceNote(null),
  };
  const dockable = page !== "conversations" && page !== "all";
  const showDock = dockable && dockOpen;
  const dockVisible = useRef(showDock);
  dockVisible.current = showDock;
  const stateRef = useRef(state);
  stateRef.current = state;
  const asking = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.call("state");
      setAppToday(s.today);
      setState(s);
      // Kept until the server has recorded a new conversation (its first message is on its way).
      setConvFrom((c) => s.from ?? (s.title ? null : c));
      // After a page reload the conversation is still open on the server: show its messages again.
      if (!restored.current) {
        restored.current = true;
        if (s.hasConversation && !turnsRef.current.length) {
          const entries = await api.call("transcript").catch(() => []);
          const extras = await api.call("turnExtras").catch(() => ({}));
          if (entries.length && !turnsRef.current.length) setTurns(withExtras(turnsFromTranscript(entries, now()), extras));
        }
      }
      // A reply still running on the server (e.g. after a reload): follow it again (its events and Stop).
      if (s.turnId && !turnsRef.current.some((t) => t.id === s.turnId)) {
        const id = s.turnId;
        setTurns((ts) => (ts.some((t) => t.id === id) ? ts : [...ts, { id, at: now(), user: { text: "", attachments: [] }, steps: [], blocks: [], status: "running" }]));
      }
      // Questions still open on the server are shown again: in their reply, or as a dialog.
      for (const c of s.confirms) {
        const inTurn = c.turnId && turnsRef.current.some((t) => t.id === c.turnId);
        if (inTurn || (c.turnId && c.turnId === s.turnId)) setTurns((ts) => ts.map((t) => (t.id === c.turnId ? addConfirm(t, c.id, c.req) : t)));
        else setDialog((d) => d ?? { id: c.id, req: c.req });
      }
      api.call("reminders").then(setReminders, () => null);
      api.call("history").then(setRecent, () => null);
    } catch {
      /* not connected: the connection listener retries */
    }
  }, [api]);

  refreshShell.current = refresh;
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
          case "turnDone": {
            setTurns((ts) => ts.map((t) => (t.id === m.turnId && t.status === "running" ? applyEvent(t, { type: "turn_end", status: m.error ? "failed" : "completed", ...(m.error ? { error: m.error } : {}) }) : t)));
            // A reply followed after a page reload missed its start: show the stored conversation instead.
            const followed = turnsRef.current.find((t) => t.id === m.turnId && !t.user.text && !t.user.attachments.length);
            if (followed)
              void Promise.all([api.call("transcript"), api.call("turnExtras").catch(() => ({}))]).then(
                ([entries, extras]) => entries.length && setTurns(withExtras(turnsFromTranscript(entries, followed.at), extras)),
                () => null,
              );
            setRefreshKey((k) => k + 1);
            setVoiceUi((v) => (v ? { ...v, working: false } : v));
            void refresh();
            break;
          }
          case "confirm": {
            // A reply's question is a card in that reply; any other (delete from Staff, screening criteria) a dialog.
            if (m.turnId && turnsRef.current.some((t) => t.id === m.turnId)) {
              setTurns((ts) => ts.map((t) => (t.id === m.turnId ? addConfirm(t, m.id, m.req) : t)));
              // Voice: the question waits on screen (the On screen panel); the voice asks for it.
              setVoiceUi((v) => (v ? { ...v, line: `Waiting for your OK: ${m.req.title}` } : v));
              // The side panel is closed on another page: a short popup under its button.
              if (!dockVisible.current && pageRef.current !== "conversations") setAskPopup(m.req.title);
            } else setDialog({ id: m.id, req: m.req });
            setState((s) => (s ? { ...s, confirms: [...s.confirms.filter((c) => c.id !== m.id), { id: m.id, req: m.req, turnId: m.turnId }] } : s));
            break;
          }
          case "confirmAnswered":
            // Answered here or in another tab.
            setDialog((d) => (d?.id === m.id ? null : d));
            setAskPopup(null);
            setRefreshKey((k) => k + 1);
            setTurns((ts) => ts.map((t) => setConfirm(t, m.id, m.yes ? "yes" : "no")));
            setState((s) => (s ? { ...s, confirms: s.confirms.filter((c) => c.id !== m.id) } : s));
            break;
          case "confirmWithdrawn":
            setDialog((d) => (d?.id === m.id ? null : d));
            setAskPopup(null);
            setTurns((ts) => ts.map((t) => setConfirm(t, m.id, "withdrawn")));
            setState((s) => (s ? { ...s, confirms: s.confirms.filter((c) => c.id !== m.id) } : s));
            break;
          case "changed": {
            bumpRefresh();
            if (m.by !== "adviser") break;
            // A new conversation has no stored title yet: its first message stands in.
            const title = stateRef.current?.title ?? turnsRef.current.find((t) => t.id === m.turnId)?.user.text.slice(0, 60) ?? null;
            const seen: Seen = { change: m.change, by: m.by, at: Date.now(), turnId: m.turnId, title };
            setRecentChanges((r) => [...r.filter((x) => Date.now() - x.at < RECENT_MS), seen].slice(-100));
            if (pageOf(m.change.ref) !== pageRef.current) setUnseen((u) => [...u, seen]);
            if (m.turnId) setTurns((ts) => ts.map((t) => (t.id === m.turnId ? addChange(t, m.change) : t)));
            break;
          }
          case "progress":
            setLastProgress(m.message);
            if (pageRef.current !== "hiring") setToast(m.message);
            break;
          case "login":
            setLogin({ url: m.url, code: m.code, message: m.message });
            break;
          case "voiceAudio":
            bv.current?.play(m.pcm);
            break;
          case "voice":
            switch (m.kind) {
              case "request":
                setTurns((ts) =>
                  m.mode === "new" || !ts.some((t) => t.id === m.turnId)
                    ? [...ts, { id: m.turnId, at: now(), user: { text: m.text, attachments: [] }, steps: [], blocks: [], status: "running", voice: true }]
                    : [...ts, { id: crypto.randomUUID(), at: now(), user: { text: m.text, attachments: [] }, steps: [], blocks: [], status: "completed", voice: true, userOnly: true }],
                );
                setVoiceUi((v) => (v ? { ...v, working: true, line: `“${m.text.trim()}”` } : v));
                break;
              case "said":
                setVoiceUi((v) => (v ? { ...v, line: `“${m.text}”` } : v));
                break;
              case "skipped":
                if (m.turnId) setTurns((ts) => ts.map((t) => (t.id === m.turnId ? { ...t, blocks: [...t.blocks, { kind: "skipped", req: m.req }] } : t)));
                break;
              case "error":
                setVoiceUi((v) => (v ? { ...v, line: m.message } : v));
                break;
              case "ended":
                stopBrowserVoice();
                setVoiceUi(null);
                setVoiceNote({ kind: "ended", seconds: m.billedSeconds, byUser: m.byUser, reason: m.reason });
                void refresh();
                break;
            }
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

  /** Sends on the current conversation: in the side panel on a page that has one, else on Conversations. */
  const send = async (text: string, skill?: string, attachments: string[] = [], mode?: "setup", from?: SessionFrom) => {
    const turnId = crypto.randomUUID();
    if (pageRef.current === "conversations" || pageRef.current === "all") setPage("conversations");
    else setDockOpen(true);
    setTurns((ts) => [...ts, { id: turnId, at: now(), user: { text, attachments }, ...(skill ? { skill } : {}), steps: [], blocks: [], status: "running" }]);
    try {
      await api.call("send", { text, turnId, ...(skill ? { skill } : {}), ...(mode ? { mode } : {}), ...(from ? { from } : {}) });
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

  /** `stay`: from the side panel (the page stays); otherwise Conversations opens. */
  const newConversation = async (stay = false): Promise<boolean> => {
    try {
      await api.call("newConversation");
      setTurns([]);
      setResumedTitle(null);
      setConvFrom(null);
      setNotice(null);
      if (!stay) setPage("conversations");
      void refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const resume = async (threadId: string, stay = false) => {
    try {
      const r = await api.call("resume", { threadId });
      setNotice(null);
      if (!stay) setPage("conversations");
      if (!r.alreadyOpen) {
        const rec = recent.find((x) => x.threadId === threadId);
        setResumedTitle(rec?.title ?? "an earlier conversation");
        const entries = await api.call("transcript").catch(() => []);
        const extras = await api.call("turnExtras").catch(() => ({}));
        setTurns(withExtras(turnsFromTranscript(entries, rec ? new Date(rec.startedAt) : now()), extras));
      }
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /**
   * A page button that asks MeritAI (owner, 2026-09-27): the side panel opens; the current conversation
   * continues when it is empty or about the same thing, otherwise a new one starts (no question asked).
   * While an answer runs, the request waits as "Next".
   */
  const ask = (a: Ask) => {
    setDockOpen(true);
    setAskPopup(null);
    if (a.draft) {
      setDraft(a.text);
      setPendingFrom(a.from);
      return;
    }
    if (running || state?.busy || asking.current) {
      setQueue((q) => [...q, a]);
      return;
    }
    void runAsk(a);
  };
  const runAsk = async (a: Ask) => {
    asking.current = true;
    try {
      const empty = turnsRef.current.length === 0;
      const same = empty || convFromRef.current?.key === a.from.key;
      let from: SessionFrom | undefined = empty ? a.from : undefined;
      if (!same) {
        const cur = stateRef.current;
        const prev = cur?.title && cur.threadId ? { title: cur.title, threadId: cur.threadId } : null;
        if (!(await newConversation(true))) return;
        if (prev) setNotice({ about: a.from.label, prev });
        from = a.from;
      }
      if (from) setConvFrom(from);
      await send(a.text, a.skill, a.attachments ?? [], a.mode, from);
    } finally {
      asking.current = false;
    }
  };
  /** What the owner typed and sent: a request they finished from a page button keeps that button's topic. */
  const typedSend = (text: string, skill?: string, attachments?: string[]) => {
    if (pendingFrom) {
      setPendingFrom(null);
      void runAsk({ text, from: pendingFrom, ...(skill ? { skill } : {}), ...(attachments ? { attachments } : {}) });
    } else void send(text, skill, attachments);
  };
  const running = turns.some((t) => t.status === "running");
  const waitingOnYou = turns.some((t) => t.blocks.some((b) => b.kind === "confirm" && b.state === "open"));
  // The next waiting request goes when nothing runs.
  useEffect(() => {
    if (running || state?.busy || asking.current || !queue.length) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    void runAsk(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, state?.busy, queue]);
  useEffect(() => {
    if (showDock) setAskPopup(null);
  }, [showDock]);
  // Ctrl J opens and closes the side panel (not on Conversations, which is the full view).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j" && pageRef.current !== "conversations" && pageRef.current !== "all") {
        e.preventDefault();
        setDockOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  /** "From Hiring · Team leader": back to that page and thing. */
  const goFrom = (f: SessionFrom) => {
    setStaffAdd(null);
    if (f.page === "staff" && f.employeeId !== undefined) return openEmployee(f.employeeId);
    setStaffOpen(null);
    if (f.page === "hiring" && f.job) setHiringJob({ job: f.job });
    setPage(f.page);
  };

  // Opening a page shows what changed there meanwhile and clears its dot.
  useEffect(() => {
    setArrivals((a) => (a && a.page !== page ? null : a));
    const here = unseen.filter((s) => pageOf(s.change.ref) === page);
    if (!here.length) return;
    setArrivals((a) => ({ page, items: [...(a?.page === page ? a.items : []), ...here] }));
    setUnseen((u) => u.filter((s) => pageOf(s.change.ref) !== page));
  }, [page, unseen]);
  const freshPages = new Set(unseen.map((s) => pageOf(s.change.ref)));
  const openTarget = (t: OpenTarget) => {
    switch (t.kind) {
      case "employee":
        return openEmployee(t.id, t.docs === true);
      case "job":
        setStaffOpen(null);
        setHiringJob({ job: t.job });
        return setPage("hiring");
      case "files":
        return setPage("files");
      case "profile":
        return setPage("profile");
      case "connections":
        return setPage("connections");
      case "conversation":
        // Next to the page when it has the side panel; else the full view.
        if (dockable) setDockOpen(true);
        else setPage("conversations");
    }
  };
  const live: Live = { recent: recentChanges, refreshKey, open: openTarget };
  // One line per thing (a hire also shortlists: only the hire is said).
  const arrivalNote = (p: Page) => {
    if (arrivals?.page !== p) return null;
    const last = new Map(arrivals.items.map((s) => [refKey(s.change.ref), s]));
    return <ArrivalNote items={[...last.values()].map((s) => ({ summary: s.change.summary, title: s.title }))} onDismiss={() => setArrivals(null)} />;
  };

  // The owner's language (Settings): the page in Chinese, or English again (a reload).
  useEffect(() => {
    if (state?.language) applyLanguage(state.language);
  }, [state?.language]);

  const currentThread = state?.threadId ?? null;
  const showPanel = page === "conversations" && wide;
  const askButton: AskButton = !dockable ? "none" : showDock ? "open" : waitingOnYou ? "waiting" : running ? "working" : "closed";
  const docked = showDock && wide;

  return (
    <LiveContext.Provider value={live}>
    <div className={`m app${docked ? " dock-open" : ""}`}>
      <AppBar
        state={state}
        connection={connection}
        showAttention={!showPanel}
        onAttention={() => setAttentionOpen(true)}
        ask={askButton}
        onAskToggle={() => setDockOpen(!dockOpen)}
        onLeaveSample={() =>
          void api.call("setWorkspace", { path: null }).then(
            () => {
              // Back to the first run's business step for their own business.
              try {
                sessionStorage.removeItem("meritai.firstRun");
              } catch {
                /* only this tab */
              }
              setFirstRunDone(false);
              setTurns([]);
              setPage("conversations");
              void refresh();
            },
            (e: Error) => setError(e.message),
          )
        }
      />
      {connection !== "open" && (
        <div className="banner bad conn" role="alert">
          <Icon name="alert" size={18} />
          <span>
            <b>{connection === "connecting" ? "Connecting to MeritAI…" : "MeritAI isn't reachable."}</b> {connection === "closed" && "It may have been closed. Start it again with npm run ui; this page reconnects by itself."}
          </span>
        </div>
      )}
      {state && (!state.account.loggedIn || (state.business.needsSetup && !firstRunDone)) ? (
        <FirstRun
          api={api}
          state={state}
          login={login}
          onRefresh={() => void refresh()}
          onSetup={() => (finishFirstRun(), setPage("conversations"), void send("Set up my business profile", undefined, [], "setup"))}
          onForm={() => (finishFirstRun(), setPage("profile"))}
          onSkip={finishFirstRun}
          onSample={async () => {
            await api.call("useSampleBusiness");
            finishFirstRun();
            setPage("conversations");
            await refresh();
          }}
        />
      ) : (
      <div className="body">
        <Nav page={page} fresh={freshPages} collapsed={docked} onFeedback={() => setFeedbackOpen(true)} onPage={(p) => (setStaffOpen(null), setStaffAdd(null), setPage(p))} onNew={() => void newConversation()} recent={recent} onRecent={(id) => void resume(id)} currentThread={currentThread} state={state} />
        {page === "conversations" && (
          <ConversationPage
            api={api}
            state={state}
            turns={turns}
            title={state?.title ?? null}
            onSend={typedSend}
            onStop={() => void api.call("stop").catch(() => null)}
            onAnswer={(id, yes) => void answer(id, yes)}
            onNew={() => void newConversation()}
            onResume={(id) => void resume(id)}
            resumedTitle={resumedTitle}
            draft={draft}
            onDraftUsed={() => setDraft(null)}
            from={convFrom}
            onGoFrom={goFrom}
            voice={voiceProps}
            onRedo={(t) => setDraft(t)}
          />
        )}
        {page === "all" && <AllConversations api={api} onResume={(id) => void resume(id)} onNew={() => void newConversation()} />}
        {page === "staff" && <StaffPage key={staffOpen ? `${staffOpen.id}:${staffOpen.n}` : staffAdd ? `add:${staffAdd.name}` : "list"} api={api} openId={staffOpen?.id ?? null} openDocs={staffOpen?.docs ?? false} addPrefill={staffAdd} onAsk={ask} onChanged={() => void refresh()} refreshKey={refreshKey} arrival={arrivalNote("staff")} />}
        {page === "files" && <FilesPage api={api} onAsk={ask} refreshKey={refreshKey} arrival={arrivalNote("files")} />}
        {page === "profile" && <ProfilePage api={api} onAsk={() => ask({ text: "Set up my business profile", mode: "setup", from: FROM_PROFILE })} onChanged={() => void refresh()} refreshKey={refreshKey} arrival={arrivalNote("profile")} />}
        {page === "connections" && <ConnectionsPage api={api} />}
        {page === "memory" && <MemoryPage api={api} onProfile={() => setPage("profile")} />}
        {page === "settings" && <SettingsPage api={api} login={login} language={state?.language ?? "en"} onChanged={() => void refresh()} />}
        {page === "hiring" && <HiringPage api={api} progress={lastProgress} onAsk={ask} asking={{ running: turns.find((t) => t.status === "running")?.user.text ?? null, queued: queue.map((q) => q.text) }} openJob={hiringJob} refreshKey={refreshKey} arrival={arrivalNote("hiring")} onHire={(c, job) => (setStaffOpen(null), setStaffAdd({ name: c?.name ?? "", role: job, ...(c ? { hireFrom: { job, file: c.file } } : {}) }), setPage("staff"))} onOpenEmployee={(id) => openEmployee(id)} />}
        {/* Kept while closed on a page (a half-typed message survives closing it); hidden, not removed. */}
        {dockable && (
          <Dock
            hidden={!dockOpen}
            api={api}
            state={state}
            page={page}
            turns={turns}
            title={state?.title ?? null}
            from={convFrom}
            recent={recent}
            currentThread={currentThread}
            running={running}
            waiting={waitingOnYou}
            queue={queue}
            notice={notice}
            draft={draft}
            floating={!wide}
            onDraftUsed={() => setDraft(null)}
            onSend={typedSend}
            onStop={() => void api.call("stop").catch(() => null)}
            onAnswer={(id, yes) => void answer(id, yes)}
            onNew={() => void newConversation(true)}
            onResume={(id) => void resume(id, true)}
            onCancelQueued={(i) => setQueue((q) => q.filter((_, j) => j !== i))}
            onFull={() => setPage("conversations")}
            onClose={() => setDockOpen(false)}
            onGoFrom={goFrom}
            voiceOn={voiceUi !== null}
            onEndVoice={voiceProps.onEnd}
          />
        )}
        {showPanel && voiceUi && <VoiceStage turns={turns.slice(voiceFrom.current).filter((t) => t.voice)} api={api} onAnswer={(id, yes) => void answer(id, yes)} />}
        {showPanel && !voiceUi && <AttentionPanel reminders={reminders} rulesChecked={state?.rulesChecked ?? null} onAsk={(r) => void send(`Help me with this: ${r.title}`)} onOpenEmployee={openEmployee} />}
      </div>
      )}
      {attentionOpen && !showPanel && (
        <>
          <div className="scrim fill" onClick={() => setAttentionOpen(false)} />
          <div className="attention-drawer">
            <AttentionPanel reminders={reminders} rulesChecked={state?.rulesChecked ?? null} onClose={() => setAttentionOpen(false)} onAsk={(r) => (setAttentionOpen(false), pageRef.current === "conversations" || pageRef.current === "all" ? void send(`Help me with this: ${r.title}`) : ask({ text: `Help me with this: ${r.title}`, from: fromReminder(r) }))} onOpenEmployee={(id) => (setAttentionOpen(false), openEmployee(id))} />
          </div>
        </>
      )}
      {askPopup && !showDock && dockable && (
        <div className="ask-pop" role="dialog" aria-label="MeritAI needs your OK">
          <div className="cap" style={{ color: "#6B4E00" }}>
            Needs your OK
          </div>
          <b>{fmtDatesIn(askPopup)}</b>
          <span className="meta">{state?.title ? `In “${state.title}”. ` : ""}Nothing changes until you say yes.</span>
          <div className="row-wrap">
            <button type="button" className="btn p sm" onClick={() => setDockOpen(true)}>
              Open the side panel
            </button>
            <button type="button" className="btn g sm" onClick={() => setAskPopup(null)}>
              Later
            </button>
          </div>
        </div>
      )}
      {feedbackOpen && <FeedbackDialog api={api} state={state} onClose={() => setFeedbackOpen(false)} />}
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
    </LiveContext.Provider>
  );
}
