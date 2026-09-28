import { createContext, useContext } from "react";
import type { EntityChange, EntityRef } from "../../src/changes";
import type { Page } from "./components/Shell";

/**
 * The conversation and the pages in step (owner, 2026-09-27; design: SyncRules): what the adviser
 * changed recently, and how to open a changed thing from anywhere (a card in a reply, a banner).
 */

/** A change as the UI saw it arrive. */
export interface Seen {
  change: EntityChange;
  by: "adviser" | "you";
  at: number;
  turnId: string | null;
  /** The conversation it happened in (its title then), for "in “…”". */
  title: string | null;
}

/** Where a card or banner can take the owner. */
export type OpenTarget =
  | { kind: "employee"; id: number; docs?: boolean }
  | { kind: "job"; job: string }
  | { kind: "files" }
  | { kind: "profile" }
  | { kind: "connections" }
  | { kind: "conversation" };

export interface Live {
  /** The adviser's changes of the last RECENT_MS (rows are marked "New · MeritAI" meanwhile). */
  recent: Seen[];
  /** Bumped when data changed: live views reload. */
  refreshKey: number;
  /** In voice, what a question waiting for the owner's OK is about: the page highlights it ("Talking about"; design: DockVoice). */
  talking: EntityRef[];
  open: (t: OpenTarget) => void;
}

export const RECENT_MS = 10 * 60_000;

export const LiveContext = createContext<Live>({ recent: [], refreshKey: 0, talking: [], open: () => {} });
export const useLive = () => useContext(LiveContext);

/** The page that shows a thing. */
export function pageOf(r: EntityRef): Page {
  switch (r.kind) {
    case "employee":
      return "staff";
    case "job":
    case "candidate":
      return "hiring";
    case "file":
      return "files";
    case "profile":
      return "profile";
  }
}

/** The latest recent adviser change per thing, by a key the caller picks (null: not this page's). */
export function marks<K>(recent: Seen[], key: (r: EntityRef) => K | null): Map<K, Seen> {
  const out = new Map<K, Seen>();
  const since = Date.now() - RECENT_MS;
  for (const s of recent) {
    if (s.at < since || s.by !== "adviser") continue;
    const k = key(s.change.ref);
    if (k !== null) out.set(k, s);
  }
  return out;
}

/** "New · MeritAI", "Updated · MeritAI"… for a marked row. */
export function markLabel(s: Seen): string {
  const a = s.change.action;
  const word = a === "added" || a === "created" ? "New" : a === "left" ? "Left" : a === "hired" ? "Hired" : a === "shortlisted" ? "Shortlisted" : a === "not" ? "Not this time" : a === "saved" ? "New" : a === "closed" ? "Closed" : "Updated";
  return `${word} · MeritAI`;
}
