/**
 * Weekdays worked out by code. The model got them wrong (round 6, onb-04: "Monday 13 October" twice, and
 * in a welcome email; 13 October 2026 is a Tuesday), although the instructions give today's weekday.
 * `longDate` gives tools a date with its weekday; `wrongWeekdays` is the client-side backstop that flags a
 * reply whose weekday and date don't match (like the pay calculation guard it warns, never rewrites: we
 * can't tell whether the date or the weekday is the mistake).
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ZH_WEEKDAYS = "日一二三四五六";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The weekday (0 = Sunday) of a real calendar date, or null (e.g. 31 February). */
function weekdayOf(y: number, m: number, d: number): number | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.getUTCDay() : null;
}

/** "Tuesday 13 October 2026" for 2026-10-13 (null if it isn't a date). */
export function longDate(iso: string | null | undefined): string | null {
  const m = iso ? ISO.exec(iso) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = weekdayOf(y, mo, d);
  return wd === null ? null : `${WEEKDAYS[wd]} ${d} ${MONTHS[mo - 1]} ${y}`;
}

// "Mon", "Tues", "Thur"... and the full names.
const WD_WORD = "(Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)";
const MONTH_WORD = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const ORD = "(?:st|nd|rd|th)?";
const YEAR = "(?:,?\\s+(\\d{4}))?";
const PATTERNS: { re: RegExp; parts: (m: RegExpExecArray) => { wd: number; day: number; month: number; year: number | null } }[] = [
  // Monday 13 October (2026), Mon, 13th of Oct
  {
    re: new RegExp(`\\b${WD_WORD}\\.?,?\\s+(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_WORD}\\b\\.?${YEAR}`, "gi"),
    parts: (m) => ({ wd: wdIndex(m[1]), day: Number(m[2]), month: monthIndex(m[3]), year: m[4] ? Number(m[4]) : null }),
  },
  // Monday, October 13 (, 2026)
  {
    re: new RegExp(`\\b${WD_WORD}\\.?,?\\s+${MONTH_WORD}\\.?\\s+(\\d{1,2})${ORD}\\b${YEAR}`, "gi"),
    parts: (m) => ({ wd: wdIndex(m[1]), day: Number(m[3]), month: monthIndex(m[2]), year: m[4] ? Number(m[4]) : null }),
  },
  // Monday 2026-10-13
  {
    re: new RegExp(`\\b${WD_WORD}\\.?,?\\s+(\\d{4})-(\\d{2})-(\\d{2})\\b`, "gi"),
    parts: (m) => ({ wd: wdIndex(m[1]), day: Number(m[4]), month: Number(m[3]), year: Number(m[2]) }),
  },
  // 2026年10月13日（星期一）, 10月13日 周一, 10月13号礼拜一
  {
    re: /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]\s*[（(]?\s*(?:星期|周|礼拜)([一二三四五六日天])/g,
    parts: (m) => ({ wd: m[4] === "天" ? 0 : ZH_WEEKDAYS.indexOf(m[4]), day: Number(m[3]), month: Number(m[2]), year: m[1] ? Number(m[1]) : null }),
  },
];

function wdIndex(w: string): number {
  return WEEKDAYS.findIndex((d) => d.slice(0, 3).toLowerCase() === w.slice(0, 3).toLowerCase());
}
function monthIndex(w: string): number {
  return MONTHS.findIndex((m) => m.slice(0, 3).toLowerCase() === w.slice(0, 3).toLowerCase()) + 1;
}

/** Without a year: the year that puts the date closest to today. */
function nearestYear(month: number, day: number, today: string): number | null {
  const [ty, tm, td] = today.split("-").map(Number);
  const now = Date.UTC(ty, tm - 1, td);
  let best: number | null = null;
  for (const y of [ty - 1, ty, ty + 1]) {
    if (weekdayOf(y, month, day) === null) continue;
    if (best === null || Math.abs(Date.UTC(y, month - 1, day) - now) < Math.abs(Date.UTC(best, month - 1, day) - now)) best = y;
  }
  return best;
}

export interface WrongWeekday {
  /** As written in the reply. */
  said: string;
  /** The date with its real weekday, e.g. "Tuesday 13 October 2026". */
  actual: string;
}

/** Weekday + date pairs in a reply that don't match the calendar (dates without a year: the one nearest today). */
export function wrongWeekdays(text: string, today: string): WrongWeekday[] {
  const out: WrongWeekday[] = [];
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const { wd, day, month, year } = p.parts(m as RegExpExecArray);
      if (wd < 0 || month < 1) continue;
      const y = year ?? nearestYear(month, day, today);
      if (y === null) continue;
      const real = weekdayOf(y, month, day);
      if (real === null || real === wd) continue;
      const said = m[0].trim().replace(/[.,]+$/, "");
      if (seen.has(said)) continue;
      seen.add(said);
      out.push({ said, actual: longDate(`${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`) as string });
    }
  }
  return out;
}

export function weekdayWarning(wrong: WrongWeekday[]): string {
  const list = wrong.map((w) => `"${w.said}" (${w.actual})`).join("; ");
  return `This reply has a weekday that doesn't match its date: ${list}. Check the date before you send or rely on it.`;
}
