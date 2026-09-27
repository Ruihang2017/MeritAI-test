import { mkdirSync, realpathSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, parse, dirname, sep, relative } from "node:path";
import { homedir } from "node:os";
import { allCodexHomes } from "../engine/codexHome";

/**
 * Where users drop files for the assistant and where it saves documents:
 * - Jobs/<job>/   one workspace per role: a JD file plus applications (any subfolders)
 * - Inbox/        loose files not tied to a job (read-only to the model)
 * - Outbox/       documents the assistant saves (write-only, never overwrites)
 * - Policies/     the business's own policies and handbook (read-only to the model)
 * - .assistant/   the assistant's own data for this business (business profile, catalog); never exposed to the model
 *
 * One files root is one business workspace.
 *
 * The file tools run in our Node process with the user's full permissions; the
 * Codex sandbox does not apply. These checks are the security boundary.
 */

export interface Folders {
  root: string;
  inbox: string;
  outbox: string;
  jobs: string;
  policies: string;
  /** Internal data (catalog database); not reachable through any tool. */
  data: string;
}

export const INBOX = "Inbox";
export const OUTBOX = "Outbox";
export const JOBS = "Jobs";
export const POLICIES = "Policies";
export const DATA = ".assistant";

export function defaultFilesRoot(projectRoot: string): string {
  // The desktop app's default is a folder in the user's Documents (FX_FILES_ROOT).
  return process.env.FX_FILES_ROOT ?? join(projectRoot, "files");
}

/** Creates Inbox/Outbox/Jobs/Policies under root if needed. */
export function ensureFolders(root: string): Folders {
  const f = { root, inbox: join(root, INBOX), outbox: join(root, OUTBOX), jobs: join(root, JOBS), policies: join(root, POLICIES), data: join(root, DATA) };
  for (const d of [f.inbox, f.outbox, f.jobs, f.policies, f.data]) mkdirSync(d, { recursive: true });
  return f;
}

/** A job id is its folder name under Jobs/: letters, digits, space, dot, dash, underscore. */
export function checkJobId(job: string): string {
  const j = String(job ?? "").trim();
  if (!j || j.length > 80 || !/^[\p{L}\p{N} ._()-]+$/u.test(j) || j.startsWith(".") || j.includes("..")) {
    throw new Error(`invalid job name "${j}" (use letters, digits, spaces, brackets, dots, dashes or underscores)`);
  }
  return j;
}

export function listJobs(f: Folders): string[] {
  return readdirSync(f.jobs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

/** The job's folder; throws if it does not exist (or escapes Jobs/ through a link). */
export function jobDir(f: Folders, job: string): string {
  const dir = join(f.jobs, checkJobId(job));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`no job named "${job}"`);
  if (!isSameOrInside(realpathSync(dir), realpathSync(f.jobs))) throw new Error("that job folder points outside Jobs and cannot be used");
  return dir;
}

export interface TreeFile {
  /** Path relative to the walked root, with "/" separators. */
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

/** Max folder depth and files returned by walk(); larger trees are cut with a note. */
export const MAX_WALK_DEPTH = 6;
export const MAX_WALK_FILES = 5000;

/**
 * Lists files under dir recursively. Skips hidden entries, Office lock files
 * (~$...), and any link or junction whose real target is outside dir.
 */
export function walk(dir: string): { files: TreeFile[]; truncated: boolean } {
  const realRoot = realpathSync(dir);
  const files: TreeFile[] = [];
  let truncated = false;
  const visit = (d: string, depth: number) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
      const abs = join(d, e.name);
      let real: string;
      try {
        real = realpathSync(abs);
      } catch {
        continue;
      }
      if (!isSameOrInside(real, realRoot)) continue;
      const st = statSync(real);
      if (st.isDirectory()) {
        if (depth < MAX_WALK_DEPTH) visit(abs, depth + 1);
        else truncated = true;
      } else if (st.isFile()) {
        if (files.length >= MAX_WALK_FILES) {
          truncated = true;
          return;
        }
        files.push({ rel: relative(dir, abs).split(sep).join("/"), abs: real, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  visit(dir, 0);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, truncated };
}

/**
 * Resolves a relative path like "sub/Resume.pdf" inside root. Every segment
 * must be a safe name, and the real path must stay inside the real root.
 */
export function resolveRelInside(root: string, rel: string): string {
  const parts = String(rel ?? "").split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.length > MAX_WALK_DEPTH + 1) throw new Error("invalid path");
  for (const part of parts) checkFileName(part);
  const candidate = join(root, ...parts);
  if (!existsSync(candidate)) throw new Error(`no file "${parts.join("/")}"`);
  const real = realpathSync(candidate);
  if (!isSameOrInside(real, realpathSync(root))) throw new Error("that file points outside the folder and cannot be used");
  if (!statSync(real).isFile()) throw new Error("not a file");
  return real;
}

const norm = (p: string) => resolve(p).replace(/[\\/]+$/, "").toLowerCase();
export const isSameOrInside = (child: string, parent: string) => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + sep) || c.startsWith(p + "/");
};

/**
 * Validates a user-chosen root for Inbox/Outbox. Returns the absolute path or
 * throws with a user-facing reason. Refuses system and sensitive locations.
 */
export function validateFilesRoot(input: string, ctx: { projectRoot: string; codexHome: string; memoryRoot: string }): string {
  const raw = input.trim().replace(/^["']|["']$/g, "");
  if (!raw) throw new Error("empty path");
  const abs = resolve(raw);
  if (existsSync(abs) && !statSync(abs).isDirectory()) throw new Error("not a folder");

  if (norm(abs) === norm(parse(abs).root)) throw new Error("a whole drive is too broad; pick a folder");
  const home = homedir();
  if (norm(abs) === norm(home)) throw new Error("your whole user folder is too broad; pick a subfolder");

  const forbidden: [string | undefined, string][] = [
    [process.env.SystemRoot ?? process.env.windir, "the Windows folder"],
    [process.env.ProgramFiles, "Program Files"],
    [process.env["ProgramFiles(x86)"], "Program Files"],
    [process.env.ProgramW6432, "Program Files"],
    [process.env.ProgramData, "ProgramData"],
    [join(home, "AppData"), "AppData"],
    ...[ctx.codexHome, ...allCodexHomes(ctx.projectRoot)].map((d): [string, string] => [d, "the assistant's engine folder (contains credentials)"]),
    [ctx.memoryRoot, "the assistant's memory folder"],
    [join(ctx.projectRoot, "src"), "the assistant's source code"],
  ];
  for (const [dir, label] of forbidden) {
    if (dir && isSameOrInside(abs, dir)) throw new Error(`cannot use ${label}`);
  }
  // A parent of these folders is fine: the model only ever reaches <root>/Inbox and <root>/Outbox.
  return abs;
}

const BAD_CHARS = /[\\/:*?"<>|\x00-\x1f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A bare file name from the model: no paths, no reserved names. Throws if unsafe. */
export function checkFileName(name: string): string {
  const n = String(name ?? "").trim();
  if (!n) throw new Error("empty file name");
  if (n.length > 150) throw new Error("file name too long");
  if (n === "." || n === ".." || n.includes("..")) throw new Error("invalid file name");
  if (BAD_CHARS.test(n)) throw new Error("file name must not contain a path or any of \\ / : * ? \" < > |");
  if (RESERVED.test(n)) throw new Error("reserved file name");
  if (/[. ]$/.test(n)) throw new Error("file name must not end with a dot or space");
  return n;
}

/**
 * Resolves `name` inside `dir` and verifies, after following links and
 * junctions, that the real file sits directly in the real `dir`.
 */
export function resolveInside(dir: string, name: string): string {
  const safe = checkFileName(name);
  const candidate = join(dir, safe);
  if (!existsSync(candidate)) throw new Error(`no file named "${safe}"`);
  const real = realpathSync(candidate);
  const realDir = realpathSync(dir);
  if (norm(dirname(real)) !== norm(realDir)) throw new Error("that file points outside the folder and cannot be used");
  return real;
}

/** Turns a model-proposed document name into a safe file name stem (for saving). */
export function sanitizeStem(name: string): string {
  let s = String(name ?? "")
    .replace(/\.(md|docx|txt)$/i, "")
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (RESERVED.test(s)) s = `_${s}`;
  s = s.slice(0, 100).trim();
  return s || "document";
}
