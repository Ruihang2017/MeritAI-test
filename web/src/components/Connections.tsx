import { useEffect, useState } from "react";
import type { Api } from "../api";
import { Icon, type IconName } from "./Icon";

/**
 * What MeritAI will connect to (owner, 2026-09-27; design: Connections). Nothing here works yet:
 * today MeritAI runs only on this computer, drafts, and the owner sends. "I want this" is kept on
 * this computer and goes in the next feedback file, so the MeritAI team learns what to build first.
 */

export const CONNECTIONS: { group: string; sub: string; items: { name: string; icon: IconName; what: string }[] }[] = [
  {
    group: "Email and calendar",
    sub: "send offers and candidate emails, book interviews",
    items: [
      { name: "Outlook and Microsoft 365", icon: "mail", what: "Send the emails MeritAI drafts from your own mailbox, after you OK each one. Book interviews in your calendar." },
      { name: "Gmail and Google Calendar", icon: "mail", what: "The same for Google accounts: send from your Gmail, invites in Google Calendar." },
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
          <span className="sub">What MeritAI will work with</span>
        </div>
        <span className="pill soon">Coming soon</span>
      </div>
      <div className="staff-body">
        <div className="banner info" style={{ alignItems: "center" }}>
          <Icon name="plug" size={18} />
          <span className="grow">
            <b>Today MeritAI runs only on this computer: it drafts, you send.</b> Soon it will connect to the tools you use, so it can send the offer, post the job ad and update payroll for you, always after your OK. Tell us which you'd use first.
          </span>
        </div>
        {CONNECTIONS.map((g) => (
          <section key={g.group} className="conn-group">
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <h2 className="h3">{g.group}</h2>
              <span className="meta">{g.sub}</span>
            </div>
            <div className="conn-grid">
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
