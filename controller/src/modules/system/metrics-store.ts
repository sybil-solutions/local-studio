import type { Database } from "bun:sqlite";
import { openSqliteDatabase } from "../../stores/sqlite";

/** Stores best observed per-model and per-runtime-session throughput metrics. */
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
    this.db.run(`
      CREATE TABLE IF NOT EXISTS peak_metric_sessions (
        session_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        peak_prefill_tps REAL,
        peak_generation_tps REAL,
        best_ttft_ms REAL,
        started_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_peak_metric_sessions_model_updated ON peak_metric_sessions(model_id, updated_at)`
    );
  }

  public get(modelId: string): Record<string, unknown> | null {
    const row = this.db
      .query("SELECT * FROM peak_metrics WHERE model_id = ?")
      .get(modelId) as Record<string, unknown> | null;
    return row ? { ...row } : null;
  }

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

  /**
   * Snapshot best runtime speeds for one model load/session.
   * @param sessionId Stable id for the current model runtime session.
   * @param modelId Model served by the runtime session.
   * @param prefillTps Observed prefill throughput.
   * @param generationTps Observed decode throughput.
   * @param ttftMs Observed time to first token.
   */
  public updateSessionPeak(
    sessionId: string,
    modelId: string,
    prefillTps?: number,
    generationTps?: number,
    ttftMs?: number
  ): Record<string, unknown> {
    this.db
      .query(
        `
        INSERT INTO peak_metric_sessions (
          session_id,
          model_id,
          peak_prefill_tps,
          peak_generation_tps,
          best_ttft_ms
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          model_id = excluded.model_id,
          peak_prefill_tps = CASE
            WHEN excluded.peak_prefill_tps IS NULL THEN peak_metric_sessions.peak_prefill_tps
            WHEN peak_metric_sessions.peak_prefill_tps IS NULL THEN excluded.peak_prefill_tps
            WHEN excluded.peak_prefill_tps > peak_metric_sessions.peak_prefill_tps THEN excluded.peak_prefill_tps
            ELSE peak_metric_sessions.peak_prefill_tps
          END,
          peak_generation_tps = CASE
            WHEN excluded.peak_generation_tps IS NULL THEN peak_metric_sessions.peak_generation_tps
            WHEN peak_metric_sessions.peak_generation_tps IS NULL THEN excluded.peak_generation_tps
            WHEN excluded.peak_generation_tps > peak_metric_sessions.peak_generation_tps THEN excluded.peak_generation_tps
            ELSE peak_metric_sessions.peak_generation_tps
          END,
          best_ttft_ms = CASE
            WHEN excluded.best_ttft_ms IS NULL THEN peak_metric_sessions.best_ttft_ms
            WHEN peak_metric_sessions.best_ttft_ms IS NULL THEN excluded.best_ttft_ms
            WHEN excluded.best_ttft_ms < peak_metric_sessions.best_ttft_ms THEN excluded.best_ttft_ms
            ELSE peak_metric_sessions.best_ttft_ms
          END,
          updated_at = CURRENT_TIMESTAMP
      `
      )
      .run(sessionId, modelId, prefillTps ?? null, generationTps ?? null, ttftMs ?? null);

    return this.getSession(sessionId) ?? {};
  }

  public getSession(sessionId: string): Record<string, unknown> | null {
    const row = this.db
      .query("SELECT * FROM peak_metric_sessions WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | null;
    return row ? { ...row } : null;
  }

  /**
   * Return the best recorded runtime session for a model.
   * @param modelId Model id to inspect.
   */
  public getBestSession(modelId: string): Record<string, unknown> | null {
    const row = this.db
      .query(
        `
        SELECT * FROM peak_metric_sessions
        WHERE model_id = ?
        ORDER BY
          COALESCE(peak_generation_tps, 0) DESC,
          COALESCE(peak_prefill_tps, 0) DESC,
          updated_at DESC
        LIMIT 1
      `
      )
      .get(modelId) as Record<string, unknown> | null;
    return row ? { ...row } : null;
  }

  public getAll(): Array<Record<string, unknown>> {
    const rows = this.db.query("SELECT * FROM peak_metrics ORDER BY model_id").all() as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => {
      const modelId = String(row["model_id"] ?? "");
      const bestSession = modelId ? this.getBestSession(modelId) : null;
      return {
        ...row,
        best_session_id: bestSession?.["session_id"] ?? null,
        best_session_prefill_tps: bestSession?.["peak_prefill_tps"] ?? null,
        best_session_generation_tps: bestSession?.["peak_generation_tps"] ?? null,
        best_session_ttft_ms: bestSession?.["best_ttft_ms"] ?? null,
      };
    });
  }
}

/** Stores lifetime aggregate counters used by the usage dashboard. */
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
