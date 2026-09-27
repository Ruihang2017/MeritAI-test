import { useEffect, useState } from "react";
import type { Settings, ShellState } from "../../../src/server/protocol";
import type { Api } from "../api";
import { Icon } from "./Icon";

/**
 * First run (design boards FirstSignIn / FirstWorkspace / FirstSetup): sign in, confirm the
 * workspace folder, then set up the business profile (with the adviser, a form, or later).
 */
export function FirstRun({
  api,
  state,
  login,
  onRefresh,
  onSetup,
  onForm,
  onSkip,
  onSample,
}: {
  api: Api;
  state: ShellState;
  login: { url: string | null; code: string | null; message: string } | null;
  onRefresh: () => void;
  onSetup: () => void;
  onForm: () => void;
  onSkip: () => void;
  /** "Try it with a sample business" (design: FirstChoose). */
  onSample: () => Promise<void>;
}) {
  const [preparing, setPreparing] = useState(false);
  const signedIn = state.account.loggedIn;
  const [step, setStep] = useState<"workspace" | "business">("workspace");
  const [signing, setSigning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [path, setPath] = useState("");
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (signedIn) api.call("settings").then((s) => (setSettings(s), setPath(s.workspace)), () => null);
  }, [api, signedIn]);

  const signIn = async () => {
    setSigning(true);
    setErr(null);
    const r = await api.call("login").catch((e: Error) => ({ ok: false, error: e.message }));
    setSigning(false);
    if (!r.ok) setErr(`Sign-in didn't finish: ${r.error ?? "unknown error"}. Try again.`);
    onRefresh();
  };
  const useFolder = async (p: string | null) => {
    setErr(null);
    try {
      if (p !== null && p !== settings?.workspace) setSettings(await api.call("setWorkspace", { path: p }));
      setStep("business");
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const current = !signedIn ? 1 : step === "workspace" ? 2 : 3;
  return (
    <div className="first dots">
      <ol className="first-steps" aria-label="Setup steps">
        {["Sign in", "Workspace", "Your business"].map((s, i) => (
          <li key={s} className={i + 1 === current ? "on" : i + 1 < current ? "done" : ""} aria-current={i + 1 === current ? "step" : undefined}>
            {i + 1 < current ? <Icon name="check" size={14} stroke={2.4} /> : i + 1} {s}
          </li>
        ))}
      </ol>
      <div className="card first-card">
        <div className="logo lg">M</div>
        {current === 1 && (
          <>
            <h1 className="h1" style={{ fontSize: 28 }}>
              Welcome to MeritAI
            </h1>
            <p className="first-lead">An HR adviser for businesses without an HR department. Tell it what's happening; it tells you what to do and helps get the paperwork done.</p>
            <ul className="first-list">
              <li>Hiring, new starters, probation, leaving, difficult conversations</li>
              <li>Reminders from your staff register</li>
              <li>Legal points checked against official Australian sources</li>
            </ul>
            {!signing ? (
              <button type="button" className="btn p lg" style={{ alignSelf: "flex-start" }} onClick={() => void signIn()}>
                Sign in with ChatGPT
              </button>
            ) : (
              <div className="signin">
                {login?.url ? (
                  <>
                    <span>
                      <b>1.</b> Open the sign-in page:{" "}
                      <a href={login.url} target="_blank" rel="noreferrer noopener" className="mono">
                        {login.url.replace(/^https?:\/\//, "")}
                      </a>
                    </span>
                    <span>
                      <b>2.</b> Sign in to ChatGPT and enter this code:
                    </span>
                    <div className="row-wrap" style={{ alignItems: "center" }}>
                      <span className="mono code" aria-label="Sign-in code">
                        {login.code ?? "—"}
                      </span>
                      {login.code && (
                        <button type="button" className="btn sm" onClick={() => void navigator.clipboard.writeText(login.code!).then(() => setCopied(true))}>
                          {copied ? "Copied" : "Copy code"}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <span className="meta">{login?.message ?? "Starting sign-in…"}</span>
                )}
                <div className="banner n" style={{ alignItems: "center" }}>
                  <span className="spin" />
                  <span className="grow">Waiting for you to finish in the browser. This page moves on by itself.</span>
                </div>
              </div>
            )}
          </>
        )}
        {current === 2 && (
          <>
            <h1 className="h1" style={{ fontSize: 26 }}>
              Where should MeritAI keep your files?
            </h1>
            <p className="first-lead">One folder for this business: Inbox (files you give it), Outbox (letters and reports it saves), Jobs and Policies, plus the business profile and staff register.</p>
            <div className="ws-choice">
              <Icon name="folder" size={20} />
              <span className="mono grow" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                {settings?.workspace ?? "…"}
              </span>
            </div>
            {changing && (
              <label className="field">
                Another folder
                <input className="input mono" style={{ fontSize: 13 }} value={path} onChange={(e) => setPath(e.target.value)} />
              </label>
            )}
            <div className="row-wrap">
              <button type="button" className="btn p lg" onClick={() => void useFolder(changing ? path : null)} disabled={!settings}>
                {changing ? "Use this folder" : "Use this folder"}
              </button>
              {!changing && (
                <button type="button" className="btn lg" onClick={() => setChanging(true)}>
                  Choose another
                </button>
              )}
            </div>
          </>
        )}
        {current === 3 && (
          <>
            <h1 className="h1" style={{ fontSize: 26 }}>
              Tell MeritAI about your business
            </h1>
            <p className="first-lead">Its name, state, staff and payroll. The adviser uses it in every answer, so letters and advice fit your business.</p>
            <div className="first-options">
              <button type="button" className="pick" onClick={onSetup}>
                <b>Set up with the adviser</b>
                <span className="meta">About 5 minutes. It asks a few questions and saves the answers when you say yes. It works out your likely award with you.</span>
              </button>
              <button type="button" className="pick" onClick={onForm}>
                <b>Fill in the form myself</b>
                <span className="meta">Profile & policies page.</span>
              </button>
              <button
                type="button"
                className="pick sample-pick"
                disabled={preparing}
                onClick={() => {
                  setPreparing(true);
                  setErr(null);
                  onSample().catch((e: Error) => (setErr(e.message), setPreparing(false)));
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b>{preparing ? "Preparing the sample business…" : "Try it with a sample business"}</b>
                  <span className="pill warn" style={{ height: 22 }}>
                    For trying MeritAI
                  </span>
                </span>
                <span className="meta">
                  A made-up cleaning business (Wattle Lane Cleaning, NSW) with 9 staff, 3 open jobs and paperwork due, so you can try everything without your own data. It is kept in its own folder and dated 26 Sep 2026. Switch to your own business any time.
                </span>
              </button>
            </div>
            <button type="button" className="btn g" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={onSkip}>
              Skip for now
            </button>
          </>
        )}
        {err && (
          <div className="banner bad" role="alert">
            {err}
          </div>
        )}
        <div className="banner warn" style={{ fontSize: 13 }}>
          <span>Internal test: use sample data only while signed in to a personal account.</span>
        </div>
      </div>
    </div>
  );
}
