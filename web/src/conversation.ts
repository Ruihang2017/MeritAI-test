import type { AppEvent } from "../../src/app/app";
import type { ConfirmRequest } from "../../src/engine/types";
import { refKey, turnKey, type ChangeAction, type EntityChange, type EntityRef } from "../../src/changes";

/** One part of an assistant reply, in the order it arrived. */
export type Block =
  | { kind: "text"; text: string; done: boolean }
  | { kind: "confirm"; id: string; req: ConfirmRequest; state: "open" | "yes" | "no" | "withdrawn"; receipt?: string }
  | { kind: "warning"; message: string }
  | { kind: "unverified"; urls: string[] }
  | { kind: "error"; message: string }
  | { kind: "limit"; resetAt: string | null }
  /** A change the adviser needed an OK for during voice: declined then, to be done in the chat. */
  | { kind: "skipped"; req: ConfirmRequest };

export interface Step {
  summary: string;
  files?: string[];
}

/** A thing a reply changed (design: SyncChat's "What changed"), with what happened to it, in order. */
export interface TurnChange {
  key: string;
  ref: EntityRef;
  actions: ChangeAction[];
  summary: string;
}

export interface Turn {
  id: string;
  /** What the reply changed (employees, jobs, candidates, files, the profile). */
  changes?: TurnChange[];
  /** Files a restored reply saved (its steps aren't stored; the cards and chips show them again). */
  files?: string[];
  at: Date;
  user: { text: string; attachments: string[] };
  skill?: string;
  steps: Step[];
  blocks: Block[];
  status: "running" | "completed" | "interrupted" | "failed";
  /** Spoken (voice in the browser). */
  voice?: boolean;
  /** Only the owner's words, added by voice to the reply already running. */
  userOnly?: boolean;
}

/** The tool activity that confirms a save, per kind of question (the tools' own display lines). */
const RECEIPT: Partial<Record<ConfirmRequest["kind"], RegExp>> = {
  register: /^register: (added|updated|deleted|\d+ item\(s\) recorded)/,
  profile: /^profile saved/,
  setup: /^profile saved/,
  memory: /^memory saved/,
  // The Hiring actions' saves (src/screening/hiringTools.ts); missing until 2026-09-29, so a "yes" showed "no receipt".
  hiring: /^hiring: (\d+ decision\(s\) saved for |.+ hired for |.+ updated$|JD saved for |job .+ created$|\d+ application\(s\) added to )/,
  criteria: /^criteria confirmed for /,
};
/** Receipt value for a "yes" whose save was never reported. */
export const UNREPORTED = "\u0000unreported";

/** Links to these domains (and subdomains) are official sources. */
export function isOfficial(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return new URL(url).protocol === "https:" && domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** Links flagged as unverified in this turn. */
export const flaggedLinks = (turn: Turn) => new Set(turn.blocks.flatMap((b) => (b.kind === "unverified" ? b.urls : [])));

/** Applies one streamed event to a turn (returns a new turn). */
export function applyEvent(turn: Turn, ev: AppEvent): Turn {
  const t: Turn = { ...turn, blocks: [...turn.blocks], steps: [...turn.steps] };
  const last = t.blocks[t.blocks.length - 1];
  switch (ev.type) {
    case "text_delta":
      if (last?.kind === "text" && !last.done) t.blocks[t.blocks.length - 1] = { ...last, text: last.text + ev.text };
      else t.blocks.push({ kind: "text", text: ev.text, done: false });
      break;
    case "text_done":
      // The full message replaces what was streamed (a message can also arrive without deltas).
      if (last?.kind === "text" && !last.done) t.blocks[t.blocks.length - 1] = { kind: "text", text: ev.text, done: true };
      else t.blocks.push({ kind: "text", text: ev.text, done: true });
      break;
    case "tool_activity": {
      t.steps.push({ summary: ev.summary, ...(ev.files ? { files: ev.files } : {}) });
      // The tool's own "saved" line for a card answered yes is its receipt; only the matching kind counts.
      const open = [...t.blocks].reverse().find((b): b is Extract<Block, { kind: "confirm" }> => b.kind === "confirm" && b.state === "yes" && !b.receipt && RECEIPT[b.req.kind]?.test(ev.summary) === true);
      if (open) t.blocks = t.blocks.map((b) => (b === open ? { ...open, receipt: ev.summary } : b));
      break;
    }
    case "skill_loaded":
      t.skill = ev.name;
      break;
    case "warning":
      t.blocks.push({ kind: "warning", message: ev.message });
      break;
    case "unverified_links":
      t.blocks.push({ kind: "unverified", urls: ev.urls });
      break;
    case "links_corrected":
      t.blocks = t.blocks.map((b) => (b.kind === "text" ? { ...b, text: ev.fixes.reduce((s, f) => s.split(f.from).join(f.to), b.text) } : b));
      break;
    case "error":
      // A usage-limit error is shown by its own block (usage_limit follows it).
      if (!ev.willRetry && !/usage limit/i.test(ev.message)) t.blocks.push({ kind: "error", message: ev.message });
      break;
    case "usage_limit":
      t.blocks.push({ kind: "limit", resetAt: ev.resetAt });
      break;
    case "turn_end":
      t.status = ev.status;
      // A "yes" with no save reported by the end of the reply is not shown as saved.
      t.blocks = t.blocks.map((b) => (b.kind === "text" && !b.done ? { ...b, done: true } : b.kind === "confirm" && b.state === "yes" && !b.receipt ? { ...b, receipt: UNREPORTED } : b));
      if (ev.status === "failed" && ev.error && !t.blocks.some((b) => b.kind === "error" || b.kind === "limit")) t.blocks.push({ kind: "error", message: ev.error });
      break;
    case "usage":
      break;
  }
  return t;
}

/**
 * Rebuilds finished turns from stored messages (after a resume or a page reload).
 * The app prefixes attachments as [attached: "name" (...)]; they become chips again.
 */
export function turnsFromTranscript(entries: { role: "user" | "assistant"; text: string }[], at: Date): Turn[] {
  const turns: Turn[] = [];
  for (const [i, e] of entries.entries()) {
    if (e.role === "user") {
      const attachments = [...e.text.matchAll(/\[attached: "([^"]+)"[^\]]*\]/g)].map((m) => m[1]);
      const text = e.text.replace(/\[(attached|imported folder as job|reply language)[^\]]*\]\s*/g, "").trim();
      turns.push({ id: `stored-${i}`, at, user: { text, attachments }, steps: [], blocks: [], status: "completed" });
    } else {
      if (!turns.length) turns.push({ id: `stored-${i}`, at, user: { text: "", attachments: [] }, steps: [], blocks: [], status: "completed" });
      turns[turns.length - 1].blocks.push({ kind: "text", text: e.text, done: true });
    }
  }
  return turns;
}

/** A change the adviser made during this turn joins its "What changed" (one entry per thing). */
export function addChange(turn: Turn, c: EntityChange): Turn {
  const key = refKey(c.ref);
  const list = turn.changes ?? [];
  const i = list.findIndex((x) => x.key === key);
  const next = i >= 0 ? list.map((x, j) => (j === i ? { ...x, ref: c.ref, actions: [...x.actions, c.action], summary: c.summary } : x)) : [...list, { key, ref: c.ref, actions: [c.action], summary: c.summary }];
  return { ...turn, changes: next };
}

/** Gives restored turns (a resumed or reloaded conversation) back their "What changed" and saved files. */
export function withExtras(turns: Turn[], extras: Record<string, { changes: EntityChange[]; files: string[] }>): Turn[] {
  return turns.map((t) => {
    const x = t.user.text ? extras[turnKey(t.user.text)] : undefined;
    if (!x) return t;
    let out: Turn = { ...t, files: x.files };
    for (const c of x.changes) out = addChange(out, c);
    return out;
  });
}

/** A confirmation question joins the running turn. */
export function addConfirm(turn: Turn, id: string, req: ConfirmRequest): Turn {
  if (turn.blocks.some((b) => b.kind === "confirm" && b.id === id)) return turn;
  return { ...turn, blocks: [...turn.blocks, { kind: "confirm", id, req, state: "open" }] };
}

export function setConfirm(turn: Turn, id: string, state: "yes" | "no" | "withdrawn"): Turn {
  return { ...turn, blocks: turn.blocks.map((b) => (b.kind === "confirm" && b.id === id && b.state === "open" ? { ...b, state } : b)) };
}

/** Official links in the reply, for the sources row (unverified and other sites left out). */
export function sources(turn: Turn, domains: string[]): { title: string; url: string }[] {
  const flagged = flaggedLinks(turn);
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const b of turn.blocks) {
    if (b.kind !== "text") continue;
    for (const m of b.text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
      const url = m[2];
      if (flagged.has(url) || seen.has(url) || !isOfficial(url, domains)) continue;
      seen.add(url);
      out.push({ title: m[1], url });
    }
  }
  return out;
}
