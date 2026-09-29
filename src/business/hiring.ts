import type { Catalog, Decision } from "../screening/catalog";
import { nameFromFile } from "../screening/blind";
import type { Register } from "./register";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { checkJobId, jobDir, listJobs, resolveInside, walk, type Folders } from "../files/folders";
import { READABLE } from "../files/parse";
import { ingestJob, sha256, type IngestSummary } from "../screening/pipeline";
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

/**
 * Moves application files the owner attached (they are in the Inbox) into a job, so they can be screened
 * (owner, 2026-09-29: resumes sent in the chat stayed in the Inbox and the adviser could only say "move them
 * yourself"). A move, not a copy: the Inbox file is already the app's copy of what the owner dropped. A file
 * identical to one already in the job isn't added twice (its Inbox copy goes); another file with the same
 * name gets " (2)". Readable types only (PDF, Word, text); then the job is catalogued.
 */
export async function moveInboxToJob(
  folders: Folders,
  cat: Catalog,
  job: string,
  names: string[],
): Promise<{ moved: string[]; already: string[]; refused: { name: string; reason: string }[]; summary: IngestSummary }> {
  const dir = jobDir(folders, job);
  const moved: string[] = [];
  const already: string[] = [];
  const refused: { name: string; reason: string }[] = [];
  const inJob = new Map(walk(dir).files.map((f) => [sha256(readFileSync(f.abs)), f.rel]));
  for (const name of names) {
    let src: string;
    try {
      src = resolveInside(folders.inbox, name);
    } catch (e) {
      refused.push({ name, reason: (e as Error).message });
      continue;
    }
    const ext = extname(src).toLowerCase();
    if (!READABLE.includes(ext)) {
      refused.push({ name, reason: `not a readable application (${READABLE.join(", ")})` });
      continue;
    }
    const hash = sha256(readFileSync(src));
    if (inJob.has(hash)) {
      unlinkSync(src);
      already.push(name);
      continue;
    }
    let target = basename(src);
    for (let i = 2; existsSync(join(dir, target)); i++) target = `${basename(src, ext)} (${i})${ext}`;
    try {
      renameSync(src, join(dir, target));
    } catch {
      // Another volume or a lock: copy, then remove the Inbox copy.
      copyFileSync(src, join(dir, target));
      unlinkSync(src);
    }
    inJob.set(hash, target);
    moved.push(target);
  }
  const summary = await ingestJob(cat, folders, job);
  if (moved.length) cat.notify({ ref: { kind: "job", job }, action: "updated", summary: `${job}: ${moved.length} application(s) added` });
  return { moved, already, refused, summary };
}
