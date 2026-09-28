// The MeritAI team's side of Send feedback (owner, 2026-09-28): every feedback file testers sent,
// in one Excel workbook, plus a short summary here.
//
//   npx tsx scripts/feedback-report.ts <folder with the files> [report.xlsx]
//
// Files can sit in subfolders (one per tester or per email); a file sent twice counts once. Each file
// carries all of that tester's ratings so far, so ratings are counted once per tester, time and question.
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface FeedbackRating {
  at: string;
  rating: "up" | "down";
  reasons: string[];
  note: string;
  conversation: string | null;
  question: string;
  answer: string;
}

export interface FeedbackFile {
  file: string;
  from: string;
  version: string;
  savedAt: string;
  note: string;
  ratings: FeedbackRating[];
  wantedConnections: string[];
  errors: { at: string; message: string }[];
  conversation: string | null;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** The feedback files under a folder (any depth), each read once whatever its name. */
export function readFeedbackFolder(folder: string): { files: FeedbackFile[]; duplicates: number; skipped: string[] } {
  const seen = new Set<string>();
  const files: FeedbackFile[] = [];
  const skipped: string[] = [];
  let duplicates = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.toLowerCase().endsWith(".json")) {
        const raw = readFileSync(p);
        const hash = createHash("sha256").update(raw).digest("hex");
        if (seen.has(hash)) {
          duplicates++;
          continue;
        }
        seen.add(hash);
        let j: Record<string, unknown>;
        try {
          j = JSON.parse(raw.toString("utf8"));
        } catch {
          skipped.push(name);
          continue;
        }
        if (j.kind !== "MeritAI feedback") {
          skipped.push(name);
          continue;
        }
        const technical = (j.technical ?? {}) as { app?: string; recentErrors?: { at: string; message: string }[] };
        const conv = j.conversation as { title?: string } | undefined;
        files.push({
          file: basename(p),
          from: text(j.from) || "(no name)",
          version: text(j.version) || text(technical.app) || "?",
          savedAt: text(j.savedAt),
          note: text(j.note),
          ratings: Array.isArray(j.ratings) ? (j.ratings as FeedbackRating[]) : [],
          wantedConnections: Array.isArray(j.wantedConnections) ? (j.wantedConnections as string[]) : [],
          errors: Array.isArray(technical.recentErrors) ? technical.recentErrors : [],
          conversation: conv?.title ?? null,
        });
      }
    }
  };
  walk(folder);
  files.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  return { files, duplicates, skipped };
}

export interface FeedbackReport {
  testers: string[];
  versions: string[];
  up: number;
  down: number;
  reasons: [string, number][];
  notDown: (FeedbackRating & { from: string; version: string })[];
  notes: { at: string; from: string; version: string; note: string; conversation: string | null; wanted: string }[];
  errors: { message: string; count: number; testers: string[]; versions: string[]; last: string }[];
  byTester: { from: string; version: string; files: number; up: number; down: number }[];
}

export function summarise(files: FeedbackFile[]): FeedbackReport {
  // A rating once per tester, time and question (each file repeats the earlier ones).
  const ratings = new Map<string, FeedbackRating & { from: string; version: string }>();
  for (const f of files) for (const r of f.ratings) ratings.set(`${f.from}|${r.at}|${r.question}`, { ...r, from: f.from, version: f.version });
  const all = [...ratings.values()].sort((a, b) => a.at.localeCompare(b.at));
  const reasons = new Map<string, number>();
  for (const r of all) if (r.rating === "down") for (const x of r.reasons) reasons.set(x, (reasons.get(x) ?? 0) + 1);
  // Errors: the same message counted once per tester and time.
  const errs = new Map<string, { count: number; testers: Set<string>; versions: Set<string>; last: string; seen: Set<string> }>();
  for (const f of files)
    for (const e of f.errors) {
      const msg = e.message.replace(/\s+/g, " ").trim();
      const x = errs.get(msg) ?? { count: 0, testers: new Set(), versions: new Set(), last: "", seen: new Set() };
      const k = `${f.from}|${e.at}`;
      if (!x.seen.has(k)) (x.seen.add(k), x.count++);
      x.testers.add(f.from);
      x.versions.add(f.version);
      if (e.at > x.last) x.last = e.at;
      errs.set(msg, x);
    }
  const by = new Map<string, { from: string; version: string; files: number; up: number; down: number }>();
  for (const f of files) {
    const k = `${f.from}|${f.version}`;
    const x = by.get(k) ?? { from: f.from, version: f.version, files: 0, up: 0, down: 0 };
    x.files++;
    by.set(k, x);
  }
  for (const r of all) {
    const x = by.get(`${r.from}|${r.version}`);
    if (x) r.rating === "up" ? x.up++ : x.down++;
  }
  return {
    testers: [...new Set(files.map((f) => f.from))],
    versions: [...new Set(files.map((f) => f.version))],
    up: all.filter((r) => r.rating === "up").length,
    down: all.filter((r) => r.rating === "down").length,
    reasons: [...reasons].sort((a, b) => b[1] - a[1]),
    notDown: all.filter((r) => r.rating === "down"),
    notes: files.filter((f) => f.note.trim() || f.wantedConnections.length).map((f) => ({ at: f.savedAt, from: f.from, version: f.version, note: f.note, conversation: f.conversation, wanted: f.wantedConnections.join("; ") })),
    errors: [...errs].map(([message, x]) => ({ message, count: x.count, testers: [...x.testers], versions: [...x.versions], last: x.last })).sort((a, b) => b.count - a.count),
    byTester: [...by.values()].sort((a, b) => a.from.localeCompare(b.from) || a.version.localeCompare(b.version)),
  };
}

const day = (iso: string) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

export async function workbook(r: FeedbackReport, files: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = (name: string, cols: { header: string; key: string; width: number }[]) => {
    const ws = wb.addWorksheet(name);
    ws.columns = cols;
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return ws;
  };
  const o = sheet("Overview", [
    { header: "Tester", key: "from", width: 24 },
    { header: "Version", key: "version", width: 10 },
    { header: "Feedback files", key: "files", width: 15 },
    { header: "Helpful", key: "up", width: 10 },
    { header: "Not helpful", key: "down", width: 12 },
  ]);
  for (const x of r.byTester) o.addRow(x);
  o.addRow({});
  o.addRow({ from: "All", files, up: r.up, down: r.down }).font = { bold: true };
  o.addRow({});
  o.addRow({ from: "Not helpful: why" }).font = { bold: true };
  for (const [why, n] of r.reasons) o.addRow({ from: why, files: n });

  const d = sheet("Not helpful", [
    { header: "When", key: "at", width: 17 },
    { header: "Tester", key: "from", width: 18 },
    { header: "Version", key: "version", width: 9 },
    { header: "Conversation", key: "conversation", width: 24 },
    { header: "Question", key: "question", width: 50 },
    { header: "Start of the reply", key: "answer", width: 60 },
    { header: "What went wrong", key: "reasons", width: 26 },
    { header: "Their note", key: "note", width: 40 },
  ]);
  for (const x of r.notDown) d.addRow({ ...x, at: day(x.at), answer: x.answer.slice(0, 600), reasons: x.reasons.join("; ") });

  const n = sheet("Notes", [
    { header: "When", key: "at", width: 17 },
    { header: "Tester", key: "from", width: 18 },
    { header: "Version", key: "version", width: 9 },
    { header: "What they wrote", key: "note", width: 80 },
    { header: "Conversation included", key: "conversation", width: 26 },
    { header: "Connections they want", key: "wanted", width: 36 },
  ]);
  for (const x of r.notes) n.addRow({ ...x, at: day(x.at) });

  const e = sheet("Errors", [
    { header: "Error", key: "message", width: 80 },
    { header: "Times", key: "count", width: 8 },
    { header: "Testers", key: "testers", width: 24 },
    { header: "Versions", key: "versions", width: 12 },
    { header: "Last seen", key: "last", width: 17 },
  ]);
  for (const x of r.errors) e.addRow({ ...x, testers: x.testers.join(", "), versions: x.versions.join(", "), last: day(x.last) });

  for (const ws of [d, n, e]) ws.eachRow((row, i) => i > 1 && (row.alignment = { vertical: "top", wrapText: true }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.log("Usage: npx tsx scripts/feedback-report.ts <folder with the feedback files> [report.xlsx]");
    process.exit(1);
  }
  const { files, duplicates, skipped } = readFeedbackFolder(resolve(folder));
  const r = summarise(files);
  const stamp = new Date().toISOString().slice(0, 10);
  const out = resolve(process.argv[3] ?? join(folder, `MeritAI feedback report ${stamp}.xlsx`));
  writeFileSync(out, await workbook(r, files.length));
  console.log(`${files.length} feedback files (${duplicates} sent twice, counted once${skipped.length ? `; ${skipped.length} other .json files skipped` : ""})`);
  console.log(`testers: ${r.testers.join(", ") || "-"} · versions: ${r.versions.join(", ") || "-"}`);
  console.log(`replies rated: ${r.up} helpful, ${r.down} not helpful${r.reasons.length ? ` (${r.reasons.map(([w, c]) => `${w} ${c}`).join(", ")})` : ""}`);
  console.log(`notes: ${r.notes.length} · errors: ${r.errors.length} different${r.errors[0] ? ` (most: "${r.errors[0].message.slice(0, 80)}" ×${r.errors[0].count})` : ""}`);
  console.log(`report: ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
