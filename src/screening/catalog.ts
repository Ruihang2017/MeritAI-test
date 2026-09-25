import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

/**
 * Application catalog: one SQLite file per files root (<root>/.assistant/catalog.sqlite).
 * Sources (today: folders under Jobs/; later ATS, SEEK, email, SharePoint) are
 * normalised into applications; parsed text is cached by content hash, so a
 * file is parsed once and evaluated once per criteria version.
 *
 * Contains candidates' personal data. Rows of a job are deleted when its folder
 * disappears (see Catalog.purgeMissingJobs), which is the retention mechanism.
 */

export type AppStatus = "ok" | "unreadable" | "duplicate";

export interface Application {
  id: number;
  job: string;
  source: string;
  sourceRef: string;
  hash: string;
  size: number;
  status: AppStatus;
  duplicateOf: string | null;
  error: string | null;
  firstSeen: string;
}

export interface Criterion {
  id: string;
  type: "essential" | "desirable";
  text: string;
}

export interface Rubric {
  job: string;
  version: number;
  role: string;
  criteria: Criterion[];
  jdHash: string;
  confirmed: boolean;
  createdAt: string;
}

export interface CriterionResult {
  id: string;
  status: "met" | "partly" | "not_evidenced";
  evidence: string;
}

export interface Evaluation {
  isResume: boolean;
  summary: string;
  criteria: CriterionResult[];
  strengths: string[];
  gaps: string[];
  questions: string[];
  flags: { suspiciousInstructions: boolean; differentRole: boolean };
}

export class Catalog {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(join(dataDir, "catalog.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS texts (
        hash TEXT PRIMARY KEY, text TEXT, pages INTEGER, error TEXT, parsed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT NOT NULL,
        hash TEXT NOT NULL, size INTEGER NOT NULL, status TEXT NOT NULL,
        duplicate_of TEXT, error TEXT,
        first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
        display_name TEXT,
        UNIQUE (job, source, source_ref));
      CREATE TABLE IF NOT EXISTS rubrics (
        job TEXT NOT NULL, version INTEGER NOT NULL, role TEXT NOT NULL,
        criteria TEXT NOT NULL, jd_hash TEXT NOT NULL, confirmed INTEGER NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY (job, version));
      CREATE TABLE IF NOT EXISTS evaluations (
        hash TEXT NOT NULL, job TEXT NOT NULL, version INTEGER NOT NULL,
        result TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (hash, job, version));
    `);
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------- texts

  getText(hash: string): { text: string | null; pages: number | null; error: string | null } | undefined {
    return this.db.prepare("SELECT text, pages, error FROM texts WHERE hash = ?").get(hash) as
      | { text: string | null; pages: number | null; error: string | null }
      | undefined;
  }

  putText(hash: string, text: string | null, pages: number | null, error: string | null): void {
    this.db
      .prepare("INSERT OR REPLACE INTO texts (hash, text, pages, error, parsed_at) VALUES (?, ?, ?, ?, ?)")
      .run(hash, text, pages, error, new Date().toISOString());
  }

  // ---------------------------------------------------------- applications

  /** Inserts or refreshes an application; returns whether it is new. */
  upsertApplication(a: { job: string; source: string; sourceRef: string; hash: string; size: number; status: AppStatus; duplicateOf: string | null; error: string | null; displayName: string | null }): boolean {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT id, hash FROM applications WHERE job = ? AND source = ? AND source_ref = ?")
      .get(a.job, a.source, a.sourceRef) as { id: number; hash: string } | undefined;
    if (existing) {
      this.db
        .prepare("UPDATE applications SET hash = ?, size = ?, status = ?, duplicate_of = ?, error = ?, display_name = ?, last_seen = ? WHERE id = ?")
        .run(a.hash, a.size, a.status, a.duplicateOf, a.error, a.displayName, now, existing.id);
      return false;
    }
    this.db
      .prepare(
        "INSERT INTO applications (job, source, source_ref, hash, size, status, duplicate_of, error, first_seen, last_seen, display_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(a.job, a.source, a.sourceRef, a.hash, a.size, a.status, a.duplicateOf, a.error, now, now, a.displayName);
    return true;
  }

  /** Removes applications of a source that were not seen in the latest scan (file deleted or moved). */
  removeUnseen(job: string, source: string, seenRefs: Set<string>): number {
    const rows = this.db.prepare("SELECT id, source_ref FROM applications WHERE job = ? AND source = ?").all(job, source) as { id: number; source_ref: string }[];
    let n = 0;
    for (const r of rows) {
      if (!seenRefs.has(r.source_ref)) {
        this.db.prepare("DELETE FROM applications WHERE id = ?").run(r.id);
        n++;
      }
    }
    return n;
  }

  applications(job: string): (Application & { displayName: string | null })[] {
    const rows = this.db.prepare("SELECT * FROM applications WHERE job = ? ORDER BY source_ref").all(job) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      job: r.job as string,
      source: r.source as string,
      sourceRef: r.source_ref as string,
      hash: r.hash as string,
      size: r.size as number,
      status: r.status as AppStatus,
      duplicateOf: (r.duplicate_of as string) ?? null,
      error: (r.error as string) ?? null,
      firstSeen: r.first_seen as string,
      displayName: (r.display_name as string) ?? null,
    }));
  }

  jobsInCatalog(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT job FROM applications UNION SELECT DISTINCT job FROM rubrics").all() as { job: string }[];
    return rows.map((r) => r.job);
  }

  /** Retention: drop everything about jobs whose folder no longer exists. */
  purgeJob(job: string): void {
    const hashes = this.db.prepare("SELECT DISTINCT hash FROM applications WHERE job = ?").all(job) as { hash: string }[];
    this.db.prepare("DELETE FROM applications WHERE job = ?").run(job);
    this.db.prepare("DELETE FROM rubrics WHERE job = ?").run(job);
    this.db.prepare("DELETE FROM evaluations WHERE job = ?").run(job);
    // Parsed text is only kept while some application still refers to it.
    for (const { hash } of hashes) {
      const used = this.db.prepare("SELECT 1 FROM applications WHERE hash = ? LIMIT 1").get(hash);
      if (!used) this.db.prepare("DELETE FROM texts WHERE hash = ?").run(hash);
    }
  }

  // ---------------------------------------------------------------- rubrics

  latestRubric(job: string): Rubric | undefined {
    const r = this.db.prepare("SELECT * FROM rubrics WHERE job = ? ORDER BY version DESC LIMIT 1").get(job) as Record<string, unknown> | undefined;
    return r ? toRubric(r) : undefined;
  }

  saveRubric(job: string, role: string, criteria: Criterion[], jdHash: string): Rubric {
    const version = (this.latestRubric(job)?.version ?? 0) + 1;
    const createdAt = new Date().toISOString();
    this.db
      .prepare("INSERT INTO rubrics (job, version, role, criteria, jd_hash, confirmed, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
      .run(job, version, role, JSON.stringify(criteria), jdHash, createdAt);
    return { job, version, role, criteria, jdHash, confirmed: false, createdAt };
  }

  confirmRubric(job: string, version: number): void {
    this.db.prepare("UPDATE rubrics SET confirmed = 1 WHERE job = ? AND version = ?").run(job, version);
  }

  // ------------------------------------------------------------ evaluations

  getEvaluation(hash: string, job: string, version: number): Evaluation | undefined {
    const r = this.db.prepare("SELECT result FROM evaluations WHERE hash = ? AND job = ? AND version = ?").get(hash, job, version) as { result: string } | undefined;
    return r ? (JSON.parse(r.result) as Evaluation) : undefined;
  }

  putEvaluation(hash: string, job: string, version: number, e: Evaluation): void {
    this.db
      .prepare("INSERT OR REPLACE INTO evaluations (hash, job, version, result, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(hash, job, version, JSON.stringify(e), new Date().toISOString());
  }
}

function toRubric(r: Record<string, unknown>): Rubric {
  return {
    job: r.job as string,
    version: r.version as number,
    role: r.role as string,
    criteria: JSON.parse(r.criteria as string) as Criterion[],
    jdHash: r.jd_hash as string,
    confirmed: (r.confirmed as number) === 1,
    createdAt: r.created_at as string,
  };
}
