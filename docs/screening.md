# Bulk screening (as built)

Screening a job's applications is a fixed workflow run by code: **judgement by the model, control flow by code**. The model never reads resumes one by one in the chat.

## 1 Folders

```
files/
  Jobs/<job>/          one workspace per role (the folder name is the job id)
    JD....             optional JD file at the top level (name starts with "JD", "Job description" or "职位描述", or ends with "JD" or "job description", e.g. "Cleaner JD.docx")
    anything/…         applications: any file types, any subfolders (depth ≤ 6, ≤ 5,000 files)
  Inbox/               loose files not tied to a job (read with read_file)
  Outbox/              reports and documents the assistant saves
  .assistant/          catalog.sqlite (internal; no tool can reach it)
```

Ways to add applications:

- drag and drop folders into `Jobs/<job>`;
- `/import <path> [job]` copies a folder or file in, never overwriting existing files.

Later sources (SEEK, ATS, email, SharePoint; P4, not in the POC) become further *sources* feeding the same catalog.

## 2 Catalog (`src/screening/catalog.ts`)

One SQLite file per files root (Node's built-in `node:sqlite`).

| Table | Content |
|---|---|
| `applications` | job, source (`folder`), source_ref (relative path), content hash, status (`ok` / `unreadable` / `duplicate`), display name |
| `texts` | parsed text, cached by content hash, so every file is parsed once |
| `rubrics` | versioned screening criteria per job, and whether the user confirmed them |
| `evaluations` | the structured result per (hash, job, criteria version), so nothing is evaluated twice |

- **Duplicates:** the same content under two paths (e.g. from SEEK and from email) is evaluated once and listed as a duplicate.
- **Retention:** deleting a job folder deletes its applications, criteria and evaluations, plus any cached text no other application uses. This runs on `/jobs`, `list_jobs` and at the start of screening.

## 3 Flow

| Step | What happens | Code |
|---|---|---|
| 1 Ingest | Walk `Jobs/<job>` (links out of the folder are skipped), hash, parse new files, dedupe | `pipeline.ingestJob` |
| 2 Criteria | The model drafts 3-8 essential and 0-6 desirable criteria from the JD file or JD text from the chat. Protected attributes are excluded, and so are languages beyond English unless the JD says the job needs them: in testing, a JD drafted in a Chinese conversation asked for Chinese, which the job-description skill and this step now prevent. **The user must confirm** (CLI `[y/n]`, or in chat; the model may call `confirm_criteria` only after explicit approval). Edits create a new version | `proposeCriteria`, `confirm_criteria` |
| 3 Evaluate | One isolated, tool-less ephemeral thread per resume, **blind** (name, email, phone, links, DOB lines masked), fixed JSON schema: per criterion met / partly / not evidenced with evidence; strengths, gaps, questions; flags (not a resume, AI instructions, different role). Up to **20 new resumes per run, 20 in parallel** (`FX_SCREEN_LIMIT`, `FX_SCREEN_CONCURRENCY`) | `evaluateResume`, `screenJob` |
| 4 Rank | Deterministic: band (Strong = all essentials met; Partial ≥ half; Weak; Not a resume), then essential score, then desirable score (met 1, partly 0.5) | `rank` |
| 5 Results | **By default only in the chat or terminal**: counts plus the top 10 by name with band, scores, a one-line summary and gaps (`chatSummary`). No file is written | `report.ts` |
| 6 Report (on request) | Only when the user asks ("give me the report" → `save_screening_report`, or `/report <job> [word|excel|both]`). Saved as `<job> screening report.docx` and `<job> all candidates.xlsx` (a later one gets " (2)"). **Word by default**: summary, criteria, a blind model comparison of the top 10, the top 10 with evidence and questions, files not screened. **Excel only when asked**: everyone, rank, name, band, one column per criterion, summary, flags, file; plus Criteria and Not-screened sheets. Uses existing results; screens nothing new | `report.ts` |
| 7 Your decision | The owner marks each screened candidate **Shortlist** or **Not this time** (two options, owner 2026-09-27; a second click clears), in the ranking or the candidate panel, or all the rest at once. Stored in the catalog by file content (`decisions` table), so they survive re-screening; purged with the job. When everyone screened is decided the job shows "N shortlisted" and the next steps: interview kit for the shortlisted, candidate emails (invitations and "not this time", drafts in the Outbox, the owner sends them), and Add to Staff for a hire. No model call | `catalog.ts`, `app.ts` (`decide`, `decideRest`) |
| 8 Hires and the job | Each job has **people to hire** (default 1; New job, the job menu, Duplicate) and is **open or closed** (`job_settings` table). A **hire** is recorded when the Staff form opened from Hiring's "Add to Staff" is saved (`addEmployee` with `hireFrom` → `recordHire`, `hires` table: candidate → employee); it also shortlists them, and deleting the employee undoes it. Nothing else counts as a hire (no matching by name). When hired = people to hire the job is **Filled** and the page suggests closing it (never automatic). A **closed** job keeps everything and is read-only (screening, criteria, decisions and adding files are refused until **Reopen**). **Duplicate** makes a new open job with a copy of the JD (named "<new job> JD") and the criteria (confirmed if they were); applications, decisions and hires are not copied. Job names may contain brackets | `catalog.ts`, `app.ts` (`setOpenings`, `setJobClosed`, `duplicateJob`, `recordHire`) |

**Running again** evaluates only new resumes, or everything again if the criteria changed. It is how larger jobs are processed 20 at a time.

## 4 Using it

- **Chat:** "screen the store_manager applicants" (or with a pasted JD). Tools used: `list_jobs`, `job_status`, `propose_criteria`, `confirm_criteria`, `screen_candidates`, `read_job_file`.
- **CLI:**
  - `/jobs` lists the jobs;
  - `/import <path> [job]` brings files in;
  - `/screen <job>` runs the workflow directly: it drafts criteria from the JD file, asks `[y/n]`, screens and saves. This path needs no model decisions.

## 5 Why this design

- **Scale:** in-chat reading stops at a few dozen resumes (the context fills up). Here each resume costs one isolated call of about 4-5k tokens, and caching avoids repeats.
- **Consistency and fairness:** every resume is judged against the same confirmed criteria, blind, with evidence quotes that can be audited. The ranking is rule-based, not a model score.
- **Safety:** an evaluator has no tools. A resume with injected instructions can at most distort its own evaluation, and it gets flagged. In the tests the injected candidate was flagged and not ranked first.
- **Names:** the report shows names (the owner's decision); only the evaluator is blind. Blind or anonymous output in chat is available on request.

## 6 Costs and limits

- **Quota:** the Codex engine runs on the owner's personal ChatGPT Plus account, which has usage windows. Keep batches small (20) until it uses a company API key.
- **Time:** 20 parallel evaluations took about 5-15 s in tests. The concurrency probe: 20 parallel ephemeral threads on one app-server all succeeded, in 4.8 s against 3.7 s for one.
- **Name masking:** best effort. Names are detected from the first line of the resume; free-text mentions elsewhere may remain. Structured details (email, phone, links, DOB) are masked reliably, and year ranges are kept.
- **Unreadable files:** scanned PDFs, `.doc` and unsupported types are listed in the report, not silently skipped.

## 7 Tests

`npm run test:screening` covers:

- masking and name extraction;
- criteria id normalisation;
- ingest (subfolders, PDF, DOCX, a duplicate, an unsupported file);
- criteria drafting, and the refusal to screen before confirmation;
- a blind evaluation run (the spy checks that no names or emails reach the evaluators);
- ranking, the non-resume, the injected resume;
- report formats (default = one Word file; Word and Excel content);
- the chat flow shows results without saving; a report on request is Word only; Excel only when asked;
- cache, batch limit and incremental runs;
- the chat flow (criteria proposed → waits → confirmed → screened → files saved);
- retention.
