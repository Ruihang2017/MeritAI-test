import { useCallback, useEffect, useState } from "react";
import type { Api } from "../api";
import type { EmailItem, GmailState, SendResult } from "../../../src/server/protocol";
import { fmtDay, localDay } from "../format";
import { Icon } from "./Icon";

/**
 * Sending the emails MeritAI drafted from the owner's Gmail (design: EmailRules, GmailConnect,
 * EmailReview, EmailOne, EmailSent). The adviser only drafts; these buttons send, after the owner
 * has seen each email and the address it goes to, with 10 seconds to undo. Test mode (on unless
 * turned off in Connections) sends everything to the owner themselves.
 */

export function useGmail(api: Api): { gmail: GmailState | null; setGmail: (g: GmailState) => void; reload: () => void } {
  const [gmail, setGmail] = useState<GmailState | null>(null);
  const reload = useCallback(() => void api.call("gmail").then(setGmail, () => null), [api]);
  useEffect(reload, [reload]);
  return { gmail, setGmail, reload };
}

export type Batch = { id: string; sendAt: number; count: number; test: boolean; state: "waiting" | "sending" | "done" | "undone"; results: SendResult[]; drafts: string[] };

/** A send in progress: 10 seconds to undo, then the results. `onFinished` reloads what shows them. */
export function useSend(api: Api, onFinished: () => void) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const send = async (items: { draft: string; to: string }[], again = false): Promise<string | null> => {
    const r = await api.call("sendEmails", { items, again }).catch((e: Error) => ({ ok: false as const, error: e.message }));
    if (!r.ok) return r.error;
    const id = r.id;
    setBatch({ id, sendAt: Date.parse(r.sendAt), count: r.count, test: r.test, state: "waiting", results: [], drafts: items.map((x) => x.draft) });
    void api.call("emailResults", { id }).then(
      (res) => {
        setBatch((b) => (b?.id === id ? { ...b, state: res.state === "cancelled" ? "undone" : "done", results: res.results } : b));
        onFinished();
      },
      () => null,
    );
    return null;
  };
  const undo = () => batch && void api.call("cancelEmails", { id: batch.id }).then((r) => r.cancelled && setBatch((b) => (b ? { ...b, state: "undone" } : b)));
  const now = () => batch && void api.call("sendEmailsNow", { id: batch.id }).then((r) => r.started && setBatch((b) => (b ? { ...b, state: "sending" } : b)));
  return { batch, send, undo, now, dismiss: () => setBatch(null) };
}

function useSecondsLeft(until: number | null): number {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    if (until === null) return;
    const i = setInterval(() => setT(Date.now()), 250);
    return () => clearInterval(i);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - t) / 1000));
}

/** The bar at the bottom while emails wait, and what happened after (design: EmailSent). */
export function SendToast({ batch, from, onUndo, onNow, onClose, onReview, inline }: { batch: Batch; from: string | null; onUndo: () => void; onNow: () => void; onClose: () => void; onReview?: () => void; inline?: boolean }) {
  const cls = `toast mail-toast${inline ? " inline" : ""}`;
  const left = useSecondsLeft(batch.state === "waiting" ? batch.sendAt : null);
  const sent = batch.results.filter((r) => r.ok);
  const failed = batch.results.filter((r) => !r.ok);
  useEffect(() => {
    if (batch.state !== "done" || failed.length) return;
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [batch.state, failed.length, onClose]);
  if (batch.state === "waiting" || batch.state === "sending")
    return (
      <div className={cls} role="status">
        <span className="spin" style={{ borderColor: "#4A5363", borderTopColor: "#FFFFFF" }} />
        <span className="grow">
          <b>{batch.state === "sending" ? `Sending ${batch.count} email${batch.count === 1 ? "" : "s"}…` : `Sending ${batch.count} email${batch.count === 1 ? "" : "s"} in ${left} s`}</b>{" "}
          <span style={{ color: "#C4CCD9" }}>{`${from ? `from ${from}` : ""}${batch.test ? " · test mode" : ""}`}</span>
        </span>
        {batch.state === "waiting" && (
          <>
            <button type="button" className="btn sm toast-btn" onClick={onUndo}>
              Undo
            </button>
            <button type="button" className="btn sm" onClick={onNow}>
              Send now
            </button>
          </>
        )}
      </div>
    );
  if (batch.state === "undone")
    return (
      <div className={`${cls} light`} role="status">
        <Icon name="alert" size={18} />
        <span className="grow">
          <b>Not sent.</b> The drafts are still in your Outbox.
        </span>
        {onReview && (
          <button type="button" className="btn sm" onClick={onReview}>
            Review and send
          </button>
        )}
        <button type="button" className="ib" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  return (
    <div className={`${cls} ${failed.length ? "warn" : "ok"}`} role="status">
      <Icon name={failed.length ? "alert" : "check"} size={18} stroke={2.2} />
      <span className="grow">
        <b>{`${sent.length} email${sent.length === 1 ? "" : "s"} sent`}</b> {`${from ? `from ${from}` : ""}${batch.test ? " (test mode: to you)" : ""}.`}
        {failed.length > 0 && <span style={{ display: "block" }}>{`${failed.length} not sent: ${failed.map((f) => f.error).filter((x, i, a) => a.indexOf(x) === i).join("; ")}`}</span>}
      </span>
      <button type="button" className="ib" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

/** The address an email goes to by default: the only one there is, or the one in the draft. */
export function defaultTo(e: EmailItem): string {
  if (e.options.length === 1) return e.options[0].address;
  return e.options.find((o) => o.from !== "application")?.address ?? "";
}

const GROUPS: [EmailItem["kind"], string][] = [
  ["invite", "Interview invitations"],
  ["not", "Not this time"],
  ["other", "Other emails"],
];

/** Where an address came from, next to it. */
function AddressField({ e, value, onChange }: { e: EmailItem; value: string; onChange: (v: string) => void }) {
  const name = e.candidate?.name ?? "the candidate";
  if (e.options.length > 1)
    return (
      <span className="row-wrap" style={{ alignItems: "center" }}>
        <select className="input mail-addr" aria-label={`${name}'s address`} value={value} onChange={(x) => onChange(x.target.value)}>
          {!value && <option value="">Pick an address</option>}
          {e.options.map((o) => (
            <option key={o.address} value={o.address}>
              {o.address}
            </option>
          ))}
        </select>
        <span className="mail-warn">{`${e.options.length} addresses: pick one`}</span>
      </span>
    );
  if (!e.options.length)
    return (
      <span className="row-wrap" style={{ alignItems: "center" }}>
        <input className="input mail-addr" aria-label={`${name}'s address`} placeholder="Type the address" value={value} onChange={(x) => onChange(x.target.value.trim())} />
        <span className="mail-warn">No email address in the application</span>
      </span>
    );
  return <span className="mono mail-to">{e.options[0].address}</span>;
}

const validAddress = (s: string) => /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[a-z]{2,}$/i.test(s);

/** A draft's text, and editing it before it goes (the recipients and attachments stay). */
function DraftText({ api, e, onSaved }: { api: Api; e: EmailItem; onSaved: () => void }) {
  const [edit, setEdit] = useState<{ subject: string; body: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!edit)
    return (
      <div className="mail-text">
        <div className="mail-body">{e.body.trim()}</div>
        {e.attachments.length > 0 && (
          <span className="row-wrap">
            {e.attachments.map((a) => (
              <span key={a} className="chip">
                <Icon name="file" size={15} />
                {a}
              </span>
            ))}
          </span>
        )}
        {!e.sentAt && (
          <span className="row-wrap" style={{ alignItems: "center" }}>
            <button type="button" className="btn sm" onClick={() => setEdit({ subject: e.subject, body: e.body.trim() })}>
              <Icon name="edit" size={15} />
              Edit
            </button>
            <span className="meta">From the draft in your Outbox</span>
          </span>
        )}
      </div>
    );
  return (
    <form
      className="mail-text"
      onSubmit={(x) => {
        x.preventDefault();
        void api.call("updateEmailDraft", { draft: e.draft, ...edit }).then(
          () => (setEdit(null), onSaved()),
          (er: Error) => setErr(er.message),
        );
      }}
    >
      <label className="field">
        Subject
        <input className="input" value={edit.subject} onChange={(x) => setEdit({ ...edit, subject: x.target.value })} />
      </label>
      <label className="field">
        Message
        <textarea className="input mail-edit" rows={9} value={edit.body} onChange={(x) => setEdit({ ...edit, body: x.target.value })} />
      </label>
      {err && <div className="banner bad">{err}</div>}
      <span className="row-wrap">
        <button type="submit" className="btn p sm">
          Save
        </button>
        <button type="button" className="btn sm" onClick={() => setEdit(null)}>
          Cancel
        </button>
      </span>
    </form>
  );
}

function Check({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} className={`mail-check${on ? " on" : ""}`} disabled={disabled} onClick={onClick}>
      {on && <Icon name="check" size={14} stroke={3} />}
    </button>
  );
}

/** The panel: every draft for the job, untick or edit any, Send N (design: EmailReview). */
export function EmailReview({
  api,
  job,
  items,
  gmail,
  onClose,
  onSend,
  onChanged,
  onConnect,
}: {
  api: Api;
  job: string;
  items: EmailItem[];
  gmail: GmailState | null;
  onClose: () => void;
  onSend: (items: { draft: string; to: string }[], again: boolean) => Promise<string | null>;
  onChanged: () => void;
  onConnect: () => void;
}) {
  const unsent = items.filter((e) => !e.sentAt);
  const sent = items.filter((e) => e.sentAt);
  const [to, setTo] = useState<Record<string, string>>(() => Object.fromEntries(unsent.map((e) => [e.draft, defaultTo(e)])));
  const [sel, setSel] = useState<Record<string, boolean>>(() => Object.fromEntries(unsent.map((e) => [e.draft, !e.earlier && validAddress(defaultTo(e))])));
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const onKey = (x: KeyboardEvent) => x.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const addr = (e: EmailItem) => to[e.draft] ?? defaultTo(e);
  const ready = (e: EmailItem) => validAddress(addr(e));
  const chosen = unsent.filter((e) => sel[e.draft] && ready(e));
  const needAddress = unsent.filter((e) => !ready(e));
  const connected = !!gmail?.connected;
  const send = async () => {
    setSending(true);
    setErr(null);
    const error = await onSend(chosen.map((e) => ({ draft: e.draft, to: addr(e) })), chosen.some((e) => e.earlier));
    setSending(false);
    if (error) setErr(error);
    else onClose();
  };
  return (
    <>
      <div className="scrim mail-scrim" aria-hidden="true" onClick={onClose} />
      <aside className="drawer side mail-review" role="dialog" aria-label="Candidate emails">
        <div className="drawer-h">
          <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 className="h2" style={{ fontSize: 20 }}>
              Candidate emails
            </h2>
            <span className="meta">
              {`${job} · ${unsent.length} draft${unsent.length === 1 ? "" : "s"} by MeritAI`}
              {gmail?.email ? ` · from ${gmail.email}` : ""}
            </span>
          </div>
          <button type="button" className="ib" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {!connected ? (
          <div className="banner info mail-banner">
            <Icon name="mail" size={18} />
            <span className="grow">
              <b>Connect Gmail to send these from MeritAI.</b> Or open each draft in your email app from the Outbox.
            </span>
            <button type="button" className="btn p sm" onClick={onConnect}>
              Connect Gmail
            </button>
          </div>
        ) : (
          gmail?.testMode && (
            <div className="banner warn mail-banner">
              <Icon name="alert" size={18} />
              <span className="grow">
                <b>Test mode:</b> {`all of these go to ${gmail.email}, not to the candidates.`}{" "}
                <button type="button" className="link-btn" onClick={onConnect}>
                  Change it in Connections
                </button>
              </span>
            </div>
          )
        )}
        <div className="drawer-b mail-list">
          {GROUPS.map(([kind, label]) => {
            const list = unsent.filter((e) => e.kind === kind);
            if (!list.length) return null;
            return (
              <section key={kind} className="mail-group">
                <div className="mail-group-h">
                  <h3 className="cap">{label}</h3>
                  <span className="meta">{list.length}</span>
                </div>
                {list.map((e) => {
                  const isOpen = open === e.draft;
                  const warn = !ready(e) || !!e.earlier;
                  return (
                    <div key={e.draft} className={`mail-item${warn ? " warn" : ""}`}>
                      <div className="mail-item-h">
                        <Check on={!!sel[e.draft] && ready(e)} disabled={!ready(e)} label={`Send to ${e.candidate?.name ?? e.draft}`} onClick={() => setSel({ ...sel, [e.draft]: !sel[e.draft] })} />
                        <b className="mail-name">{e.candidate?.name ?? e.draft}</b>
                        <span className="mail-mid">
                          <AddressField e={e} value={addr(e)} onChange={(v) => (setTo({ ...to, [e.draft]: v }), setSel({ ...sel, [e.draft]: validAddress(v) }))} />
                          <span className="meta ellipsis">{e.subject}</span>
                          {e.earlier && <span className="mail-warn">{`Already sent this kind of email on ${fmtDay(localDay(e.earlier.at))}: tick to send again`}</span>}
                        </span>
                        <button type="button" className="ib" aria-expanded={isOpen} aria-label={isOpen ? "Hide the email" : "Show the email"} onClick={() => setOpen(isOpen ? null : e.draft)}>
                          <Icon name={isOpen ? "up" : "down"} size={16} stroke={2} />
                        </button>
                      </div>
                      {isOpen && <DraftText api={api} e={e} onSaved={onChanged} />}
                    </div>
                  );
                })}
              </section>
            );
          })}
          {sent.length > 0 && (
            <section className="mail-group">
              <div className="mail-group-h">
                <h3 className="cap">Sent</h3>
                <span className="meta">{sent.length}</span>
              </div>
              {sent.map((e) => (
                <div key={e.draft} className="mail-item sent">
                  <div className="mail-item-h">
                    <Icon name="check" size={16} stroke={2.4} />
                    <b className="mail-name">{e.candidate?.name ?? e.draft}</b>
                    <span className="mail-mid">
                      <span className="mono mail-to">{e.sentTo}</span>
                      <span className="meta ellipsis">{e.subject}</span>
                    </span>
                    <span className="pill ok">{`Emailed ${fmtDay(localDay(e.sentAt!))}${e.test ? " · test" : ""}`}</span>
                  </div>
                </div>
              ))}
            </section>
          )}
          {!items.length && <p className="meta">No drafts for this job yet.</p>}
        </div>
        {err && (
          <div className="banner bad" style={{ margin: "0 22px 8px" }}>
            {err}
          </div>
        )}
        <div className="drawer-f" style={{ gap: 10 }}>
          <span className="grow" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <b style={{ fontSize: 14 }}>{`${chosen.length} of ${unsent.length} selected`}</b>
            <span className="meta">
              {needAddress.length ? `${needAddress.map((e) => e.candidate?.name ?? e.draft).join(", ")} ${needAddress.length === 1 ? "needs" : "need"} an address first · ` : ""}
              you can undo for 10 seconds
            </span>
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn p" disabled={!connected || !chosen.length || sending} onClick={() => void send()}>
            <Icon name="send" size={16} />
            {`Send ${chosen.length} email${chosen.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </aside>
    </>
  );
}

const TITLE: Record<EmailItem["kind"], string> = { invite: "Interview invitation", not: "“Not this time” email", other: "Email" };

/** One email, in the candidate panel (design: EmailOne). */
export function CandidateEmail({ api, e, gmail, sending, onSend, onChanged, onConnect }: { api: Api; e: EmailItem; gmail: GmailState | null; sending: boolean; onSend: (to: string, again: boolean) => void; onChanged: () => void; onConnect: () => void }) {
  const [to, setTo] = useState(defaultTo(e));
  const [show, setShow] = useState(false);
  const connected = !!gmail?.connected;
  return (
    <section className="card mail-card" aria-label="Email">
      <div className="mail-card-h">
        <span className="chg-ic">
          <Icon name="mail" size={18} />
        </span>
        <div className="grow" style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <b style={{ fontSize: 15 }}>{TITLE[e.kind]}</b>
          <span className="meta">Drafted by MeritAI · in your Outbox</span>
        </div>
        {e.sentAt ? <span className="pill ok">{`Emailed ${fmtDay(localDay(e.sentAt))}`}</span> : sending ? <span className="pill info">Sending…</span> : <span className="pill info">Not sent</span>}
      </div>
      <div className="mail-row">
        <span className="meta">To</span>
        {e.sentAt ? <span className="mono mail-to">{e.sentTo}</span> : <AddressField e={e} value={to} onChange={setTo} />}
      </div>
      <div className="mail-row">
        <span className="meta">Subject</span>
        <span>{e.subject}</span>
      </div>
      {show ? (
        <DraftText api={api} e={e} onSaved={onChanged} />
      ) : (
        <div className="mail-row">
          <span className="meta">Message</span>
          <button type="button" className="link-btn mail-preview" onClick={() => setShow(true)}>
            {e.body.replace(/\s+/g, " ").trim().slice(0, 180)}…
          </button>
        </div>
      )}
      {!e.sentAt && !sending && (
        <>
          <div className="row-wrap" style={{ alignItems: "center" }}>
            {connected ? (
              <button type="button" className="btn p sm" disabled={!validAddress(to)} onClick={() => onSend(to, !!e.earlier)}>
                <Icon name="send" size={15} />
                Send from Gmail
              </button>
            ) : (
              <button type="button" className="btn sm" onClick={onConnect}>
                <Icon name="mail" size={15} />
                Connect Gmail to send from MeritAI
              </button>
            )}
            <button type="button" className="btn g sm" onClick={() => void api.call("openFile", { path: e.path })}>
              Open in email app
            </button>
          </div>
          {connected && (
            <span className="meta">
              {`From ${gmail!.email}`}
              {gmail!.testMode ? " · test mode: it goes to you" : ""}
              {" · undo for 10 seconds"}
              {e.earlier ? ` · already sent this kind on ${fmtDay(localDay(e.earlier.at))}` : ""}
            </span>
          )}
        </>
      )}
    </section>
  );
}
