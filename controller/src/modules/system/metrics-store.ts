// CRITICAL
import type { Database } from "bun:sqlite";
import { openSqliteDatabase } from "../../stores/sqlite";

export class PeakMetricsStore {
  private readonly db: Database;

  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS peak_metrics (
        model_id TEXT PRIMARY KEY,
        prefill_tps REAL,
        generation_tps REAL,
        ttft_ms REAL,
        total_tokens INTEGER DEFAULT 0,
        total_requests INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  public get(modelId: string): Record<string, unknown> | null {
    const row = this.db
      .query("SELECT * FROM peak_metrics WHERE model_id = ?")
      .get(modelId) as Record<string, unknown> | null;
    return row ? { ...row } : null;
  }

  /** Upserts peak values — only overwrites if the new value is better. */
  public updateIfBetter(
    modelId: string,
    prefillTps?: number,
    generationTps?: number,
    ttftMs?: number
  ): Record<string, unknown> {
    const current = this.get(modelId);
    const updates: Record<string, number> = {};

    if (current) {
      if (
        prefillTps !== undefined &&
        (current["prefill_tps"] === null || Number(prefillTps) > Number(current["prefill_tps"]))
      ) {
        updates["prefill_tps"] = prefillTps;
      }
      if (
        generationTps !== undefined &&
        (current["generation_tps"] === null ||
          Number(generationTps) > Number(current["generation_tps"]))
      ) {
        updates["generation_tps"] = generationTps;
      }
      if (
        ttftMs !== undefined &&
        (current["ttft_ms"] === null || Number(ttftMs) < Number(current["ttft_ms"]))
      ) {
        updates["ttft_ms"] = ttftMs;
      }
    } else {
      if (prefillTps !== undefined) {
        updates["prefill_tps"] = prefillTps;
      }
      if (generationTps !== undefined) {
        updates["generation_tps"] = generationTps;
      }
      if (ttftMs !== undefined) {
        updates["ttft_ms"] = ttftMs;
      }
    }

    if (Object.keys(updates).length > 0) {
      if (current) {
        const setClause = Object.keys(updates)
          .map((key) => `${key} = ?`)
          .join(", ");
        this.db
          .query(
            `UPDATE peak_metrics SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE model_id = ?`
          )
          .run(...Object.values(updates), modelId);
      } else {
        this.db
          .query(
            `
          INSERT INTO peak_metrics (model_id, prefill_tps, generation_tps, ttft_ms)
          VALUES (?, ?, ?, ?)
        `
          )
          .run(
            modelId,
            updates["prefill_tps"] ?? null,
            updates["generation_tps"] ?? null,
            updates["ttft_ms"] ?? null
          );
      }
    }

    return this.get(modelId) ?? {};
  }

  public addTokens(modelId: string, tokens: number, requests = 1): void {
    this.db
      .query(
        `
      INSERT INTO peak_metrics (model_id, total_tokens, total_requests)
      VALUES (?, ?, ?)
      ON CONFLICT(model_id) DO UPDATE SET
        total_tokens = total_tokens + excluded.total_tokens,
        total_requests = total_requests + excluded.total_requests,
        updated_at = CURRENT_TIMESTAMP
    `
      )
      .run(modelId, tokens, requests);
  }

  public getAll(): Array<Record<string, unknown>> {
    const rows = this.db.query("SELECT * FROM peak_metrics ORDER BY model_id").all() as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => ({ ...row }));
  }
}

export class LifetimeMetricsStore {
  private readonly db: Database;

  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS lifetime_metrics (
        key TEXT PRIMARY KEY,
        value REAL NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const defaults: Array<[string, number]> = [
      ["tokens_total", 0],
      ["prompt_tokens_total", 0],
      ["completion_tokens_total", 0],
      ["energy_wh", 0],
      ["uptime_seconds", 0],
      ["requests_total", 0],
      ["first_started_at", 0],
    ];
    for (const [key, value] of defaults) {
      this.db
        .query("INSERT OR IGNORE INTO lifetime_metrics (key, value) VALUES (?, ?)")
        .run(key, value);
    }
  }

  public get(key: string): number {
    const row = this.db.query("SELECT value FROM lifetime_metrics WHERE key = ?").get(key) as {
      value?: number;
    } | null;
    return row?.value ?? 0;
  }

  public getAll(): Record<string, number> {
    const rows = this.db.query("SELECT key, value FROM lifetime_metrics").all() as Array<{
      key: string;
      value: number;
    }>;
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  public set(key: string, value: number): void {
    this.db
      .query(
        `INSERT INTO lifetime_metrics (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      )
      .run(key, value);
  }

  public increment(key: string, delta: number): number {
    this.db
      .query(
        `INSERT INTO lifetime_metrics (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = value + excluded.value, updated_at = CURRENT_TIMESTAMP`
      )
      .run(key, delta);
    return this.get(key);
  }

  public ensureFirstStarted(): void {
    const current = this.get("first_started_at");
    if (current === 0) {
      this.set("first_started_at", Date.now() / 1000);
    }
  }

  public addEnergy(wattHours: number): void {
    this.increment("energy_wh", wattHours);
  }

  public addTokens(tokens: number): void {
    this.increment("tokens_total", tokens);
  }

  public addPromptTokens(tokens: number): void {
    this.increment("prompt_tokens_total", tokens);
  }

  public addCompletionTokens(tokens: number): void {
    this.increment("completion_tokens_total", tokens);
  }

  public addUptime(seconds: number): void {
    this.increment("uptime_seconds", seconds);
  }

  public addRequests(count = 1): void {
    this.increment("requests_total", count);
  }
}
