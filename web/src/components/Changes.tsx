import { useEffect, useState } from "react";
import type { JobSummary } from "../../../src/app/app";
import type { StaffRow } from "../../../src/server/protocol";
import type { Api } from "../api";
import type { TurnChange } from "../conversation";
import { fmtDay } from "../format";
import { todayIso } from "../clock";
import { useLive } from "../live";
import { Icon } from "./Icon";

/**
 * "What changed" under a reply (design: SyncChat): one card per thing the reply changed, showing
 * its state now (fetched, so it follows later changes too) and the next step.
 */
export function ChangeCards({ items, api, compact }: { items: TurnChange[]; api: Api; compact?: boolean }) {
  const { refreshKey } = useLive();
  const employees = items.filter((i) => i.ref.kind === "employee");
  // Candidates show inside their job's card.
  const jobNames = [...new Set(items.flatMap((i) => (i.ref.kind === "job" || i.ref.kind === "candidate" ? [i.ref.job] : [])))];
  const profile = items.some((i) => i.ref.kind === "profile");
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const wantStaff = employees.length > 0;
  const wantJobs = jobNames.length > 0;
  useEffect(() => {
    if (wantStaff) api.call("staff", { includeLeft: true }).then(setStaff, () => null);
    if (wantJobs) api.call("jobs").then(setJobs, () => null);
  }, [api, refreshKey, wantStaff, wantJobs]);
  if (!employees.length && !jobNames.length && !profile) return null;
  return (
    <section className={`changes${compact ? " compact" : ""}`} aria-label="What changed">
      <div className="cap">What changed</div>
      {employees.map((i) => i.ref.kind === "employee" && <EmployeeCard key={i.key} item={i} id={i.ref.id} name={i.ref.name} row={staff?.find((r) => r.id === (i.ref as { id: number }).id) ?? null} loaded={staff !== null} />)}
      {jobNames.map((job) => (
        <JobCard key={job} job={job} api={api} summary={jobs?.find((j) => j.job === job) ?? null} loaded={jobs !== null} items={items.filter((i) => (i.ref.kind === "job" || i.ref.kind === "candidate") && i.ref.job === job)} />
      ))}
      {profile && <ProfileCard />}
    </section>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function EmployeeCard({ item, id, name, row, loaded }: { item: TurnChange; id: number; name: string; row: StaffRow | null; loaded: boolean }) {
  const { open } = useLive();
  const last = item.actions[item.actions.length - 1];
  if (loaded && !row)
    return (
      <article className="card chg">
        <div className="chg-h">
          <span className="chg-av">{initials(name)}</span>
          <div className="chg-t">
            <b>{name}</b>
            <span className="meta">Deleted from the register</span>
          </div>
          <span className="cap chg-where">Staff</span>
        </div>
      </article>
    );
  const pill = item.actions.includes("added") ? ["New · added by MeritAI", "info"] : last === "left" ? ["Marked as left", "n"] : last === "documents" ? ["Paperwork recorded", "ok"] : ["Updated by MeritAI", "info"];
  const missing = row && row.status === "active" ? row.documentsExpected.filter((d) => !d.recorded) : [];
  const starting = row ? row.startDate > todayIso() : false;
  return (
    <article className="card chg">
      <div className="chg-h">
        <span className="chg-av">{initials(row?.name ?? name)}</span>
        <div className="chg-t">
          <span className="chg-name">
            <b>{row?.name ?? name}</b>
            <span className={`pill ${pill[1]}`}>{pill[0]}</span>
          </span>
          {row && (
            <span className="meta">
              {row.role} · {cap(row.employmentType)} · {row.status === "left" ? `left ${row.leftDate ? fmtDay(row.leftDate) : ""}` : `${starting ? "starts" : "started"} ${fmtDay(row.startDate, { year: !starting })}`}
            </span>
          )}
        </div>
        <span className="cap chg-where">Staff</span>
      </div>
      {missing.length > 0 && (
        <div className="chg-body">
          <b>{starting ? `Before day one: ${missing.length} thing${missing.length > 1 ? "s" : ""}.` : `Starting paperwork: ${missing.length} not recorded.`}</b>{" "}
          {missing.map((d, i) => (
            <span key={d.id}>
              {i ? ", " : ""}
              <span>{d.label}</span>
            </span>
          ))}
          .
        </div>
      )}
      {row?.status === "active" && missing.length === 0 && last === "documents" && <div className="chg-body">All starting paperwork is recorded.</div>}
      <div className="row-wrap">
        <button type="button" className="btn sm" onClick={() => open({ kind: "employee", id })}>
          Open in Staff
        </button>
        {missing.length > 0 && (
          <button type="button" className="btn g sm" onClick={() => open({ kind: "employee", id, docs: true })}>
            Record paperwork
          </button>
        )}
      </div>
    </article>
  );
}

const CAND: Record<string, string> = { hired: "hired", emailed: "emailed", shortlisted: "shortlisted", not: "not this time", cleared: "decision cleared" };
const JOB: Record<string, string> = { created: "created", "criteria-drafted": "criteria drafted", "criteria-confirmed": "criteria confirmed", screened: "screened", applications: "new applications", openings: "people to hire changed", closed: "closed", reopened: "reopened" };

function JobCard({ job, api, summary: j, loaded, items }: { job: string; api: Api; summary: JobSummary | null; loaded: boolean; items: TurnChange[] }) {
  const { open } = useLive();
  const [closing, setClosing] = useState(false);
  const lines = items.map((i) => {
    const last = i.actions[i.actions.length - 1];
    if (i.ref.kind === "candidate") return `${i.ref.name} ${CAND[last] ?? last}`;
    return cap(JOB[last] ?? last);
  });
  const filled = j && j.hired >= j.openings;
  const pill = !j ? null : j.closedAt ? ["Closed", "n"] : j.stage === "needs-jd" ? ["No job description yet", "warn"] : j.stage === "criteria" ? ["Criteria to confirm", "warn"] : [`${j.hired} of ${j.openings} hired`, filled ? "ok" : "info"];
  if (loaded && !j)
    return (
      <article className="card chg">
        <div className="chg-h">
          <span className="chg-ic">
            <Icon name="hiring" size={18} />
          </span>
          <div className="chg-t">
            <b>{job}</b>
            <span className="meta">No longer on the Hiring page</span>
          </div>
        </div>
      </article>
    );
  return (
    <article className="card chg">
      <div className="chg-h">
        <span className="chg-ic">
          <Icon name="hiring" size={18} />
        </span>
        <div className="chg-t">
          <span className="chg-name">
            <b>{job}</b>
            {pill && <span className={`pill ${pill[1]}`}>{pill[0]}</span>}
          </span>
          <span className="meta">
            {[...lines, ...(j && j.shortlisted && !lines.some((l) => l.includes("shortlisted")) ? [`${j.shortlisted} shortlisted`] : [])].map((l, i) => (
              <span key={i}>
                {i ? " · " : ""}
                <span>{l}</span>
              </span>
            ))}
          </span>
        </div>
        <span className="cap chg-where">Hiring</span>
      </div>
      {j && !j.closedAt && j.openings > 0 && (
        <div className="chg-bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (j.hired / j.openings) * 100)}%` }} />
        </div>
      )}
      {filled && !j?.closedAt && <div className="chg-body">Everyone this job needs is hired. Close it when you're done (you can reopen it).</div>}
      <div className="row-wrap">
        <button type="button" className="btn sm" onClick={() => open({ kind: "job", job })}>
          Open job
        </button>
        {filled && !j?.closedAt && (
          <button type="button" className="btn g sm" disabled={closing} onClick={() => (setClosing(true), void api.call("closeJob", { job }).finally(() => setClosing(false)))}>
            Close the job
          </button>
        )}
      </div>
    </article>
  );
}

function ProfileCard() {
  const { open } = useLive();
  return (
    <article className="card chg">
      <div className="chg-h">
        <span className="chg-ic">
          <Icon name="building" size={18} />
        </span>
        <div className="chg-t">
          <b>Business profile</b>
          <span className="meta">Updated by MeritAI · used in every answer</span>
        </div>
        <span className="cap chg-where">Profile</span>
      </div>
      <div className="row-wrap">
        <button type="button" className="btn sm" onClick={() => open({ kind: "profile" })}>
          Open profile
        </button>
      </div>
    </article>
  );
}

/** A page's note about what the adviser changed while the owner was elsewhere (design: SyncStaff). */
export function ArrivalNote({ items, onDismiss }: { items: { summary: string; title: string | null }[]; onDismiss: () => void }) {
  const { open } = useLive();
  if (!items.length) return null;
  const titles = [...new Set(items.map((i) => i.title).filter(Boolean))];
  const what = items.length === 1 ? items[0].summary : `${items.length} changes: ${items.slice(-3).map((i) => i.summary).join("; ")}${items.length > 3 ? "…" : ""}`;
  return (
    <div className="banner info arrival" role="status">
      <span className="arrival-av" aria-hidden="true">
        M
      </span>
      <span className="grow">
        <b>MeritAI: {what}</b>
        {titles.length === 1 ? <> · in “{titles[0]}”</> : null}
      </span>
      <button type="button" className="btn g sm" onClick={() => open({ kind: "conversation" })}>
        Back to the conversation
      </button>
      <button type="button" className="ib" aria-label="Dismiss" onClick={onDismiss} style={{ width: 36, height: 36 }}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
