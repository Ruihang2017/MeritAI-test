import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { EmailDraft } from "../files/email";

/**
 * Testers' feedback (owner, 2026-09-27): "Was this helpful?" on each reply, kept on this computer,
 * and "Send feedback", which writes one file the tester sends to the MeritAI team (the app is
 * local only, so nothing is sent from here).
 */

export const RATING_REASONS = ["Wrong or out of date", "Missed something", "Not what I asked", "Too long or unclear", "Something else"] as const;

export interface Rating {
  at: string;
  rating: "up" | "down";
  reasons: string[];
  note: string;
  conversation: string | null;
  threadId: string | null;
  /** The owner's message and the reply (shortened), so the team can see what was rated. */
  question: string;
  answer: string;
}

export class FeedbackLog {
  constructor(private readonly file: string) {}

  add(r: Rating): void {
    appendFileSync(this.file, JSON.stringify(r) + "\n");
  }

  all(): Rating[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Rating];
        } catch {
          return [];
        }
      });
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The email that takes a feedback file to the MeritAI team (owner, 2026-09-28): a draft the tester
 * checks and sends from their own email app, with the file attached.
 */
export function feedbackEmail(o: { to: string; file: string; data: Buffer; version: string; when: Date; name: string | null }): EmailDraft {
  const day = `${o.when.getDate()} ${MONTHS[o.when.getMonth()]}`;
  return {
    to: [o.to],
    cc: [],
    subject: `MeritAI feedback · ${o.version} · ${day}`,
    body: ["Hi MeritAI team,", "", `My feedback from MeritAI ${o.version} is attached.`, ...(o.name ? ["", o.name] : [])].join("\n"),
    attachments: [{ name: basename(o.file), data: o.data }],
  };
}

/** Writes the feedback file into <workspace>/Feedback/ and returns its path. */
export function writeFeedbackFile(workspace: string, when: Date, content: unknown): string {
  const dir = join(workspace, "Feedback");
  mkdirSync(dir, { recursive: true });
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ${p(when.getHours())}-${p(when.getMinutes())}-${p(when.getSeconds())}`;
  const file = join(dir, `MeritAI feedback ${stamp}.json`);
  writeFileSync(file, JSON.stringify(content, null, 2) + "\n");
  return file;
}
