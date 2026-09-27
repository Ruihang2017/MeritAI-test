import { now as clockNow } from "./clock";

// Design rule (ui-design.md §11): dates show as "Fri 9 Oct"; another year's as "14 Feb 2027" (no
// weekday). Short form "6 Sep" after "since" and in reminder details; "Left 30 Jun 2026" with the year.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parse = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

export function fmtDate(iso: string, now = clockNow()): string {
  const d = parse(iso);
  if (!d) return iso;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "6 Sep" ("6 Sep 2025" in another year, or always with `year`). */
export function fmtDay(iso: string, opts: { year?: boolean } = {}, now = clockNow()): string {
  const d = parse(iso);
  if (!d) return iso;
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return opts.year || d.getFullYear() !== now.getFullYear() ? `${base} ${d.getFullYear()}` : base;
}

/** Reformats every YYYY-MM-DD inside a text (confirm items, receipts, reminders, staff dates). */
export const fmtDatesIn = (text: string, opts: { short?: boolean } = {}) =>
  text.replace(/(?<![\w/=.-])\d{4}-\d{2}-\d{2}(?![\w/-])/g, (d, at: number) => {
    const before = text.slice(Math.max(0, at - 6), at);
    if (/Left $/.test(before)) return fmtDay(d, { year: true });
    return opts.short || /since $/.test(before) ? fmtDay(d) : fmtDate(d);
  });

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).replace(" ", " ").toLowerCase();
}

/** A timestamp as the design shows saved files: "Today 9:41 am", "Yesterday 4:08 pm", "Thu 24 Sep" (local time). */
export function fmtWhen(iso: string, now = clockNow()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = dayLabel(d, now);
  return day === "Today" || day === "Yesterday" ? `${day} ${fmtTime(d)}` : day;
}

/** The local calendar day of a timestamp (YYYY-MM-DD). */
export const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "Today", "Yesterday" or the date, for day dividers and history. */
export function dayLabel(d: Date, now = clockNow()): string {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return fmtDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, now);
}
