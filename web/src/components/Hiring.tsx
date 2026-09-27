import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobResults, JobSummary } from "../../../src/app/app";
import type { Api } from "../api";
import { Icon } from "./Icon";

const STAGE = { "needs-jd": "Needs job description", criteria: "Criteria to confirm", ready: "Ready to screen", screened: "Screened" } as const;

type Job = JobSummary;
type Ranked = JobResults["ranked"][number];

const BAND: Record<string, string> = { Strong: "ok", Partial: "warn", Weak: "n", "Not a resume": "n" };
const STATUS: Record<string, [string, string]> = { met: ["Met", "ok"], partly: ["Partly", "warn"], not_evidenced: ["Not evidenced", "n"] };

export function HiringPage({ api, progress, onAsk }: { api: Api; progress: string | null; onAsk: (text: string) => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [result, setResult] = useState<JobResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<React.ReactNode>(null);
  const [newJob, setNewJob] = useState(false);
  const [cand, setCand] = useState<Ranked | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      // Furthest along first, as in the design: screened, ready, criteria to confirm, no job description.
      const order = { screened: 0, ready: 1, criteria: 2, "needs-jd": 3 };
      const js = (await api.call("jobs")).sort((a, b) => order[a.stage] - order[b.stage] || a.job.localeCompare(b.job));
      setJobs(js);
      setSel((s) => s ?? js[0]?.job ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  const loadResult = useCallback(async (job: string) => {
    try {
      setResult(await api.call("screenResults", { job }));
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void loadJobs(), [loadJobs]);
  useEffect(() => {
    if (sel) void loadResult(sel);
  }, [sel, loadResult]);
  useEffect(() => {
    const close = () => setReportOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const screen = async () => {
    if (!sel) return;
    setBusy("Screening…");
    setError(null);
    setNote(null);
    try {
      const r = await api.call("screen", { job: sel });
      if (r.status === "no-jd") setNote(<>This job has no job description yet, so there are no criteria to screen against. Add a file named “Job description” to the job folder, or write one with the adviser.</>);
      if (r.status === "not-confirmed") setNote(<>The criteria weren't confirmed, so nothing was screened. Screen again to review them.</>);
      await loadResult(sel);
      await loadJobs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const report = async (format: "docx" | "xlsx") => {
    if (!sel) return;
    setReportOpen(false);
    setBusy("Writing the report…");
    try {
      const paths = await api.call("report", { job: sel, format });
      setNote(
        <>
          <b>Report saved to the Outbox.</b> {format === "docx" ? "Word, the top 10" : "Excel, everyone"}. It contains candidates' personal details: keep it private.{" "}
          {paths.map((p) => (
            <button key={p} type="button" className="link-btn" onClick={() => void api.call("openFile", { path: p })}>
              Open {p.split(/[\\/]/).pop()}
            </button>
          ))}
        </>,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const confirmed = result?.rubric?.confirmed ?? false;
  const screened = result?.ranked.length ?? 0;
  const apps = result?.ingest.applications ?? 0;
  const steps: [string, "done" | "now" | "todo"][] = [
    ["Job description", result ? (result.ingest.jdFiles.length ? "done" : "now") : "todo"],
    ["Criteria", confirmed ? "done" : result?.ingest.jdFiles.length ? "now" : "todo"],
    [`Screen${apps ? ` (${screened} of ${apps})` : ""}`, confirmed && screened && !result?.remaining ? "done" : confirmed ? "now" : "todo"],
    ["Shortlist", screened && !result?.remaining ? "now" : "todo"],
  ];

  return (
    <main className="main" style={{ background: "#EEF2F7" }}>
      <div className="page-h">
        <div style={{ flexGrow: 1, display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 className="h1">Hiring</h1>
          <span className="sub">Fair screening against criteria you confirm. You see names; the assessment is blind to names and contact details.</span>
        </div>
        <button type="button" className="btn p" onClick={() => setNewJob(true)}>
          <Icon name="plus" size={16} stroke={2} />
          New job
        </button>
      </div>
      <div className="hiring">
        <aside className="jobs" aria-label="Jobs">
          <div className="cap" style={{ padding: "0 4px 6px" }}>
            Jobs
          </div>
          {jobs?.length === 0 && <p className="meta">No jobs yet.</p>}
          {jobs?.map((j) => (
            <button key={j.job} type="button" className={`job${sel === j.job ? " on" : ""}`} onClick={() => (setSel(j.job), setCand(null), setNote(null))}>
              <b className="ellipsis">{j.job}</b>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={`pill ${j.stage === "screened" ? "ok" : "warn"}`} style={{ height: 22 }}>
                  {STAGE[j.stage]}
                </span>
                <span className="meta">{j.stage === "needs-jd" ? `${j.files} file${j.files === 1 ? "" : "s"}` : `${j.applications} application${j.applications === 1 ? "" : "s"}`}</span>
              </span>
            </button>
          ))}
        </aside>
        <section className="job-main">
          {error && (
            <div className="banner bad" role="alert" style={{ alignItems: "center" }}>
              <span className="grow">{error}</span>
              <button type="button" className="ib" aria-label="Dismiss" style={{ width: 36, height: 36 }} onClick={() => setError(null)}>
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {jobs?.length === 0 && (
            <div className="center dots" style={{ borderRadius: 12 }}>
              <div className="card empty-card">
                <div className="empty-ic">
                  <Icon name="hiring" size={24} />
                </div>
                <b style={{ fontSize: 16 }}>No jobs yet</b>
                <span className="sub" style={{ lineHeight: 1.5 }}>
                  Start with a job description and the applications. MeritAI screens them fairly against criteria you confirm.
                </span>
                <button type="button" className="btn p" onClick={() => setNewJob(true)}>
                  New job
                </button>
              </div>
            </div>
          )}
          {sel && result && (
            <>
              <div className="card job-head">
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <h2 className="h2 ellipsis" style={{ fontSize: 19 }}>
                    {sel}
                  </h2>
                  <span className="meta">
                    {result.ingest.jdFiles[0] ?? "No job description"} · {apps} application{apps === 1 ? "" : "s"}
                    {result.ingest.unreadable.length ? ` · ${result.ingest.unreadable.length} unreadable` : ""}
                    {result.ingest.duplicates.length ? ` · ${result.ingest.duplicates.length} duplicate skipped` : ""}
                  </span>
                </div>
                {(!confirmed || result.remaining > 0) && (
                  <button type="button" className="btn p" disabled={!!busy} onClick={() => void screen()}>
                    {!confirmed ? "Review criteria and screen" : `Screen the remaining ${result.remaining}`}
                  </button>
                )}
                <div style={{ position: "relative" }}>
                  <button type="button" className="btn" disabled={!screened || !!busy} aria-haspopup="menu" aria-expanded={reportOpen} onClick={(e) => (e.stopPropagation(), setReportOpen(!reportOpen))}>
                    Report
                    <Icon name="chevron" size={14} className="rot" />
                  </button>
                  {reportOpen && (
                    <div className="menu row-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                      <button type="button" role="menuitem" className="menu-item row" onClick={() => void report("docx")}>
                        Word report (top 10)
                      </button>
                      <button type="button" role="menuitem" className="menu-item row" onClick={() => void report("xlsx")}>
                        Excel (everyone)
                      </button>
                      <div role="separator" className="menu-sep" />
                      <button type="button" role="menuitem" className="menu-item row" onClick={() => (setReportOpen(false), onAsk(`Draft emails to the shortlisted candidates for "${sel}": invitations to interview for the top ones, and respectful "not this time" emails for the rest.`))}>
                        Candidate emails (with the adviser)
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <ol className="stepper" aria-label="Steps">
                {steps.map(([label, s], i) => (
                  <li key={label} className={s} aria-current={s === "now" ? "step" : undefined}>
                    <span className="n">{s === "done" ? <Icon name="check" size={13} stroke={2.6} /> : i + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
              {busy && (
                <div className="banner info" style={{ alignItems: "center" }}>
                  <span className="spin" />
                  <span>
                    <b>{busy}</b> {progress ?? ""}
                  </span>
                </div>
              )}
              {note && (
                <div className="banner info">
                  <span>{note}</span>
                </div>
              )}
              {confirmed && result.rubric && (
                <details className="card crit">
                  <summary>
                    <b>Criteria</b> <span className="meta">{result.rubric.criteria.length} · confirmed · {result.rubric.role}</span>
                  </summary>
                  <ul>
                    {result.rubric.criteria.map((c) => (
                      <li key={c.id}>
                        <span className={`pill ${c.type === "essential" ? "info" : "n"}`}>{c.type}</span> {c.text}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {screened > 0 ? (
                <div className="card" style={{ overflow: "hidden" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: 16, width: 56 }}>Rank</th>
                        <th>Name</th>
                        <th>Band</th>
                        <th>Essential</th>
                        <th>Desirable</th>
                        <th>Summary</th>
                        <th style={{ width: 170 }}>Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.ranked.map((c) => (
                        <tr key={c.file} className={cand?.file === c.file ? "sel" : ""}>
                          <td style={{ paddingLeft: 16 }}>{c.rank}</td>
                          <td className="b" style={{ whiteSpace: "nowrap" }}>
                            <button type="button" className="name-btn" onClick={() => setCand(c)}>
                              {c.name}
                            </button>
                          </td>
                          <td>
                            <span className={`pill ${BAND[c.band] ?? "n"}`}>{c.band}</span>
                          </td>
                          <td>
                            {c.essentialScore} of {c.essentialTotal}
                          </td>
                          <td>
                            {c.desirableScore} of {c.desirableTotal}
                          </td>
                          <td className="ellipsis" style={{ maxWidth: 260 }}>
                            {c.evaluation.summary}
                          </td>
                          <td>
                            {(c.evaluation.flags.suspiciousInstructions || c.evaluation.flags.differentRole) && (
                              <span className="flag">
                                <Icon name="alert" size={14} />
                                {c.evaluation.flags.suspiciousInstructions ? "Hidden instructions" : "Different role"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !busy && (
                  <div className="card empty-card" style={{ maxWidth: "none" }}>
                    <b>{apps ? "Not screened yet" : "No applications yet"}</b>
                    <span className="meta">{apps ? "Screen them against your criteria. You'll confirm the criteria first." : "Add applications with New job (same name adds to it), or drop a folder into a conversation."}</span>
                  </div>
                )
              )}
              <p className="meta" style={{ margin: 0 }}>
                Screening is blind: the assessment sees each application with names and contact details removed, and is told never to use protected attributes such as age, gender or origin. "Not evidenced" means the application doesn't show it, not that the person lacks it.
              </p>
            </>
          )}
        </section>
      </div>
      {cand && result && <Candidate c={cand} result={result} onClose={() => setCand(null)} onAsk={() => onAsk(`Help me prepare a phone screen for ${cand.name} for "${sel}".`)} />}
      {newJob && (
        <NewJob
          api={api}
          existing={jobs?.map((j) => j.job) ?? []}
          onClose={() => setNewJob(false)}
          onCreated={async (job, text) => {
            setNewJob(false);
            setNote(text);
            await loadJobs();
            setSel(job);
            await loadResult(job);
          }}
        />
      )}
    </main>
  );
}

function Candidate({ c, result, onClose, onAsk }: { c: Ranked; result: JobResults; onClose: () => void; onAsk: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const crit = new Map((result.rubric?.criteria ?? []).map((x) => [x.id, x]));
  const ev = c.evaluation;
  return (
    <aside className="drawer side" style={{ width: 440 }} aria-label={c.name}>
      <div className="drawer-h">
        <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 className="h2 ellipsis" style={{ fontSize: 20 }}>
            {c.name}
          </h2>
          <div className="row-wrap" style={{ alignItems: "center" }}>
            <span className={`pill ${BAND[c.band] ?? "n"}`}>{c.band}</span>
            <span className="meta">
              Rank {c.rank} of {result.ranked.length} · essential {c.essentialScore} of {c.essentialTotal} · desirable {c.desirableScore} of {c.desirableTotal}
            </span>
          </div>
        </div>
        <button type="button" className="ib" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="drawer-b" style={{ padding: "14px 22px", gap: 14 }}>
        {ev.flags.suspiciousInstructions && (
          <div className="banner warn">
            <span>
              <b>Hidden instructions in the file.</b> The application contains text aimed at an AI screener. It was ignored and did not affect the assessment. You may want to read the file yourself.
            </span>
          </div>
        )}
        {ev.flags.differentRole && (
          <div className="banner warn">
            <span>
              <b>Seems to be for a different role.</b> Check that this application belongs to this job.
            </span>
          </div>
        )}
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>{ev.summary}</p>
        <section>
          <h3 className="cap" style={{ margin: "0 0 4px" }}>
            Against your criteria
          </h3>
          {ev.criteria.map((r) => (
            <div key={r.id} className="crit-row">
              <span className={`pill ${STATUS[r.status]?.[1] ?? "n"}`} style={{ width: 112, justifyContent: "center", flexShrink: 0 }}>
                {STATUS[r.status]?.[0] ?? r.status}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13.5 }}>
                <b>
                  {crit.get(r.id)?.text ?? r.id}
                  {crit.get(r.id)?.type === "desirable" && <span className="meta"> · desirable</span>}
                </b>
                {r.evidence && <span style={{ color: "#4A5363" }}>{r.evidence}</span>}
              </span>
            </div>
          ))}
        </section>
        {[
          ["Strengths", ev.strengths],
          ["Gaps", ev.gaps],
          ["Questions to ask", ev.questions],
        ].map(([t, xs]) =>
          (xs as string[]).length ? (
            <section key={t as string}>
              <h3 className="cap" style={{ margin: "0 0 4px" }}>
                {t as string}
              </h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.55 }}>
                {(xs as string[]).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
        <p className="meta" style={{ margin: 0 }}>
          File: {c.file}
        </p>
      </div>
      <div className="drawer-f">
        <button type="button" className="btn p" style={{ flexGrow: 1 }} onClick={onAsk}>
          Draft a phone screen
        </button>
      </div>
    </aside>
  );
}

function NewJob({ api, existing, onClose, onCreated }: { api: Api; existing: string[]; onClose: () => void; onCreated: (job: string, note: React.ReactNode) => void }) {
  const [name, setName] = useState("");
  const [jd, setJd] = useState<File | null>(null);
  const [apps, setApps] = useState<File[]>([]);
  const addApps = (fs: FileList | null) => {
    const list = [...(fs ?? [])];
    setApps((a) => [...a, ...list]);
  };
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const jdInput = useRef<HTMLInputElement>(null);
  const appsInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const adding = existing.includes(name.trim());

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const file = async (f: File) => ({ name: f.name, base64: await toBase64(f) });
      const r = await api.call("createJob", { job: name.trim(), jd: jd ? await file(jd) : null, applications: await Promise.all(apps.map(file)) });
      onCreated(
        r.job,
        <>
          <b>{adding ? "Added to" : "Created"} “{r.job}”.</b> {r.summary.newApplications} new application{r.summary.newApplications === 1 ? "" : "s"}
          {r.summary.unreadable.length ? `, ${r.summary.unreadable.length} can't be read (${r.summary.unreadable.map((u) => u.file).join(", ")})` : ""}
          {r.summary.duplicates.length ? `, ${r.summary.duplicates.length} duplicate skipped` : ""}
          {r.refused.length ? `. Not added: ${r.refused.map((x) => `${x.name} (${x.reason})`).join("; ")}` : ""}.
        </>,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="scrim fill" onClick={onClose} />
      <div className="modal dialog" role="dialog" aria-modal="true" aria-label="New job" style={{ width: 600 }}>
        <h2 className="h2" style={{ fontSize: 19 }}>
          New job
        </h2>
        <label className="field">
          Job name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Team leader" autoFocus list="jobs-list" />
          <datalist id="jobs-list">
            {existing.map((j) => (
              <option key={j} value={j} />
            ))}
          </datalist>
          {adding && <span className="hint">This job exists: the files are added to it.</span>}
        </label>
        <div className="field">
          Job description
          <div className="row-wrap" style={{ alignItems: "center" }}>
            <input ref={jdInput} type="file" hidden accept=".pdf,.docx,.txt,.md" onChange={(e) => (setJd(e.target.files?.[0] ?? null), (e.target.value = ""))} />
            <button type="button" className="btn sm" onClick={() => jdInput.current?.click()}>
              <Icon name="file" size={15} />
              {jd ? "Change file" : "Choose file"}
            </button>
            <span className="meta">{jd ? jd.name : "PDF, Word or text. No JD yet? Write one with the adviser first."}</span>
          </div>
        </div>
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addApps(e.dataTransfer.files);
          }}
        >
          <Icon name="attach" size={22} />
          <b>Applications</b>
          <span className="meta">Drop resumes here, or</span>
          <input ref={appsInput} type="file" multiple hidden accept=".pdf,.docx,.txt,.md" onChange={(e) => (addApps(e.target.files), (e.target.value = ""))} />
          <button type="button" className="btn sm" onClick={() => appsInput.current?.click()}>
            Choose files
          </button>
          {apps.length > 0 && <span className="meta">{apps.length} file{apps.length === 1 ? "" : "s"}: {apps.slice(0, 4).map((f) => f.name).join(", ")}{apps.length > 4 ? "…" : ""}</span>}
        </div>
        {err && <div className="banner bad">{err}</div>}
        <div className="row-wrap">
          <button type="button" className="btn p lg" disabled={!name.trim() || (!jd && !apps.length) || saving} onClick={() => void save()}>
            {saving ? "Adding…" : adding ? "Add to job" : "Create job"}
          </button>
          <button type="button" className="btn lg" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </>
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
