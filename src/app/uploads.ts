import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Attachments uploaded as bytes (a browser UI has no file paths). They are written to a
 * staging folder, then go through the same path flow as a drag and drop: loose files to
 * the Inbox, dropped folders offered as a job import. The caller deletes the staging folder.
 */

export interface Upload {
  /** The file name. */
  name: string;
  data: Buffer | Uint8Array;
  /** Path inside a dropped folder, including the file name (like `webkitRelativePath`), e.g. "Applicants/Jo Smith.pdf". */
  relPath?: string;
}

/** Prefix of staging folders in the OS temp folder. */
export const STAGING_PREFIX = "fx-upload-";

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * A name that is safe as one file or folder name: the last path segment only, no
 * characters Windows refuses, no trailing dots or spaces, no device names (CON, NUL, ...).
 * Null if nothing usable is left.
 */
export function safeName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? "";
  let s = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/[. ]+$/, "").trim();
  if (!s || s === "." || s === "..") return null;
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

/** Splits an upload into folder segments and a file name, or says why it is refused. */
export function uploadPath(u: Upload): { folders: string[]; name: string } | { error: string } {
  if (!u.relPath) {
    const name = safeName(u.name ?? "");
    return name ? { folders: [], name } : { error: "no usable file name" };
  }
  if (/^([a-zA-Z]:|[\\/])/.test(u.relPath)) return { error: "absolute paths are not accepted" };
  const parts = u.relPath.split(/[\\/]/).filter((p) => p !== "" && p !== ".");
  if (parts.includes("..")) return { error: "paths with .. are not accepted" };
  const safe = parts.map(safeName);
  if (!safe.length || safe.some((p) => p === null)) return { error: "no usable file name" };
  const segs = safe as string[];
  return { folders: segs.slice(0, -1), name: segs[segs.length - 1] };
}

export interface StagedUploads {
  /** The staging folder (delete it when done). */
  dir: string;
  /** Loose files, each in its own subfolder so equal names do not collide. */
  files: { index: number; label: string; path: string }[];
  /** Top-level dropped folders, with the index of their first upload. */
  folders: { index: number; label: string; path: string }[];
  refused: { index: number; label: string; reason: string }[];
}

/** Writes uploads to a new staging folder; oversize and unsafe uploads are refused, not written. */
export function stageUploads(uploads: Upload[], maxBytes: number): StagedUploads {
  const dir = mkdtempSync(join(tmpdir(), STAGING_PREFIX));
  const staged: StagedUploads = { dir, files: [], folders: [], refused: [] };
  const tops = new Set<string>();
  for (const [index, u] of uploads.entries()) {
    const label = u.relPath || u.name;
    const p = uploadPath(u);
    if ("error" in p) {
      staged.refused.push({ index, label, reason: p.error });
      continue;
    }
    if (u.data.byteLength > maxBytes) {
      staged.refused.push({ index, label, reason: `larger than ${Math.round(maxBytes / 1024 / 1024)} MB` });
      continue;
    }
    const target = p.folders.length ? join(dir, "folders", ...p.folders) : join(dir, "files", String(index));
    mkdirSync(target, { recursive: true });
    try {
      writeFileSync(join(target, p.name), u.data, { flag: "wx" });
    } catch {
      staged.refused.push({ index, label, reason: "the same path was uploaded twice" });
      continue;
    }
    if (!p.folders.length) {
      staged.files.push({ index, label, path: join(target, p.name) });
      continue;
    }
    // Windows folder names are case-insensitive: "Applicants/" and "applicants/" are one folder.
    const key = p.folders[0].toLowerCase();
    if (!tops.has(key)) {
      tops.add(key);
      staged.folders.push({ index, label: p.folders[0], path: join(dir, "folders", p.folders[0]) });
    }
  }
  return staged;
}
