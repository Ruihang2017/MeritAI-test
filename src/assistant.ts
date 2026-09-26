import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerEngine } from "./engine/appServer";
import type { Confirm, Engine } from "./engine/types";
import { UserMemory } from "./memory/store";
import { buildMemoryContext } from "./memory/context";
import { memoryTools } from "./memory/tools";
import { officialSourcesTool } from "./research/officialSources";
import { defaultFilesRoot, ensureFolders, type Folders } from "./files/folders";
import { fileTools } from "./files/tools";
import { Catalog } from "./screening/catalog";
import { screeningTools } from "./screening/tools";
import type { Progress } from "./screening/pipeline";
import { BusinessStore, renderProfile } from "./business/profile";
import { businessTools } from "./business/tools";
import { policyTools, renderPolicyIndex } from "./business/policies";
import { onboardingTools } from "./business/onboarding";
import { Register } from "./business/register";
import { registerTools } from "./business/registerTools";
import { reminderTools, todayLocal } from "./business/reminders";
import { leavingTools } from "./business/leaving";
import { parentalLeaveTools } from "./business/parentalLeave";
import { basePrompt, type ReplyFormat } from "./basePrompt";
import { FakeEngine } from "./engine/fakeEngine";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Assistant {
  engine: Engine;
  mem: UserMemory;
  /** This user's business workspace (Jobs/Inbox/Outbox/Policies, created if missing); follows /files set. */
  folders: () => Folders;
  /** The business profile of the current workspace. */
  business: () => BusinessStore;
  /** The application catalog of the current workspace. */
  catalog: () => Catalog;
  /** The employee register of the current workspace. */
  register: () => Register;
  paths: { projectRoot: string; codexHome: string; memoryRoot: string };
}

/**
 * Assembles the HR assistant: engine + prompts + the business profile and
 * policies + this user's memory + tools. The CLI and all test scripts use
 * this, so what is tested is what users get.
 */
export function createAssistant(opts: {
  userId: string;
  /** Asks the user a yes/no question (memory proposals, business profile and register changes). */
  confirm: Confirm;
  /** Defaults to <repo>/memory; tests pass a throwaway dir. */
  memoryRoot?: string;
  /** Service tier id: "priority" or "default". */
  serviceTier?: string;
  /** true keeps Codex's built-in coding-agent prompt (A/B only). */
  codexBasePrompt?: boolean;
  /** Reply formatting: "plain" (default, raw-text terminal) or "markdown" (a chat UI that renders it). */
  format?: ReplyFormat;
  clientVersion?: string;
  /** "codex" (default): the real engine. "fake": scripted replies with the real tools, for UI work without the model (src/engine/fakeEngine.ts). */
  engine?: "codex" | "fake";
  onLog?: (line: string) => void;
  /** Progress of long-running tools (e.g. bulk screening), for the UI. */
  onProgress?: Progress;
}): Assistant {
  const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
  const workspace = resolve(ROOT, "workspace");
  mkdirSync(workspace, { recursive: true });

  const memoryRoot = opts.memoryRoot ?? resolve(ROOT, "memory");
  const mem = new UserMemory(memoryRoot, opts.userId);
  const codexHome = resolve(ROOT, "codex_home");
  const folders = () => ensureFolders(mem.settings().filesRoot ?? defaultFilesRoot(ROOT));
  const business = () => new BusinessStore(folders().data);

  // One catalog per workspace; reopened if the user moves their folders (/files set).
  let cat: { dir: string; db: Catalog } | null = null;
  const catalog = () => {
    const dir = folders().data;
    if (cat?.dir !== dir) {
      cat?.db.close();
      cat = { dir, db: new Catalog(dir) };
    }
    return cat.db;
  };
  let reg: { dir: string; db: Register } | null = null;
  const register = () => {
    const dir = folders().data;
    if (reg?.dir !== dir) {
      reg?.db.close();
      reg = { dir, db: new Register(dir) };
    }
    return reg.db;
  };

  const tools = () => [
    ...memoryTools({ mem, confirm: opts.confirm }),
    ...businessTools({ store: business, confirm: opts.confirm }),
    ...policyTools(folders),
    ...onboardingTools(business),
    ...registerTools({ register, business, confirm: opts.confirm }),
    ...leavingTools(business),
    ...parentalLeaveTools(todayLocal),
    ...reminderTools({ register, business }),
    officialSourcesTool(() => engine),
    ...fileTools(folders),
    ...screeningTools({ engine: () => engine, folders, catalog, onProgress: opts.onProgress }),
  ];

  const engine: Engine = opts.engine === "fake" ? new FakeEngine({ tools, codexHome, ...(process.env.FX_FAKE_DELAY_MS ? { delayMs: Number(process.env.FX_FAKE_DELAY_MS) } : {}) }) : new AppServerEngine({
    codexBin: process.env.CODEX_BIN ?? "codex",
    codexHome,
    workspace,
    baseInstructions: opts.codexBasePrompt ? undefined : basePrompt(ROOT, opts.format),
    // Rebuilt for every new session, so profile, policy and memory changes apply on /new.
    developerInstructions: () =>
      [
        read("prompts/developer.md"),
        renderProfile(business()),
        renderPolicyIndex(folders()),
        buildMemoryContext(mem, read("prompts/memory.md")),
      ].join("\n\n"),
    tools,
    serviceTier: opts.serviceTier,
    clientVersion: opts.clientVersion ?? "0.4.0",
    onLog: opts.onLog,
  });

  return { engine, mem, folders, business, catalog, register, paths: { projectRoot: ROOT, codexHome, memoryRoot } };
}
