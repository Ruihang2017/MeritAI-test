import type { AppEvent } from "../../src/app/app";
import type { ConfirmRequest } from "../../src/engine/types";

/** One part of an assistant reply, in the order it arrived. */
export type Block =
  | { kind: "text"; text: string; done: boolean }
  | { kind: "confirm"; id: string; req: ConfirmRequest; state: "open" | "yes" | "no" | "withdrawn"; receipt?: string }
  | { kind: "warning"; message: string }
  | { kind: "unverified"; urls: string[] }
  | { kind: "error"; message: string };

export interface Step {
  summary: string;
  files?: string[];
}

export interface Turn {
  id: string;
  at: Date;
  user: { text: string; attachments: string[] };
  skill?: string;
  steps: Step[];
  blocks: Block[];
  status: "running" | "completed" | "interrupted" | "failed";
}

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
      // A register or profile change right after a "yes" is the receipt for that card.
      const open = [...t.blocks].reverse().find((b): b is Extract<Block, { kind: "confirm" }> => b.kind === "confirm" && b.state === "yes" && !b.receipt);
      if (open && /updated|added|saved|removed|recorded/i.test(ev.summary)) {
        t.blocks = t.blocks.map((b) => (b === open ? { ...open, receipt: ev.summary } : b));
      }
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
      if (!ev.willRetry) t.blocks.push({ kind: "error", message: ev.message });
      break;
    case "turn_end":
      t.status = ev.status;
      t.blocks = t.blocks.map((b) => (b.kind === "text" && !b.done ? { ...b, done: true } : b));
      if (ev.status === "failed" && ev.error && !t.blocks.some((b) => b.kind === "error")) t.blocks.push({ kind: "error", message: ev.error });
      break;
    case "usage":
      break;
  }
  return t;
}

/** A confirmation question joins the running turn. */
export function addConfirm(turn: Turn, id: string, req: ConfirmRequest): Turn {
  if (turn.blocks.some((b) => b.kind === "confirm" && b.id === id)) return turn;
  return { ...turn, blocks: [...turn.blocks, { kind: "confirm", id, req, state: "open" }] };
}

export function setConfirm(turn: Turn, id: string, state: "yes" | "no" | "withdrawn"): Turn {
  return { ...turn, blocks: turn.blocks.map((b) => (b.kind === "confirm" && b.id === id && b.state === "open" ? { ...b, state } : b)) };
}

/** Markdown links in the reply, for the sources row (unverified ones left out). */
export function sources(turn: Turn): { title: string; url: string }[] {
  const flagged = new Set(turn.blocks.flatMap((b) => (b.kind === "unverified" ? b.urls : [])));
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const b of turn.blocks) {
    if (b.kind !== "text") continue;
    for (const m of b.text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
      const url = m[2];
      if (flagged.has(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({ title: m[1], url });
    }
  }
  return out;
}
