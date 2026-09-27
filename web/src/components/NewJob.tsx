import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
import type { IndustryId, JobTemplate } from "../../../src/business/jobTemplates";
import { jobDescription, searchTemplates } from "../../../src/business/jobTemplates";
import type { Api } from "../api";
import { Icon } from "./Icon";

/**
 * New job (design: NewJobPick, NewJobEdit; owner, 2026-09-27): start from a role template (by
 * industry, the business's own first), your own job description, or write one with MeritAI.
 * A template becomes a job description the owner edits here, then in Word; bracketed parts are theirs.
 */
type Tab = "template" | "own" | "adviser";
type Data = { industries: { id: IndustryId; name: string }[]; templates: JobTemplate[]; suggested: IndustryId[]; business: string | null; location: string | null };
const TYPES = ["full-time", "part-time", "casual", "fixed-term"] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function NewJobDialog({ api, existing, onClose, onCreated, onWriteJd, onTailor, ownForm }: { api: Api; existing: string[]; onClose: () => void; onCreated: (job: string, note: React.ReactNode) => void; onWriteJd: (name: string) => void; onTailor: (job: string) => void; ownForm: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("template");
  const [data, setData] = useState<Data | null>(null);
  const [picked, setPicked] = useState<JobTemplate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.call("jobTemplates").then(setData, (e: Error) => setErr(e.message));
  }, [api]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [role, setRole] = useState("");
  return (
    <>
      <div className="scrim fill" onClick={onClose} />
      <div className={`modal dialog newjob${picked && tab === "template" ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label="New job">
        <div className="newjob-h">
          {picked && tab === "template" && (
            <button type="button" className="btn g sm" style={{ paddingLeft: 0 }} onClick={() => setPicked(null)}>
              ‹ All roles
            </button>
          )}
          <div className="grow" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h2 className="h2" style={{ fontSize: 19 }}>
              {picked && tab === "template" ? `New job from the ${picked.title} template` : "New job"}
            </h2>
            <span className="meta">{picked && tab === "template" ? "Choose what fits; the job description on the right follows. You can edit it in Word afterwards." : "Start from a ready-made job description for the role, and make it yours."}</span>
          </div>
          <button type="button" className="ib" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {!(picked && tab === "template") && (
          <div className="seg" role="tablist" aria-label="How to start" style={{ alignSelf: "flex-start" }}>
            {(
              [
                ["template", "From a template"],
                ["own", "My own job description"],
                ["adviser", "Write it with MeritAI"],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
        )}
        {err && <div className="banner bad">{err}</div>}
        {tab === "template" && data && !picked && <Picker data={data} onPick={setPicked} onAdviser={() => setTab("adviser")} />}
        {tab === "template" && data && picked && <Editor api={api} data={data} t={picked} existing={existing} onCreated={onCreated} onTailor={onTailor} />}
        {tab === "template" && !data && !err && <div className="meta">Loading…</div>}
        {tab === "own" && ownForm}
        {tab === "adviser" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="sub" style={{ margin: 0 }}>
              Tell MeritAI about the job in the side panel: what the person will do, the hours, what they need. It drafts the job description with you and saves it into a new job when you're happy.
            </p>
            <label className="field" style={{ maxWidth: 420 }}>
              Role
              <input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Office administrator" autoFocus />
            </label>
            <div className="row-wrap">
              <button type="button" className="btn p lg" onClick={() => onWriteJd(role.trim())}>
                Write it with MeritAI
              </button>
              <button type="button" className="btn lg" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Picker({ data, onPick, onAdviser }: { data: Data; onPick: (t: JobTemplate) => void; onAdviser: () => void }) {
  const [q, setQ] = useState("");
  const [ind, setInd] = useState<IndustryId | null>(data.suggested[0] ?? null);
  // The business's industry first, then the rest.
  const industries = [...data.industries].sort((a, b) => Number(data.suggested.includes(b.id)) - Number(data.suggested.includes(a.id)));
  const list = q.trim() ? searchTemplates(q) : ind ? data.templates.filter((t) => t.industry === ind) : data.templates;
  return (
    <div className="newjob-pick">
      <div className="search" style={{ width: "100%" }}>
        <Icon name="search" size={16} />
        <label htmlFor="role-q" className="sr">
          Search roles
        </label>
        <input id="role-q" className="input" style={{ height: 44, fontSize: 15 }} placeholder="Search roles: barista, cleaner, receptionist, mechanic…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {!q.trim() && (
        <div className="row-wrap" style={{ gap: 6 }}>
          {industries.map((i) => (
            <button key={i.id} type="button" className={`fb-chip${ind === i.id ? " on" : ""}`} aria-pressed={ind === i.id} onClick={() => setInd(ind === i.id ? null : i.id)}>
              {i.name}
              {data.suggested.includes(i.id) && <span className="meta"> · your business</span>}
            </button>
          ))}
        </div>
      )}
      <div className="roles">
        {list.map((t) => (
          <button key={t.id} type="button" className="role-card" onClick={() => onPick(t)}>
            <b>{t.title}</b>
            <span className="sub">{t.summary}</span>
            <span className="row-wrap" style={{ gap: 6, alignItems: "center" }}>
              <span className="pill n" style={{ height: 22 }}>
                {t.types.map(cap).slice(0, 2).join(" · ")}
              </span>
              {t.award && <span className="meta">Likely: {t.award.name}</span>}
            </span>
          </button>
        ))}
        {!list.length && <div className="meta">No role called that yet. Try another word, or write it with MeritAI.</div>}
      </div>
      <div className="banner n" style={{ alignItems: "center", fontSize: 13.5 }}>
        <span className="grow">
          Can't find the role? <b>Write it with MeritAI</b>: tell it about the job and it drafts the description with you.
        </span>
        <button type="button" className="btn sm" onClick={onAdviser}>
          Write it with MeritAI
        </button>
      </div>
      <span className="meta">
        {data.templates.length} roles in {data.industries.length} industries. Each is a generic starting point: you check and edit it.
      </span>
    </div>
  );
}

function Editor({ api, data, t, existing, onCreated, onTailor }: { api: Api; data: Data; t: JobTemplate; existing: string[]; onCreated: (job: string, note: React.ReactNode) => void; onTailor: (job: string) => void }) {
  const [name, setName] = useState(t.title);
  const [openings, setOpenings] = useState("1");
  const [type, setType] = useState<string>(t.types[0] ?? "full-time");
  const [hours, setHours] = useState("");
  const [location, setLocation] = useState(data.location ?? "");
  const [pay, setPay] = useState("");
  const [duties, setDuties] = useState(t.duties.map((d) => ({ text: d, on: true })));
  const [extra, setExtra] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const exists = existing.some((j) => j.toLowerCase() === name.trim().toLowerCase());
  const md = useMemo(
    () => jobDescription(t, { jobName: name.trim() || t.title, business: data.business, employmentType: cap(type), hours, location, pay, start: "", duties: duties.filter((d) => d.on).map((d) => d.text), essential: t.essential, desirable: t.desirable }),
    [t, name, data.business, type, hours, location, pay, duties],
  );
  const create = async (tailor: boolean) => {
    setSaving(true);
    setErr(null);
    try {
      const r = await api.call("createJobFromText", { job: name.trim(), openings: Number(openings), jd: md });
      onCreated(r.job, <>Created “{r.job}” with its job description (“{r.job} JD.docx”, in the job's folder). Fill in the bracketed parts in Word, or ask MeritAI to tailor it. Then add the applications.</>);
      if (tailor) onTailor(r.job);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="newjob-edit">
        <form className="newjob-form" onSubmit={(e) => e.preventDefault()}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
            <label className="field">
              Job name
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              <span className="hint">{exists ? "There is already a job with this name." : `Folder: Jobs/${name.trim() || "…"}`}</span>
            </label>
            <label className="field">
              People to hire
              <input className="input" type="number" min={1} max={99} value={openings} onChange={(e) => setOpenings(e.target.value)} />
            </label>
          </div>
          <fieldset style={{ margin: 0, padding: 0, border: 0 }}>
            <legend className="field" style={{ padding: 0, marginBottom: 6 }}>
              Employment type
            </legend>
            <div className="seg" role="radiogroup" aria-label="Employment type">
              {TYPES.map((x) => (
                <button key={x} type="button" role="radio" aria-checked={type === x} className={type === x ? "on" : ""} onClick={() => setType(x)}>
                  {cap(x)}
                </button>
              ))}
            </div>
          </fieldset>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label className="field">
              Hours
              <input className="input" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. Sat and Sun, 6 am to 10 am" />
            </label>
            <label className="field">
              Location
              <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Suburb and state" />
            </label>
          </div>
          <label className="field">
            Pay <span className="hint">Leave empty to use the award rate; MeritAI never works out pay.</span>
            <input className="input" value={pay} onChange={(e) => setPay(e.target.value)} placeholder="Award rate for the level (check the Pay and Conditions Tool)" />
          </label>
          <div className="field" style={{ gap: 2 }}>
            What you'll do
            {duties.map((d, i) => (
              <label key={i} className="duty">
                <input type="checkbox" checked={d.on} onChange={(e) => setDuties(duties.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                <span style={{ color: d.on ? "#1B1F27" : "#5F6878", fontWeight: 400 }}>{d.text}</span>
              </label>
            ))}
            <span className="row-wrap" style={{ alignItems: "center", marginTop: 4 }}>
              <input className="input" style={{ flexGrow: 1, height: 36 }} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Add a duty" aria-label="Add a duty" />
              <button type="button" className="btn sm" disabled={!extra.trim()} onClick={() => (setDuties([...duties, { text: extra.trim(), on: true }]), setExtra(""))}>
                Add
              </button>
            </span>
          </div>
        </form>
        <section className="newjob-jd" aria-label="Job description">
          {t.award && (
            <div className="banner info" style={{ fontSize: 13, padding: "10px 12px" }}>
              <span>
                <b>Likely award: {t.award.name}</b> [{t.award.code}]. Confirm it and the level with the Award finder before you advertise pay.
              </span>
            </div>
          )}
          <article className="card jd-preview">
            <JdPreview md={md} />
          </article>
          {t.checks.length > 0 && <span className="meta">Check before hiring: {t.checks.join("; ")}.</span>}
        </section>
      </div>
      {err && <div className="banner bad">{err}</div>}
      <div className="row-wrap" style={{ alignItems: "center" }}>
        <button type="button" className="btn p lg" disabled={!name.trim() || exists || saving} onClick={() => void create(false)}>
          {saving ? "Creating…" : "Create job"}
        </button>
        <button type="button" className="btn lg" disabled={!name.trim() || exists || saving} onClick={() => void create(true)}>
          Create and ask MeritAI to tailor it
        </button>
        <span className="meta grow">Saved as “{name.trim() || "…"} JD.docx” in the job. Bracketed parts are yours to fill in.</span>
      </div>
    </>
  );
}

/** The job description as it will read (headings, bullets; bracketed placeholders highlighted). */
function JdPreview({ md }: { md: string }) {
  const hl = (s: string) => s.split(/(\[[^\]]+\])/g).map((p, i) => (p.startsWith("[") ? <mark key={i}>{p}</mark> : p.split(/\*\*([^*]+)\*\*/g).map((q, j) => (j % 2 ? <b key={`${i}-${j}`}>{q}</b> : q))));
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`u${out.length}`}>{list.map((x, i) => <li key={i}>{hl(x)}</li>)}</ul>);
    list = [];
  };
  for (const line of md.split("\n")) {
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (line.startsWith("# ")) out.push(<h3 key={out.length}>{line.slice(2)}</h3>);
    else if (line.startsWith("## ")) out.push(<b key={out.length} className="jd-h">{line.slice(3)}</b>);
    else if (line.trim()) out.push(<p key={out.length}>{hl(line)}</p>);
  }
  flush();
  return <>{out}</>;
}
