import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { jobDir, walk, type Folders } from "../files/folders";
import { extractText } from "../files/parse";
import { markdownToDocx } from "../files/docx";
import { JD_NAME, sha256 } from "../screening/pipeline";
import { now } from "../clock";

/**
 * A job's description on the Hiring page (owner, 2026-09-29; design: HiringJD, HiringJDOpen, HiringJDEdit,
 * HiringJDChanged): read it for the page, save the owner's edits or the adviser's new version, undo a save.
 * A job has one JD file (screening finds it by name), so a replaced version goes to the job's hidden
 * ".previous" folder (screening skips hidden entries), newest first; Undo brings the newest back.
 */

export const PREVIOUS = ".previous";
export const JD_FORMATS = [".docx", ".pdf", ".txt", ".md"];

export interface JdView {
  /** The JD file's name in the job folder. */
  file: string;
  format: "docx" | "pdf" | "txt" | "md";
  /** For the page: headings, paragraphs, bullet points and bold. A PDF gives plain paragraphs. */
  markdown: string;
  /** sha256 of its text, as screening computes it for the criteria (`Rubric.jdHash`). */
  hash: string;
  updatedAt: string;
  /** A replaced version is kept: Undo is possible. */
  canUndo: boolean;
}

/** The job's JD file (top level, JD in the name), or null. */
export function findJd(folders: Folders, job: string): string | null {
  return walk(jobDir(folders, job)).files.find((f) => !f.rel.includes("/") && JD_NAME.test(f.rel))?.rel ?? null;
}

/** mammoth's markdown escapes punctuation and writes bold as __x__. */
export function cleanMammoth(md: string): string {
  return md
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~'"])/g, "$1")
    .replace(/__(.+?)__/g, "**$1**")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function previousDir(folders: Folders, job: string): string {
  return join(jobDir(folders, job), PREVIOUS);
}

/** Kept versions, newest first: "<stamp> <original name>". */
function previousVersions(folders: Folders, job: string): string[] {
  const dir = previousDir(folders, job);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^\d{8}-\d{6}(-\d+)? /.test(n))
    .sort()
    .reverse();
}

const stamp = () => {
  const d = now();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Moves the current JD into ".previous" (a unique stamped name). */
function keepCurrent(folders: Folders, job: string, file: string): void {
  const dir = previousDir(folders, job);
  mkdirSync(dir, { recursive: true });
  let name = `${stamp()} ${file}`;
  for (let i = 1; existsSync(join(dir, name)); i++) name = `${stamp()}-${i} ${file}`;
  movable(() => renameSync(join(jobDir(folders, job), file), join(dir, name)));
}

/** A file open in Word can't be replaced: say so plainly. */
function movable<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") throw new Error("the job description is open in another program (Word?): close it there first, then save again");
    throw e;
  }
}

export async function readJd(folders: Folders, job: string): Promise<JdView | null> {
  const file = findJd(folders, job);
  if (!file) return null;
  const path = join(jobDir(folders, job), file);
  const format = extname(file).slice(1).toLowerCase() as JdView["format"];
  const text = (await extractText(path)).text;
  let markdown = text;
  if (format === "docx") {
    // convertToMarkdown keeps headings, lists and bold; it is in mammoth but not in its type definitions.
    const mammoth = (await import("mammoth")) as unknown as { convertToMarkdown(input: { path: string }): Promise<{ value: string }> };
    markdown = cleanMammoth((await mammoth.convertToMarkdown({ path })).value);
  }
  return { file, format, markdown: markdown.trim(), hash: sha256(text), updatedAt: statSync(path).mtime.toISOString(), canUndo: previousVersions(folders, job).length > 0 };
}

/**
 * Saves a new version (markdown) as a Word file: the current JD goes to ".previous" first. A Word JD keeps
 * its name; another format becomes "<job> JD.docx". Returns the file's name.
 */
export async function writeJd(folders: Folders, job: string, markdown: string): Promise<string> {
  const md = markdown.trim();
  if (!md) throw new Error("the job description is empty");
  const current = findJd(folders, job);
  const name = current && /\.docx$/i.test(current) ? current : `${job} JD.docx`;
  const data = await markdownToDocx(md, `${job} JD`);
  if (current) keepCurrent(folders, job, current);
  movable(() => writeFileSync(join(jobDir(folders, job), name), data));
  return name;
}

/** Replaces the JD with an uploaded file (docx, pdf, txt, md), keeping the current one. Returns its name. */
export function replaceJdFile(folders: Folders, job: string, uploadName: string, data: Buffer): string {
  const ext = extname(uploadName).toLowerCase();
  if (!JD_FORMATS.includes(ext)) throw new Error(`a job description must be ${JD_FORMATS.join(", ")}`);
  const current = findJd(folders, job);
  if (current) keepCurrent(folders, job, current);
  const name = `${job} JD${ext}`;
  movable(() => writeFileSync(join(jobDir(folders, job), name), data));
  return name;
}

/** Brings the newest kept version back; the current JD is kept in its place (so Undo again redoes). */
export function undoJd(folders: Folders, job: string): string {
  const [newest] = previousVersions(folders, job);
  if (!newest) throw new Error("there is no earlier version to go back to");
  const original = newest.replace(/^\d{8}-\d{6}(-\d+)? /, "");
  const current = findJd(folders, job);
  const back = join(previousDir(folders, job), newest);
  if (current) keepCurrent(folders, job, current);
  movable(() => renameSync(back, join(jobDir(folders, job), original)));
  return original;
}
