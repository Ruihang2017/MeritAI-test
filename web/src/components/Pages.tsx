import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BusinessProfile } from "../../../src/business/profile";
import type { Preference, TaskNote } from "../../../src/memory/store";
import type { FileRow, Settings, WorkspaceFiles } from "../../../src/server/protocol";
import type { Api } from "../api";
import { fmtDate, fmtDatesIn } from "../format";
import { Icon } from "./Icon";

const isoDay = (iso: string) => iso.slice(0, 10);
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [load]);
  useEffect(() => void reload(), [reload]);
  return { data, error, reload };
}

function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="page-h">
      <div style={{ flexGrow: 1, display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
        <h1 className="h1">{title}</h1>
        {sub && <span className="sub ellipsis">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function LoadError({ what, error, retry }: { what: string; error: string; retry: () => void }) {
  return (
    <div className="banner bad" role="alert" style={{ alignItems: "center" }}>
      <span className="grow">
        <b>Couldn't load {what}.</b> {error} Your data is safe; nothing was changed.
      </span>
      <button type="button" className="btn sm" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Files

type Tab = "inbox" | "outbox" | "jobs" | "policies";

export function FilesPage({ api, onAsk }: { api: Api; onAsk: (text: string) => void }) {
  const load = useCallback(() => api.call("files"), [api]);
  const { data, error, reload } = useLoad<WorkspaceFiles>(load);
  const [tab, setTab] = useState<Tab>("inbox");
  const [msg, setMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const open = async (path: string, reveal = false) => {
    const r = await api.call(reveal ? "revealFile" : "openFile", { path }).catch((e: Error) => ({ ok: false as const, error: e.message }));
    if (!r.ok) setMsg(r.error);
  };
  const upload = async (files: File[]) => {
    if (!files.length) return;
    const payload = await Promise.all(files.map(async (f) => ({ name: f.name, base64: await toBase64(f) })));
    const out = await api.call("attach", { files: payload }).catch((e: Error) => [{ kind: "error" as const, path: "", message: e.message }]);
    const ok = out.filter((o) => o.kind === "attached").length;
    const bad = out.filter((o) => o.kind === "refused" || o.kind === "error");
    setMsg(`${ok} file${ok === 1 ? "" : "s"} added to the Inbox.${bad.length ? ` Not added: ${bad.map((b) => ("reason" in b ? `${b.path} (${b.reason})` : "message" in b ? b.message : b.path)).join("; ")}` : ""} They'll go with your next message.`);
    await reload();
  };

  const list: FileRow[] = data ? (tab === "inbox" ? data.inbox : tab === "outbox" ? data.outbox : tab === "policies" ? data.policies : []) : [];
  return (
    <main className="main" style={{ background: "#EEF2F7" }}>
      <PageHead title="Files" sub={data?.root}>
        {tab === "inbox" && (
          <>
            <input ref={input} type="file" multiple hidden onChange={(e) => (void upload([...(e.target.files ?? [])]), (e.target.value = ""))} />
            <button type="button" className="btn p" onClick={() => input.current?.click()}>
              <Icon name="attach" size={16} />
              Add files
            </button>
          </>
        )}
      </PageHead>
      <div className="staff-body">
        {error && <LoadError what="your files" error={error} retry={() => void reload()} />}
        <nav className="tabs" aria-label="Folders">
          {(
            [
              ["inbox", "Inbox", data?.inbox.length],
              ["outbox", "Outbox", data?.outbox.length],
              ["jobs", "Jobs", data?.jobs.length],
              ["policies", "Policies", data?.policies.length],
            ] as [Tab, string, number | undefined][]
          ).map(([k, label, n]) => (
            <button key={k} type="button" className={`tab${tab === k ? " on" : ""}`} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
              {label}
              {n !== undefined && <span className="meta" style={{ marginLeft: 6 }}>{n}</span>}
            </button>
          ))}
        </nav>
        {msg && (
          <div className="banner info" style={{ alignItems: "center" }}>
            <span className="grow">{msg}</span>
            <button type="button" className="ib" aria-label="Dismiss" style={{ width: 36, height: 36 }} onClick={() => setMsg(null)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {data && tab === "jobs" && (
          <div className="card" style={{ overflow: "hidden" }}>
            {data.jobs.length === 0 ? (
              <div className="empty-card" style={{ maxWidth: "none" }}>
                <b>No jobs yet</b>
                <span className="meta">Drop a folder of applications into a conversation, or create a job on the Hiring page.</span>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 16 }}>Job</th>
                    <th>Files</th>
                    <th>Criteria</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => (
                    <tr key={j.job}>
                      <td className="b" style={{ paddingLeft: 16 }}>
                        {j.job}
                      </td>
                      <td>{j.files}</td>
                      <td>{j.criteria}</td>
                      <td style={{ textAlign: "right", paddingRight: 12 }}>
                        <button type="button" className="btn sm" onClick={() => void open(j.path, false)}>
                          Open folder
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {data && tab !== "jobs" && (
          <div className="card" style={{ overflow: "hidden" }}>
            {list.length === 0 ? (
              <div className="empty-card dots" style={{ maxWidth: "none" }}>
                <b>{tab === "inbox" ? "Nothing in your Inbox" : tab === "outbox" ? "Nothing saved yet" : "No policies yet"}</b>
                <span className="meta">
                  {tab === "inbox"
                    ? "Drop resumes, letters or policies here or into a conversation. The adviser reads them when you ask."
                    : tab === "outbox"
                      ? "Letters and reports the adviser saves for you appear here. Drafts start with a DRAFT line to check before sending."
                      : "Add your policies (Word, PDF or text) to the Policies folder; the adviser reads them when they're relevant."}
                </span>
                {tab === "inbox" && (
                  <button type="button" className="btn p" onClick={() => input.current?.click()}>
                    Choose files
                  </button>
                )}
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 16 }}>Name</th>
                    <th>Modified</th>
                    <th>Size</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((f) => (
                    <tr key={f.path}>
                      <td className="b" style={{ paddingLeft: 16 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                          <FileBadge name={f.name} />
                          <span>
                            {"title" in f && (f as FileRow & { title: string }).title !== f.name ? (f as FileRow & { title: string }).title : f.name}
                            {!f.readable && <span className="pill warn" style={{ marginLeft: 8 }}>Can't be read</span>}
                            {"description" in f && (f as FileRow & { description: string }).description && (
                              <span className="meta" style={{ display: "block", fontWeight: 400 }}>
                                {(f as FileRow & { description: string }).description}
                              </span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td>{fmtDate(isoDay(f.modified))}</td>
                      <td>{kb(f.size)}</td>
                      <td style={{ textAlign: "right", paddingRight: 12, whiteSpace: "nowrap" }}>
                        <button type="button" className="btn sm" onClick={() => void open(f.path)}>
                          Open
                        </button>{" "}
                        <button type="button" className="btn g sm" onClick={() => void open(f.path, true)}>
                          Show in folder
                        </button>
                        {tab === "inbox" && f.readable && (
                          <button type="button" className="btn g sm" onClick={() => onAsk(`Please read "${f.name}" in my Inbox and tell me what I need to do.`)}>
                            Ask about it
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        <div className="meta">
          {tab === "inbox"
            ? "Dropped files are copied here. Dropping the same file again reuses it; nothing is overwritten."
            : tab === "outbox"
              ? "The adviser saves only when you ask, and never overwrites a file."
              : tab === "policies"
                ? "Your business's own policies. The adviser uses them together with the law; the law wins where they differ."
                : "Each job folder holds its job description and applications."}
        </div>
      </div>
    </main>
  );
}

function FileBadge({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const [label, bg, fg] = ext === "docx" || ext === "doc" ? ["DOC", "#DCE6FA", "#1446A6"] : ext === "xlsx" || ext === "xls" ? ["XLS", "#E3F3E8", "#1E6B3E"] : ext === "pdf" ? ["PDF", "#FCE8E6", "#7A1C15"] : ["md", "txt"].includes(ext) ? ["TXT", "#EBEEF3", "#4A5363"] : ["IMG", "#EBEEF3", "#4A5363"];
  return (
    <span style={{ width: 36, height: 36, borderRadius: 8, background: bg, color: fg, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-hidden="true">
      {label}
    </span>
  );
}

function toBase64(f: File): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => fail(new Error(`Couldn't read ${f.name}`));
    r.readAsDataURL(f);
  });
}

// ------------------------------------------------------------------ Profile and policies

const STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];
const ADVISER: Record<string, string> = { "hr-adviser": "HR adviser", "employment-lawyer": "Employment lawyer", "employer-association": "Employer association", accountant: "Accountant", none: "None" };

export function ProfilePage({ api, onAsk, onChanged }: { api: Api; onAsk: (text: string) => void; onChanged: () => void }) {
  const load = useCallback(() => api.call("profile"), [api]);
  const { data, error, reload } = useLoad(load);
  const [editing, setEditing] = useState(false);
  const [receipt, setReceipt] = useState<string[] | null>(null);
  const p = data?.profile;
  const rows: [string, React.ReactNode][] = p
    ? [
        ["Legal name", p.legalName],
        ["Trading name", p.tradingName],
        ["ABN", p.abn],
        ["What the business does", p.industry],
        ["States where staff work", p.states.join(", ")],
        ["Business address", p.address],
        ["Number of employees", p.headcount === null ? null : `${p.headcount}${data?.smallBusiness ? " (a small business employer: fewer than 15)" : ""}`],
        ["Employment types", p.employmentTypes.join(", ")],
        ["Awards", p.awards.join(", ")],
        ["Pay frequency", p.payFrequency],
        ["Payroll system", p.payrollSystem],
        ["Benefits and own rules", p.benefitsAndRules.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{p.benefitsAndRules.map((b) => <li key={b}>{b}</li>)}</ul> : null],
        ["Signs letters and contracts", p.signer],
        ["HR / legal adviser", p.adviser ? `${ADVISER[p.adviser.kind] ?? p.adviser.kind}${p.adviser.name ? `: ${p.adviser.name}` : ""}${p.adviser.contact ? ` (${p.adviser.contact})` : ""}` : null],
        ["Employee Assistance Program", p.hasEap === null ? null : p.hasEap ? "Yes" : "No"],
        ["Other notes", p.notes],
      ]
    : [];
  return (
    <main className="main" style={{ background: "#EEF2F7" }}>
      <PageHead title="Profile & policies" sub="The adviser uses these in every answer">
        {data?.exists === false && (
          <button type="button" className="btn" onClick={() => onAsk("/setup")}>
            Set up with the adviser
          </button>
        )}
        <button type="button" className="btn p" onClick={() => (setEditing(true), setReceipt(null))}>
          {data?.exists ? "Edit profile" : "Fill in the form"}
        </button>
      </PageHead>
      <div className="staff-body">
        {error && <LoadError what="your business profile" error={error} retry={() => void reload()} />}
        {receipt && (
          <div className="receipt" style={{ alignItems: "flex-start" }}>
            <Icon name="check" size={18} stroke={2.2} />
            <span>
              <b>Saved to the business profile</b>
              <br />
              {receipt.join(" · ")}
            </span>
          </div>
        )}
        {data && !data.exists && (
          <div className="banner info">
            <span>
              <b>Tell MeritAI about your business.</b> Its name, state, staff and payroll. The adviser uses it in every answer. About 5 minutes with the adviser, or fill in the form yourself.
            </span>
          </div>
        )}
        {p && (
          <div className="two-col">
            <section className="card" style={{ padding: "8px 20px 12px" }}>
              <h2 className="h2" style={{ padding: "10px 0" }}>
                Business profile
              </h2>
              <dl className="dl">
                {rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v || <span className="meta">Not set</span>}</dd>
                  </div>
                ))}
              </dl>
              {p.updatedAt && <p className="meta">Last changed {fmtDate(isoDay(p.updatedAt))}</p>}
            </section>
            <section className="card" style={{ padding: "8px 20px 12px", alignSelf: "start" }}>
              <h2 className="h2" style={{ padding: "10px 0" }}>
                Policies
              </h2>
              {data.policies.length === 0 ? (
                <p className="meta">No policies yet. Put them in the Policies folder (Files page).</p>
              ) : (
                <ul className="docs">
                  {data.policies.map((x) => (
                    <li key={x.id}>
                      <Icon name="file" size={16} />
                      <span className="grow">
                        {x.title}
                        {x.description && (
                          <span className="meta" style={{ display: "block" }}>
                            {x.description}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="meta">Where a policy and the law differ, the adviser follows the law and says so.</p>
            </section>
          </div>
        )}
      </div>
      {editing && p && (
        <ProfileForm
          api={api}
          p={p}
          onClose={() => setEditing(false)}
          onSaved={(lines) => {
            setEditing(false);
            setReceipt(lines.length ? lines : ["No changes"]);
            void reload();
            onChanged();
          }}
        />
      )}
    </main>
  );
}

function ProfileForm({ api, p, onClose, onSaved }: { api: Api; p: BusinessProfile; onClose: () => void; onSaved: (lines: string[]) => void }) {
  const [f, setF] = useState({
    legalName: p.legalName ?? "",
    tradingName: p.tradingName ?? "",
    abn: p.abn ?? "",
    industry: p.industry ?? "",
    states: p.states,
    address: p.address ?? "",
    headcount: p.headcount === null ? "" : String(p.headcount),
    awards: p.awards.join(", "),
    payFrequency: p.payFrequency ?? "",
    payrollSystem: p.payrollSystem ?? "",
    benefits: p.benefitsAndRules.join("\n"),
    signer: p.signer ?? "",
    adviserKind: p.adviser?.kind ?? "",
    adviserName: p.adviser?.name ?? "",
    adviserContact: p.adviser?.contact ?? "",
    hasEap: p.hasEap === null ? "" : p.hasEap ? "yes" : "no",
    notes: p.notes ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nul = (s: string) => (s.trim() ? s.trim() : null);
    const list = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);
    const changes: Partial<BusinessProfile> = {
      legalName: nul(f.legalName),
      tradingName: nul(f.tradingName),
      abn: nul(f.abn),
      industry: nul(f.industry),
      states: f.states,
      address: nul(f.address),
      headcount: f.headcount.trim() ? Number(f.headcount) : null,
      awards: list(f.awards, /,/),
      payFrequency: (nul(f.payFrequency) as BusinessProfile["payFrequency"]) ?? null,
      payrollSystem: nul(f.payrollSystem),
      benefitsAndRules: list(f.benefits, /\n/),
      signer: nul(f.signer),
      adviser: f.adviserKind ? { kind: f.adviserKind as NonNullable<BusinessProfile["adviser"]>["kind"], name: nul(f.adviserName), contact: nul(f.adviserContact) } : null,
      hasEap: f.hasEap ? f.hasEap === "yes" : null,
      notes: nul(f.notes),
    };
    const res = await api.call("updateProfile", { changes }).catch((e2: Error) => ({ ok: false as const, error: e2.message }));
    if (res.ok) onSaved(res.lines);
    else setErr(res.error);
  };
  return (
    <>
      <div className="scrim fill" onClick={onClose} />
      <aside className="drawer side" style={{ width: 520 }} role="dialog" aria-modal="true" aria-label="Edit business profile">
        <div className="drawer-h">
          <div style={{ flexGrow: 1 }}>
            <h2 className="h2" style={{ fontSize: 20 }}>
              Edit business profile
            </h2>
            <div className="meta">Saving is your OK. Business details only.</div>
          </div>
          <button type="button" className="ib" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <form id="prof" className="form drawer-b" style={{ padding: "16px 22px" }} onSubmit={submit}>
          <div className="two">
            <label className="field">
              Legal name
              <input className="input" value={f.legalName} onChange={set("legalName")} />
            </label>
            <label className="field">
              Trading name
              <input className="input" value={f.tradingName} onChange={set("tradingName")} />
            </label>
          </div>
          <div className="two">
            <label className="field">
              ABN
              <input className="input" value={f.abn} onChange={set("abn")} />
            </label>
            <label className="field">
              Number of employees
              <input className="input" type="number" min={0} value={f.headcount} onChange={set("headcount")} />
            </label>
          </div>
          <label className="field">
            What the business does
            <input className="input" value={f.industry} onChange={set("industry")} />
          </label>
          <fieldset className="checks">
            <legend className="field" style={{ marginBottom: 6 }}>
              States where staff work
            </legend>
            <div className="row-wrap">
              {STATES.map((s) => (
                <label key={s} className="check" style={{ minWidth: 84 }}>
                  <input type="checkbox" checked={f.states.includes(s)} onChange={(e) => setF({ ...f, states: e.target.checked ? [...f.states, s] : f.states.filter((x) => x !== s) })} />
                  {s}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            Business address
            <input className="input" value={f.address} onChange={set("address")} />
          </label>
          <label className="field">
            Awards <span className="hint">comma separated, as you know them</span>
            <input className="input" value={f.awards} onChange={set("awards")} />
          </label>
          <div className="two">
            <label className="field">
              Pay frequency
              <select className="input" value={f.payFrequency} onChange={set("payFrequency")}>
                <option value="">Not set</option>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="field">
              Payroll system
              <input className="input" value={f.payrollSystem} onChange={set("payrollSystem")} />
            </label>
          </div>
          <label className="field">
            Benefits and own rules <span className="hint">one per line</span>
            <textarea className="input" rows={3} style={{ height: "auto", padding: 10 }} value={f.benefits} onChange={set("benefits")} />
          </label>
          <label className="field">
            Signs letters and contracts
            <input className="input" value={f.signer} onChange={set("signer")} placeholder="e.g. Jo Kim, Director" />
          </label>
          <div className="two">
            <label className="field">
              HR / legal adviser
              <select className="input" value={f.adviserKind} onChange={set("adviserKind")}>
                <option value="">Not set</option>
                {Object.entries(ADVISER).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Adviser's name
              <input className="input" value={f.adviserName} onChange={set("adviserName")} disabled={!f.adviserKind || f.adviserKind === "none"} />
            </label>
          </div>
          <div className="two">
            <label className="field">
              Adviser's contact
              <input className="input" value={f.adviserContact} onChange={set("adviserContact")} disabled={!f.adviserKind || f.adviserKind === "none"} />
            </label>
            <label className="field">
              Employee Assistance Program
              <select className="input" value={f.hasEap} onChange={set("hasEap")}>
                <option value="">Not set</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>
          <label className="field">
            Other notes
            <textarea className="input" rows={2} style={{ height: "auto", padding: 10 }} value={f.notes} onChange={set("notes")} />
          </label>
          {err && (
            <div className="banner bad" role="alert">
              {err}
            </div>
          )}
        </form>
        <div className="drawer-f">
          <button type="submit" form="prof" className="btn p lg">
            Save profile
          </button>
          <button type="button" className="btn lg" onClick={onClose}>
            Cancel
          </button>
        </div>
      </aside>
    </>
  );
}

// ------------------------------------------------------------------ Memory

export function MemoryPage({ api }: { api: Api }) {
  const load = useCallback(() => api.call("memories"), [api]);
  const { data, error, reload } = useLoad<{ preferences: Preference[]; notes: TaskNote[] }>(load);
  const [confirm, setConfirm] = useState<{ id: string; text: string } | null>(null);
  const forget = async (id: string) => {
    setConfirm(null);
    await api.call("forget", { id }).catch(() => null);
    await reload();
  };
  const Item = ({ id, text, meta }: { id: string; text: string; meta: string }) => (
    <li>
      <Icon name="memory" size={16} />
      <span className="grow">
        {text}
        <span className="meta" style={{ display: "block" }}>
          {meta}
        </span>
      </span>
      <button type="button" className="btn g sm danger-text" onClick={() => setConfirm({ id, text })}>
        Forget
      </button>
    </li>
  );
  return (
    <main className="main" style={{ background: "#EEF2F7" }}>
      <PageHead title="Memory" sub="What the adviser remembers about how you work" />
      <div className="staff-body">
        {error && <LoadError what="memory" error={error} retry={() => void reload()} />}
        {data && (
          <div className="two-col">
            <section className="card" style={{ padding: "8px 20px 12px" }}>
              <h2 className="h2" style={{ padding: "10px 0 4px" }}>
                Preferences
              </h2>
              <p className="meta" style={{ margin: "0 0 8px" }}>
                Kept until you forget them. The adviser asks before remembering anything.
              </p>
              {data.preferences.length === 0 ? (
                <p className="meta">Nothing remembered yet. Tell the adviser, e.g. "Remember that I sign letters as Jo Kim, Director".</p>
              ) : (
                <ul className="docs">
                  {data.preferences.map((x) => (
                    <Item key={x.id} id={x.id} text={x.text} meta={`${x.source === "explicit" ? "You asked" : "You agreed"} · ${fmtDate(isoDay(x.createdAt))}`} />
                  ))}
                </ul>
              )}
            </section>
            <section className="card" style={{ padding: "8px 20px 12px", alignSelf: "start" }}>
              <h2 className="h2" style={{ padding: "10px 0 4px" }}>
                Recent work notes
              </h2>
              <p className="meta" style={{ margin: "0 0 8px" }}>
                Short notes from past conversations, so the adviser can pick up where you left off. They expire after 30 days. Never personal details about staff or candidates.
              </p>
              {data.notes.length === 0 ? (
                <p className="meta">No notes yet.</p>
              ) : (
                <ul className="docs">
                  {data.notes.map((x) => (
                    <Item key={x.id} id={x.id} text={fmtDatesIn(x.text)} meta={`Expires ${fmtDate(isoDay(x.expiresAt))}`} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
      {confirm && (
        <>
          <div className="scrim fill" onClick={() => setConfirm(null)} />
          <div className="modal dialog" role="alertdialog" aria-modal="true" aria-label="Forget this">
            <h2 className="h2" style={{ fontSize: 19 }}>
              Forget this?
            </h2>
            <p className="items-plain" style={{ margin: 0 }}>
              {confirm.text}
            </p>
            <p className="meta" style={{ margin: 0 }}>
              The adviser won't use it in new conversations. This can't be undone.
            </p>
            <div className="row-wrap">
              <button type="button" className="btn d lg" onClick={() => void forget(confirm.id)}>
                Forget
              </button>
              <button type="button" className="btn lg" autoFocus onClick={() => setConfirm(null)}>
                Keep
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

// ------------------------------------------------------------------ Settings

export function SettingsPage({ api, onChanged, login }: { api: Api; onChanged: () => void; login: { url: string | null; code: string | null; message: string } | null }) {
  const load = useCallback(() => api.call("settings"), [api]);
  const { data, error, reload } = useLoad<Settings>(load);
  const [s, setS] = useState<Settings | null>(null);
  const [path, setPath] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [copied, setCopied] = useState(false);
  const cur = s ?? data;
  useEffect(() => {
    if (data) setPath(data.workspace);
  }, [data]);

  const tier = async (t: "fast" | "standard") => setS(await api.call("setTier", { tier: t }));
  const workspace = async (p: string | null) => {
    setErr(null);
    try {
      const r = await api.call("setWorkspace", { path: p });
      setS(r);
      setPath(r.workspace);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const signIn = async () => {
    setSigning(true);
    setErr(null);
    const r = await api.call("login").catch((e: Error) => ({ ok: false, error: e.message }));
    setSigning(false);
    if (!r.ok) setErr(`Sign-in didn't finish: ${r.error ?? "unknown error"}`);
    await reload();
    setS(null);
    onChanged();
  };

  return (
    <main className="main" style={{ background: "#EEF2F7" }}>
      <PageHead title="Settings" />
      <div className="staff-body">
        {error && <LoadError what="settings" error={error} retry={() => void reload()} />}
        {err && (
          <div className="banner bad" role="alert">
            {err}
          </div>
        )}
        {cur && (
          <div className="two-col">
            <section className="card set">
              <h2 className="h2">Account</h2>
              <p className="sub" style={{ margin: 0 }}>
                <span className="dot" style={{ display: "inline-block", color: cur.account.loggedIn ? "#2E9D5B" : "#B3261E", marginRight: 8 }} />
                {cur.account.description}
              </p>
              {cur.engine === "codex" && !cur.account.loggedIn && !signing && (
                <button type="button" className="btn p" style={{ alignSelf: "flex-start" }} onClick={() => void signIn()}>
                  Sign in with ChatGPT
                </button>
              )}
              {signing && (
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
                        <span className="mono code">{login.code ?? "—"}</span>
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
              <p className="meta" style={{ margin: 0 }}>
                Internal test: use sample data only while signed in to a personal account.
              </p>
            </section>
            <section className="card set">
              <h2 className="h2">Speed</h2>
              <div className="seg" role="radiogroup" aria-label="Speed">
                <button type="button" role="radio" aria-checked={cur.tier === "fast"} className={cur.tier === "fast" ? "on" : ""} onClick={() => void tier("fast")}>
                  Fast
                </button>
                <button type="button" role="radio" aria-checked={cur.tier === "standard"} className={cur.tier === "standard" ? "on" : ""} onClick={() => void tier("standard")}>
                  Standard
                </button>
              </div>
              <p className="meta" style={{ margin: 0 }}>
                Fast answers sooner and uses more of your ChatGPT plan's usage. Applies from the next message.
              </p>
            </section>
            <section className="card set" style={{ gridColumn: "1 / -1" }}>
              <h2 className="h2">Workspace folder</h2>
              <p className="meta" style={{ margin: 0 }}>
                One folder per business: Inbox, Outbox, Jobs and Policies, plus the business profile and staff register. {cur.workspaceIsDefault ? "This is the default folder." : "You chose this folder."}
              </p>
              <form
                className="row-wrap"
                style={{ alignItems: "center" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void workspace(path);
                }}
              >
                <label htmlFor="ws" className="sr">
                  Workspace folder
                </label>
                <input id="ws" className="input mono" style={{ flexGrow: 1, minWidth: 320, fontSize: 13 }} value={path} onChange={(e) => setPath(e.target.value)} />
                <button type="submit" className="btn" disabled={path === cur.workspace}>
                  Use this folder
                </button>
                {!cur.workspaceIsDefault && (
                  <button type="button" className="btn g" onClick={() => void workspace(null)}>
                    Reset to default
                  </button>
                )}
              </form>
            </section>
            <section className="card set" style={{ gridColumn: "1 / -1" }}>
              <h2 className="h2">About</h2>
              <dl className="dl">
                <div>
                  <dt>Engine</dt>
                  <dd>{cur.engine === "fake" ? "Demo engine (scripted replies, no model)" : "Codex app-server"}</dd>
                </div>
                <div>
                  <dt>Model (shown for testers)</dt>
                  <dd>{cur.model ?? "—"}</dd>
                </div>
                <div>
                  <dt>Privacy</dt>
                  <dd>Everything stays in the workspace folder on this computer, except what is sent to the model to answer you. The register refuses TFNs, bank details, dates of birth and health information.</dd>
                </div>
              </dl>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
