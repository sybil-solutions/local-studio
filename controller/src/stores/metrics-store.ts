import { Database } from "bun:sqlite";

/**
 * SQLite-backed storage for peak metrics per model.
 */
export class PeakMetricsStore {
  private readonly db: Database;

  /**
   * Create a peak metrics store.
   * @param dbPath - SQLite database path.
   */
  public constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.run("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  /**
   * Initialize schema.
   * @returns void
   */
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

  /**
   * Get peak metrics for a model.
   * @param modelId - Model id.
   * @returns Metrics row or null.
   */
  public get(modelId: string): Record<string, unknown> | null {
    const row = this.db.query("SELECT * FROM peak_metrics WHERE model_id = ?").get(modelId) as Record<string, unknown> | null;
    return row ? { ...row } : null;
  }

  /**
   * Update metrics if new values are better.
   * @param modelId - Model id.
   * @param prefillTps - Prefill tokens per second.
   * @param generationTps - Generation tokens per second.
   * @param ttftMs - Time-to-first-token in ms.
   * @returns Updated metrics.
   */
  public updateIfBetter(
    modelId: string,
    prefillTps?: number,
    generationTps?: number,
    ttftMs?: number,
  ): Record<string, unknown> {
    const current = this.get(modelId);
    const updates: Record<string, number> = {};

    if (current) {
      if (prefillTps !== undefined && (current["prefill_tps"] === null || Number(prefillTps) > Number(current["prefill_tps"]))) {
        updates["prefill_tps"] = prefillTps;
      }
      if (generationTps !== undefined && (current["generation_tps"] === null || Number(generationTps) > Number(current["generation_tps"]))) {
        updates["generation_tps"] = generationTps;
      }
      if (ttftMs !== undefined && (current["ttft_ms"] === null || Number(ttftMs) < Number(current["ttft_ms"]))) {
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
        const setClause = Object.keys(updates).map((key) => `${key} = ?`).join(", ");
        this.db.query(`UPDATE peak_metrics SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE model_id = ?`)
          .run(...Object.values(updates), modelId);
      } else {
        this.db.query(`
          INSERT INTO peak_metrics (model_id, prefill_tps, generation_tps, ttft_ms)
          VALUES (?, ?, ?, ?)
        `).run(
          modelId,
          updates["prefill_tps"] ?? null,
          updates["generation_tps"] ?? null,
          updates["ttft_ms"] ?? null,
        );
      }
    }

    return this.get(modelId) ?? {};
  }

  /**
   * Add cumulative token and request counts.
   * @param modelId - Model id.
   * @param tokens - Tokens count.
   * @param requests - Request count.
   * @returns void
   */
  public addTokens(modelId: string, tokens: number, requests = 1): void {
    this.db.query(`
      INSERT INTO peak_metrics (model_id, total_tokens, total_requests)
      VALUES (?, ?, ?)
      ON CONFLICT(model_id) DO UPDATE SET
        total_tokens = total_tokens + excluded.total_tokens,
        total_requests = total_requests + excluded.total_requests,
        updated_at = CURRENT_TIMESTAMP
    `).run(modelId, tokens, requests);
  }

  /**
   * Get all peak metrics.
   * @returns List of metrics rows.
   */
  public getAll(): Array<Record<string, unknown>> {
    const rows = this.db.query("SELECT * FROM peak_metrics ORDER BY model_id").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ ...row }));
  }
}

/**
 * SQLite-backed storage for lifetime metrics.
 */
export class LifetimeMetricsStore {
  private readonly db: Database;

  /**
   * Create a lifetime metrics store.
   * @param dbPath - SQLite database path.
   */
  public constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.migrate();
  }

  /**
   * Initialize schema and defaults.
   * @returns void
   */
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
      this.db.query("INSERT OR IGNORE INTO lifetime_metrics (key, value) VALUES (?, ?)").run(key, value);
    }
  }

  /**
   * Get a lifetime metric value.
   * @param key - Metric key.
   * @returns Metric value.
   */
  public get(key: string): number {
    const row = this.db.query("SELECT value FROM lifetime_metrics WHERE key = ?").get(key) as { value?: number } | null;
    return row?.value ?? 0;
  }

  /**
   * Get all lifetime metrics.
   * @returns Map of metric values.
   */
  public getAll(): Record<string, number> {
    const rows = this.db.query("SELECT key, value FROM lifetime_metrics").all() as Array<{ key: string; value: number }>;
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  /**
   * Set a lifetime metric.
   * @param key - Metric key.
   * @param value - Metric value.
   * @returns void
   */
  public set(key: string, value: number): void {
    this.db.query(
      `INSERT INTO lifetime_metrics (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).run(key, value);
  }

  /**
   * Increment a lifetime metric.
   * @param key - Metric key.
   * @param delta - Increment value.
   * @returns Updated value.
   */
  public increment(key: string, delta: number): number {
    this.db.query(
      `INSERT INTO lifetime_metrics (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = value + excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).run(key, delta);
    return this.get(key);
  }

  /**
   * Ensure first_started_at is set.
   * @returns void
   */
  public ensureFirstStarted(): void {
    const current = this.get("first_started_at");
    if (current === 0) {
      this.set("first_started_at", Date.now() / 1000);
    }
  }

  /**
   * Add energy consumption in watt-hours.
   * @param wattHours - Watt hours to add.
   * @returns void
   */
  public addEnergy(wattHours: number): void {
    this.increment("energy_wh", wattHours);
  }

  /**
   * Add total tokens.
   * @param tokens - Tokens to add.
   * @returns void
   */
  public addTokens(tokens: number): void {
    this.increment("tokens_total", tokens);
  }

  /**
   * Add prompt tokens.
   * @param tokens - Tokens to add.
   * @returns void
   */
  public addPromptTokens(tokens: number): void {
    this.increment("prompt_tokens_total", tokens);
  }

  /**
   * Add completion tokens.
   * @param tokens - Tokens to add.
   * @returns void
   */
  public addCompletionTokens(tokens: number): void {
    this.increment("completion_tokens_total", tokens);
  }

  /**
   * Add uptime in seconds.
   * @param seconds - Seconds to add.
   * @returns void
   */
  public addUptime(seconds: number): void {
    this.increment("uptime_seconds", seconds);
  }

  /**
   * Add request count.
   * @param count - Requests to add.
   * @returns void
   */
  public addRequests(count = 1): void {
    this.increment("requests_total", count);
  }
}
