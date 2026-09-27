import { appendFileSync, existsSync, readFileSync } from "node:fs";

/**
 * Voice usage on this computer (owner, 2026-09-27): each call's billed seconds, so Settings can
 * show today, this month and all time in US dollars, and a monthly limit can stop voice. An
 * estimate: GPT-Live bills about US$0.05 a minute; the OpenAI bill is the real figure (it also
 * counts the key's use elsewhere). Dates are the computer's real date, not the sample's.
 */

export const USD_PER_MINUTE = 0.05;

export interface VoiceCall {
  /** When the call ended (ISO). */
  at: string;
  seconds: number;
}

export interface UsagePeriod {
  calls: number;
  seconds: number;
  usd: number;
}

export interface VoiceUsageSummary {
  today: UsagePeriod;
  month: UsagePeriod & { label: string };
  all: UsagePeriod & { since: string | null };
  /** The monthly limit in US$, or null for none. */
  limitUsd: number | null;
  usdPerMinute: number;
}

export const usdFor = (seconds: number) => Math.round((seconds / 60) * USD_PER_MINUTE * 100) / 100;

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export class VoiceUsage {
  constructor(private readonly file: string) {}

  add(seconds: number, at: Date = new Date()): void {
    if (!(seconds > 0)) return;
    appendFileSync(this.file, JSON.stringify({ at: at.toISOString(), seconds: Math.round(seconds) } satisfies VoiceCall) + "\n");
  }

  all(): VoiceCall[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          const c = JSON.parse(l) as VoiceCall;
          return typeof c.seconds === "number" && typeof c.at === "string" ? [c] : [];
        } catch {
          return [];
        }
      });
  }

  /** This month's estimate so far (US$). */
  monthUsd(now: Date = new Date()): number {
    return this.summary(null, now).month.usd;
  }

  summary(limitUsd: number | null, now: Date = new Date()): VoiceUsageSummary {
    const calls = this.all();
    const today = localDate(now);
    const month = today.slice(0, 7);
    const period = (xs: VoiceCall[]): UsagePeriod => {
      const seconds = xs.reduce((s, c) => s + c.seconds, 0);
      return { calls: xs.length, seconds, usd: usdFor(seconds) };
    };
    const day = (c: VoiceCall) => localDate(new Date(c.at));
    return {
      today: period(calls.filter((c) => day(c) === today)),
      month: { ...period(calls.filter((c) => day(c).startsWith(month))), label: now.toLocaleString("en-AU", { month: "long" }) },
      all: { ...period(calls), since: calls.length ? calls.map((c) => c.at).sort()[0] : null },
      limitUsd,
      usdPerMinute: USD_PER_MINUTE,
    };
  }
}
