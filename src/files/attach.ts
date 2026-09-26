import { constants, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, join, parse as parsePath } from "node:path";
import { checkJobId, isSameOrInside, type Folders } from "./folders";
import { READABLE } from "./parse";
import type { Catalog } from "../screening/catalog";
import { ingestJob, sha256, type IngestSummary, type Progress } from "../screening/pipeline";

/**
 * Drag and drop into the chat. A terminal turns a dropped file into its path
 * (quoted if it has spaces). The client, not the model, copies the file into
 * the Inbox: dropping is the user's own action, and the model still only
 * reaches Inbox/Jobs/Policies through the guarded file tools.
 */

export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
export const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

export interface DroppedPath {
  /** The text as it appeared in the message (with quotes). */
  raw: string;
  path: string;
}

const ABS = /^(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\)/;
const TRAILING = /[.,;:!?)\]]+$/;

/** Existing absolute paths in a message: "C:\a b\x.pdf", 'C:\x.pdf', C:\x.pdf, \\server\share\x.pdf. */
export function findDroppedPaths(line: string): DroppedPath[] {
  const out: DroppedPath[] = [];
  const seen = new Set<number>();
  const add = (raw: string, candidate: string, index: number) => {
    if (seen.has(index) || !ABS.test(candidate)) return;
    let p = candidate;
    if (!existsSync(p)) {
      const trimmed = p.replace(TRAILING, "");
      if (trimmed === p || !existsSync(trimmed)) return;
      raw = raw.slice(0, raw.length - (p.length - trimmed.length));
      p = trimmed;
    }
    seen.add(index);
    out.push({ raw, path: p });
  };
  for (const m of line.matchAll(/"([^"\r\n]+)"|'([^'\r\n]+)'/g)) add(m[0], (m[1] ?? m[2]).trim(), m.index);
  // Unquoted paths cannot contain spaces (a terminal quotes those).
  for (const m of line.matchAll(/(?<=^|\s)((?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>|*?]+)/g)) {
    const inQuotes = out.some((d) => line.indexOf(d.raw) <= m.index && m.index < line.indexOf(d.raw) + d.raw.length);
    if (!inQuotes) add(m[1], m[1], m.index);
  }
  return out.sort((a, b) => line.indexOf(a.raw) - line.indexOf(b.raw));
}

export type AttachResult =
  | { kind: "file"; source: string; name: string; path: string; image: boolean; reused: boolean }
  | { kind: "folder"; source: string }
  | { kind: "refused"; source: string; reason: string };

const sha = (p: string) => sha256(readFileSync(p));

/**
 * Copies one dropped file into the Inbox (never overwriting; an identical file
 * already there is reused). Folders are returned for the caller to offer a job import.
 */
export function attachToInbox(f: Folders, source: string, forbidden: string[]): AttachResult {
  let real: string;
  try {
    real = realpathSync(source);
  } catch {
    return { kind: "refused", source, reason: "not found" };
  }
  for (const dir of [...forbidden, f.data]) {
    if (existsSync(dir) && isSameOrInside(real, realpathSync(dir))) return { kind: "refused", source, reason: "that is one of the assistant's own folders" };
  }
  const st = statSync(real);
  if (st.isDirectory()) return { kind: "folder", source: real };
  if (!st.isFile()) return { kind: "refused", source, reason: "not a file" };
  const ext = extname(real).toLowerCase();
  const image = IMAGE_EXTS.includes(ext);
  if (!image && !READABLE.includes(ext)) {
    return { kind: "refused", source, reason: `unsupported type "${ext || "(none)"}" (supported: ${[...READABLE, ...IMAGE_EXTS].join(", ")})` };
  }
  if (st.size > MAX_ATTACH_BYTES) return { kind: "refused", source, reason: `larger than ${MAX_ATTACH_BYTES / 1024 / 1024} MB` };

  // Already directly in the Inbox: nothing to copy.
  if (dirname(real).toLowerCase() === realpathSync(f.inbox).toLowerCase()) {
    return { kind: "file", source: real, name: basename(real), path: real, image, reused: true };
  }

  const { name: stem } = parsePath(real);
  let hash: string | null = null;
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${stem}${ext}` : `${stem} (${i})${ext}`;
    const dest = join(f.inbox, name);
    if (existsSync(dest)) {
      hash ??= sha(real);
      if (statSync(dest).size === st.size && sha(dest) === hash) return { kind: "file", source: real, name, path: dest, image, reused: true };
      continue;
    }
    try {
      copyFileSync(real, dest, constants.COPYFILE_EXCL);
      return { kind: "file", source: real, name, path: dest, image, reused: false };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  return { kind: "refused", source, reason: "too many files with this name in the Inbox" };
}

/** The message the model gets: each dropped path replaced by a short attachment note. */
export function rewriteMessage(line: string, dropped: DroppedPath[], results: AttachResult[]): string {
  let out = line;
  dropped.forEach((d, i) => {
    const r = results[i];
    if (r?.kind === "file") out = out.replace(d.raw, `[attached: "${r.name}" (in the Inbox${r.image ? "; image shown to you" : ""})]`);
  });
  return out.trim();
}

/**
 * Copies a folder (or one file) into Jobs/<job>/ without overwriting anything,
 * then catalogues it. Used by /import and by dropping a folder into the chat.
 */
export async function importIntoJob(
  f: Folders,
  catalog: Catalog,
  source: string,
  job: string | null,
  progress?: Progress,
): Promise<{ job: string; summary: IngestSummary }> {
  if (!existsSync(source)) throw new Error(`not found: ${source}`);
  const id = checkJobId(job?.trim() || basename(source.replace(/[\\/]+$/, "")));
  const dest = join(f.jobs, id);
  mkdirSync(dest, { recursive: true });
  if (statSync(source).isDirectory()) cpSync(source, dest, { recursive: true, force: false, errorOnExist: false });
  else cpSync(source, join(dest, basename(source)), { force: false, errorOnExist: false });
  return { job: id, summary: await ingestJob(catalog, f, id, progress) };
}
