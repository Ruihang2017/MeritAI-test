import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Opening a workspace file with the system's default app, or showing it in the file
 * manager (a UI's "open" / "show in folder" for saved documents). Only files inside the
 * business workspace can be opened, never the assistant's own data folder.
 */

export type OpenResult = { ok: true } | { ok: false; error: string };

export interface LaunchCommand {
  command: string;
  args: string[];
  /** Windows: the arguments are passed exactly as written (already quoted). */
  verbatim?: boolean;
}

/** Starts a command without waiting for it; rejects if it cannot be started. Injectable for tests. */
export type Launcher = (cmd: LaunchCommand) => Promise<void>;

export const spawnLauncher: Launcher = (cmd) =>
  new Promise((resolveStart, reject) => {
    const child = spawn(cmd.command, cmd.args, { detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: cmd.verbatim });
    child.once("error", (e) => reject(e));
    child.once("spawn", () => {
      child.unref();
      resolveStart();
    });
  });

/**
 * The command that opens (default app) or reveals (file manager) a path.
 * Windows uses explorer.exe rather than `cmd /c start`, so % and & in names are never
 * interpreted; Windows paths cannot contain `"`, so quoting them verbatim is safe.
 */
export function launchCommand(action: "open" | "reveal", path: string, platform: NodeJS.Platform = process.platform): LaunchCommand {
  if (platform === "win32") return { command: "explorer.exe", args: [action === "open" ? `"${path}"` : `/select,"${path}"`], verbatim: true };
  if (platform === "darwin") return { command: "open", args: action === "open" ? [path] : ["-R", path] };
  // Linux and others: no standard "select in folder", so reveal opens the containing folder.
  return { command: "xdg-open", args: [action === "open" ? path : dirname(path)] };
}

/** Opens a web address in the default browser (Google's sign-in). Only https; quoted verbatim on Windows (a URL has no `"`). */
export function launchUrl(url: string, platform: NodeJS.Platform = process.platform): LaunchCommand {
  if (!/^https:\/\/[^\s"]+$/.test(url)) throw new Error("not a web address");
  if (platform === "win32") return { command: "explorer.exe", args: [`"${url}"`], verbatim: true };
  return { command: platform === "darwin" ? "open" : "xdg-open", args: [url] };
}

const inside = (child: string, parent: string) => {
  const r = relative(parent, child);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};

/**
 * The real path of `path` if it may be opened: it exists and is inside the workspace
 * root (after resolving links), and not inside the assistant's data folder.
 * Relative paths are taken from the workspace root.
 */
export function openablePath(folders: { root: string; data: string }, path: string): { ok: true; path: string } | { ok: false; error: string } {
  if (!path?.trim()) return { ok: false, error: "no path given" };
  const full = resolve(folders.root, path);
  if (!existsSync(full)) return { ok: false, error: `not found: ${path}` };
  const real = realpathSync(full);
  if (!inside(real, realpathSync(folders.root))) return { ok: false, error: "only files in the business workspace can be opened" };
  const data = existsSync(folders.data) ? realpathSync(folders.data) : resolve(folders.data);
  if (inside(real, data)) return { ok: false, error: "the assistant's data folder cannot be opened" };
  return { ok: true, path: real };
}
