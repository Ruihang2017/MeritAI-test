import { useCallback, useEffect, useState } from "react";
import type { Api } from "../api";
import type { EmailItem } from "../../../src/server/protocol";
import { fmtDay, localDay } from "../format";
import { useLive } from "../live";
import { Icon } from "./Icon";
import { defaultTo, SendToast, useGmail, useSend } from "./Mail";

/**
 * An email draft the adviser saved (design: EmailDraft, EmailOne): who it's to, the subject, what's
 * attached. With Gmail connected the owner sends it from here (10 seconds to undo); without, it
 * opens in their email app, where they check it and press Send.
 */
export function EmailCard({ path, api }: { path: string; api: Api }) {
  const [d, setD] = useState<EmailItem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const { gmail } = useGmail(api);
  const live = useLive();
  const load = useCallback(
    () =>
      void api.call("emailItem", { draft: path }).then(
        (r) => (r ? (setD(r), setTo((t) => t || defaultTo(r))) : setErr("This draft isn't in the Outbox any more.")),
        (e: Error) => setErr(e.message),
      ),
    [api, path],
  );
  useEffect(load, [load]);
  const sender = useSend(api, load);
  const open = (reveal = false) => void api.call(reveal ? "revealFile" : "openFile", { path }).then((r) => !r.ok && setErr(r.error));
  const send = () => void sender.send([{ draft: path, to }]).then((e) => e && setErr(e));
  const row = (k: string, v: React.ReactNode) => (
    <div className="mail-row">
      <span className="meta">{k}</span>
      <span style={{ minWidth: 0 }}>{v}</span>
    </div>
  );
  const busy = sender.batch?.state === "waiting" || sender.batch?.state === "sending";
  const valid = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[a-z]{2,}$/i.test(to);
  return (
    <article className="card chg" aria-label="Email draft">
      <div className="chg-h">
        <span className="chg-ic">
          <Icon name="mail" size={18} />
        </span>
        <div className="chg-t">
          <b>Email draft</b>
          <span className="meta">{gmail?.connected ? "Saved in Outbox · send it from your Gmail, or open it in your email app" : "Saved in Outbox · opens in your email app, ready to check and send"}</span>
        </div>
        {d?.sentAt && <span className="pill ok">{`Emailed ${fmtDay(localDay(d.sentAt))}`}</span>}
      </div>
      {d && (
        <div>
          {d.sentAt
            ? row("To", d.sentTo)
            : row(
                "To",
                gmail?.connected ? (
                  d.options.length > 1 ? (
                    <select className="input mail-addr" aria-label="Send to" value={to} onChange={(e) => setTo(e.target.value)}>
                      {d.options.map((o) => (
                        <option key={o.address}>{o.address}</option>
                      ))}
                    </select>
                  ) : d.options.length ? (
                    d.options[0].address
                  ) : (
                    <input className="input mail-addr" aria-label="Send to" placeholder="Type the address" value={to} onChange={(e) => setTo(e.target.value.trim())} />
                  )
                ) : d.to.length ? (
                  d.to.join(", ")
                ) : (
                  <i className="meta">add it in your email app</i>
                ),
              )}
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
          {row("Message", <span className="meta ellipsis2">{d.body.replace(/\s+/g, " ").trim().slice(0, 220)}</span>)}
        </div>
      )}
      {err && <div className="banner bad">{err}</div>}
      {sender.batch && <SendToast inline batch={sender.batch} from={gmail?.email ?? null} onUndo={sender.undo} onNow={sender.now} onClose={sender.dismiss} />}
      {!d?.sentAt && (
        <div className="row-wrap" style={{ alignItems: "center" }}>
          {gmail?.connected ? (
            <button type="button" className="btn p sm" disabled={!d || !valid || busy} onClick={send}>
              <Icon name="send" size={15} />
              Send from Gmail
            </button>
          ) : (
            <button type="button" className="btn p sm" onClick={() => open()}>
              <Icon name="external" size={15} />
              Open in email app
            </button>
          )}
          {gmail?.connected ? (
            <button type="button" className="btn sm" onClick={() => open()}>
              Open in email app
            </button>
          ) : (
            <button type="button" className="btn sm" onClick={() => open(true)}>
              Show in folder
            </button>
          )}
          <span className="grow" />
          {!gmail?.connected && (
            <button type="button" className="btn sm" onClick={() => live.open({ kind: "connections" })}>
              <Icon name="mail" size={15} />
              Connect Gmail to send from MeritAI
            </button>
          )}
        </div>
      )}
      <span className="meta">
        {d?.sentAt
          ? `Sent from ${gmail?.email ?? "your Gmail"}${d.test ? " in test mode (to you)" : ""}.`
          : gmail?.connected
            ? `From ${gmail.email}${gmail.testMode ? " · test mode: it goes to you" : ""} · undo for 10 seconds`
            : "Gmail isn't connected: your email app opens the draft, you check it and press Send."}
      </span>
    </article>
  );
}

/** Several drafts in one reply (a job's candidate emails): one card, reviewed and sent on the Hiring page. */
export function EmailBatchCard({ paths, api }: { paths: string[]; api: Api }) {
  const [job, setJob] = useState<string | null>(null);
  const live = useLive();
  useEffect(() => {
    void api.call("emailItem", { draft: paths[0] }).then((r) => setJob(r?.job ?? null), () => null);
  }, [api, paths]);
  return (
    <article className="card chg" aria-label="Email drafts">
      <div className="chg-h">
        <span className="chg-ic">
          <Icon name="mail" size={18} />
        </span>
        <div className="chg-t">
          <b>{`${paths.length} email drafts`}</b>
          <span className="meta">{job ? `Saved in Outbox · for the ${job} candidates` : "Saved in Outbox"}</span>
        </div>
      </div>
      <div className="row-wrap" style={{ alignItems: "center" }}>
        {job ? (
          <button type="button" className="btn p sm" onClick={() => live.open({ kind: "job", job })}>
            <Icon name="send" size={15} />
            Review and send on the Hiring page
          </button>
        ) : (
          <button type="button" className="btn sm" onClick={() => live.open({ kind: "files" })}>
            Open Files
          </button>
        )}
      </div>
    </article>
  );
}
