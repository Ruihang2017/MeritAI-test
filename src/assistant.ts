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
import { casualPathwayTools } from "./business/casualPathway";
import { parentalLeaveTools } from "./business/parentalLeave";
import { basePrompt, type ReplyFormat } from "./basePrompt";
import { FakeEngine } from "./engine/fakeEngine";
import { codexHomeFor } from "./engine/codexHome";
import { Changes } from "./changes";
import { hiringTools } from "./screening/hiringTools";
import { candidates, findCandidate, hireCount, linkHire } from "./business/hiring";
import { listJobs } from "./files/folders";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The app's today for the model (journeys, 2026-09-27): the sample business runs on its own date
 * (src/clock.ts), and "done today" or "starts next Monday" must mean the same day to the adviser
 * as to the register and the reminders.
 */
/** The owner's language (Settings; owner, 2026-09-27): replies in it, documents for others in English. */
export function languageLine(lang: "en" | "zh" | undefined): string {
  return lang === "zh" ? LANGUAGE_ZH : "";
}
export const LANGUAGE_ZH =
  "Language: the owner reads Simplified Chinese. Reply in Simplified Chinese. Keep the names of laws, agencies, awards, forms, tools and official pages in English (a short Chinese explanation in brackets is fine, e.g. Fair Work Information Statement（公平工作信息说明）). " +
  "Write documents for other people (letters, contracts, emails, job descriptions and ads, policies, messages to candidates or employees) in English, as Australian workplaces use English, unless the owner asks for another language; tell the owner in Chinese what you drafted.";

function todayLine(): string {
  const iso = todayLocal();
  const d = new Date(`${iso}T12:00:00`);
  const day = d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `Today is ${day} (${iso}). Use this date for "today", "tomorrow", "next Monday" and other relative dates.`;
}

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
  /** Every write to the register, jobs, profile and saved files (src/changes.ts). */
  changes: Changes;
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
  // The engine's working folder (empty; the sandbox is read-only). The desktop app puts it in the user's app data.
  const workspace = process.env.FX_ENGINE_CWD ?? resolve(ROOT, "workspace");
  mkdirSync(workspace, { recursive: true });

  // The desktop app keeps memory in the user's app data (FX_MEMORY_ROOT).
  const memoryRoot = opts.memoryRoot ?? process.env.FX_MEMORY_ROOT ?? resolve(ROOT, "memory");
  const mem = new UserMemory(memoryRoot, opts.userId);
  const changes = new Changes();
  const codexHome = codexHomeFor(ROOT);
  const folders = () => ensureFolders(mem.settings().filesRoot ?? defaultFilesRoot(ROOT));
  const business = () => new BusinessStore(folders().data, changes.emit);

  // One catalog per workspace; reopened if the user moves their folders (/files set).
  let cat: { dir: string; db: Catalog } | null = null;
  const catalog = () => {
    const dir = folders().data;
    if (cat?.dir !== dir) {
      cat?.db.close();
      cat = { dir, db: new Catalog(dir, changes.emit) };
    }
    return cat.db;
  };
  let reg: { dir: string; db: Register } | null = null;
  const register = () => {
    const dir = folders().data;
    if (reg?.dir !== dir) {
      reg?.db.close();
      reg = { dir, db: new Register(dir, changes.emit) };
    }
    return reg.db;
  };

  const tools = () => [
    ...memoryTools({ mem, confirm: opts.confirm }),
    ...businessTools({ store: business, confirm: opts.confirm }),
    ...policyTools(folders),
    ...onboardingTools(business),
    ...registerTools({
      register,
      business,
      confirm: opts.confirm,
      hires: {
        find: (job, who) => {
          if (!listJobs(folders()).includes(job)) return { ok: false, error: `no job called "${job}"` };
          const f = findCandidate(catalog(), job, who);
          return f.ok ? { ok: true, file: f.candidate.file, name: f.candidate.name } : f;
        },
        link: (job, file, employeeId) => {
          linkHire(catalog(), register(), job, file, employeeId);
          const c = hireCount(catalog(), register(), job);
          return `${c.hired} of ${c.openings} hired.${c.hired >= c.openings && !c.closed ? " Everyone the job needs is hired: ask the owner whether to close it (update_job with open: false)." : ""}`;
        },
        jobsWith: (name) => {
          const n = name.toLowerCase().trim();
          return listJobs(folders()).filter((j) => !catalog().jobSettings(j).closedAt && candidates(catalog(), j).some((c) => !c.employeeId && c.name.toLowerCase().trim() === n));
        },
      },
    }),
    ...leavingTools(business, register, todayLocal),
    ...casualPathwayTools(business, register, todayLocal),
    ...parentalLeaveTools(todayLocal),
    ...reminderTools({ register, business }),
    officialSourcesTool(() => engine),
    ...fileTools(folders, changes.emit, {
      find: (job, who) => {
        if (!listJobs(folders()).includes(job)) return { ok: false, error: `no job called "${job}"` };
        const f = findCandidate(catalog(), job, who);
        return f.ok ? { ok: true, hash: f.candidate.hash, name: f.candidate.name, decision: f.candidate.decision } : f;
      },
      link: (draft, job, hash, kind) => catalog().linkEmail(draft, job, hash, kind),
    }),
    ...screeningTools({ engine: () => engine, folders, catalog, onProgress: opts.onProgress }),
    ...hiringTools({ folders, catalog, register, confirm: opts.confirm }),
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
        todayLine(),
        languageLine(mem.settings().language),
        renderProfile(business()),
        renderPolicyIndex(folders()),
        buildMemoryContext(mem, read("prompts/memory.md")),
      ].join("\n\n"),
    tools,
    serviceTier: opts.serviceTier,
    clientVersion: opts.clientVersion ?? "0.4.0",
    onLog: opts.onLog,
  });

  return { engine, mem, folders, business, catalog, register, paths: { projectRoot: ROOT, codexHome, memoryRoot }, changes };
}
