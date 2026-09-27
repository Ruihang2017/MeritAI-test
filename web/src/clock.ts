// The UI's "now", following the app's today (ShellState.today): the demo workspace runs on the
// design's date (src/clock.ts), so "Today", "Yesterday" and "this week" read as on the canvas.
let offsetDays = 0;

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Called with each ShellState: whole days between the app's today and this computer's. */
export function setAppToday(iso: string): void {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return;
  const real = new Date();
  offsetDays = Math.round((new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() - new Date(real.getFullYear(), real.getMonth(), real.getDate()).getTime()) / 86_400_000);
}

export function now(): Date {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d;
}

/** Today as YYYY-MM-DD (e.g. a form's default date). */
export const todayIso = () => localIso(now());
