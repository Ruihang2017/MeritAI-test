import { join } from "node:path";
import type { ClientTool, Confirm, ToolOutcome } from "../engine/types";
import { checkJobId, jobDir, listJobs, type Folders } from "../files/folders";
import type { Register } from "../business/register";
import { candidates, createJobWithJd, findCandidate, hireCount, linkHire } from "../business/hiring";
import { writeJd } from "../business/jobDescription";
import type { Catalog, Decision } from "./catalog";
import { ingestJob, JD_NAME } from "./pipeline";
import { walk } from "../files/folders";

const fail = (text: string): ToolOutcome => ({ success: false, text });
const jobProp = { type: "string", description: "Job folder name, exactly as listed by list_jobs." };
const MAX_JD_CHARS = 40_000;

/**
 * The Hiring page's actions for the adviser (owner, 2026-09-27: one action, one path): the
 * candidates of a job, the owner's decisions, a hire, how many to hire, closing a job, a new job.
 * Every write shows what changes and waits for the owner's OK (as the register tools do).
 */
export function hiringTools(opts: { folders: () => Folders; catalog: () => Catalog; register: () => Register; confirm: Confirm }): ClientTool[] {
  const { confirm } = opts;
  const existing = (job: string): string | null => {
    const jobs = listJobs(opts.folders());
    if (jobs.includes(job)) return null;
    return `No job called "${job}". Jobs: ${jobs.join(", ") || "none"}.`;
  };
  const closed = (job: string) => opts.catalog().jobSettings(job).closedAt !== null;
  const countLine = (job: string) => {
    const c = hireCount(opts.catalog(), opts.register(), job);
    return `${job}: ${c.hired} of ${c.openings} hired${c.closed ? " (closed)" : ""}.${c.hired >= c.openings && !c.closed ? " Everyone it needs is hired: ask the owner whether to close the job (update_job with open: false); never close it without their OK." : ""}`;
  };

  return [
    {
      name: "list_candidates",
      description:
        "List a job's candidates (readable applications): name, application file, whether screened against the current criteria, the owner's decision (shortlist / not this time) and whether they were hired. Use it to find a candidate the owner mentions by name.",
      inputSchema: { type: "object", properties: { job: jobProp }, required: ["job"], additionalProperties: false },
      handle: async (args) => {
        const job = String((args as { job?: unknown }).job ?? "");
        const missing = existing(job);
        if (missing) return fail(missing);
        await ingestJob(opts.catalog(), opts.folders(), job).catch(() => null);
        const list = candidates(opts.catalog(), job);
        if (!list.length) return { success: true, text: `"${job}" has no readable applications yet.`, display: `candidates: ${job}: none` };
        const lines = list.map((c) => `- ${c.name} (file: ${c.file}): ${c.screened ? "screened" : "not screened yet"}; decision: ${c.decision === "shortlist" ? "shortlisted" : c.decision === "not" ? "not this time" : "none"}${c.employeeId ? `; hired (employee [${c.employeeId}])` : ""}`);
        return { success: true, text: `Candidates for "${job}":\n${lines.join("\n")}\n\n${countLine(job)}`, display: `candidates: ${job}: ${list.length}` };
      },
    },
    {
      name: "decide_candidates",
      description:
        "Record the owner's own decisions on screened candidates of a job: shortlist, not (Not this time) or clear. Only for decisions the owner stated; never decide for them. Call it directly: the app shows the decisions and asks the owner to confirm.",
      inputSchema: {
        type: "object",
        properties: {
          job: jobProp,
          decisions: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: { candidate: { type: "string", description: "The candidate's name or application file, as list_candidates shows it." }, decision: { type: "string", enum: ["shortlist", "not", "clear"] } },
              required: ["candidate", "decision"],
              additionalProperties: false,
            },
          },
        },
        required: ["job", "decisions"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { job?: string; decisions?: { candidate: string; decision: "shortlist" | "not" | "clear" }[] };
        const job = String(a.job ?? "");
        const missing = existing(job);
        if (missing) return fail(missing);
        if (closed(job)) return fail(`"${job}" is closed. Decisions need it reopened first (update_job with open: true), if the owner wants that.`);
        const picked: { hash: string; name: string; decision: Decision | null; label: string }[] = [];
        for (const d of a.decisions ?? []) {
          const f = findCandidate(opts.catalog(), job, String(d.candidate ?? ""));
          if (!f.ok) return fail(`Not saved: ${f.error}.`);
          if (!f.candidate.screened) return fail(`Not saved: ${f.candidate.name} isn't screened against the current criteria yet; decisions are for screened candidates.`);
          if (f.candidate.employeeId) return fail(`Not saved: ${f.candidate.name} was hired; remove them from Staff to undo the hire.`);
          const decision = d.decision === "clear" ? null : d.decision;
          picked.push({ hash: f.candidate.hash, name: f.candidate.name, decision, label: decision === "shortlist" ? "Shortlist" : decision === "not" ? "Not this time" : "No decision" });
        }
        if (!(await confirm({ kind: "hiring", title: `Record your decisions for ${job}?`, items: picked.map((p) => `${p.name}: ${p.label}`), about: { kind: "job", job } }))) return { success: true, text: "The owner did not confirm; nothing was saved.", display: "hiring: not saved" };
        for (const p of picked) opts.catalog().setDecision(job, p.hash, p.decision);
        return { success: true, text: `Saved: ${picked.map((p) => `${p.name}: ${p.label}`).join("; ")}.`, display: `hiring: ${picked.length} decision(s) saved for ${job}` };
      },
    },
    {
      name: "record_hire",
      description:
        "Link an employee already in the register to the job and candidate they were hired from, so the job counts them as hired (e.g. they were added before the hire was linked). For someone new, use add_employee with hiredFrom instead. Call it directly: the app asks the owner to confirm.",
      inputSchema: {
        type: "object",
        properties: { job: jobProp, candidate: { type: "string", description: "Name or application file, as list_candidates shows it." }, employeeId: { type: "integer" } },
        required: ["job", "candidate", "employeeId"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { job?: string; candidate?: string; employeeId?: number };
        const job = String(a.job ?? "");
        const missing = existing(job);
        if (missing) return fail(missing);
        const e = opts.register().get(Number(a.employeeId));
        if (!e) return fail(`No employee with id ${a.employeeId}. Call list_employees first.`);
        const f = findCandidate(opts.catalog(), job, String(a.candidate ?? ""));
        if (!f.ok) return fail(`Not saved: ${f.error}.`);
        if (!(await confirm({ kind: "hiring", title: `Record ${e.name} as hired for ${job}?`, items: [`Application: ${f.candidate.name} (${f.candidate.file})`, `Employee: ${e.name}, ${e.role}`], about: { kind: "job", job } }))) return { success: true, text: "The owner did not confirm; nothing was saved.", display: "hiring: not saved" };
        linkHire(opts.catalog(), opts.register(), job, f.candidate.file, e.id);
        return { success: true, text: `Recorded. ${countLine(job)}`, display: `hiring: ${e.name} hired for ${job}` };
      },
    },
    {
      name: "update_job",
      description:
        "Change a job's settings: how many people it is for (openings: the total, including anyone already hired), or close it (open: false; everything is kept, read-only) or reopen it (open: true). " +
        "Reopening a filled job to hire more: set openings to the number already hired plus the new ones, in the same call (list_candidates or list_jobs shows how many are hired). Pass null for what doesn't change. Call it directly: the app asks the owner to confirm.",
      inputSchema: {
        type: "object",
        properties: { job: jobProp, openings: { type: ["integer", "null"], description: "1 to 99" }, open: { type: ["boolean", "null"] } },
        required: ["job", "openings", "open"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { job?: string; openings?: number | null; open?: boolean | null };
        const job = String(a.job ?? "");
        const missing = existing(job);
        if (missing) return fail(missing);
        const items: string[] = [];
        const cur = opts.catalog().jobSettings(job);
        if (a.openings !== null && a.openings !== undefined) {
          if (!Number.isInteger(a.openings) || a.openings < 1 || a.openings > 99) return fail("openings must be a whole number from 1 to 99.");
          if (a.openings !== cur.openings) items.push(`People to hire: ${cur.openings} → ${a.openings}`);
        }
        if (a.open !== null && a.open !== undefined && a.open === (cur.closedAt !== null)) items.push(a.open ? "Reopen the job" : "Close the job (kept, read-only; you can reopen it)");
        if (!items.length) return fail("Nothing to change.");
        if (!(await confirm({ kind: "hiring", title: `Change ${job}?`, items, about: { kind: "job", job } }))) return { success: true, text: "The owner did not confirm; nothing was saved.", display: "hiring: not saved" };
        if (a.openings && a.openings !== cur.openings) opts.catalog().setOpenings(job, a.openings);
        if (a.open !== null && a.open !== undefined && a.open === (cur.closedAt !== null)) opts.catalog().setClosed(job, !a.open);
        const now = hireCount(opts.catalog(), opts.register(), job);
        const full = a.open === true && now.hired >= now.openings;
        return {
          success: true,
          text: full ? `Saved: reopened, but it still has everyone it's for (${now.hired} of ${now.openings} hired). If the owner wants more people, call update_job again with openings = ${now.hired} + how many more (the owner's OK is asked again).` : `Saved. ${countLine(job)}`,
          display: `hiring: ${job} updated`,
        };
      },
    },
    {
      name: "set_job_description",
      description:
        "Save a job description into an existing job (markdown the owner approved in this conversation; saved as a Word file named '<job> JD'), so screening can use it. " +
        "If the job already has one, pass replace: true only when the owner wants the new version to replace it (e.g. they asked you to tailor it). Call it directly: the app asks the owner to confirm.",
      inputSchema: {
        type: "object",
        properties: { job: jobProp, jd: { type: "string", description: "The job description in markdown." }, replace: { type: "boolean", description: "Replace the job's current job description file." } },
        required: ["job", "jd", "replace"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { job?: string; jd?: string; replace?: boolean };
        const job = String(a.job ?? "");
        const missing = existing(job);
        if (missing) return fail(missing);
        if (closed(job)) return fail(`"${job}" is closed. Reopen it first (update_job with open: true), if the owner wants that.`);
        const jd = String(a.jd ?? "").trim();
        if (!jd) return fail("The job description is empty.");
        if (jd.length > MAX_JD_CHARS) return fail("The job description is too long.");
        const dir = jobDir(opts.folders(), job);
        const current = walk(dir).files.find((x) => !x.rel.includes("/") && JD_NAME.test(x.rel));
        if (current && !a.replace) return fail(`"${job}" already has a job description file (${current.rel}). If the owner wants the new version to replace it, call again with replace: true; otherwise save it to the Outbox with save_document.`);
        // A Word JD keeps its name; another format (PDF, text) becomes "<job> JD.docx". Either way the replaced version is kept (Undo on the Hiring page).
        const name = current && /\.docx$/i.test(current.rel) ? current.rel : `${job} JD.docx`;
        if (!(await confirm({ kind: "hiring", title: current ? `Replace the job description of ${job}?` : `Save this job description into ${job}?`, items: [current ? `${name} is replaced by the new version` : `Saved as "${name}" in the job's folder`, `${jd.split("\n")[0].replace(/^#+\s*/, "").slice(0, 80)}`], about: { kind: "job", job } }))) {
          return { success: true, text: "The owner did not confirm; nothing was saved.", display: "hiring: not saved" };
        }
        let p: string;
        try {
          p = join(dir, await writeJd(opts.folders(), job, jd));
        } catch (e) {
          return fail(`Not saved: ${(e as Error).message}.`);
        }
        opts.catalog().notify({ ref: { kind: "job", job }, action: "updated", summary: `${job}: job description saved` });
        const drafted = opts.catalog().latestRubric(job);
        return { success: true, text: `Saved "${name}" into the job.${drafted ? " Screening criteria were drafted from the earlier version: offer to draft them again from this one (propose_criteria)." : " Next: draft the screening criteria from it (propose_criteria) when the owner wants to screen."}`, display: `hiring: JD saved for ${job}`, files: [p] };
      },
    },
    {
      name: "create_job",
      description:
        "Create a new job on the Hiring page, optionally with its job description (markdown the owner approved in this conversation; saved as a Word file named '<job> JD'). Applications are added to it later (dropped on the job, or into its folder). Call it directly: the app asks the owner to confirm.",
      inputSchema: {
        type: "object",
        properties: {
          job: { type: "string", description: "Short job name, e.g. 'Office admin' or 'Weekend cleaner'." },
          openings: { type: "integer", description: "How many people to hire (1 to 99)." },
          jd: { type: ["string", "null"], description: "The job description in markdown, only if the owner approved it; null for none yet." },
        },
        required: ["job", "openings", "jd"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const a = args as { job?: string; openings?: number; jd?: string | null };
        let job: string;
        try {
          job = checkJobId(String(a.job ?? "").trim());
        } catch (e) {
          return fail(`Not created: ${(e as Error).message}.`);
        }
        const f = opts.folders();
        if (listJobs(f).some((j) => j.toLowerCase() === job.toLowerCase())) return fail(`There is already a job called "${job}".`);
        const openings = Number(a.openings ?? 1);
        if (!Number.isInteger(openings) || openings < 1 || openings > 99) return fail("openings must be a whole number from 1 to 99.");
        const jd = typeof a.jd === "string" && a.jd.trim() ? a.jd.trim() : null;
        if (jd && jd.length > MAX_JD_CHARS) return fail("The job description is too long.");
        if (!(await confirm({ kind: "hiring", title: `Create the job "${job}"?`, items: [`People to hire: ${openings}`, jd ? `Job description: saved as "${job} JD.docx" (${jd.split("\n")[0].replace(/^#+\s*/, "").slice(0, 60)})` : "No job description yet"] }))) {
          return { success: true, text: "The owner did not confirm; nothing was created.", display: "hiring: not created" };
        }
        const created = await createJobWithJd(f, opts.catalog(), job, openings, jd);
        const files = created.jdFile ? [created.jdFile] : [];
        return {
          success: true,
          text: `Created "${job}" (${openings} to hire)${jd ? ` with its job description "${job} JD.docx"` : ""}. The owner adds applications on the Hiring page (drop them on the job) or in its folder.${jd ? " When there are applications, draft the screening criteria from the JD (propose_criteria)." : ""}`,
          display: `hiring: job ${job} created`,
          ...(files.length ? { files } : {}),
        };
      },
    },
  ];
}
