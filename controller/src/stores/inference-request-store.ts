import type { Database } from "bun:sqlite";
import { openSqliteDatabase } from "./sqlite";

export interface InferenceRequestRecord {
  model: string;
  source?: string | null;
  session_id?: string | null;
  provider?: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  ttft_ms?: number | null;
  duration_ms?: number | null;
  status?: number;
  streamed?: boolean;
}

interface NumberRow {
  [key: string]: number;
}

const buildModelFilter = (
  knownModels?: ReadonlySet<string>
): { clause: string; params: string[] } => {
  if (!knownModels || knownModels.size === 0) return { clause: "", params: [] };
  const params = [...knownModels];
  const placeholders = params.map(() => "?").join(",");
  return { clause: ` AND model IN (${placeholders})`, params };
};

/**
 * Convert SQLite aggregate values into finite numbers.
 * @param value - Raw SQLite aggregate value.
 * @returns Finite number or zero.
 */
const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Persistent log of every inference request that traverses the OpenAI
 * proxy. Source of truth for the /usage analytics dashboard.
 */
export class InferenceRequestStore {
  private readonly db: Database;

  /**
   * Create an inference request store.
   * @param dbPath - SQLite database path.
   */
  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.migrate();
  }

  /**
   * Create required database tables and indexes.
   */
  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS inference_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        model TEXT NOT NULL,
        source TEXT,
        session_id TEXT,
        provider TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        ttft_ms INTEGER,
        duration_ms INTEGER,
        status INTEGER NOT NULL DEFAULT 200,
        streamed INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_inference_requests_created_at ON inference_requests(created_at)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_inference_requests_model_created ON inference_requests(model, created_at)`
    );
  }

  /**
   * Persist one completed inference request.
   * @param record - Request usage and timing record.
   */
  public record(record: InferenceRequestRecord): void {
    const promptTokens = Math.max(0, Math.round(record.prompt_tokens));
    const completionTokens = Math.max(0, Math.round(record.completion_tokens));
    const reasoningTokens = Math.max(0, Math.round(record.reasoning_tokens ?? 0));
    const cacheRead = Math.max(0, Math.round(record.cache_read_tokens ?? 0));
    const cacheWrite = Math.max(0, Math.round(record.cache_write_tokens ?? 0));
    const totalTokens = promptTokens + completionTokens;

    this.db
      .query(
        `INSERT INTO inference_requests (
           model, source, session_id, provider,
           prompt_tokens, completion_tokens, reasoning_tokens,
           cache_read_tokens, cache_write_tokens, total_tokens,
           ttft_ms, duration_ms, status, streamed
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.model,
        record.source ?? null,
        record.session_id ?? null,
        record.provider ?? null,
        promptTokens,
        completionTokens,
        reasoningTokens,
        cacheRead,
        cacheWrite,
        totalTokens,
        record.ttft_ms ?? null,
        record.duration_ms ?? null,
        record.status ?? 200,
        record.streamed ? 1 : 0
      );
  }

  /**
   * Aggregate stats over all rows whose `model` is in `knownModels`. If
   * the set is empty/undefined, no rows match (returns null) — caller is
   * expected to skip in that case.
   * @param knownModels - Recipe-managed model names to include.
   * @returns Aggregated usage payload or null when no rows match.
   */
  public aggregate(knownModels: ReadonlySet<string>): Record<string, unknown> | null {
    if (!knownModels || knownModels.size === 0) return null;
    const filter = buildModelFilter(knownModels);
    const params = filter.params;

    const totalsRow = this.db
      .query<NumberRow, string[]>(
        `SELECT
           COUNT(*) as total_requests,
           COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
           COALESCE(SUM(completion_tokens), 0) as completion_tokens,
           COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
           COALESCE(SUM(cache_read_tokens), 0) as cache_read,
           COALESCE(SUM(cache_write_tokens), 0) as cache_write,
           COUNT(DISTINCT session_id) as unique_sessions
         FROM inference_requests
         WHERE 1=1${filter.clause}`
      )
      .get(...params) as NumberRow | null;

    const totalRequests = toFiniteNumber(totalsRow?.["total_requests"]);
    if (totalRequests === 0) return null;

    const promptTokens = toFiniteNumber(totalsRow?.["prompt_tokens"]);
    const completionTokens = toFiniteNumber(totalsRow?.["completion_tokens"]);
    const totalTokens = promptTokens + completionTokens;
    const cacheHits = toFiniteNumber(totalsRow?.["cache_read"]);
    const cacheMisses = toFiniteNumber(totalsRow?.["cache_write"]);

    const successRow = this.db
      .query<NumberRow, string[]>(
        `SELECT
           SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as ok,
           AVG(duration_ms) as avg_dur,
           AVG(ttft_ms) as avg_ttft
         FROM inference_requests
         WHERE 1=1${filter.clause}`
      )
      .get(...params) as NumberRow | null;
    const successful = toFiniteNumber(successRow?.["ok"]);

    const byModel = this.db
      .query<Record<string, unknown>, string[]>(
        `SELECT
           model,
           COUNT(*) as requests,
           SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successful,
           COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
           COALESCE(SUM(completion_tokens), 0) as completion_tokens,
           COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) as total_tokens,
           AVG(duration_ms) as avg_latency_ms,
           AVG(ttft_ms) as avg_ttft_ms
         FROM inference_requests
         WHERE 1=1${filter.clause}
         GROUP BY model
         ORDER BY total_tokens DESC
         LIMIT 25`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const daily = this.db
      .query<Record<string, unknown>, string[]>(
        `SELECT
           DATE(created_at) as date,
           COUNT(*) as requests,
           SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successful,
           COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
           COALESCE(SUM(completion_tokens), 0) as completion_tokens,
           COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) as total_tokens,
           AVG(duration_ms) as avg_latency_ms
         FROM inference_requests
         WHERE DATE(created_at) >= DATE('now', '-30 days')${filter.clause}
         GROUP BY DATE(created_at)
         ORDER BY date DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const dailyByModel = this.db
      .query<Record<string, unknown>, string[]>(
        `SELECT
           DATE(created_at) as date,
           model,
           COUNT(*) as requests,
           SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successful,
           COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
           COALESCE(SUM(completion_tokens), 0) as completion_tokens,
           COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) as total_tokens
         FROM inference_requests
         WHERE DATE(created_at) >= DATE('now', '-30 days')${filter.clause}
         GROUP BY DATE(created_at), model
         ORDER BY date DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const hourly = this.db
      .query<Record<string, unknown>, string[]>(
        `SELECT
           CAST(strftime('%H', created_at) AS INTEGER) as hour,
           COUNT(*) as requests,
           SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successful,
           COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens
         FROM inference_requests
         WHERE 1=1${filter.clause}
         GROUP BY strftime('%H', created_at)
         ORDER BY hour`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const peakDays = this.db
      .query<Record<string, unknown>, string[]>(
        `SELECT
           DATE(created_at) as date,
           COUNT(*) as requests,
           COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens
         FROM inference_requests
         WHERE 1=1${filter.clause}
         GROUP BY DATE(created_at)
         ORDER BY requests DESC
         LIMIT 5`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const peakHours = this.db
      .query<Record<string, unknown>, string[]>(
        `SELECT
           CAST(strftime('%H', created_at) AS INTEGER) as hour,
           COUNT(*) as requests
         FROM inference_requests
         WHERE DATE(created_at) >= DATE('now', '-7 days')${filter.clause}
         GROUP BY strftime('%H', created_at)
         ORDER BY requests DESC
         LIMIT 5`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const recent = this.db
      .query<NumberRow, string[]>(
        `SELECT
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) as last_hour,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) as last_24h,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-48 hours') AND datetime(created_at) < datetime('now', '-24 hours') THEN 1 ELSE 0 END) as prev_24h,
           COALESCE(SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') THEN prompt_tokens + completion_tokens ELSE 0 END), 0) as last_24h_tokens
         FROM inference_requests
         WHERE 1=1${filter.clause}`
      )
      .get(...params) as NumberRow | null;

    const week = this.db
      .query<NumberRow, string[]>(
        `SELECT
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as this_week_requests,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days') THEN prompt_tokens + completion_tokens ELSE 0 END) as this_week_tokens,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days') AND status >= 200 AND status < 300 THEN 1 ELSE 0 END) as this_week_ok,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-14 days') AND datetime(created_at) < datetime('now', '-7 days') THEN 1 ELSE 0 END) as last_week_requests,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-14 days') AND datetime(created_at) < datetime('now', '-7 days') THEN prompt_tokens + completion_tokens ELSE 0 END) as last_week_tokens,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-14 days') AND datetime(created_at) < datetime('now', '-7 days') AND status >= 200 AND status < 300 THEN 1 ELSE 0 END) as last_week_ok
         FROM inference_requests
         WHERE 1=1${filter.clause}`
      )
      .get(...params) as NumberRow | null;

    const calcChangePct = (current: number, previous: number): number | null => {
      if (previous === 0) return current === 0 ? 0 : null;
      return ((current - previous) / previous) * 100;
    };

    return {
      totals: {
        total_tokens: totalTokens,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_requests: totalRequests,
        successful_requests: successful,
        failed_requests: totalRequests - successful,
        success_rate: totalRequests ? (successful / totalRequests) * 100 : 0,
        unique_sessions: toFiniteNumber(totalsRow?.["unique_sessions"]),
        unique_users: 0,
      },
      latency: {
        avg_ms: toNullableNumber(successRow?.["avg_dur"]),
        p50_ms: null,
        p95_ms: null,
        p99_ms: null,
        min_ms: null,
        max_ms: null,
      },
      ttft: {
        avg_ms: toNullableNumber(successRow?.["avg_ttft"]),
        p50_ms: null,
        p95_ms: null,
        p99_ms: null,
      },
      tokens_per_request: {
        avg: totalRequests ? Math.round(totalTokens / totalRequests) : 0,
        avg_prompt: totalRequests ? Math.round(promptTokens / totalRequests) : 0,
        avg_completion: totalRequests ? Math.round(completionTokens / totalRequests) : 0,
        max: byModel.reduce(
          (max, row) =>
            Math.max(
              max,
              toFiniteNumber(row["requests"]) ? Math.round(toFiniteNumber(row["total_tokens"]) / toFiniteNumber(row["requests"])) : 0
            ),
          0
        ),
        p50: 0,
        p95: 0,
      },
      cache: {
        hits: cacheHits,
        misses: cacheMisses,
        hit_tokens: cacheHits,
        miss_tokens: cacheMisses,
        hit_rate: cacheHits + cacheMisses > 0 ? (cacheHits / (cacheHits + cacheMisses)) * 100 : 0,
      },
      week_over_week: {
        this_week: {
          requests: toFiniteNumber(week?.["this_week_requests"]),
          tokens: toFiniteNumber(week?.["this_week_tokens"]),
          successful: toFiniteNumber(week?.["this_week_ok"]),
        },
        last_week: {
          requests: toFiniteNumber(week?.["last_week_requests"]),
          tokens: toFiniteNumber(week?.["last_week_tokens"]),
          successful: toFiniteNumber(week?.["last_week_ok"]),
        },
        change_pct: {
          requests: calcChangePct(
            toFiniteNumber(week?.["this_week_requests"]),
            toFiniteNumber(week?.["last_week_requests"])
          ),
          tokens: calcChangePct(
            toFiniteNumber(week?.["this_week_tokens"]),
            toFiniteNumber(week?.["last_week_tokens"])
          ),
        },
      },
      recent_activity: {
        last_hour_requests: toFiniteNumber(recent?.["last_hour"]),
        last_24h_requests: toFiniteNumber(recent?.["last_24h"]),
        prev_24h_requests: toFiniteNumber(recent?.["prev_24h"]),
        last_24h_tokens: toFiniteNumber(recent?.["last_24h_tokens"]),
        change_24h_pct: calcChangePct(toFiniteNumber(recent?.["last_24h"]), toFiniteNumber(recent?.["prev_24h"])),
      },
      peak_days: peakDays.map((row) => ({
        date: row["date"],
        requests: toFiniteNumber(row["requests"]),
        tokens: toFiniteNumber(row["tokens"]),
      })),
      peak_hours: peakHours.map((row) => ({
        hour: toFiniteNumber(row["hour"]),
        requests: toFiniteNumber(row["requests"]),
      })),
      by_model: byModel.map((row) => {
        const requests = toFiniteNumber(row["requests"]);
        const ok = toFiniteNumber(row["successful"]);
        return {
          model: String(row["model"] ?? "unknown"),
          requests,
          successful: ok,
          success_rate: requests ? (ok / requests) * 100 : 0,
          total_tokens: toFiniteNumber(row["total_tokens"]),
          prompt_tokens: toFiniteNumber(row["prompt_tokens"]),
          completion_tokens: toFiniteNumber(row["completion_tokens"]),
          avg_tokens: requests ? Math.round(toFiniteNumber(row["total_tokens"]) / requests) : 0,
          avg_latency_ms: toNullableNumber(row["avg_latency_ms"]),
          p50_latency_ms: null,
          avg_ttft_ms: toNullableNumber(row["avg_ttft_ms"]),
          tokens_per_sec: null,
          prefill_tps: null,
          generation_tps: null,
        };
      }),
      daily: daily.map((row) => {
        const requests = toFiniteNumber(row["requests"]);
        const ok = toFiniteNumber(row["successful"]);
        return {
          date: row["date"],
          requests,
          successful: ok,
          success_rate: requests ? (ok / requests) * 100 : 0,
          total_tokens: toFiniteNumber(row["total_tokens"]),
          prompt_tokens: toFiniteNumber(row["prompt_tokens"]),
          completion_tokens: toFiniteNumber(row["completion_tokens"]),
          avg_latency_ms: toFiniteNumber(row["avg_latency_ms"]),
        };
      }),
      daily_by_model: dailyByModel.map((row) => {
        const requests = toFiniteNumber(row["requests"]);
        const ok = toFiniteNumber(row["successful"]);
        return {
          date: row["date"],
          model: String(row["model"] ?? "unknown"),
          requests,
          successful: ok,
          success_rate: requests ? (ok / requests) * 100 : 0,
          total_tokens: toFiniteNumber(row["total_tokens"]),
          prompt_tokens: toFiniteNumber(row["prompt_tokens"]),
          completion_tokens: toFiniteNumber(row["completion_tokens"]),
        };
      }),
      hourly_pattern: hourly.map((row) => ({
        hour: toFiniteNumber(row["hour"]),
        requests: toFiniteNumber(row["requests"]),
        successful: toFiniteNumber(row["successful"]),
        tokens: toFiniteNumber(row["tokens"]),
      })),
    };
  }
}
