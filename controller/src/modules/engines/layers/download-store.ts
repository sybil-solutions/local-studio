// CRITICAL
import type { ModelDownload } from "../types";
import { openSqliteDatabase } from "../../../stores/sqlite";
import { parseJsonOrNull } from "../../../core/json";

export class DownloadStore {
  private readonly db: ReturnType<typeof openSqliteDatabase>;

  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS model_downloads (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  public list(): ModelDownload[] {
    const rows = this.db
      .query("SELECT data FROM model_downloads ORDER BY updated_at DESC")
      .all() as Array<{
      data: string;
    }>;
    const downloads: ModelDownload[] = [];
    for (const row of rows) {
      const parsed = parseJsonOrNull(row.data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      if (typeof record["id"] !== "string" || typeof record["model_id"] !== "string") continue;
      downloads.push(record as unknown as ModelDownload);
    }
    return downloads;
  }

  public get(id: string): ModelDownload | null {
    const row = this.db.query("SELECT data FROM model_downloads WHERE id = ?").get(id) as {
      data: string;
    } | null;
    if (!row?.data) {
      return null;
    }
    const parsed = parseJsonOrNull(row.data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record["id"] !== "string" || typeof record["model_id"] !== "string") return null;
    return record as unknown as ModelDownload;
  }

  public save(download: ModelDownload): void {
    const data = JSON.stringify(download);
    this.db
      .query(
        `
      INSERT INTO model_downloads (id, data, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
    `
      )
      .run(download.id, data);
  }

  public delete(id: string): boolean {
    const result = this.db.query("DELETE FROM model_downloads WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
