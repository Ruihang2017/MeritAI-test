import { useEffect, useState } from "react";
import type { Api } from "../api";
import { Icon } from "./Icon";

/**
 * An email draft the adviser saved (design: EmailDraft): who it's to, the subject, what's attached.
 * It opens in the owner's email app, where they check it and press Send; sending from MeritAI
 * itself is coming (Connections).
 */
export function EmailCard({ path, api }: { path: string; api: Api }) {
  const [d, setD] = useState<{ to: string[]; cc: string[]; subject: string; attachments: string[]; preview: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.call("emailDraft", { path }).then((r) => (r.ok ? setD(r) : setErr(r.error)), (e: Error) => setErr(e.message));
  }, [api, path]);
  const open = (reveal = false) => void api.call(reveal ? "revealFile" : "openFile", { path }).then((r) => !r.ok && setErr(r.error));
  const row = (k: string, v: React.ReactNode) => (
    <div className="mail-row">
      <span className="meta">{k}</span>
      <span style={{ minWidth: 0 }}>{v}</span>
    </div>
  );
  return (
    <article className="card chg" aria-label="Email draft">
      <div className="chg-h">
        <span className="chg-ic">
          <Icon name="mail" size={18} />
        </span>
        <div className="chg-t">
          <b>Email draft</b>
          <span className="meta">Saved in Outbox · opens in your email app, ready to check and send</span>
        </div>
      </div>
      {d && (
        <div>
          {row("To", d.to.length ? d.to.join(", ") : <i className="meta">add it in your email app</i>)}
          {d.cc.length > 0 && row("Cc", d.cc.join(", "))}
          {row("Subject", d.subject)}
          {d.attachments.length > 0 &&
            row(
              "Attached",
              <span className="row-wrap">
                {d.attachments.map((a) => (
                  <span key={a} className="chip">
                    <Icon name="file" size={15} />
                    {a}
                  </span>
                ))}
              </span>,
            )}
          {row("Message", <span className="meta ellipsis2">{d.preview}</span>)}
        </div>
      )}
      {err && <div className="banner bad">{err}</div>}
      <div className="row-wrap" style={{ alignItems: "center" }}>
        <button type="button" className="btn p sm" onClick={() => open()}>
          <Icon name="external" size={15} />
          Open in email app
        </button>
        <button type="button" className="btn sm" onClick={() => open(true)}>
          Show in folder
        </button>
        <span className="grow" />
        <button type="button" className="btn sm" disabled title="Coming soon: send from MeritAI with your Outlook or Gmail account, after your OK">
          <Icon name="send" size={15} />
          Send from MeritAI
        </button>
        <span className="pill soon">Coming soon</span>
      </div>
      <span className="meta">MeritAI doesn't send email yet: your email app opens the draft, you check it and press Send.</span>
    </article>
  );
}
