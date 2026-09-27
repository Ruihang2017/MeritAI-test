// The app's "now". Real use: the system clock. The demo workspace (npm run ui:demo / ui:fake)
// sets FX_TODAY=YYYY-MM-DD, the day the design canvas's sample data is dated, and "now"
// becomes that day at the current time of day, so the demo reads exactly like the design
// on any day it is opened.

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Whole days between the real local date and FX_TODAY (0 when unset or invalid). */
export function clockOffsetDays(): number {
  const t = process.env.FX_TODAY;
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return 0;
  const [y, m, d] = t.split("-").map(Number);
  const real = new Date();
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(real.getFullYear(), real.getMonth(), real.getDate()).getTime()) / 86_400_000);
}

export function now(): Date {
  const d = new Date();
  d.setDate(d.getDate() + clockOffsetDays());
  return d;
}

/** Today as YYYY-MM-DD in local time. */
export const todayIso = () => localIso(now());
