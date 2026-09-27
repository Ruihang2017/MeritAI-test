import ExcelJS from "exceljs";
import type { Engine } from "../engine/types";
import type { Folders } from "../files/folders";
import { markdownToDocx } from "../files/docx";
import { writeNew } from "../files/tools";
import { sanitizeStem } from "../files/folders";
import type { RankedCandidate, ScreenResult } from "./pipeline";

/** Candidates detailed in the Word report and compared by the model; Excel has everyone. */
export const REPORT_TOP_N = 10;

const STATUS_LABEL: Record<string, string> = { met: "Met", partly: "Partly met", not_evidenced: "Not evidenced" };

const COMPARE_INSTRUCTIONS = `You write a short comparison of shortlisted candidates for a recruiter, from structured screening results (not resumes). Candidates are labelled C1, C2, ...; you do not know their names.
- overview: 2-4 sentences on the shortlist as a whole (how many strong matches, common gaps).
- notes: one sentence per candidate on what distinguishes them from the others.
- Evidence-based and job-related only. No recommendation to hire or reject; the decision rests with the recruiter and hiring manager.`;

const COMPARE_SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string" },
    notes: {
      type: "array",
      items: { type: "object", properties: { label: { type: "string" }, note: { type: "string" } }, required: ["label", "note"], additionalProperties: false },
    },
  },
  required: ["overview", "notes"],
  additionalProperties: false,
};

export async function compareShortlist(engine: Engine, r: ScreenResult): Promise<{ overview: string; notes: Map<string, string> }> {
  const top = r.ranked.filter((c) => c.band !== "Not a resume").slice(0, REPORT_TOP_N);
  if (top.length < 2) return { overview: "", notes: new Map() };
  const payload = top
    .map((c, i) => `C${i + 1} (${c.band}; essential ${c.essentialScore}/${c.essentialTotal}; desirable ${c.desirableScore}/${c.desirableTotal}): ${c.evaluation.summary} Strengths: ${c.evaluation.strengths.join("; ")}. Gaps: ${c.evaluation.gaps.join("; ")}.`)
    .join("\n");
  const { text } = await engine.runEphemeral(`Role: ${r.rubric.role}\n\n${payload}`, { instructions: COMPARE_INSTRUCTIONS, outputSchema: COMPARE_SCHEMA });
  const parsed = JSON.parse(text) as { overview: string; notes: { label: string; note: string }[] };
  const notes = new Map<string, string>();
  for (const n of parsed.notes) {
    const i = Number(n.label.replace(/\D/g, "")) - 1;
    if (top[i]) notes.set(top[i].file, n.note);
  }
  return { overview: parsed.overview, notes };
}

function candidateMarkdown(c: RankedCandidate, r: ScreenResult, note?: string): string {
  const crit = (type: "essential" | "desirable") =>
    r.rubric.criteria
      .filter((k) => k.type === type)
      .map((k) => {
        const res = c.evaluation.criteria.find((x) => x.id === k.id);
        return `- **${k.id} ${STATUS_LABEL[res?.status ?? "not_evidenced"]}**: ${k.text}${res?.evidence ? ` (${res.evidence})` : ""}`;
      })
      .join("\n");
  const flags = [c.evaluation.flags.suspiciousInstructions && "contains instructions aimed at an AI (ignored)", c.evaluation.flags.differentRole && "appears to be for a different role"].filter(Boolean);
  return [
    `### ${c.rank}. ${c.name} (${c.band})`,
    `File: ${c.file}. Essential ${c.essentialScore}/${c.essentialTotal}, desirable ${c.desirableScore}/${c.desirableTotal}.`,
    "",
    c.evaluation.summary + (note ? ` ${note}` : ""),
    "",
    "Essential criteria:",
    crit("essential"),
    ...(r.rubric.criteria.some((k) => k.type === "desirable") ? ["", "Desirable criteria:", crit("desirable")] : []),
    "",
    `Strengths: ${c.evaluation.strengths.join("; ") || "-"}`,
    "",
    `Gaps: ${c.evaluation.gaps.join("; ") || "-"}`,
    "",
    "Questions to verify:",
    ...c.evaluation.questions.map((q) => `- ${q}`),
    ...(flags.length ? ["", `Flags: ${flags.join("; ")}`] : []),
  ].join("\n");
}

export function reportMarkdown(r: ScreenResult, comparison: { overview: string; notes: Map<string, string> }): string {
  const top = r.ranked.slice(0, REPORT_TOP_N);
  const counts = (b: string) => r.ranked.filter((c) => c.band === b).length;
  const lines = [
    `# Screening report: ${r.rubric.role}`,
    "",
    `Job folder: ${r.job}. Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}. Criteria version ${r.rubric.version} (confirmed).`,
    "",
    "## Summary",
    "",
    `- Screened: ${r.ranked.length} (${counts("Strong")} strong, ${counts("Partial")} partial, ${counts("Weak")} weak, ${counts("Not a resume")} not a resume).`,
    `- Not yet screened: ${r.remaining}${r.remaining ? " (run screening again to continue; each run screens up to the batch limit)" : ""}.`,
    `- Could not read: ${r.ingest.unreadable.length}. Duplicates skipped: ${r.ingest.duplicates.length}.${r.failed.length ? ` Failed this run: ${r.failed.length}.` : ""}`,
    ...(comparison.overview ? ["", comparison.overview] : []),
    "",
    "## Criteria",
    "",
    ...r.rubric.criteria.map((c) => `- ${c.id} (${c.type}): ${c.text}`),
    "",
    `## Top ${top.length} candidates`,
    "",
    ...top.flatMap((c) => [candidateMarkdown(c, r, comparison.notes.get(c.file)), ""]),
  ];
  if (r.ingest.unreadable.length || r.ingest.duplicates.length || r.failed.length) {
    lines.push("## Not screened", "");
    for (const u of r.ingest.unreadable) lines.push(`- ${u.file}: ${u.reason}`);
    for (const d of r.ingest.duplicates) lines.push(`- ${d.file}: duplicate of ${d.sameAs}`);
    for (const f of r.failed) lines.push(`- ${f.file}: evaluation failed (${f.error})`);
    lines.push("");
  }
  lines.push(
    "---",
    "",
    "Screening aid only: the shortlisting decision rests with the recruiter and hiring manager. Resumes were evaluated blind (name and contact details masked) against the same criteria; the full list is in the Excel file.",
  );
  return lines.join("\n");
}

export async function reportXlsx(r: ScreenResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HR Assistant";
  const ws = wb.addWorksheet("Candidates");
  const critCols = r.rubric.criteria.map((c) => ({ header: c.id, key: c.id, width: 13 }));
  ws.columns = [
    { header: "Rank", key: "rank", width: 6 },
    { header: "Name", key: "name", width: 26 },
    { header: "Band", key: "band", width: 13 },
    { header: "Essential", key: "ess", width: 10 },
    { header: "Desirable", key: "des", width: 10 },
    ...critCols,
    { header: "Summary", key: "summary", width: 60 },
    { header: "Flags", key: "flags", width: 24 },
    { header: "File", key: "file", width: 40 },
  ];
  for (const c of r.ranked) {
    const row: Record<string, string | number> = {
      rank: c.rank,
      name: c.name,
      band: c.band,
      ess: `${c.essentialScore}/${c.essentialTotal}`,
      des: `${c.desirableScore}/${c.desirableTotal}`,
      summary: c.evaluation.summary,
      flags: [c.evaluation.flags.suspiciousInstructions && "AI instructions", c.evaluation.flags.differentRole && "different role"].filter(Boolean).join(", "),
      file: c.file,
    };
    for (const k of r.rubric.criteria) row[k.id] = STATUS_LABEL[c.evaluation.criteria.find((x) => x.id === k.id)?.status ?? "not_evidenced"];
    ws.addRow(row);
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  const cs = wb.addWorksheet("Criteria");
  cs.columns = [{ header: "Id", key: "id", width: 6 }, { header: "Type", key: "type", width: 11 }, { header: "Criterion", key: "text", width: 90 }];
  for (const c of r.rubric.criteria) cs.addRow(c);
  cs.getRow(1).font = { bold: true };

  const ns = wb.addWorksheet("Not screened");
  ns.columns = [{ header: "File", key: "file", width: 50 }, { header: "Reason", key: "reason", width: 60 }];
  for (const u of r.ingest.unreadable) ns.addRow({ file: u.file, reason: u.reason });
  for (const d of r.ingest.duplicates) ns.addRow({ file: d.file, reason: `duplicate of ${d.sameAs}` });
  for (const f of r.failed) ns.addRow({ file: f.file, reason: `evaluation failed: ${f.error}` });
  if (r.remaining) ns.addRow({ file: `(${r.remaining} more)`, reason: "not screened yet: batch limit reached; run screening again" });
  ns.getRow(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type ReportFormat = "docx" | "xlsx" | "both";

/**
 * Writes the screening report to the Outbox, only when the user asks for one:
 * Word by default, Excel (everyone, one column per criterion) on request.
 * Returns the saved file names.
 */
export async function saveReports(engine: Engine, folders: Folders, r: ScreenResult, format: ReportFormat = "docx"): Promise<string[]> {
  // Named as on the design canvas; a later report gets " (2)" rather than overwriting (writeNew).
  const saved: string[] = [];
  if (format !== "xlsx") {
    const comparison = await compareShortlist(engine, r).catch(() => ({ overview: "", notes: new Map<string, string>() }));
    const stem = sanitizeStem(`${r.job} screening report`);
    saved.push(writeNew(folders.outbox, stem, ".docx", await markdownToDocx(reportMarkdown(r, comparison), stem)));
  }
  if (format !== "docx") saved.push(writeNew(folders.outbox, sanitizeStem(`${r.job} all candidates`), ".xlsx", await reportXlsx(r)));
  return saved;
}

/** The chat/terminal summary shown after screening (no files). */
export function chatSummary(r: ScreenResult, top = REPORT_TOP_N): string {
  const counts = (b: string) => r.ranked.filter((c) => c.band === b).length;
  const lines = [
    `Screened ${r.ranked.length} for "${r.rubric.role}" (${counts("Strong")} strong, ${counts("Partial")} partial, ${counts("Weak")} weak, ${counts("Not a resume")} not a resume); ${r.evaluatedThisRun} new this run; ${r.remaining} not yet screened${r.remaining ? " (screen again to continue)" : ""}.`,
    `Unreadable: ${r.ingest.unreadable.length}; duplicates: ${r.ingest.duplicates.length}; failed: ${r.failed.length}; flagged for AI instructions: ${r.ranked.filter((c) => c.evaluation.flags.suspiciousInstructions).length}.`,
    "",
    ...r.ranked.slice(0, top).map((c) => {
      const gaps = c.evaluation.gaps.slice(0, 2).join("; ");
      return `${c.rank}. ${c.name} (${c.band}; essential ${c.essentialScore}/${c.essentialTotal}, desirable ${c.desirableScore}/${c.desirableTotal}): ${c.evaluation.summary}${gaps ? ` Gaps: ${gaps}.` : ""}`;
    }),
  ];
  if (r.ranked.length > top) lines.push(`... and ${r.ranked.length - top} more.`);
  return lines.join("\n");
}
