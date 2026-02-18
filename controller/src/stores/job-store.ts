// CRITICAL
import type { Database } from "bun:sqlite";
import { openSqliteDatabase } from "./sqlite";

export interface JobRecord {
  id: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  input: string;
  result: string | null;
  error: string | null;
  logs: string;
  created_at: string;
  updated_at: string;
}

const MAX_LOGS_PER_JOB = 200;

/**
 * SQLite-backed durable job store.
 */
export class JobStore {
  private readonly db: Database;

  /**
   * Create a job store.
   * @param dbPath - SQLite database path.
   */
  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        progress REAL NOT NULL DEFAULT 0,
        input TEXT NOT NULL DEFAULT '{}',
        result TEXT,
        error TEXT,
        logs TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Create a new job record.
   * @param id - Job identifier.
   * @param type - Job type.
   * @param input - JSON-serialized input.
   * @returns Created job record.
   */
  public create(id: string, type: string, input: Record<string, unknown>): JobRecord {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO jobs (id, type, status, progress, input, logs, created_at, updated_at)
         VALUES (?, ?, 'pending', 0, ?, '[]', ?, ?)`,
      )
      .run(id, type, JSON.stringify(input), now, now);
    return this.get(id)!;
  }

  /**
   * Get a job by id.
   * @param id - Job identifier.
   * @returns Job record or null.
   */
  public get(id: string): JobRecord | null {
    return (this.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRecord) ?? null;
  }

  /**
   * List recent jobs.
   * @param limit - Maximum number to return.
   * @returns List of job records.
   */
  public list(limit = 50): JobRecord[] {
    return this.db
      .query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as JobRecord[];
  }

  /**
   * Update job status and progress.
   * @param id - Job identifier.
   * @param fields - Partial update fields.
   */
  public update(
    id: string,
    fields: Partial<Pick<JobRecord, "status" | "progress" | "result" | "error">>,
  ): void {
    const sets: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (fields.status !== undefined) {
      sets.push("status = ?");
      vals.push(fields.status);
    }
    if (fields.progress !== undefined) {
      sets.push("progress = ?");
      vals.push(fields.progress);
    }
    if (fields.result !== undefined) {
      sets.push("result = ?");
      vals.push(fields.result);
    }
    if (fields.error !== undefined) {
      sets.push("error = ?");
      vals.push(fields.error);
    }
    vals.push(id);
    this.db.query(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as [string]));
  }

  /**
   * Append a log line to a job. Truncates to MAX_LOGS_PER_JOB.
   * @param id - Job identifier.
   * @param line - Log line.
   */
  public appendLog(id: string, line: string): void {
    const row = this.get(id);
    if (!row) return;
    let logs: string[];
    try {
      logs = JSON.parse(row.logs) as string[];
    } catch {
      logs = [];
    }
    logs.push(line);
    if (logs.length > MAX_LOGS_PER_JOB) {
      logs = logs.slice(-MAX_LOGS_PER_JOB);
    }
    this.db
      .query("UPDATE jobs SET logs = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(logs), id);
  }
}
