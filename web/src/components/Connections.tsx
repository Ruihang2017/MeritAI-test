import { useEffect, useState } from "react";
import type { Api } from "../api";
import { fmtDay, localDay } from "../format";
import { Icon, type IconName } from "./Icon";
import { useGmail } from "./Mail";

/**
 * What MeritAI connects to (owner, 2026-09-27; design: Connections, GmailConnect). Gmail works
 * (2026-09-29): MeritAI sends the emails it drafted, after the owner has seen them; the rest are
 * coming. "I want this" is kept on this computer and goes in the next feedback file, so the
 * MeritAI team learns what to build first.
 */

export const CONNECTIONS: { group: string; sub: string; items: { name: string; icon: IconName; what: string }[] }[] = [
  {
    group: "Email and calendar",
    sub: "send offers and candidate emails, book interviews",
    items: [
      { name: "Outlook and Microsoft 365", icon: "mail", what: "Send the emails MeritAI drafts from your own mailbox, after you OK each one. Book interviews in your calendar." },
      { name: "Microsoft Teams and Slack", icon: "conversations", what: "Reminders and new starter tasks where your team already talks." },
    ],
  },
  {
    group: "Job boards",
    sub: "advertise the job, bring applications into Hiring",
    items: [
      { name: "SEEK", icon: "board", what: "Post the job ad MeritAI writes, and bring the applications straight into the job to screen." },
      { name: "LinkedIn Jobs", icon: "board", what: "Post the job and collect applicants in Hiring." },
      { name: "Indeed", icon: "board", what: "Post the job and collect applicants in Hiring." },
    ],
  },
  {
    group: "Payroll, tasks and backup",
    sub: "less typing things in twice",
    items: [
      { name: "Xero, MYOB and Employment Hero", icon: "pay", what: "New starters and leavers go to payroll with their start or last day, after your OK." },
      { name: "Asana", icon: "tasks", what: "Onboarding and leaving checklists as tasks for your team." },
      { name: "Online backup and sync", icon: "cloud", what: "Your workspace backed up and on your other computers, encrypted." },
    ],
  },
];

/** Gmail: connect (Google's sign-in in the browser), test mode, disconnect (design: GmailConnect). */
function GmailCard({ api }: { api: Api }) {
  const { gmail, setGmail, reload } = useGmail(api);
  const [waiting, setWaiting] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => api.onEvent((ev) => ev.event === "gmailSignIn" && setUrl(ev.url)), [api]);
  const connect = async () => {
    setErr(null);
    setUrl(null);
    setWaiting(true);
    const r = await api.call("connectGmail").catch((e: Error) => ({ ok: false as const, error: e.message }));
    setWaiting(false);
    if (!r.ok && !("cancelled" in r && r.cancelled)) setErr(r.error);
    reload();
  };
  const connected = !!gmail?.connected;
  return (
    <article className={`card conn gmail${connected ? " on" : ""}`} aria-label="Gmail">
      <div className="conn-h">
        <span className={`conn-ic${connected ? " ok" : " live"}`}>
          <Icon name="mail" size={18} />
        </span>
        <b className="grow">Gmail</b>
        {connected ? (
          <span className="pill ok">
            <span className="dot" />
            Connected
          </span>
        ) : (
          <span className="pill n">Not connected</span>
        )}
      </div>
      {connected ? (
        <>
          <div style={{ fontSize: 14 }}>
            Sending as <b>{gmail!.email}</b>
            {gmail!.connectedAt && <span className="meta">{` · since ${fmtDay(localDay(gmail!.connectedAt))}`}</span>}
          </div>
          <p>MeritAI can only send: it can't read, search or delete your email. What it sends is in your Gmail Sent folder.</p>
          <div className={`test-mode${gmail!.testMode ? " on" : ""}`}>
            <button type="button" role="switch" aria-checked={gmail!.testMode} aria-label="Test mode" className="switch" onClick={() => void api.call("setGmailTestMode", { on: !gmail!.testMode }).then(setGmail)}>
              <span />
            </button>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <b>{gmail!.testMode ? "Test mode on" : "Test mode off"}</b>
              <span>{gmail!.testMode ? `Every email goes to ${gmail!.email}, not to the candidate, so you can try it safely.` : "Emails go to the candidates. Turn it on again to try things out."}</span>
            </span>
          </div>
          <div className="row-wrap" style={{ alignItems: "center" }}>
            <button type="button" className="btn sm" onClick={() => void api.call("disconnectGmail").then(setGmail)}>
              Disconnect
            </button>
            <span className="meta">Google Calendar: coming soon</span>
          </div>
        </>
      ) : waiting ? (
        <>
          <div className="banner info" style={{ alignItems: "center" }}>
            <span className="spin" />
            <span className="grow">
              <b>Waiting for you in the browser.</b> Choose your Google account, then Allow.
            </span>
          </div>
          <div className="row-wrap" style={{ alignItems: "center" }}>
            {url && (
              <a className="btn sm" href={url} target="_blank" rel="noreferrer">
                <Icon name="external" size={15} />
                Open the sign-in page
              </a>
            )}
            <button type="button" className="btn g sm" onClick={() => void api.call("cancelGmailConnect")}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Send the emails MeritAI drafts from your Gmail, after you've seen them. It can only send: it can't read your email.</p>
          <ol className="conn-steps">
            <li>Your browser opens Google's sign-in</li>
            <li>
              Choose your account, then <b>Allow</b>
            </li>
            <li>Back here: connected</li>
          </ol>
          {err && <div className="banner bad">{err}</div>}
          <div className="row-wrap" style={{ alignItems: "center" }}>
            <button type="button" className="btn p sm" disabled={!gmail?.configured} onClick={() => void connect()}>
              <Icon name="mail" size={15} />
              Connect Gmail
            </button>
            <span className="meta">Google Calendar: coming soon</span>
          </div>
          <span className="meta" style={{ lineHeight: 1.45 }}>
            {gmail && !gmail.configured
              ? "This copy of MeritAI has no Google sign-in set up."
              : "While Google reviews MeritAI, its sign-in says “Google hasn't verified this app”: choose Advanced, then Go to MeritAI-Test."}
          </span>
        </>
      )}
    </article>
  );
}

export function ConnectionsPage({ api }: { api: Api }) {
  const [wanted, setWanted] = useState<string[]>([]);
  useEffect(() => {
    api.call("connections").then((r) => setWanted(r.wanted), () => null);
  }, [api]);
  const toggle = async (name: string) => {
    const want = !wanted.includes(name);
    setWanted((w) => (want ? [...w, name] : w.filter((x) => x !== name)));
    await api.call("wantConnection", { name, want }).then((r) => setWanted(r.wanted), () => null);
  };
  return (
    <main className="main" style={{ background: "#EEF2F7" }}>
      <div className="page-h">
        <div style={{ flexGrow: 1, display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 className="h1">Connections</h1>
          <span className="sub">What MeritAI works with</span>
        </div>
      </div>
      <div className="staff-body">
        <div className="banner info" style={{ alignItems: "center" }}>
          <Icon name="plug" size={18} />
          <span className="grow">
            <b>MeritAI runs on this computer. Connect Gmail and it sends the emails it drafts, after you've seen them.</b> The rest are coming, so it can post the job ad and update payroll for you too, always after your OK. Tell us which you'd use first.
          </span>
        </div>
        {CONNECTIONS.map((g, gi) => (
          <section key={g.group} className="conn-group">
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <h2 className="h3">{g.group}</h2>
              <span className="meta">{g.sub}</span>
            </div>
            <div className="conn-grid">
              {gi === 0 && <GmailCard api={api} />}
              {g.items.map((c) => {
                const on = wanted.includes(c.name);
                return (
                  <article key={c.name} className="card conn">
                    <div className="conn-h">
                      <span className="conn-ic">
                        <Icon name={c.icon} size={18} />
                      </span>
                      <b className="grow">{c.name}</b>
                      <span className="pill soon">Coming soon</span>
                    </div>
                    <p>{c.what}</p>
                    <div className="row-wrap" style={{ alignItems: "center" }}>
                      <button type="button" className={`btn sm${on ? " wanted" : ""}`} aria-pressed={on} onClick={() => void toggle(c.name)}>
                        {on ? "✓ You want this" : "I want this"}
                      </button>
                      {on && <span className="meta">Noted. It goes in your next feedback file.</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        <section className="card conn" style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <span className="conn-ic" style={{ background: "#EEF3FC", color: "#1446A6" }}>
            <Icon name="refresh" size={18} />
          </span>
          <div className="grow" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <b style={{ fontSize: 15 }}>Plan and updates</b>
            <span className="sub">Alpha tester (free). MeritAI already updates itself; a subscription that keeps your workspace backed up is coming.</span>
          </div>
          <span className="pill soon">Coming soon</span>
        </section>
      </div>
    </main>
  );
}
