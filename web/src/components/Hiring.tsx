import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobResults, JobSummary } from "../../../src/app/app";
import type { Api } from "../api";
import { fmtDate, fmtDay, localDay } from "../format";
import { Icon } from "./Icon";
import { fromJob, type Ask, type Asking } from "../ask";
import { markLabel, marks, useLive } from "../live";

// The Hiring page as on the design canvas (Hiring*, artboards): jobs on the left, the selected
// job's steps, criteria, applications and ranked candidates on the right.

const STAGE = { "needs-jd": "Needs job description", criteria: "Criteria to confirm", ready: "Ready to screen", screened: "Screened", decided: "Decided", filled: "Filled" } as const;
const STAGE_ORDER = { filled: 0, decided: 1, screened: 2, ready: 3, criteria: 4, "needs-jd": 5 } as const;
type Decision = "shortlist" | "not";

type Job = JobSummary;
type Ranked = JobResults["ranked"][number];

const BAND: Record<string, string> = { Strong: "ok", Partial: "warn", Weak: "n", "Not a resume": "n" };
const STATUS: Record<string, [string, string]> = { met: ["Met", "ok"], partly: ["Partly", "warn"], not_evidenced: ["Not evidenced", "n"] };
/** Rows shown before "Show all". */
const TOP = 6;
/** A job description file, as screening finds it (src/screening/pipeline.ts JD_NAME). */
const JD_FILE = /^(jd\b|jd[-_ ]|job[-_ ]?description|position[-_ ]?description|职位描述|岗位描述)|[-_ ](jd|job[-_ ]?description|position[-_ ]?description)\.[a-z0-9]+$/i;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const joinPath = (dir: string, rel: string) => {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir}${sep}${rel.split("/").join(sep)}`;
};
/** "this PDF has no text layer (probably a scan...)" → "no text". */
const shortReason = (r: string | null) => (r && /no text/i.test(r) ? "no text" : (r ?? "can't be read"));

export function HiringPage({
  api,
  progress,
  onAsk: ask,
  asking,
  openJob,
  refreshKey,
  onHire,
  onOpenEmployee,
  arrival,
}: {
  /** What the adviser changed here meanwhile (design: SyncStaff, for Hiring). */
  arrival?: React.ReactNode;
  api: Api;
  progress: string | null;
  /** Asks MeritAI in the side panel, about a job. */
  onAsk: (a: Ask) => void;
  /** What the side panel is doing (a button shows its request running or waiting). */
  asking: Asking;
  /** A job to show (the side panel's "From Hiring · <job>"). */
  openJob: { job: string } | null;
  /** Changes after a reply or an answered question: the page reloads (a job description may have been saved). */
  refreshKey: number;
  /** Add to Staff for a candidate: the Staff form, which records the hire when saved. */
  onHire: (candidate: { name: string; file: string } | null, job: string) => void;
  onOpenEmployee: (id: number) => void;
}) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [result, setResult] = useState<JobResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<React.ReactNode>(null);
  const [newJob, setNewJob] = useState(false);
  const [cand, setCand] = useState<Ranked | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [saved, setSaved] = useState<{ name: string; path: string; size: number } | null>(null);
  const [screening, setScreening] = useState<number | null>(null);
  /** "Change decisions" on a decided job: back to the deciding view. */
  const [reviewing, setReviewing] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      // Furthest along first, as in the design: screened, ready, criteria to confirm, no job description.
      const js = (await api.call("jobs")).sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.job.localeCompare(b.job));
      setJobs(js);
      setSel((s) => s ?? js.find((j) => !j.closedAt)?.job ?? js[0]?.job ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  const loadResult = useCallback(
    async (job: string) => {
      try {
        setResult(await api.call("screenResults", { job }));
      } catch (e) {
        setResult(null);
        setError((e as Error).message);
      }
    },
    [api],
  );
  useEffect(() => void loadJobs(), [loadJobs]);
  useEffect(() => {
    if (sel) void loadResult(sel);
  }, [sel, loadResult]);
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    if (!refreshKey) return;
    void loadJobs();
    if (selRef.current) void loadResult(selRef.current);
  }, [refreshKey, loadJobs, loadResult]);
  /** A request about a job; `draft`: fill the side panel's box and wait for the owner's words. */
  const onAsk = (job: string, text: string, draft = false) => ask({ text, from: fromJob(job), ...(draft ? { draft } : {}) });

  const job = jobs?.find((j) => j.job === sel) ?? null;
  const pick = (name: string) => (setSel(name), setCand(null), setNote(null), setSaved(null), setShowAll(false), setError(null), setReviewing(false));
  useEffect(() => {
    if (openJob) pick(openJob.job);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openJob]);

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setScreening(null);
      if (sel) await loadResult(sel);
      await loadJobs();
    }
  };

  const screen = (count: number) =>
    run("Screening", async () => {
      if (!sel) return;
      setScreening(count);
      const r = await api.call("screen", { job: sel });
      if (r.status === "no-jd") setNote(<>This job has no job description yet, so there are no criteria to screen against.</>);
      if (r.status === "not-confirmed") setNote(<>The criteria weren't confirmed, so nothing was screened.</>);
    });
  const confirmAndScreen = (version: number, count: number) =>
    run("Screening", async () => {
      if (!sel) return;
      await api.call("confirmCriteria", { job: sel, version });
      setScreening(count);
      await api.call("screen", { job: sel });
    });
  const draft = () =>
    run("Drafting the criteria", async () => {
      if (!sel) return;
      const r = await api.call("draftCriteria", { job: sel });
      if (r.status === "no-jd") setNote(<>This job has no job description yet.</>);
    });
  const report = () =>
    run("Writing the report", async () => {
      if (!sel) return;
      const [path] = await api.call("report", { job: sel, format: "docx" });
      const files = await api.call("files");
      const f = files.outbox.find((x) => x.path === path);
      setSaved({ name: f?.name ?? path.split(/[\\/]/).pop() ?? path, path, size: f?.size ?? 0 });
    });

  // The owner's decisions (Shortlist / Not this time): saved at once, no model call.
  const refresh = async () => {
    if (sel) await loadResult(sel);
    await loadJobs();
  };
  const decide = async (file: string, decision: Decision | null) => {
    if (!sel) return;
    try {
      await api.call("decide", { job: sel, file, decision });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** Close, reopen, people to hire: saved at once. */
  const jobAction = async (f: () => Promise<unknown>) => {
    try {
      setError(null);
      await f();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const decideRest = async () => {
    if (!sel) return;
    try {
      await api.call("decideRest", { job: sel });
      setReviewing(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="main hiring-page">
      <section className="jobs-col" aria-label="Jobs">
        <div className="jobs-col-h">
          <h1 className="h1" style={{ flexGrow: 1, fontSize: 22 }}>
            Hiring
          </h1>
          <button type="button" className="btn sm" onClick={() => setNewJob(true)}>
            <Icon name="plus" size={15} stroke={2} />
            New job
          </button>
        </div>
        {/* Open jobs, then closed ones (design: the Hiring artboards' job list). */}
        {jobs && jobs.length > 0 && (
          <span className="cap" style={{ padding: "0 4px" }}>
            Open · {jobs.filter((j) => !j.closedAt).length}
          </span>
        )}
        {jobs?.filter((j) => !j.closedAt).map((j) => <JobCard key={j.job} j={j} on={sel === j.job} onPick={() => pick(j.job)} />)}
        {jobs?.some((j) => j.closedAt) && (
          <span className="cap" style={{ padding: "6px 4px 0" }}>
            Closed · {jobs.filter((j) => j.closedAt).length}
          </span>
        )}
        {jobs
          ?.filter((j) => j.closedAt)
          .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
          .map((j) => <JobCard key={j.job} j={j} on={sel === j.job} onPick={() => pick(j.job)} />)}
        <FolderDrop
          api={api}
          disabled={!!busy}
          onCreated={async (name, text) => {
            setNote(text);
            await loadJobs();
            pick(name);
            await loadResult(name);
          }}
          onError={setError}
        />
      </section>

      <section className="job-pane">
        {arrival && <div className="arrival-wrap">{arrival}</div>}
        {jobs?.length === 0 && (
          <div className="center dots" style={{ flexGrow: 1 }}>
            <div className="card empty-card">
              <div className="empty-ic">
                <Icon name="hiring" size={24} />
              </div>
              <b style={{ fontSize: 16 }}>No jobs yet</b>
              <span className="sub" style={{ lineHeight: 1.5 }}>
                Start with a job description and the applications. I screen them fairly against criteria you confirm.
              </span>
              <button type="button" className="btn p" onClick={() => setNewJob(true)}>
                New job
              </button>
            </div>
          </div>
        )}
        {job && result && (
          <JobPane
            key={job.job}
            api={api}
            job={job}
            result={result}
            busy={busy}
            screening={screening}
            progress={progress}
            error={error}
            note={note}
            saved={saved}
            showAll={showAll}
            cand={cand}
            onShowAll={() => setShowAll(true)}
            onDismissError={() => setError(null)}
            onPick={setCand}
            onScreen={screen}
            onConfirm={confirmAndScreen}
            onDraft={draft}
            onReport={report}
            onAsk={(t, draft) => onAsk(job.job, t, draft)}
            asking={asking}
            reviewing={reviewing}
            onReview={setReviewing}
            onDecide={(file, d) => void decide(file, d)}
            onRest={() => void decideRest()}
            onHire={(c) => onHire(c ? { name: c.name, file: c.file } : null, job.job)}
            onOpenEmployee={onOpenEmployee}
            onOpenings={(n) => void jobAction(() => api.call("setOpenings", { job: job.job, openings: n }))}
            onClose={() => void jobAction(() => api.call("closeJob", { job: job.job }))}
            onReopen={() => void jobAction(() => api.call("reopenJob", { job: job.job }))}
            onDuplicate={() => setDuplicating(job.job)}
          />
        )}
      </section>

      {cand && result && job && (
        <Candidate
          c={cand}
          result={result}
          onClose={() => setCand(null)}
          onOpen={() => void api.call("openFile", { path: joinPath(job.path, cand.file) }).then((r) => !r.ok && setError(r.error))}
          onInvite={() => onAsk(job.job, `Draft an interview invite for ${cand.name} for the "${job.job}" role.`)}
          onPhone={() => onAsk(job.job, `Help me prepare a phone screen for ${cand.name} for the "${job.job}" role.`)}
          decision={result.decisions.find((d) => d.file === cand.file)?.decision ?? null}
          onDecide={(d) => void decide(cand.file, d)}
          hire={result.hires.find((h) => h.file === cand.file) ?? null}
          closed={!!result.closedAt}
          onOpenEmployee={onOpenEmployee}
        />
      )}
      {duplicating && (
        <DuplicateJob
          api={api}
          from={duplicating}
          existing={jobs?.map((j) => j.job) ?? []}
          onClose={() => setDuplicating(null)}
          onDone={async (name) => {
            setDuplicating(null);
            await loadJobs();
            pick(name);
            setNote(<>Created “{name}” with the job description and criteria of “{duplicating}”. Add the applications for this round.</>);
          }}
        />
      )}
      {newJob && (
        <NewJob
          api={api}
          existing={jobs?.map((j) => j.job) ?? []}
          onClose={() => setNewJob(false)}
          onWriteJd={(name) => (setNewJob(false), onAsk(name || "New role", `Write a job description for a ${name || "new role"} with me, then save it into the job.`))}
          onCreated={async (name, text) => {
            setNewJob(false);
            setNote(text);
            await loadJobs();
            pick(name);
            await loadResult(name);
          }}
        />
      )}
    </main>
  );
}

function JobPane(p: {
  api: Api;
  job: Job;
  result: JobResults;
  busy: string | null;
  screening: number | null;
  progress: string | null;
  error: string | null;
  note: React.ReactNode;
  saved: { name: string; path: string; size: number } | null;
  showAll: boolean;
  cand: Ranked | null;
  onShowAll: () => void;
  onDismissError: () => void;
  onPick: (c: Ranked) => void;
  onScreen: (count: number) => void;
  onConfirm: (version: number, count: number) => void;
  onDraft: () => void;
  onReport: () => void;
  onAsk: (text: string, draft?: boolean) => void;
  asking: Asking;
  reviewing: boolean;
  onReview: (on: boolean) => void;
  onDecide: (file: string, decision: Decision | null) => void;
  onRest: () => void;
  onHire: (c: Ranked | null) => void;
  onOpenEmployee: (id: number) => void;
  onOpenings: (n: number) => void;
  onClose: () => void;
  onReopen: () => void;
  onDuplicate: () => void;
}) {
  const { job, result: r } = p;
  const { recent } = useLive();
  const candMarks = marks(recent, (x) => (x.kind === "candidate" && x.job === job.job ? x.file : null));
  const rubric = r.rubric;
  const confirmed = rubric?.confirmed ?? false;
  const screened = r.ranked.length;
  const unscreened = r.files.filter((f) => f.status === "application").length - screened;
  const unreadable = r.files.filter((f) => f.status === "unreadable");
  const duplicates = r.files.filter((f) => f.status === "duplicate");
  const screeningNow = p.busy === "Screening";
  const essential = rubric?.criteria.filter((c) => c.type === "essential") ?? [];
  const desirable = rubric?.criteria.filter((c) => c.type === "desirable") ?? [];

  // Decisions (HiringDecide, HiringDecided artboards).
  const dec = new Map(r.decisions.map((d) => [d.file, d.decision]));
  const shortlisted = r.ranked.filter((c) => dec.get(c.file) === "shortlist");
  const notNow = r.ranked.filter((c) => dec.get(c.file) === "not");
  const undecided = screened - shortlisted.length - notNow.length;
  const decidedView = screened > 0 && undecided === 0 && unscreened <= 0 && !p.reviewing;
  // Hires, openings, open or closed.
  const closed = !!r.closedAt;
  const hires = new Map(r.hires.map((h) => [h.file, h]));
  const filled = r.hires.length >= r.openings;
  const [menuOpen, setMenuOpen] = useState(false);
  const [openingsDraft, setOpeningsDraft] = useState<string | null>(null);
  const [filledDismissed, setFilledDismissed] = useState(false);
  const firstNames = r.hires.map((h) => h.name).join(", ");
  const lastDecided = r.decisions.map((d) => d.decidedAt).sort().pop();
  const [tab, setTab] = useState<Decision | "all">("shortlist");
  const [hireOpen, setHireOpen] = useState(false);
  const names = (cs: Ranked[]) => cs.map((c) => c.name).join(", ");
  const notHired = shortlisted.filter((c) => !hires.has(c.file));
  const kitPrompt = shortlisted.length
    ? `Build an interview kit for the "${job.job}" role for the shortlisted candidates (${names(shortlisted)}), using the confirmed screening criteria.`
    : `Build an interview kit for the "${job.job}" role, using the confirmed screening criteria.`;
  const emailsPrompt =
    shortlisted.length || notNow.length
      ? `Draft the candidate emails for the "${job.job}" role and save each one as a draft in my Outbox (I'll send them myself): ${[shortlisted.length ? `interview invitations for ${names(shortlisted)}` : "", notNow.length ? `respectful "not this time" emails for ${names(notNow)}` : ""].filter(Boolean).join("; ")}.`
      : `Draft emails to the candidates for the "${job.job}" role: interview invitations for the shortlist, and respectful "not this time" emails for the rest.`;

  type Step = { label: string; state: "done" | "now" | "todo" | "warn" };
  const steps: Step[] = [
    job.jd ? { label: "Job description", state: "done" } : { label: "Needs a job description", state: "warn" },
    confirmed ? { label: "Criteria confirmed", state: "done" } : { label: "Criteria", state: job.jd ? "now" : "todo" },
    screeningNow
      ? { label: `Screening${p.progress ? ` ${p.progress.replace(/^screened /, "").replace("/", " of ")}` : ""}`, state: "now" }
      : screened && unscreened > 0
        ? { label: `${screened} of ${screened + unscreened} screened`, state: "now" }
        : screened
          ? { label: `${screened} screened`, state: "done" }
          : { label: "Screening", state: confirmed ? "now" : "todo" },
    r.hires.length
      ? { label: `${r.hires.length} of ${r.openings} hired`, state: "done" }
      : decidedView
      ? { label: `${shortlisted.length} shortlisted`, state: "done" }
      : screened && !unscreened && !screeningNow
        ? { label: `Your decision · ${screened - undecided} of ${screened}`, state: "now" }
        : { label: "Your decision", state: "todo" },
  ];

  const where = screened > 0 ? "" : `Jobs/${job.job} · `;
  const sub = `${where}${job.jd ? `${job.jd} · ` : ""}${job.jd ? plural(job.applications, "application") : plural(job.files, "file")}${closed ? ` · hired ${r.hires.length} of ${r.openings}` : ` · hiring ${r.openings} · ${r.hires.length} hired`}`;
  if (closed) return <ClosedPane p={p} sub={sub} hires={hires} steps={steps.length} />;
  const rows = decidedView ? r.ranked.filter((c) => tab === "all" || dec.get(c.file) === tab) : p.showAll ? r.ranked : r.ranked.slice(0, TOP);

  return (
    <>
      <div className="page-h">
        <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <h2 className="h1 ellipsis" style={{ fontSize: 20 }}>
              {job.job}
            </h2>
            <span className="pill ok" style={{ height: 22 }}>
              Open
            </span>
          </span>
          <span className="meta ellipsis">{sub}</span>
        </div>
        {screeningNow && <span className="pill info">Screening</span>}
        <AdvertiseMenu onWrite={() => p.onAsk(`Write a job ad for "${job.job}" from its job description, ready to post on a job board. Save it to the Outbox as a Word document.`)} />
        {screened > 0 && (
          <>
            <button type="button" className="btn hide-docked" onClick={() => p.onAsk(kitPrompt)}>
              Interview kit
            </button>
            <button type="button" className="btn hide-docked" onClick={() => p.onAsk(emailsPrompt)}>
              Candidate emails
            </button>
            <button type="button" className="btn p" disabled={!!p.busy} onClick={p.onReport}>
              Report<span className="hide-docked">: Word (top 10)</span>
            </button>
          </>
        )}
        <div style={{ position: "relative" }}>
          <button type="button" className="ib bordered" aria-label="Job actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => (setMenuOpen(!menuOpen), setOpeningsDraft(null))}>
            <Icon name="more" size={20} />
          </button>
          {menuOpen && (
            <div className="menu job-menu" role="menu" aria-label="Job actions">
              {openingsDraft === null ? (
                <button type="button" role="menuitem" className="menu-item row" onClick={() => setOpeningsDraft(String(r.openings))}>
                  <span className="grow">People to hire</span>
                  <span className="meta">{r.openings}</span>
                </button>
              ) : (
                <form
                  className="menu-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number(openingsDraft);
                    if (Number.isInteger(n) && n >= 1 && n <= 99) (p.onOpenings(n), setMenuOpen(false));
                  }}
                >
                  <label className="field" style={{ fontSize: 13 }}>
                    People to hire
                    <input className="input" type="number" min={1} max={99} value={openingsDraft} onChange={(e) => setOpeningsDraft(e.target.value)} autoFocus />
                  </label>
                  <button type="submit" className="btn p sm">
                    Save
                  </button>
                </form>
              )}
              <button type="button" role="menuitem" className="menu-item row" onClick={() => (setMenuOpen(false), p.onDuplicate())}>
                Duplicate job…
              </button>
              <div role="separator" className="menu-sep" />
              <button type="button" role="menuitem" className="menu-item row" style={{ flexDirection: "column", alignItems: "flex-start", height: "auto", padding: "8px 12px" }} onClick={() => (setMenuOpen(false), p.onClose())}>
                Close job
                <span className="meta" style={{ fontSize: 12 }}>
                  Keeps everything; you can reopen it
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="job-body">
        <ol className="steps4" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={i} className={s.state} aria-current={s.state === "now" ? "step" : undefined}>
              {s.state === "done" ? <Icon name="check" size={16} stroke={2.4} /> : <span className="n">{s.state === "warn" ? "!" : i + 1}</span>}
              {s.label}
            </li>
          ))}
        </ol>

        {p.error && (
          <div className="banner bad" role="alert" style={{ alignItems: "center" }}>
            <span className="grow">{p.error}</span>
            <button type="button" className="ib" aria-label="Dismiss" style={{ width: 36, height: 36 }} onClick={p.onDismissError}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {p.note && (
          <div className="banner info">
            <span>{p.note}</span>
          </div>
        )}
        {p.busy && !screeningNow && (
          <div className="banner info" style={{ alignItems: "center" }}>
            <span className="spin" />
            <span>
              <b>{p.busy}…</b> {p.progress ?? ""}
            </span>
          </div>
        )}

        {/* No job description yet (HiringJobs). */}
        {!job.jd && !rubric && (
          <>
            <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              <b style={{ fontSize: 16 }}>I need the job description first</b>
              <span style={{ color: "#4A5363", lineHeight: 1.5 }}>
                I build the screening criteria from it. Put it in the job folder with JD in the file name (for example <span className="mono">{job.job} JD.docx</span>), or I can write one with you.
              </span>
              <div className="row-wrap">
                <button type="button" className="btn" onClick={() => void p.api.call("openFile", { path: job.path })}>
                  Open the job folder
                </button>
                <button type="button" className="btn p" onClick={() => p.onAsk(`Write a job description for the "${job.job}" role with me, then save it into the job.`)}>
                  Write one with the adviser
                </button>
              </div>
            </div>
            {r.files.length > 0 && (
              <div className="card" style={{ padding: "12px 16px" }}>
                <span className="cap">In this folder</span>
                <ul className="docs" style={{ marginTop: 6 }}>
                  {r.files.map((f) => (
                    <li key={f.file}>
                      <span className="grow">{f.file}</span>
                      <span className={f.status === "unreadable" ? "meta bad-text" : "meta"}>
                        {f.status === "application" ? "application" : f.status === "duplicate" ? "duplicate, skipped" : `can't read: ${shortReason(f.reason)}${shortReason(f.reason) === "no text" ? " (scanned image)" : ""}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* A JD but no criteria yet. */}
        {job.jd && !rubric && !p.busy && (
          <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <b style={{ fontSize: 16 }}>Next: the screening criteria</b>
            <span style={{ color: "#4A5363", lineHeight: 1.5 }}>I'll read {job.jd} and draft the criteria every application is assessed against. You check them before I screen anything.</span>
            <div>
              <button type="button" className="btn p" onClick={p.onDraft}>
                Draft the criteria
              </button>
            </div>
          </div>
        )}

        {/* Criteria drafted, waiting for the owner's OK (HiringCriteria). */}
        {rubric && !confirmed && !screeningNow && (
          <>
            <p style={{ margin: 0, color: "#4A5363", lineHeight: 1.5, fontSize: 14 }}>
              I read the job description and drafted these criteria. Every application is assessed against them only, so check they are right and fair before I start. Essential criteria decide the band; desirable ones break ties.
            </p>
            <div className="card confirm-card">
              <span className="cap" style={{ color: "#8A6300" }}>
                Needs your OK · screening criteria
              </span>
              <b style={{ fontSize: 16 }}>Use these criteria for screening?</b>
              <div className="crit-list">
                <span className="pill info">Essential</span>
                <ul>
                  {essential.map((c) => (
                    <li key={c.id}>{c.text}</li>
                  ))}
                </ul>
                {desirable.length > 0 && (
                  <>
                    <span className="pill n">Desirable</span>
                    <ul>
                      {desirable.map((c) => (
                        <li key={c.id}>{c.text}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <p className="meta" style={{ margin: 0, lineHeight: 1.5 }}>
                Criteria must be about the job. Age, gender, race, disability, pregnancy, family responsibilities and similar attributes can't be used, directly or through a stand-in like "recent graduate".
              </p>
              <div className="row-wrap" style={{ alignItems: "center" }}>
                <button type="button" className="btn p" disabled={!!p.busy || unscreened <= 0} onClick={() => p.onConfirm(rubric.version, unscreened)}>
                  Yes, screen {plural(unscreened, "application")}
                </button>
                <button type="button" className="btn" disabled={!!p.busy} onClick={() => p.onAsk(`Change the screening criteria for the "${job.job}" role: `, true)}>
                  No, change them
                </button>
                <span className="meta">Takes about a minute. Up to 20 per run.</span>
              </div>
            </div>
          </>
        )}

        {/* Screening now (HiringProgress). */}
        {screeningNow && (
          <div className="card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <b style={{ fontSize: 16 }}>Screening {plural(p.screening ?? unscreened, "new application")}</b>
              <span className="meta">about a minute</span>
            </div>
            <div className="bar">
              <span style={{ width: `${progressPct(p.progress)}%` }} />
            </div>
            <span className="meta">{p.progress ?? "starting…"}</span>
            {duplicates.length > 0 && (
              <span className="meta">
                Also found: {plural(duplicates.length, "duplicate")}, skipped ({duplicates.map((d) => `${d.file} is ${d.reason}`).join("; ")}).
              </span>
            )}
            <span className="meta">Each application is assessed on its own, without names, photos, ages or addresses. Results are ranked by rules once all are done.</span>
          </div>
        )}

        {/* Criteria confirmed: summary, applications, ranking (Hiring, HiringMore, HiringReport). */}
        {rubric && confirmed && !screeningNow && (
          <>
            {!decidedView && (
            <div className="crit-grid">
              <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, gridColumn: "span 2" }}>
                <div style={{ display: "flex", alignItems: "baseline" }}>
                  <span className="cap" style={{ flexGrow: 1 }}>
                    Criteria · confirmed{rubric.confirmedAt ? ` by you ${fmtDay(localDay(rubric.confirmedAt))}` : ""}
                  </span>
                  <button type="button" className="link-btn" style={{ fontSize: 13, fontWeight: 700 }} onClick={() => p.onAsk(`Change the screening criteria for the "${job.job}" role: `, true)}>
                    Change
                  </button>
                </div>
                <CritLine kind="Essential" items={essential.map((c) => c.text)} />
                {desirable.length > 0 && <CritLine kind="Desirable" items={desirable.map((c) => c.text)} />}
              </div>
              <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#4A5363" }}>
                <span className="cap">Applications</span>
                <span>
                  <b style={{ color: "#1B1F27" }}>{screened}</b> screened
                </span>
                {unreadable.length > 0 && (
                  <span>
                    <b style={{ color: "#B3261E" }}>{unreadable.length}</b> unreadable:{" "}
                    {unreadable.map((u, i) => (
                      <span key={u.file}>
                        {i > 0 && ", "}
                        <span className="mono" style={{ fontSize: 12 }}>
                          {u.file}
                        </span>{" "}
                        ({shortReason(u.reason)})
                      </span>
                    ))}
                  </span>
                )}
                {duplicates.length > 0 && (
                  <span>
                    <b style={{ color: "#1B1F27" }}>{duplicates.length}</b> duplicate skipped
                  </span>
                )}
              </div>
            </div>
            )}
            {screened > 0 && unscreened > 0 && (
              <div className="banner warn" style={{ alignItems: "center" }}>
                <span className="grow">
                  <b>
                    {screened} of {screened + unscreened} screened.
                  </b>{" "}
                  I screen up to 20 applications per run. The ranking below will change once the other {unscreened} are in.
                </span>
                <button type="button" className="btn p sm" disabled={!!p.busy} onClick={() => p.onScreen(unscreened)}>
                  Screen the remaining {unscreened}
                </button>
              </div>
            )}
            {screened === 0 && (
              <div className="card empty-card" style={{ maxWidth: "none" }}>
                <b>{unscreened > 0 ? "Ready to screen" : "No applications yet"}</b>
                <span className="meta">{unscreened > 0 ? "The criteria are confirmed. Takes about a minute; up to 20 per run." : "Add applications with New job (same name adds to it), or drop a folder."}</span>
                {unscreened > 0 && (
                  <button type="button" className="btn p" disabled={!!p.busy} onClick={() => p.onScreen(unscreened)}>
                    Screen {plural(unscreened, "application")}
                  </button>
                )}
              </div>
            )}
            {filled && !filledDismissed && (
              <div className="banner ok-banner" style={{ alignItems: "center", flexShrink: 0 }}>
                <Icon name="check" size={20} stroke={2.2} />
                <span className="grow">
                  <b>{r.openings === 1 ? "The position is filled." : r.openings === 2 ? "Both positions are filled." : `All ${r.openings} positions are filled.`}</b> Close this job? Closing keeps everything, and you can reopen it later.
                </span>
                <button type="button" className="btn p sm" onClick={p.onClose}>
                  Close job
                </button>
                <button type="button" className="btn g sm" onClick={() => setFilledDismissed(true)}>
                  Not yet
                </button>
              </div>
            )}
            {screened > 0 && decidedView && (
              <>
                <div className="card next-steps">
                  <div className="next-h">
                    <h3 className="h3">Next steps</h3>
                    <span className="meta">
                      {shortlisted.length} shortlisted · {notNow.length} not this time{lastDecided ? ` · decided ${fmtDay(localDay(lastDecided))}` : ""}
                    </span>
                    <span className="grow" />
                    <button type="button" className="link-btn" style={{ fontSize: 13, fontWeight: 700 }} onClick={() => p.onReview(true)}>
                      Change decisions
                    </button>
                  </div>
                  <NextStep n={1} title="Interview kit" text={shortlisted.length ? `Questions and a scoring sheet for ${names(shortlisted)}, built from your criteria.` : "No one is shortlisted yet."}>
                    <AskButton prompt={kitPrompt} asking={p.asking} busyLabel="Making the kit" disabled={!shortlisted.length} onAsk={p.onAsk}>
                      Make the interview kit
                    </AskButton>
                  </NextStep>
                  <NextStep n={2} title="Candidate emails" text={`${plural(shortlisted.length, "interview invitation")} and ${notNow.length} “not this time” email${notNow.length === 1 ? "" : "s"}, saved as drafts in your Outbox. You check and send them.`}>
                    <AskButton prompt={emailsPrompt} asking={p.asking} busyLabel="Drafting in the side panel" primary onAsk={p.onAsk}>
                      Draft the emails
                    </AskButton>
                  </NextStep>
                  <NextStep
                    n={3}
                    done={r.hires.length > 0}
                    title={r.hires.length ? `Hired ${r.hires.length} of ${r.openings}: ${firstNames}` : "Hired someone?"}
                    text={
                      r.hires.length
                        ? `Added to Staff ${fmtDay(localDay(r.hires[r.hires.length - 1].hiredAt))}${r.hires.length === 1 ? ` · starts ${fmtDate(r.hires[0].startDate)}` : ""}. Hires are recorded when you add someone to Staff from here.`
                        : "Add them to Staff and you'll get the new starter checklist for them."
                    }
                  >
                    {r.hires.length > 0 && (
                      <button type="button" className="btn" onClick={() => p.onOpenEmployee(r.hires[0].employeeId)}>
                        Open in Staff
                      </button>
                    )}
                    <div style={{ position: "relative" }}>
                      {!filled && (
                        <button
                          type="button"
                          className={r.hires.length ? "btn g" : "btn"}
                          aria-haspopup={notHired.length === 1 ? undefined : "menu"}
                          aria-expanded={notHired.length === 1 ? undefined : hireOpen}
                          onClick={() => (notHired.length === 1 ? p.onHire(notHired[0]) : setHireOpen(!hireOpen))}
                        >
                          {r.hires.length ? "Add another hire" : "Add to Staff"}
                        </button>
                      )}
                      {hireOpen && (
                        <div className="menu row-menu" role="menu" style={{ right: 0, left: "auto", top: 48 }}>
                          {notHired.map((c) => (
                            <button key={c.file} type="button" role="menuitem" className="menu-item row" onClick={() => (setHireOpen(false), p.onHire(c))}>
                              {c.name}
                            </button>
                          ))}
                          {notHired.length > 0 && <div role="separator" className="menu-sep" />}
                          <button type="button" role="menuitem" className="menu-item row" onClick={() => (setHireOpen(false), p.onHire(null))}>
                            Someone else
                          </button>
                        </div>
                      )}
                    </div>
                  </NextStep>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                  <div className="pick-tabs" role="tablist" aria-label="Show">
                    {(
                      [
                        ["shortlist", `Shortlisted ${shortlisted.length}`],
                        ["not", `Not this time ${notNow.length}`],
                        ["all", `All ${screened}`],
                      ] as const
                    ).map(([k, label]) => (
                      <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="meta">Changing a decision here updates the next steps.</span>
                </div>
              </>
            )}
            {screened > 0 && !decidedView && (
              <>
                <div className="banner info" style={{ padding: "10px 14px", fontSize: 13.5 }}>
                  <Icon name="shield" size={16} />
                  <span>
                    <b>Blind screening.</b> The ranking is a starting point. Shortlist the people you want to meet; the rest get a "not this time" email when you're ready. Only you see these decisions.
                  </span>
                </div>
                <div className="card decide-bar">
                  <span className="cap">Your decision</span>
                  <span style={{ fontSize: 14, color: "#4A5363" }}>
                    <b style={{ color: "#1E6B3E" }}>{shortlisted.length}</b> shortlisted · <b style={{ color: "#1B1F27" }}>{notNow.length}</b> not this time · <b style={{ color: "#1446A6" }}>{undecided}</b> to decide
                  </span>
                  <span className="grow" />
                  {undecided > 0 ? (
                    <button type="button" className="btn sm" onClick={p.onRest}>
                      Mark the rest “Not this time”
                    </button>
                  ) : (
                    job.stage === "decided" && (
                      <button type="button" className="btn p sm" onClick={() => p.onReview(false)}>
                        See next steps
                      </button>
                    )
                  )}
                </div>
              </>
            )}
            {screened > 0 && (
              <>
                <div className="card" style={{ overflow: "hidden", flexShrink: 0 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: 16, width: 40 }}>#</th>
                        <th>Candidate</th>
                        <th>Band</th>
                        <th>Essential</th>
                        <th className="opt-col">Desirable</th>
                        <th className="opt-col">Summary</th>
                        <th style={{ width: 236 }}>Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.file} className={`${p.cand?.file === c.file ? "sel" : ""}${candMarks.has(c.file) ? " fresh" : ""}`}>
                          <td style={{ paddingLeft: 16 }}>{c.rank}</td>
                          <td className="b" style={{ whiteSpace: "nowrap" }}>
                            <button type="button" className="name-btn" onClick={() => p.onPick(c)}>
                              {c.name}
                            </button>
                            {candMarks.has(c.file) && <span className="pill info fresh-pill">{markLabel(candMarks.get(c.file)!)}</span>}
                            {(c.evaluation.flags.suspiciousInstructions || c.evaluation.flags.differentRole) && (
                              <span className="flag-ic" role="img" aria-label={c.evaluation.flags.suspiciousInstructions ? "Hidden instructions in the file" : "Applied for a different role"} title={c.evaluation.flags.suspiciousInstructions ? "The file contains hidden instructions to the assessor" : "Applied for a different role"}>
                                <Icon name="alert" size={14} />
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`pill ${BAND[c.band] ?? "n"}`}>{c.band}</span>
                          </td>
                          <td>
                            {c.essentialScore} of {c.essentialTotal}
                          </td>
                          <td className="opt-col">
                            {c.desirableScore} of {c.desirableTotal}
                          </td>
                          <td className="ellipsis opt-col" style={{ maxWidth: 180 }}>
                            {c.evaluation.summary}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {hires.has(c.file) ? (
                              <HiredButton onClick={() => p.onOpenEmployee(hires.get(c.file)!.employeeId)} />
                            ) : (
                              <DecisionButtons name={c.name} value={dec.get(c.file) ?? null} onChange={(d) => p.onDecide(c.file, d)} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!decidedView && !p.showAll && r.ranked.length > TOP && (
                    <div style={{ padding: "10px 16px" }}>
                      <button type="button" className="link-btn" style={{ fontSize: 14, fontWeight: 700 }} onClick={p.onShowAll}>
                        Show all {r.ranked.length}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
            {p.saved && (
              <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
                <span className="cap" style={{ color: "#1E6B3E" }}>
                  Report saved to Outbox · top 10, with names
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="fbadge" style={{ background: "#DCE6FA", color: "#1446A6" }}>
                    DOC
                  </span>
                  <span className="grow">
                    <b>{p.saved.name}</b>
                    <span className="meta" style={{ display: "block" }}>
                      Word · {kb(p.saved.size)}
                    </span>
                  </span>
                  <button type="button" className="btn sm" onClick={() => void p.api.call("openFile", { path: p.saved!.path })}>
                    Open
                  </button>
                  <button type="button" className="btn g sm" onClick={() => void p.api.call("revealFile", { path: p.saved!.path })}>
                    Show in folder
                  </button>
                </div>
                <span className="meta">Contains candidates' personal details: share it only with the people deciding.</span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Shortlist / Not this time; clicking the chosen one again clears it. */
function DecisionButtons({ name, value, onChange, large }: { name: string; value: Decision | null; onChange: (d: Decision | null) => void; large?: boolean }) {
  return (
    <div role="group" aria-label={`Decision for ${name}`} className={`dec${large ? " lg" : ""}`}>
      <button type="button" aria-pressed={value === "shortlist"} className={value === "shortlist" ? "on-s" : ""} onClick={() => onChange(value === "shortlist" ? null : "shortlist")}>
        {value === "shortlist" && <Icon name="check" size={14} stroke={2.6} />}
        {value === "shortlist" ? "Shortlisted" : "Shortlist"}
      </button>
      <button type="button" aria-pressed={value === "not"} className={value === "not" ? "on-n" : ""} onClick={() => onChange(value === "not" ? null : "not")}>
        Not this time
      </button>
    </div>
  );
}

/** A next step that asks MeritAI: shows its request running or waiting in the side panel. */
function AskButton({ prompt, asking, busyLabel, primary, disabled, onAsk, children }: { prompt: string; asking: Asking; busyLabel: string; primary?: boolean; disabled?: boolean; onAsk: (text: string) => void; children: React.ReactNode }) {
  if (asking.running === prompt)
    return (
      <button type="button" className="btn" disabled>
        <span className="spin" />
        {busyLabel}
      </button>
    );
  if (asking.queued.includes(prompt))
    return (
      <button type="button" className="btn" disabled>
        Next in the side panel
      </button>
    );
  return (
    <button type="button" className={`btn${primary ? " p" : ""}`} disabled={disabled} onClick={() => onAsk(prompt)}>
      {children}
    </button>
  );
}

/** Advertise the job (design: SoonHiring): the ad today; posting to job boards is coming (Connections). */
function AdvertiseMenu({ onWrite }: { onWrite: () => void }) {
  const [open, setOpen] = useState(false);
  const { open: go } = useLive();
  return (
    <div style={{ position: "relative" }}>
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Advertise
        <Icon name="down" size={14} stroke={2} />
      </button>
      {open && (
        <>
          <div className="fill" style={{ zIndex: 29 }} onClick={() => setOpen(false)} />
          <div className="menu adv-menu" role="menu" aria-label="Advertise the job">
            <button type="button" role="menuitem" className="menu-item" onClick={() => (setOpen(false), onWrite())}>
              <b>Write the job ad</b>
              <span className="meta">MeritAI drafts it from the job description; you post it</span>
            </button>
            {[
              ["Post to SEEK", "Applications come straight into this job"],
              ["Post to LinkedIn Jobs", "Applicants collected here"],
              ["Post to Indeed", "Applicants collected here"],
            ].map(([t, d]) => (
              <button key={t} type="button" role="menuitem" className="menu-item row" disabled title="Coming soon">
                <span className="grow" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <b style={{ color: "#5F6878" }}>{t}</b>
                  <span className="meta">{d}</span>
                </span>
                <span className="pill soon">Coming soon</span>
              </button>
            ))}
            <button type="button" className="link-btn" style={{ padding: "8px 10px", fontSize: 13, fontWeight: 700, textAlign: "left" }} onClick={() => (setOpen(false), go({ kind: "connections" }))}>
              See all connections
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function NextStep({ n, title, text, done, children }: { n: number; title: string; text: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="next-step">
      <span className={`next-n${done ? " done" : ""}`}>{done ? <Icon name="check" size={14} stroke={2.6} /> : n}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <b style={{ fontSize: 14.5 }}>{title}</b>
        <span style={{ fontSize: 13.5, color: "#4A5363", lineHeight: 1.45 }}>{text}</span>
      </span>
      <span style={{ display: "flex", gap: 8 }}>{children}</span>
    </div>
  );
}

function HiredButton({ onClick, small }: { onClick: () => void; small?: boolean }) {
  return (
    <button type="button" className={`hired-pill${small ? " sm" : ""}`} onClick={onClick} title="Open in Staff">
      <Icon name="check" size={14} stroke={2.6} />
      Hired · in Staff
    </button>
  );
}

/** One job in the list: open or closed, where it is, and how many are hired of how many. */
function JobCard({ j, on, onPick }: { j: Job; on: boolean; onPick: () => void }) {
  const { recent } = useLive();
  const fresh = marks(recent, (r) => (r.kind === "job" || r.kind === "candidate" ? r.job : null)).get(j.job);
  const closed = !!j.closedAt;
  const pill = j.stage === "decided" ? `${j.shortlisted} shortlisted` : STAGE[j.stage];
  const tone = closed ? "n" : j.stage === "screened" || j.stage === "decided" || j.stage === "filled" ? "ok" : "warn";
  return (
    <button type="button" className={`job${on ? " on" : ""}${closed ? " closed" : ""}${fresh ? " fresh" : ""}`} onClick={onPick} title={fresh ? fresh.change.summary : undefined}>
      <span className="job-top">
        <b className="ellipsis grow">{j.job}</b>
        <span className={closed ? "job-state closed" : "job-state"}>{closed ? "Closed" : "Open"}</span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className={`pill ${tone}`} style={{ height: 22 }}>
          {pill}
        </span>
        <span className="meta">{j.stage === "needs-jd" ? plural(j.files, "file") : plural(j.applications, "application")}</span>
      </span>
      <span className="job-hired">
        <span className="hire-dots" aria-hidden="true">
          {Array.from({ length: Math.min(j.openings, 12) }, (_, i) => (
            <span key={i} className={i < j.hired ? "on" : ""} />
          ))}
        </span>
        Hired {j.hired} of {j.openings}
        {closed && j.closedAt ? ` · closed ${fmtDay(localDay(j.closedAt))}` : ""}
      </span>
    </button>
  );
}

/** A closed job (design: HiringClosed): everything kept, read-only; reopen or duplicate. */
function ClosedPane({ p, sub, hires, steps }: { p: Parameters<typeof JobPane>[0]; sub: string; hires: Map<string, JobResults["hires"][number]>; steps: number }) {
  const r = p.result;
  const dec = new Map(r.decisions.map((d) => [d.file, d.decision]));
  const labels = [p.job.jd ? "Job description" : "No job description", r.rubric?.confirmed ? "Criteria confirmed" : "Criteria", `${r.ranked.length} screened`, `${r.hires.length} of ${r.openings} hired`].slice(0, steps);
  const rows = p.showAll ? r.ranked : r.ranked.slice(0, TOP);
  return (
    <>
      <div className="page-h">
        <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <h2 className="h1 ellipsis" style={{ fontSize: 20 }}>
              {p.job.job}
            </h2>
            <span className="pill n" style={{ height: 22 }}>
              Closed
            </span>
          </span>
          <span className="meta ellipsis">{sub}</span>
        </div>
        <button type="button" className="btn" onClick={p.onDuplicate}>
          Duplicate job
        </button>
        <button type="button" className="btn p" onClick={p.onReopen}>
          Reopen
        </button>
      </div>
      <div className="job-body">
        <ol className="steps4 closed" aria-label="Steps">
          {labels.map((l) => (
            <li key={l} className="done">
              <Icon name="check" size={16} stroke={2.4} />
              {l}
            </li>
          ))}
        </ol>
        {p.error && (
          <div className="banner bad" role="alert">
            <span className="grow">{p.error}</span>
          </div>
        )}
        {p.note && (
          <div className="banner info">
            <span>{p.note}</span>
          </div>
        )}
        <div className="banner n" style={{ alignItems: "center", flexShrink: 0 }}>
          <Icon name="lock" size={20} />
          <span className="grow">
            <b>Closed {fmtDay(localDay(r.closedAt!))}.</b> Hired {r.hires.length} of {r.openings}
            {r.hires.length ? `: ${r.hires.map((h) => h.name).join(", ")}` : ""}. Everything is kept and read-only. Reopen to screen new applications or change decisions, or duplicate it to hire for the same role again.
          </span>
        </div>
        {r.ranked.length > 0 && (
          <div className="card" style={{ overflow: "hidden", flexShrink: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 16, width: 36 }}>#</th>
                  <th>Candidate</th>
                  <th>Band</th>
                  <th>Essential</th>
                  <th className="opt-col">Desirable</th>
                  <th className="opt-col">Summary</th>
                  <th style={{ width: 170 }}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.file} className={p.cand?.file === c.file ? "sel" : ""}>
                    <td style={{ paddingLeft: 16 }}>{c.rank}</td>
                    <td className="b" style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="name-btn" onClick={() => p.onPick(c)}>
                        {c.name}
                      </button>
                    </td>
                    <td>
                      <span className={`pill ${BAND[c.band] ?? "n"}`}>{c.band}</span>
                    </td>
                    <td>
                      {c.essentialScore} of {c.essentialTotal}
                    </td>
                    <td className="opt-col">
                      {c.desirableScore} of {c.desirableTotal}
                    </td>
                    <td className="ellipsis opt-col" style={{ maxWidth: 200 }}>
                      {c.evaluation.summary}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {hires.has(c.file) ? (
                        <HiredButton small onClick={() => p.onOpenEmployee(hires.get(c.file)!.employeeId)} />
                      ) : dec.get(c.file) === "shortlist" ? (
                        <span className="pill ok">Shortlisted</span>
                      ) : dec.get(c.file) === "not" ? (
                        <span className="pill n">Not this time</span>
                      ) : (
                        <span className="meta">No decision</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!p.showAll && r.ranked.length > TOP && (
              <div style={{ padding: "10px 16px" }}>
                <button type="button" className="link-btn" style={{ fontSize: 14, fontWeight: 700 }} onClick={p.onShowAll}>
                  Show all {r.ranked.length}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** Duplicate a job (design: HiringDuplicate): a new open job with the JD and criteria only. */
function DuplicateJob({ api, from, existing, onClose, onDone }: { api: Api; from: string; existing: string[]; onClose: () => void; onDone: (job: string) => void }) {
  const suggest = () => {
    for (let n = 2; ; n++) if (!existing.includes(`${from} (${n})`)) return `${from} (${n})`;
  };
  const [name, setName] = useState(suggest);
  const [openings, setOpenings] = useState("1");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await api.call("duplicateJob", { job: from, name: name.trim(), openings: Number(openings) });
      onDone(r.job);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="scrim fill" onClick={onClose} />
      <div className="modal dialog" role="dialog" aria-modal="true" aria-label="Duplicate job" style={{ width: 520 }}>
        <div>
          <h2 className="h2" style={{ fontSize: 19 }}>
            Duplicate “{from}”
          </h2>
          <span className="meta">A new open job for the same role, to hire again.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 12 }}>
          <label className="field">
            Name of the new job
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <span className="hint">Folder: Jobs/{name.trim() || "…"}</span>
          </label>
          <label className="field">
            People to hire
            <input className="input" type="number" min={1} max={99} value={openings} onChange={(e) => setOpenings(e.target.value)} />
          </label>
        </div>
        <div className="dup-note">
          <span>
            <b style={{ color: "#1E6B3E" }}>Copied:</b> the job description and the confirmed criteria.
          </span>
          <span>
            <b style={{ color: "#1B1F27" }}>Not copied:</b> applications, decisions and hires. Add the new applications to the new job.
          </span>
        </div>
        {err && <div className="banner bad">{err}</div>}
        <div className="row-wrap">
          <button type="button" className="btn p lg" disabled={!name.trim() || !(Number(openings) >= 1) || saving} onClick={() => void save()}>
            {saving ? "Duplicating…" : "Duplicate job"}
          </button>
          <button type="button" className="btn lg" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

/** "screened 3/5" → 60. */
function progressPct(progress: string | null): number {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(progress ?? "");
  return m && Number(m[2]) ? Math.round((Number(m[1]) / Number(m[2])) * 100) : 8;
}

function CritLine({ kind, items }: { kind: "Essential" | "Desirable"; items: string[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 13, alignItems: "center" }}>
      <span className={`pill ${kind === "Essential" ? "info" : "n"}`}>{kind}</span>
      {items.map((t, i) => (
        <span key={t} style={{ display: "contents" }}>
          {i > 0 && <span style={{ color: "#5F6878" }}>·</span>}
          <span>{t}</span>
        </span>
      ))}
    </div>
  );
}

function Candidate({
  c,
  result,
  decision,
  onDecide,
  hire,
  closed,
  onOpenEmployee,
  onClose,
  onOpen,
  onInvite,
  onPhone,
}: {
  c: Ranked;
  result: JobResults;
  decision: Decision | null;
  onDecide: (d: Decision | null) => void;
  hire: JobResults["hires"][number] | null;
  closed: boolean;
  onOpenEmployee: (id: number) => void;
  onClose: () => void;
  onOpen: () => void;
  onInvite: () => void;
  onPhone: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const crit = new Map((result.rubric?.criteria ?? []).map((x) => [x.id, x]));
  const ev = c.evaluation;
  const flagged = ev.flags.suspiciousInstructions || ev.flags.differentRole;
  const lists: [string, string[]][] = [
    ["Strengths", ev.strengths],
    ["Gaps", ev.gaps],
    ["Ask in the interview", ev.questions],
  ];
  return (
    <aside className="drawer side" style={{ width: 460 }} aria-label={c.name}>
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
          <div className="row-wrap" style={{ alignItems: "center", marginTop: 6 }}>
            <span className="cap" style={{ marginRight: 4 }}>
              Your decision
            </span>
            {hire ? (
              <HiredButton onClick={() => onOpenEmployee(hire.employeeId)} />
            ) : closed ? (
              <span className={`pill ${decision === "shortlist" ? "ok" : "n"}`}>{decision === "shortlist" ? "Shortlisted" : decision === "not" ? "Not this time" : "No decision"}</span>
            ) : (
              <DecisionButtons name={c.name} value={decision} onChange={onDecide} large />
            )}
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
          {ev.criteria.map((x) => (
            <div key={x.id} className="crit-row">
              <span className={`pill ${STATUS[x.status]?.[1] ?? "n"}`} style={{ width: 112, justifyContent: "center", flexShrink: 0 }}>
                {STATUS[x.status]?.[0] ?? x.status}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13.5 }}>
                <b>
                  {crit.get(x.id)?.text ?? x.id}
                  {crit.get(x.id)?.type === "desirable" && <span className="meta"> · desirable</span>}
                </b>
                {x.evidence && <span style={{ color: "#4A5363" }}>{x.evidence}</span>}
              </span>
            </div>
          ))}
          {ev.criteria.some((x) => x.status === "not_evidenced") && (
            <p className="meta" style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
              "Not evidenced" means the application doesn't show it, not that the person lacks it. A quick phone screen can fill the gaps.
            </p>
          )}
        </section>
        {lists.map(([t, xs]) =>
          xs.length ? (
            <section key={t}>
              <h3 className="cap" style={{ margin: "0 0 4px" }}>
                {t}
              </h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.55 }}>
                {xs.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
      </div>
      <div className="drawer-f">
        {flagged ? (
          <>
            <button type="button" className="btn" onClick={onOpen}>
              Open the application
            </button>
            <button type="button" className="btn p" style={{ flexGrow: 1 }} onClick={onPhone}>
              Draft a phone screen
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn p" style={{ flexGrow: 1 }} onClick={onInvite}>
              Draft an interview invite
            </button>
            <button type="button" className="btn" onClick={onOpen}>
              Open the application
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- new jobs

type Picked = { file: File; rel: string };

/** Files of a dropped folder (with their paths inside it), read through the browser's entry API. */
async function filesFromDrop(e: React.DragEvent): Promise<Picked[]> {
  const out: Picked[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));
      out.push({ file, rel: path + entry.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (!batch.length) break;
        for (const x of batch) await walk(x, `${path}${entry.name}/`);
      }
    }
  };
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry()).filter((x): x is FileSystemEntry => x !== null);
  for (const x of entries) await walk(x, "");
  return out;
}

/** A folder → a job: its name, the JD at its top level, every other file an application. */
function splitFolder(files: Picked[]): { job: string; jd: File | null; apps: File[] } | null {
  const top = files[0]?.rel.split("/")[0];
  if (!top || !files.every((f) => f.rel.includes("/"))) return null;
  const inside = files.map((f) => ({ ...f, rel: f.rel.slice(top.length + 1) })).filter((f) => !f.rel.split("/").pop()!.startsWith("."));
  const jd = inside.find((f) => !f.rel.includes("/") && JD_FILE.test(f.rel)) ?? null;
  return { job: top, jd: jd?.file ?? null, apps: inside.filter((f) => f !== jd).map((f) => f.file) };
}

function FolderDrop({ api, disabled, onCreated, onError }: { api: Api; disabled: boolean; onCreated: (job: string, note: React.ReactNode) => void; onError: (e: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const create = async (files: Picked[]) => {
    const f = splitFolder(files);
    if (!f) return onError("Drop one folder: the job description (JD in the file name) and the applications inside it.");
    setSaving(true);
    try {
      const file = async (x: File) => ({ name: x.name, base64: await toBase64(x) });
      const r = await api.call("createJob", { job: f.job, jd: f.jd ? await file(f.jd) : null, applications: await Promise.all(f.apps.map(file)) });
      onCreated(r.job, <>{createdNote(r, false)}</>);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className={`folder-drop${over ? " over" : ""}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled && !saving) void filesFromDrop(e).then(create);
      }}
    >
      <Icon name="folder" size={22} />
      <b>{saving ? "Adding the folder…" : "Start a job from a folder"}</b>
      <span>Drop a folder with the job description (JD in the file name) and the applications.</span>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        {...{ webkitdirectory: "" }}
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])].map((file) => ({ file, rel: file.webkitRelativePath || file.name }));
          e.target.value = "";
          void create(picked);
        }}
      />
      <button type="button" className="btn sm" disabled={disabled || saving} onClick={() => input.current?.click()}>
        Choose folder
      </button>
    </div>
  );
}

function createdNote(r: { job: string; summary: { newApplications: number; unreadable: { file: string }[]; duplicates: unknown[] }; refused: { name: string; reason: string }[] }, adding: boolean): React.ReactNode {
  return (
    <>
      <b>
        {adding ? "Added to" : "Created"} “{r.job}”.
      </b>{" "}
      {plural(r.summary.newApplications, "new application")}
      {r.summary.unreadable.length ? `, ${r.summary.unreadable.length} can't be read (${r.summary.unreadable.map((u) => u.file).join(", ")})` : ""}
      {r.summary.duplicates.length ? `, ${plural(r.summary.duplicates.length, "duplicate")} skipped` : ""}
      {r.refused.length ? `. Not added: ${r.refused.map((x) => `${x.name} (${x.reason})`).join("; ")}` : ""}.
    </>
  );
}

function NewJob({ api, existing, onClose, onCreated, onWriteJd }: { api: Api; existing: string[]; onClose: () => void; onCreated: (job: string, note: React.ReactNode) => void; onWriteJd: (name: string) => void }) {
  const [name, setName] = useState("");
  const [openings, setOpenings] = useState("1");
  const [jd, setJd] = useState<File | null>(null);
  const [apps, setApps] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const jdInput = useRef<HTMLInputElement>(null);
  const appsInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const role = name.trim();
  const adding = existing.includes(role);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const file = async (f: File) => ({ name: f.name, base64: await toBase64(f) });
      const r = await api.call("createJob", { job: role, jd: jd ? await file(jd) : null, applications: await Promise.all(apps.map(file)), ...(adding ? {} : { openings: Number(openings) }) });
      onCreated(r.job, createdNote(r, adding));
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
        <div>
          <h2 className="h2" style={{ fontSize: 19 }}>
            New job
          </h2>
          <span className="meta">Creates a folder in Jobs for this role's job description and applications.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 12 }}>
          <label className="field">
            Role
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Casual cleaner (Parramatta)" autoFocus list="jobs-list" />
            <datalist id="jobs-list">
              {existing.map((j) => (
                <option key={j} value={j} />
              ))}
            </datalist>
            <span className="hint">{adding ? "This job exists: the files are added to it." : `Folder: Jobs/${role || "…"}`}</span>
          </label>
          {!adding && (
            <label className="field">
              People to hire
              <input className="input" type="number" min={1} max={99} value={openings} onChange={(e) => setOpenings(e.target.value)} />
              <span className="hint">Change it any time</span>
            </label>
          )}
        </div>
        <div className="field">
          <span>
            Job description <span className="meta">· Add a file · PDF, Word or text; saved with JD in its name</span>
          </span>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setJd(e.dataTransfer.files[0] ?? null);
            }}
          >
            <input ref={jdInput} type="file" hidden accept=".pdf,.docx,.txt,.md" onChange={(e) => (setJd(e.target.files?.[0] ?? null), (e.target.value = ""))} />
            <span className="meta">{jd ? jd.name : "Drop the job description here"}</span>
            <button type="button" className="btn sm" onClick={() => jdInput.current?.click()}>
              {jd ? "Change file" : "Choose file"}
            </button>
          </div>
          <span className="meta">
            or{" "}
            <button type="button" className="link-btn" onClick={() => onWriteJd(role)}>
              Write one with the adviser
            </button>{" "}
            then save it into the job
          </span>
        </div>
        <div className="field">
          Applications
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void filesFromDrop(e).then((fs) => setApps((a) => [...a, ...fs.map((x) => x.file)]));
            }}
          >
            <span className="meta">
              {apps.length ? `${plural(apps.length, "file")}: ${apps.slice(0, 4).map((f) => f.name).join(", ")}${apps.length > 4 ? "…" : ""}` : "Drop resumes or a folder here, or add them later"}
            </span>
            <input ref={appsInput} type="file" multiple hidden accept=".pdf,.docx,.txt,.md" onChange={(e) => (setApps((a) => [...a, ...(e.target.files ?? [])]), (e.target.value = ""))} />
            <button type="button" className="btn sm" onClick={() => appsInput.current?.click()}>
              Choose files
            </button>
          </div>
          <span className="meta">Scanned PDFs without text can't be read; ask for a Word or text version.</span>
        </div>
        {err && <div className="banner bad">{err}</div>}
        <div className="row-wrap">
          <button type="button" className="btn p lg" disabled={!role || (!jd && !apps.length) || saving} onClick={() => void save()}>
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
