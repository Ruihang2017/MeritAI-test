import type { Catalog, Decision } from "../screening/catalog";
import { nameFromFile } from "../screening/blind";
import type { Register } from "./register";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkJobId, jobDir, listJobs, type Folders } from "../files/folders";
import { markdownToDocx } from "../files/docx";

/**
 * Hiring steps shared by the Hiring page and the adviser's tools, so a hire or a decision made
 * in the chat is the same as one made with the buttons (owner, 2026-09-27: one action, one path).
 */

export interface CandidateRow {
  file: string;
  name: string;
  hash: string;
  screened: boolean;
  decision: Decision | null;
  /** The employee they became, if hired from this job. */
  employeeId: number | null;
}

/** A job's applications that could be read (screened against the current criteria or not), with decisions and hires. */
export function candidates(cat: Catalog, job: string): CandidateRow[] {
  const r = cat.latestRubric(job);
  const decisions = cat.decisions(job);
  const hires = cat.hires(job);
  return cat
    .applications(job)
    .filter((a) => a.status === "ok")
    .map((a) => ({
      file: a.sourceRef,
      name: a.displayName ?? nameFromFile(a.sourceRef),
      hash: a.hash,
      screened: !!(r?.confirmed && cat.getEvaluation(a.hash, job, r.version)),
      decision: decisions.get(a.hash)?.decision ?? null,
      employeeId: hires.get(a.hash)?.employeeId ?? null,
    }));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * One candidate of a job by application file (exact) or name ("Hannah", "Hannah Cole").
 * Several matches or none: an error listing who there is, for the adviser to ask the owner.
 */
export function findCandidate(cat: Catalog, job: string, who: string): { ok: true; candidate: CandidateRow } | { ok: false; error: string } {
  const all = candidates(cat, job);
  if (!all.length) return { ok: false, error: `"${job}" has no readable applications` };
  const w = norm(who);
  const exact = all.filter((c) => c.file === who || norm(c.name) === w);
  const loose = exact.length ? exact : all.filter((c) => norm(c.name).split(" ").includes(w) || norm(c.name).includes(w) || norm(c.file).includes(w));
  if (loose.length === 1) return { ok: true, candidate: loose[0] };
  const names = (loose.length ? loose : all).slice(0, 25).map((c) => `${c.name} (${c.file})`).join("; ");
  return { ok: false, error: loose.length ? `more than one candidate matches "${who}": ${names}. Ask the owner which one` : `no candidate called "${who}" in "${job}". Candidates: ${names}` };
}

/**
 * Records a hire: the application `file` of `job` became employee `employeeId`. It also
 * shortlists them. Deleting the employee undoes it (the Hiring page drops hires whose employee is gone).
 */
export function linkHire(cat: Catalog, register: Register, job: string, file: string, employeeId: number): void {
  const app = cat.applications(job).find((a) => a.sourceRef === file && a.status === "ok");
  if (!app) throw new Error(`"${file}" isn't a readable application of "${job}"`);
  if (!register.get(employeeId)) throw new Error("no such employee");
  cat.setDecision(job, app.hash, "shortlist");
  cat.addHire(job, app.hash, employeeId);
}

/**
 * A new open job: its folder, how many to hire, and the job description (markdown) saved as
 * "<job> JD.docx" so screening finds it. Returns the job name and the JD file, if any.
 */
export async function createJobWithJd(folders: Folders, cat: Catalog, name: string, openings: number, jd: string | null): Promise<{ job: string; jdFile: string | null }> {
  const job = checkJobId(name.trim());
  if (listJobs(folders).some((j) => j.toLowerCase() === job.toLowerCase())) throw new Error(`there is already a job called "${job}"`);
  if (!Number.isInteger(openings) || openings < 1 || openings > 99) throw new Error("people to hire must be a whole number from 1 to 99");
  mkdirSync(join(folders.jobs, job), { recursive: true });
  let jdFile: string | null = null;
  if (jd?.trim()) {
    jdFile = join(jobDir(folders, job), `${job} JD.docx`);
    writeFileSync(jdFile, await markdownToDocx(jd.trim(), `${job} JD`));
  }
  cat.setOpenings(job, openings);
  cat.notify({ ref: { kind: "job", job }, action: "created", summary: `${job} created` });
  return { job, jdFile };
}

/** How many were hired from the job (employees still in the register) and how many it is for. */
export function hireCount(cat: Catalog, register: Register, job: string): { hired: number; openings: number; closed: boolean } {
  const { openings, closedAt } = cat.jobSettings(job);
  const hired = [...cat.hires(job).values()].filter((h) => register.get(h.employeeId)).length;
  return { hired, openings, closed: closedAt !== null };
}
