import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChecklistItem, FormNote, LeavingItem, LeavingReason } from "../../../src/app/app";
import type { DocumentId } from "../../../src/business/register";
import type { EmployeeFields, StaffRow } from "../../../src/server/protocol";
import type { Api } from "../api";
import { fmtDate, fmtDatesIn, fmtDay } from "../format";
import { Icon } from "./Icon";
import { todayIso } from "../clock";

const TYPES: EmployeeFields["employmentType"][] = ["full-time", "part-time", "casual", "fixed-term"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const today = todayIso;

type Panel =
  | { kind: "detail"; id: number }
  | { kind: "add"; prefill?: { name: string; role: string } }
  | { kind: "added"; name: string; lines: string[]; checklist: ChecklistItem[] }
  | { kind: "edit"; id: number }
  | { kind: "edited"; id: number; lines: string[]; notes: FormNote[] }
  | { kind: "docs"; id: number }
  | { kind: "left"; id: number }
  | { kind: "leftDone"; name: string; lines: string[]; checklist: LeavingItem[] }
  | null;

export function StaffPage({ api, openId, addPrefill, onAsk, onChanged }: { api: Api; openId?: number | null; addPrefill?: { name: string; role: string } | null; onAsk: (text: string) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  // Opened on someone (Attention's "Open employee"), or on the add form for a hire (Hiring's "Add to Staff").
  const [panel, setPanel] = useState<Panel>(openId ? { kind: "detail", id: openId } : addPrefill ? { kind: "add", prefill: addPrefill } : null);
  const [menu, setMenu] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // By name, as in the design (people who left after everyone else).
      const all = await api.call("staff", { includeLeft: true });
      setRows([...all].sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const changed = async () => {
    await load();
    onChanged();
  };

  const active = rows?.filter((r) => r.status === "active") ?? [];
  const left = rows?.filter((r) => r.status === "left") ?? [];
  const shown = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => showLeft || r.status === "active")
        .filter((r) => !type || r.employmentType === type)
        .filter((r) => !q || `${r.name} ${r.role}`.toLowerCase().includes(q.toLowerCase())),
    [rows, showLeft, type, q],
  );
  const byId = (id: number) => rows?.find((r) => r.id === id) ?? null;

  const remove = async (r: StaffRow) => {
    setMenu(null);
    setPanel(null);
    // The app asks the destructive question itself (shown as a dialog); a "no" keeps the record.
    const res = await api.call("removeEmployee", { id: r.id }).catch((e: Error) => ({ ok: false as const, error: e.message }));
    if (res.ok && res.removed) setToast(`${r.name} was deleted from the register.`);
    else if (!res.ok) setError(res.error);
    await changed();
  };

  return (
    <main className="main" style={{ background: "#EEF2F7" }}>
      <div className="page-h">
        <div style={{ flexGrow: 1, display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 className="h1">Staff</h1>
          <span className="sub">
            {rows ? `${active.length} active${left.length ? ` · ${left.length} left` : ""} · work details only` : ""}
          </span>
        </div>
        <button type="button" className="btn p" onClick={() => setPanel({ kind: "add" })}>
          <Icon name="plus" size={16} stroke={2} />
          Add employee
        </button>
      </div>

      <div className="staff-body">
        {error && (
          <div className="banner bad" role="alert" style={{ alignItems: "center" }}>
            <span className="grow">
              <b>Couldn't load your staff register.</b> {error} Your data is safe; nothing was changed.
            </span>
            <button type="button" className="btn sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}
        {rows === null && !error && <Skeleton />}
        {rows?.length === 0 && (
          <div className="center dots" style={{ borderRadius: 12 }}>
            <div className="card empty-card">
              <div className="empty-ic">
                <Icon name="staff" size={24} />
              </div>
              <b style={{ fontSize: 16 }}>Add your first employee</b>
              <span className="sub" style={{ lineHeight: 1.5 }}>
                MeritAI keeps track of probation, paperwork, contract ends and visas, and reminds you before they're due. Work details only.
              </span>
              <button type="button" className="btn p" onClick={() => setPanel({ kind: "add" })}>
                Add employee
              </button>
            </div>
          </div>
        )}
        {rows && rows.length > 0 && (
          <>
            <div className="filters">
              <label htmlFor="q" className="sr">
                Search staff
              </label>
              <div className="search">
                <Icon name="search" size={16} />
                <input id="q" className="input" placeholder="Search by name or role" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <label htmlFor="type" className="sr">
                Employment type
              </label>
              <select id="type" className="input" style={{ width: 180 }} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All types</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {cap(t)}
                  </option>
                ))}
              </select>
              <span className="grow" />
              <label className="check">
                <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
                Show people who have left{left.length ? ` (${left.length})` : ""}
              </label>
            </div>
            <div className="card" style={{ overflow: "visible" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 16 }}>Name</th>
                    <th>Role</th>
                    <th>Type</th>
                    <th>Started</th>
                    <th>Next date</th>
                    <th>Starting documents</th>
                    <th style={{ width: 48 }}>
                      <span className="sr">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const missing = r.status === "active" ? r.documentsExpected.filter((d) => !d.recorded).length : 0;
                    const sel = panel && "id" in panel && panel.id === r.id;
                    return (
                      <tr key={r.id} className={`${sel ? "sel" : ""}${r.status === "left" ? " left" : ""}`}>
                        <td className="b" style={{ paddingLeft: 16 }}>
                          <button type="button" className="name-btn" onClick={() => setPanel({ kind: "detail", id: r.id })}>
                            {r.name}
                          </button>
                          {r.status === "left" && <span className="pill n" style={{ marginLeft: 8 }}>Left</span>}
                        </td>
                        <td>{r.role}</td>
                        <td>{cap(r.employmentType)}</td>
                        <td>{fmtDay(r.startDate, { year: true })}</td>
                        <td className={`next ${r.next?.tone ?? "n"}`}>{r.next ? fmtDatesIn(r.next.text) : "—"}</td>
                        <td>
                          {r.status === "left" ? (
                            <span className="meta">—</span>
                          ) : missing ? (
                            <span className="pill bad">
                              <span className="dot" />
                              {missing} not recorded
                            </span>
                          ) : (
                            <span className="pill ok">
                              <span className="dot" />
                              All recorded
                            </span>
                          )}
                        </td>
                        <td style={{ position: "relative" }}>
                          <button
                            type="button"
                            className="ib"
                            style={{ width: 36, height: 36 }}
                            aria-label={`Actions for ${r.name}`}
                            aria-haspopup="menu"
                            aria-expanded={menu === r.id}
                            onClick={(e) => (e.stopPropagation(), setMenu(menu === r.id ? null : r.id))}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <circle cx="5" cy="12" r="1.8" />
                              <circle cx="12" cy="12" r="1.8" />
                              <circle cx="19" cy="12" r="1.8" />
                            </svg>
                          </button>
                          {menu === r.id && (
                            <div className="menu row-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                              <button type="button" role="menuitem" className="menu-item row" onClick={() => (setMenu(null), setPanel({ kind: "detail", id: r.id }))}>
                                View details
                              </button>
                              {r.status === "active" && (
                                <>
                                  <button type="button" role="menuitem" className="menu-item row" onClick={() => (setMenu(null), setPanel({ kind: "edit", id: r.id }))}>
                                    Edit details
                                  </button>
                                  <button type="button" role="menuitem" className="menu-item row" onClick={() => (setMenu(null), setPanel({ kind: "docs", id: r.id }))}>
                                    Record documents
                                  </button>
                                  <button type="button" role="menuitem" className="menu-item row" onClick={() => (setMenu(null), onAsk(`I have a question about ${r.name} (${r.role}).`))}>
                                    Ask the adviser
                                  </button>
                                  <div role="separator" className="menu-sep" />
                                  <button type="button" role="menuitem" className="menu-item row" onClick={() => (setMenu(null), setPanel({ kind: "left", id: r.id }))}>
                                    Mark as left
                                  </button>
                                </>
                              )}
                              <div role="separator" className="menu-sep" />
                              <button type="button" role="menuitem" className="menu-item row danger" onClick={() => void remove(r)}>
                                Delete from register
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", height: 80 }}>
                        No one matches. <button type="button" className="link-btn" onClick={() => (setQ(""), setType(""))}>Clear the filters</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="meta" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="shield" size={16} />
              The register holds work details only. TFNs, bank details, dates of birth, home addresses and health information are refused.
            </div>
          </>
        )}
      </div>

      {panel?.kind === "detail" && byId(panel.id) && (
        <Detail
          r={byId(panel.id)!}
          onClose={() => setPanel(null)}
          onEdit={() => setPanel({ kind: "edit", id: panel.id })}
          onDocs={() => setPanel({ kind: "docs", id: panel.id })}
          onLeft={() => setPanel({ kind: "left", id: panel.id })}
          onDelete={() => void remove(byId(panel.id)!)}
          onAsk={() => onAsk(`I have a question about ${byId(panel.id)!.name} (${byId(panel.id)!.role}).`)}
        />
      )}
      {panel?.kind === "add" && (
        <EmployeeForm
          api={api}
          prefill={panel.prefill}
          onClose={() => setPanel(null)}
          onSaved={(res) => {
            setPanel({ kind: "added", ...res });
            void changed();
          }}
        />
      )}
      {panel?.kind === "added" && <Added name={panel.name} lines={panel.lines} checklist={panel.checklist} onClose={() => setPanel(null)} />}
      {panel?.kind === "edit" && byId(panel.id) && (
        <EmployeeForm
          api={api}
          current={byId(panel.id)!}
          onClose={() => setPanel({ kind: "detail", id: panel.id })}
          onSaved={(res) => {
            setPanel({ kind: "edited", id: panel.id, lines: res.lines, notes: res.notes ?? [] });
            void changed();
          }}
        />
      )}
      {panel?.kind === "edited" && byId(panel.id) && (
        <Detail
          r={byId(panel.id)!}
          receipt={{ lines: panel.lines, notes: panel.notes }}
          onClose={() => setPanel(null)}
          onEdit={() => setPanel({ kind: "edit", id: panel.id })}
          onDocs={() => setPanel({ kind: "docs", id: panel.id })}
          onLeft={() => setPanel({ kind: "left", id: panel.id })}
          onDelete={() => void remove(byId(panel.id)!)}
          onAsk={() => onAsk(`I have a question about ${byId(panel.id)!.name}.`)}
        />
      )}
      {panel?.kind === "docs" && byId(panel.id) && (
        <DocsDialog
          api={api}
          r={byId(panel.id)!}
          onClose={() => setPanel({ kind: "detail", id: panel.id })}
          onSaved={(lines) => {
            setToast(`Recorded for ${byId(panel.id)!.name}: ${lines.join("; ")}`);
            setPanel({ kind: "detail", id: panel.id });
            void changed();
          }}
        />
      )}
      {panel?.kind === "left" && byId(panel.id) && (
        <LeftDialog
          api={api}
          r={byId(panel.id)!}
          onClose={() => setPanel({ kind: "detail", id: panel.id })}
          onSaved={(res) => {
            setPanel({ kind: "leftDone", name: byId(panel.id)!.name, lines: res.lines, checklist: res.checklist });
            void changed();
          }}
        />
      )}
      {panel?.kind === "leftDone" && <LeavingDone name={panel.name} lines={panel.lines} checklist={panel.checklist} onClose={() => setPanel(null)} onAsk={() => onAsk(`${panel.name} is leaving. Can you draft the letter confirming their last day?`)} />}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          <span className="grow">{fmtDatesIn(toast)}</span>
        </div>
      )}
    </main>
  );
}

function Skeleton() {
  return (
    <div className="card" aria-busy="true" aria-label="Loading staff">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="skel-row">
          <span style={{ width: 140 }} />
          <span style={{ width: 100 }} />
          <span style={{ width: 80 }} />
          <span style={{ width: 120 }} />
        </div>
      ))}
    </div>
  );
}

function Drawer({ title, sub, width = 440, onClose, children, footer, modal }: { title: string; sub?: React.ReactNode; width?: number; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; modal?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      {modal && <div className="scrim fill" onClick={onClose} />}
      <aside className="drawer side" style={{ width }} aria-label={title} role={modal ? "dialog" : undefined} aria-modal={modal || undefined}>
        <div className="drawer-h">
          <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 className="h2 ellipsis" style={{ fontSize: 20 }}>
              {title}
            </h2>
            {sub && <div className="meta">{sub}</div>}
          </div>
          <button type="button" className="ib" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-b" style={{ padding: "16px 22px", gap: 14 }}>
          {children}
        </div>
        {footer && <div className="drawer-f">{footer}</div>}
      </aside>
    </>
  );
}

function Detail({ r, receipt, onClose, onEdit, onDocs, onLeft, onDelete, onAsk }: { r: StaffRow; receipt?: { lines: string[]; notes: FormNote[] }; onClose: () => void; onEdit: () => void; onDocs: () => void; onLeft: () => void; onDelete: () => void; onAsk: () => void }) {
  const dates: [string, string | null][] = [
    ["Started", r.startDate],
    ["Probation ends", r.probationEnd],
    ["Contract ends", r.endDate],
    ["Visa or work rights expire", r.visaExpiry],
    ["Last day", r.leftDate],
  ];
  const missing = r.documentsExpected.filter((d) => !d.recorded);
  return (
    <Drawer
      title={r.name}
      sub={
        <>
          {r.role} · {cap(r.employmentType)}
          {r.status === "left" && " · left"}
        </>
      }
      onClose={onClose}
      footer={
        r.status === "active" ? (
          <>
            <button type="button" className="btn g sm" style={{ paddingLeft: 0 }} onClick={onLeft}>
              Mark as left
            </button>
            <button type="button" className="btn g sm" onClick={onAsk}>
              Ask the adviser
            </button>
            <span className="grow" />
            <button type="button" className="btn g sm danger-text" style={{ paddingRight: 0 }} onClick={onDelete}>
              Delete from register
            </button>
          </>
        ) : (
          <>
            <span className="grow" />
            <button type="button" className="btn g sm danger-text" onClick={onDelete}>
              Delete from register
            </button>
          </>
        )
      }
    >
      {receipt && (
        <div className="receipt" style={{ alignItems: "flex-start" }}>
          <Icon name="check" size={18} stroke={2.2} />
          <span>
            <b>Saved to the employee register</b>
            <br />
            {receipt.lines.map((l) => fmtDatesIn(l)).join(" · ")}
          </span>
        </div>
      )}
      {receipt?.notes.map((n, i) => (
        <div key={i} className="banner info">
          <span>
            {n.text}{" "}
            <a href={n.source.url} target="_blank" rel="noreferrer noopener">
              {n.source.title}
            </a>
          </span>
        </div>
      ))}
      {r.next && r.status === "active" && (
        <div className={`banner ${r.next.tone === "red" ? "bad" : r.next.tone === "amber" ? "warn" : "n"}`}>
          <span>
            <b>Next:</b> {fmtDatesIn(r.next.text)} ({r.next.tone === "red" ? "overdue" : `by ${fmtDate(r.next.due)}`})
          </span>
        </div>
      )}
      <section>
        <h3 className="cap" style={{ margin: "0 0 6px" }}>
          Work details
        </h3>
        <dl className="dl">
          {dates
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{fmtDate(v!)}</dd>
              </div>
            ))}
          {r.award && (
            <div>
              <dt>Award</dt>
              <dd>
                {r.award}
                {r.classification ? `, ${r.classification}` : ""}
              </dd>
            </div>
          )}
          {r.notes && (
            <div>
              <dt>Notes</dt>
              <dd>{r.notes}</dd>
            </div>
          )}
        </dl>
      </section>
      <section>
        <h3 className="cap" style={{ margin: "0 0 6px" }}>
          Starting documents
        </h3>
        <ul className="docs">
          {r.documentsExpected.map((d) => (
            <li key={d.id}>
              {d.recorded ? <Icon name="check" size={16} stroke={2.2} className="ok-ic" /> : <span className="todo-ic" aria-hidden="true" />}
              <span className="grow">
                {d.label}
                <span className="meta" style={{ display: "block" }}>
                  {d.recorded ? `Recorded ${fmtDate(d.recorded)}` : `Not recorded yet · due ${d.timing}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      {r.status === "active" && (
        <div className="row-wrap">
          {missing.length > 0 && (
            <button type="button" className="btn p" onClick={onDocs}>
              Record documents
            </button>
          )}
          <button type="button" className="btn" onClick={onEdit}>
            Edit details
          </button>
        </div>
      )}
    </Drawer>
  );
}

function EmployeeForm({ api, current, prefill, onClose, onSaved }: { api: Api; current?: StaffRow; prefill?: { name: string; role: string }; onClose: () => void; onSaved: (r: { name: string; lines: string[]; checklist: ChecklistItem[]; notes?: FormNote[] }) => void }) {
  const [f, setF] = useState<EmployeeFields>(
    current
      ? { name: current.name, role: current.role, employmentType: current.employmentType as EmployeeFields["employmentType"], startDate: current.startDate, endDate: current.endDate, award: current.award, classification: current.classification, probationEnd: current.probationEnd, visaExpiry: current.visaExpiry, notes: current.notes }
      : { name: prefill?.name ?? "", role: prefill?.role ?? "", employmentType: "full-time", startDate: today() },
  );
  const [citizen, setCitizen] = useState(false);
  const [apprentice, setApprentice] = useState(false);
  const [site, setSite] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof EmployeeFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value || null });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      if (current) {
        // Only what changed goes to the app (it shows "old → new" for each).
        const changes: Partial<EmployeeFields> = {};
        for (const k of Object.keys(f) as (keyof EmployeeFields)[]) if ((f[k] ?? null) !== ((current as unknown as Record<string, unknown>)[k] ?? null)) (changes as Record<string, unknown>)[k] = f[k] ?? null;
        if (!Object.keys(changes).length) {
          onClose();
          return;
        }
        const res = await api.call("updateEmployee", { id: current.id, changes });
        if (!res.ok) setErr(res.error);
        else onSaved({ name: res.employee.name, lines: res.lines, checklist: [], notes: res.notes });
      } else {
        const details = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== "")) as unknown as EmployeeFields;
        const res = await api.call("addEmployee", { details, mayNeedVisaCheck: !citizen, apprentice, constructionSite: site });
        if (!res.ok) setErr(res.error);
        else onSaved({ name: res.employee.name, lines: res.lines, checklist: res.checklist });
      }
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer title={current ? `Edit ${current.name}` : "Add employee"} sub="Work details only. Saving is your OK: nothing else is asked." width={480} onClose={onClose} modal>
      <form id="emp" className="form" onSubmit={submit}>
        <label className="field">
          Full name
          <input className="input" required value={f.name} onChange={set("name")} autoFocus />
        </label>
        <label className="field">
          Role
          <input className="input" required value={f.role} onChange={set("role")} placeholder="e.g. Cleaner" />
        </label>
        <div className="two">
          <label className="field">
            Employment type
            <select className="input" value={f.employmentType} onChange={set("employmentType")}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {cap(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Start date
            <input className="input" type="date" required value={f.startDate} onChange={set("startDate")} />
          </label>
        </div>
        {f.employmentType === "fixed-term" && (
          <label className="field">
            Contract end date
            <input className="input" type="date" value={f.endDate ?? ""} onChange={set("endDate")} />
            <span className="hint">Fixed-term contracts have limits on length and renewals; MeritAI checks them when you change this.</span>
          </label>
        )}
        <div className="two">
          <label className="field">
            Award <span className="hint">optional</span>
            <input className="input" value={f.award ?? ""} onChange={set("award")} placeholder="e.g. Cleaning Services Award" />
          </label>
          <label className="field">
            Level <span className="hint">optional</span>
            <input className="input" value={f.classification ?? ""} onChange={set("classification")} />
          </label>
        </div>
        <div className="two">
          <label className="field">
            Probation ends <span className="hint">optional</span>
            <input className="input" type="date" value={f.probationEnd ?? ""} onChange={set("probationEnd")} />
          </label>
          <label className="field">
            Visa or work rights expire <span className="hint">if on a visa</span>
            <input className="input" type="date" value={f.visaExpiry ?? ""} onChange={set("visaExpiry")} />
          </label>
        </div>
        {!current && (
          <fieldset className="checks">
            <legend className="sr">About this person</legend>
            <label className="check">
              <input type="checkbox" checked={citizen} onChange={(e) => setCitizen(e.target.checked)} />
              Australian citizen or permanent resident (no visa check needed)
            </label>
            <label className="check">
              <input type="checkbox" checked={apprentice} onChange={(e) => setApprentice(e.target.checked)} />
              Apprentice or trainee
            </label>
            <label className="check">
              <input type="checkbox" checked={site} onChange={(e) => setSite(e.target.checked)} />
              Will work on construction sites
            </label>
          </fieldset>
        )}
        <label className="field">
          Notes <span className="hint">work-related only; no health, family or personal details</span>
          <textarea className="input" rows={2} style={{ height: "auto", padding: 10 }} value={f.notes ?? ""} onChange={set("notes")} />
        </label>
        {err && (
          <div className="banner bad" role="alert">
            <span>{err}</span>
          </div>
        )}
      </form>
      <div className="row-wrap" style={{ marginTop: "auto" }}>
        <button type="submit" form="emp" className="btn p lg" disabled={saving}>
          {saving ? "Saving…" : current ? "Save changes" : "Add employee"}
        </button>
        <button type="button" className="btn lg" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Drawer>
  );
}

const WHEN: Record<string, string> = { "before start": "Before they start", "on or before day one": "On or before day one", "first weeks": "In the first weeks", ongoing: "Ongoing", "before the last day": "Before the last day", "final pay": "Final pay", "after they leave": "After they leave" };

function Checklist({ items }: { items: (ChecklistItem | LeavingItem)[] }) {
  const groups = [...new Set(items.map((i) => i.when))];
  return (
    <>
      {groups.map((g) => (
        <section key={g}>
          <h3 className="cap" style={{ margin: "4px 0 6px" }}>
            {WHEN[g] ?? g}
          </h3>
          <ul className="checklist">
            {items
              .filter((i) => i.when === g)
              .map((i, k) => (
                <li key={k}>
                  <span className="todo-ic" aria-hidden="true" />
                  <span>
                    {fmtDatesIn(i.task)}
                    <span className="meta" style={{ display: "block" }}>
                      {i.why}{" "}
                      <a href={i.source.url} target="_blank" rel="noreferrer noopener">
                        {i.source.title}
                      </a>
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Added({ name, lines, checklist, onClose }: { name: string; lines: string[]; checklist: ChecklistItem[]; onClose: () => void }) {
  return (
    <Drawer title={`${name} added`} sub="New starter checklist, from official sources" width={480} onClose={onClose}>
      <div className="receipt" style={{ alignItems: "flex-start" }}>
        <Icon name="check" size={18} stroke={2.2} />
        <span>
          <b>Saved to the employee register</b>
          <br />
          {lines.map((l) => fmtDatesIn(l)).join(" · ")}
        </span>
      </div>
      <Checklist items={checklist} />
    </Drawer>
  );
}

function LeavingDone({ name, lines, checklist, onClose, onAsk }: { name: string; lines: string[]; checklist: LeavingItem[]; onClose: () => void; onAsk: () => void }) {
  return (
    <Drawer title={`${name} marked as left`} sub="Leaving checklist, from official sources" width={480} onClose={onClose} footer={<button type="button" className="btn p" onClick={onAsk}>Draft the letter with the adviser</button>}>
      <div className="receipt" style={{ alignItems: "flex-start" }}>
        <Icon name="check" size={18} stroke={2.2} />
        <span>
          <b>Saved to the employee register</b>
          <br />
          {lines.map((l) => fmtDatesIn(l)).join(" · ")}
        </span>
      </div>
      <Checklist items={checklist} />
    </Drawer>
  );
}

function Modal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: React.ReactNode; actions: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim fill" onClick={onClose} />
      <div className="modal dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="h2" style={{ fontSize: 19 }}>
          {title}
        </h2>
        {children}
        <div className="row-wrap">{actions}</div>
      </div>
    </>
  );
}

function DocsDialog({ api, r, onClose, onSaved }: { api: Api; r: StaffRow; onClose: () => void; onSaved: (lines: string[]) => void }) {
  const missing = r.documentsExpected.filter((d) => !d.recorded);
  const [picked, setPicked] = useState<Set<DocumentId>>(new Set(missing.map((d) => d.id)));
  const [date, setDate] = useState(today());
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const res = await api.call("recordDocuments", { id: r.id, documents: [...picked], date }).catch((e: Error) => ({ ok: false as const, error: e.message }));
    if (res.ok) onSaved(res.lines);
    else setErr(res.error);
  };
  return (
    <Modal
      title={`Record documents for ${r.name}`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn p lg" disabled={!picked.size} onClick={() => void save()}>
            Record {picked.size} document{picked.size === 1 ? "" : "s"}
          </button>
          <button type="button" className="btn lg" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="sub" style={{ margin: 0 }}>
        Tick what's done. This records that it happened; keep the documents themselves in your own files.
      </p>
      <div className="checks">
        {missing.map((d) => (
          <label key={d.id} className="check doc">
            <input type="checkbox" checked={picked.has(d.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} />
            <span>
              {d.label}
              <span className="meta" style={{ display: "block" }}>
                Due {d.timing}
              </span>
            </span>
          </label>
        ))}
      </div>
      <label className="field" style={{ maxWidth: 220 }}>
        Done on
        <input className="input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </label>
      {err && <div className="banner bad">{err}</div>}
    </Modal>
  );
}

const REASONS: { v: LeavingReason; label: string }[] = [
  { v: "resignation", label: "Resigned" },
  { v: "dismissal", label: "Dismissed" },
  { v: "redundancy", label: "Made redundant" },
  { v: "end of fixed-term contract", label: "Fixed-term contract ended" },
  { v: "other", label: "Other" },
];

function LeftDialog({ api, r, onClose, onSaved }: { api: Api; r: StaffRow; onClose: () => void; onSaved: (res: { lines: string[]; checklist: LeavingItem[] }) => void }) {
  const [date, setDate] = useState(r.endDate ?? today());
  const [reason, setReason] = useState<LeavingReason>(r.employmentType === "fixed-term" ? "end of fixed-term contract" : "resignation");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const res = await api.call("markLeft", { id: r.id, leftDate: date, reason }).catch((e: Error) => ({ ok: false as const, error: e.message }));
    if (res.ok) onSaved({ lines: res.lines, checklist: res.checklist });
    else setErr(res.error);
  };
  return (
    <Modal
      title={`Mark ${r.name} as left`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn p lg" onClick={() => void save()}>
            Mark as left
          </button>
          <button type="button" className="btn lg" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="sub" style={{ margin: 0 }}>
        Their record stays in the register (final pay and records obligations continue). You'll get the leaving checklist next.
      </p>
      <div className="two">
        <label className="field">
          Last day
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          Why they're leaving
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value as LeavingReason)}>
            {REASONS.map((x) => (
              <option key={x.v} value={x.v}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(reason === "dismissal" || reason === "redundancy") && (
        <div className="banner warn">
          <span>Dismissals and redundancies carry legal risk. The checklist starts with getting advice; ask the adviser before you act.</span>
        </div>
      )}
      {err && <div className="banner bad">{err}</div>}
    </Modal>
  );
}
