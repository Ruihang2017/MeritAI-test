import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/**
 * The voice API key a tester pastes in Settings (owner, 2026-09-27). It is kept on this
 * computer only, encrypted for the Windows user (DPAPI, through PowerShell with the data on
 * stdin, never on a command line), and goes only to OpenAI while voice is on. Nothing shows it
 * again except its last 4 characters. It is never put in an environment variable (codex would
 * read OPENAI_API_KEY), in a log or in an error message.
 */

export interface VoiceKeyStatus {
  set: boolean;
  last4: string | null;
  /** When OpenAI last accepted it (saved keys). */
  checkedAt: string | null;
  /** "env": VOICE_OPENAI_API_KEY in .env (a developer setup), used when no key is saved; "demo": the demo engine's stand-in voice, no key. */
  source: "saved" | "env" | "demo" | null;
}

interface Stored {
  cipher: string;
  last4: string;
  checkedAt: string;
}

const PROTECT =
  "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Console]::Out.Write([Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser')))";
const UNPROTECT = PROTECT.replace("::Protect(", "::Unprotect(");

function powershell(script: string, input: string): Promise<string> {
  if (process.platform !== "win32") return Promise.reject(new Error("Saving a voice key needs Windows"));
  return new Promise((ok, fail) => {
    const p = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 20_000 }, (e, out) =>
      // PowerShell's own error text could quote its input: never pass it on.
      e ? fail(new Error("Windows couldn't encrypt or read the saved key")) : ok(out.trim()),
    );
    p.stdin?.end(input);
  });
}

/** Encrypts for the current Windows user. */
export async function protect(plain: string): Promise<string> {
  return powershell(PROTECT, Buffer.from(plain, "utf8").toString("base64"));
}

export async function unprotect(cipher: string): Promise<string> {
  return Buffer.from(await powershell(UNPROTECT, cipher), "base64").toString("utf8");
}

/** A reason the text can't be an OpenAI API key, or null. */
export function keyFormatProblem(key: string): string | null {
  if (!key) return "Paste your OpenAI API key first.";
  if (/\s/.test(key)) return "The key has a space or a line break in it. Copy it again from OpenAI.";
  if (!key.startsWith("sk-")) return "That doesn't look like an OpenAI API key (they start with sk-).";
  if (key.length < 20 || key.length > 300) return "That doesn't look like a whole OpenAI API key. Copy it again from OpenAI.";
  return null;
}

/** Asks OpenAI whether it accepts the key (listing models is free). */
export async function checkWithOpenAI(key: string, fetchImpl: typeof fetch = fetch): Promise<"ok" | "rejected" | "unreachable"> {
  try {
    const r = await fetchImpl("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    if (r.ok) return "ok";
    return r.status === 401 || r.status === 403 ? "rejected" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export class VoiceKeyStore {
  constructor(private readonly file: string) {}

  private stored(): Stored | null {
    if (!existsSync(this.file)) return null;
    try {
      const s = JSON.parse(readFileSync(this.file, "utf8")) as Stored;
      return typeof s.cipher === "string" && typeof s.last4 === "string" ? s : null;
    } catch {
      return null;
    }
  }

  status(envKey?: string): VoiceKeyStatus {
    const s = this.stored();
    if (s) return { set: true, last4: s.last4, checkedAt: s.checkedAt, source: "saved" };
    if (envKey) return { set: true, last4: envKey.slice(-4), checkedAt: null, source: "env" };
    return { set: false, last4: null, checkedAt: null, source: null };
  }

  async save(key: string, checkedAt: string): Promise<void> {
    const stored: Stored = { cipher: await protect(key), last4: key.slice(-4), checkedAt };
    writeFileSync(this.file, JSON.stringify(stored, null, 2) + "\n");
  }

  /** The saved key, decrypted; null when none is saved. */
  async load(): Promise<string | null> {
    const s = this.stored();
    return s ? unprotect(s.cipher) : null;
  }

  remove(): void {
    rmSync(this.file, { force: true });
  }
}
