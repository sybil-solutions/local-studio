// CRITICAL
import type { Hono } from "hono";
import Database from "bun:sqlite";
import type { AppContext } from "../types/context";

/**
 * Register usage analytics routes.
 * Uses SQLite spend_logs table as single source of truth.
 * Falls back to empty data if table doesn't exist.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerUsageRoutes = (app: Hono, context: AppContext): void => {
  /**
   * Calculate percentage change.
   * @param current - Current value.
   * @param previous - Previous value.
   * @returns Change percent or null.
   */
  const calcChange = (current: number, previous: number): number | null => {
    if (!previous || previous === 0) {
      return null;
    }
    return Math.round(((current - previous) / previous) * 1000) / 10;
  };

  /**
   * Create empty usage stats response.
   * @returns Empty usage response object.
   */
  const emptyResponse = (): Record<string, unknown> => ({
    totals: {
      total_tokens: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      success_rate: 0,
      unique_sessions: 0,
      unique_users: 0,
    },
    latency: {
      avg_ms: 0,
      p50_ms: 0,
      p95_ms: 0,
      p99_ms: 0,
      min_ms: 0,
      max_ms: 0,
    },
    ttft: {
      avg_ms: 0,
      p50_ms: 0,
      p95_ms: 0,
      p99_ms: 0,
    },
    tokens_per_request: {
      avg: 0,
      avg_prompt: 0,
      avg_completion: 0,
      max: 0,
      p50: 0,
      p95: 0,
    },
    cache: {
      hits: 0,
      misses: 0,
      hit_tokens: 0,
      miss_tokens: 0,
      hit_rate: 0,
    },
    week_over_week: {
      this_week: { requests: 0, tokens: 0, successful: 0 },
      last_week: { requests: 0, tokens: 0, successful: 0 },
      change_pct: { requests: null, tokens: null },
    },
    recent_activity: {
      last_hour_requests: 0,
      last_24h_requests: 0,
      prev_24h_requests: 0,
      last_24h_tokens: 0,
      change_24h_pct: null,
    },
    peak_days: [],
    peak_hours: [],
    by_model: [],
    daily: [],
    hourly_pattern: [],
  });

  app.get("/usage", async (ctx) => {
    let db: Database | null = null;
    try {
      db = new Database(context.config.db_path, { readonly: true });

      // Check if spend_logs table exists
      const tableCheck = db.query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='spend_logs'`
      ).get();

      if (!tableCheck) {
        // Table doesn't exist, return empty data
        return ctx.json(emptyResponse());
      }

      // Totals
      const totals = db.query<{
        total_tokens: number;
        prompt_tokens: number;
        completion_tokens: number;
        total_requests: number;
        successful_requests: number;
        failed_requests: number;
        unique_sessions: number;
      }, []>(`
        SELECT
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
          COALESCE(SUM(completion_tokens), 0) as completion_tokens,
          COUNT(*) as total_requests,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_requests,
          SUM(CASE WHEN status != 'success' OR status IS NULL THEN 1 ELSE 0 END) as failed_requests,
          COUNT(DISTINCT session_id) as unique_sessions
        FROM spend_logs
      `).get() ?? { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, total_requests: 0, successful_requests: 0, failed_requests: 0, unique_sessions: 0 };

      // If no data at all, return empty response
      if (totals.total_requests === 0) {
        return ctx.json(emptyResponse());
      }

      // Latency stats (using julianday for time calculations)
      const latency = db.query<{
        avg_ms: number;
        min_ms: number;
        max_ms: number;
      }, []>(`
        SELECT
          AVG((julianday(end_time) - julianday(start_time)) * 86400000) as avg_ms,
          MIN((julianday(end_time) - julianday(start_time)) * 86400000) as min_ms,
          MAX((julianday(end_time) - julianday(start_time)) * 86400000) as max_ms
        FROM spend_logs
        WHERE status = 'success' AND end_time IS NOT NULL AND start_time IS NOT NULL
      `).get() ?? { avg_ms: 0, min_ms: 0, max_ms: 0 };

      // Percentiles need to be calculated differently in SQLite
      const latencyPercentiles = db.query<{ latency_ms: number }, []>(`
        SELECT (julianday(end_time) - julianday(start_time)) * 86400000 as latency_ms
        FROM spend_logs
        WHERE status = 'success' AND end_time IS NOT NULL AND start_time IS NOT NULL
        ORDER BY latency_ms
      `).all();

      const getPercentile = (sorted: { latency_ms: number }[], p: number): number => {
        if (sorted.length === 0) return 0;
        const index = Math.floor(sorted.length * p);
        return Math.round(sorted[Math.min(index, sorted.length - 1)]?.latency_ms ?? 0);
      };

      // TTFT stats
      const ttft = db.query<{
        avg_ms: number;
      }, []>(`
        SELECT
          AVG((julianday(completion_start_time) - julianday(start_time)) * 86400000) as avg_ms
        FROM spend_logs
        WHERE status = 'success'
          AND completion_start_time IS NOT NULL
          AND completion_start_time != ''
          AND start_time IS NOT NULL
      `).get() ?? { avg_ms: 0 };

      const ttftPercentiles = db.query<{ ttft_ms: number }, []>(`
        SELECT (julianday(completion_start_time) - julianday(start_time)) * 86400000 as ttft_ms
        FROM spend_logs
        WHERE status = 'success'
          AND completion_start_time IS NOT NULL
          AND completion_start_time != ''
          AND start_time IS NOT NULL
        ORDER BY ttft_ms
      `).all();

      // Token stats
      const tokenStats = db.query<{
        avg_tokens: number;
        avg_prompt: number;
        avg_completion: number;
        max_tokens: number;
      }, []>(`
        SELECT
          AVG(total_tokens) as avg_tokens,
          AVG(prompt_tokens) as avg_prompt,
          AVG(completion_tokens) as avg_completion,
          MAX(total_tokens) as max_tokens
        FROM spend_logs
        WHERE status = 'success' AND total_tokens IS NOT NULL
      `).get() ?? { avg_tokens: 0, avg_prompt: 0, avg_completion: 0, max_tokens: 0 };

      const tokenPercentiles = db.query<{ tokens: number }, []>(`
        SELECT total_tokens as tokens
        FROM spend_logs
        WHERE status = 'success' AND total_tokens IS NOT NULL
        ORDER BY tokens
      `).all();

      // Cache stats
      const cacheRows = db.query<{
        cache_hit: string | null;
        count: number;
        tokens: number;
      }, []>(`
        SELECT
          cache_hit,
          COUNT(*) as count,
          COALESCE(SUM(total_tokens), 0) as tokens
        FROM spend_logs
        GROUP BY cache_hit
      `).all();

      const cache = { hits: 0, misses: 0, hit_tokens: 0, miss_tokens: 0, hit_rate: 0 };
      for (const row of cacheRows) {
        if (row.cache_hit === "True") {
          cache.hits = row.count;
          cache.hit_tokens = row.tokens;
        } else if (row.cache_hit === "False" || row.cache_hit === null) {
          cache.misses += row.count;
          cache.miss_tokens += row.tokens;
        }
      }
      const totalCache = cache.hits + cache.misses;
      if (totalCache > 0) {
        cache.hit_rate = Math.round((cache.hits / totalCache) * 10000) / 100;
      }

      // By model
      const byModel = db.query<{
        model: string;
        requests: number;
        successful: number;
        total_tokens: number;
        prompt_tokens: number;
        completion_tokens: number;
        avg_tokens: number;
        avg_latency_ms: number;
        avg_ttft_ms: number;
      }, []>(`
        SELECT
          model,
          COUNT(*) as requests,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
          COALESCE(SUM(completion_tokens), 0) as completion_tokens,
          AVG(CASE WHEN status = 'success' THEN total_tokens END) as avg_tokens,
          AVG(CASE WHEN status = 'success' THEN (julianday(end_time) - julianday(start_time)) * 86400000 END) as avg_latency_ms,
          AVG(CASE WHEN status = 'success' AND completion_start_time IS NOT NULL AND completion_start_time != ''
              THEN (julianday(completion_start_time) - julianday(start_time)) * 86400000 END) as avg_ttft_ms
        FROM spend_logs
        WHERE model != '' AND model IS NOT NULL
        GROUP BY model
        ORDER BY total_tokens DESC
        LIMIT 25
      `).all();

      // Daily stats (last 14 days)
      const daily = db.query<{
        date: string;
        requests: number;
        successful: number;
        total_tokens: number;
        prompt_tokens: number;
        completion_tokens: number;
        avg_latency_ms: number;
      }, []>(`
        SELECT
          DATE(start_time) as date,
          COUNT(*) as requests,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
          COALESCE(SUM(completion_tokens), 0) as completion_tokens,
          AVG(CASE WHEN status = 'success' THEN (julianday(end_time) - julianday(start_time)) * 86400000 END) as avg_latency_ms
        FROM spend_logs
        WHERE DATE(start_time) >= DATE('now', '-14 days')
        GROUP BY DATE(start_time)
        ORDER BY date DESC
      `).all();

      // Hourly pattern
      const hourly = db.query<{
        hour: number;
        requests: number;
        successful: number;
        tokens: number;
      }, []>(`
        SELECT
          CAST(strftime('%H', start_time) AS INTEGER) as hour,
          COUNT(*) as requests,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
          COALESCE(SUM(total_tokens), 0) as tokens
        FROM spend_logs
        WHERE start_time IS NOT NULL
        GROUP BY strftime('%H', start_time)
        ORDER BY hour
      `).all();

      // Week over week
      const wow = db.query<{
        this_week_requests: number;
        last_week_requests: number;
        this_week_tokens: number;
        last_week_tokens: number;
        this_week_successful: number;
        last_week_successful: number;
      }, []>(`
        SELECT
          SUM(CASE WHEN DATE(start_time) >= DATE('now', '-7 days') THEN 1 ELSE 0 END) as this_week_requests,
          SUM(CASE WHEN DATE(start_time) >= DATE('now', '-14 days') AND DATE(start_time) < DATE('now', '-7 days') THEN 1 ELSE 0 END) as last_week_requests,
          SUM(CASE WHEN DATE(start_time) >= DATE('now', '-7 days') AND status = 'success' THEN total_tokens ELSE 0 END) as this_week_tokens,
          SUM(CASE WHEN DATE(start_time) >= DATE('now', '-14 days') AND DATE(start_time) < DATE('now', '-7 days') AND status = 'success' THEN total_tokens ELSE 0 END) as last_week_tokens,
          SUM(CASE WHEN DATE(start_time) >= DATE('now', '-7 days') AND status = 'success' THEN 1 ELSE 0 END) as this_week_successful,
          SUM(CASE WHEN DATE(start_time) >= DATE('now', '-14 days') AND DATE(start_time) < DATE('now', '-7 days') AND status = 'success' THEN 1 ELSE 0 END) as last_week_successful
        FROM spend_logs
      `).get() ?? { this_week_requests: 0, last_week_requests: 0, this_week_tokens: 0, last_week_tokens: 0, this_week_successful: 0, last_week_successful: 0 };

      // Peak days
      const peakDays = db.query<{
        date: string;
        requests: number;
        tokens: number;
      }, []>(`
        SELECT
          DATE(start_time) as date,
          COUNT(*) as requests,
          COALESCE(SUM(total_tokens), 0) as tokens
        FROM spend_logs
        WHERE status = 'success'
        GROUP BY DATE(start_time)
        ORDER BY requests DESC
        LIMIT 5
      `).all();

      // Peak hours
      const peakHours = db.query<{
        hour: number;
        requests: number;
      }, []>(`
        SELECT
          CAST(strftime('%H', start_time) AS INTEGER) as hour,
          COUNT(*) as requests
        FROM spend_logs
        WHERE DATE(start_time) >= DATE('now', '-7 days')
        GROUP BY strftime('%H', start_time)
        ORDER BY requests DESC
        LIMIT 5
      `).all();

      // Recent activity
      const recent = db.query<{
        last_24h_requests: number;
        prev_24h_requests: number;
        last_24h_tokens: number;
        last_hour_requests: number;
      }, []>(`
        SELECT
          SUM(CASE WHEN datetime(start_time) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) as last_24h_requests,
          SUM(CASE WHEN datetime(start_time) >= datetime('now', '-48 hours') AND datetime(start_time) < datetime('now', '-24 hours') THEN 1 ELSE 0 END) as prev_24h_requests,
          SUM(CASE WHEN datetime(start_time) >= datetime('now', '-24 hours') AND status = 'success' THEN total_tokens ELSE 0 END) as last_24h_tokens,
          SUM(CASE WHEN datetime(start_time) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) as last_hour_requests
        FROM spend_logs
      `).get() ?? { last_24h_requests: 0, prev_24h_requests: 0, last_24h_tokens: 0, last_hour_requests: 0 };

      // Format by_model with tokens_per_sec
      const modelsFormatted = byModel.map((row) => {
        const avgLatencyMs = row.avg_latency_ms ?? 0;
        const completionTokens = row.completion_tokens;
        let tokensPerSec: number | null = null;
        if (avgLatencyMs > 0 && row.successful > 0) {
          const avgCompletion = completionTokens / row.successful;
          tokensPerSec = avgCompletion ? Math.round((avgCompletion / (avgLatencyMs / 1000)) * 10) / 10 : null;
        }
        return {
          model: row.model,
          requests: row.requests,
          successful: row.successful,
          success_rate: row.requests ? Math.round((row.successful / row.requests) * 1000) / 10 : 0,
          total_tokens: row.total_tokens,
          prompt_tokens: row.prompt_tokens,
          completion_tokens: completionTokens,
          avg_tokens: Math.round(row.avg_tokens ?? 0),
          avg_latency_ms: Math.round(avgLatencyMs),
          p50_latency_ms: Math.round(avgLatencyMs), // Approximation
          avg_ttft_ms: Math.round(row.avg_ttft_ms ?? 0),
          tokens_per_sec: tokensPerSec,
        };
      });

      const successRate = totals.total_requests
        ? Math.round((totals.successful_requests / totals.total_requests) * 10000) / 100
        : 0;

      return ctx.json({
        totals: {
          total_tokens: totals.total_tokens,
          prompt_tokens: totals.prompt_tokens,
          completion_tokens: totals.completion_tokens,
          total_requests: totals.total_requests,
          successful_requests: totals.successful_requests,
          failed_requests: totals.failed_requests,
          success_rate: successRate,
          unique_sessions: totals.unique_sessions,
          unique_users: 2, // Hardcoded for now
        },
        latency: {
          avg_ms: Math.round(latency.avg_ms ?? 0),
          p50_ms: getPercentile(latencyPercentiles, 0.5),
          p95_ms: getPercentile(latencyPercentiles, 0.95),
          p99_ms: getPercentile(latencyPercentiles, 0.99),
          min_ms: Math.round(latency.min_ms ?? 0),
          max_ms: Math.round(latency.max_ms ?? 0),
        },
        ttft: {
          avg_ms: Math.round(ttft.avg_ms ?? 0),
          p50_ms: getPercentile(ttftPercentiles.map(r => ({ latency_ms: r.ttft_ms })), 0.5),
          p95_ms: getPercentile(ttftPercentiles.map(r => ({ latency_ms: r.ttft_ms })), 0.95),
          p99_ms: getPercentile(ttftPercentiles.map(r => ({ latency_ms: r.ttft_ms })), 0.99),
        },
        tokens_per_request: {
          avg: Math.round(tokenStats.avg_tokens ?? 0),
          avg_prompt: Math.round(tokenStats.avg_prompt ?? 0),
          avg_completion: Math.round(tokenStats.avg_completion ?? 0),
          max: tokenStats.max_tokens ?? 0,
          p50: getPercentile(tokenPercentiles.map(r => ({ latency_ms: r.tokens })), 0.5),
          p95: getPercentile(tokenPercentiles.map(r => ({ latency_ms: r.tokens })), 0.95),
        },
        cache,
        week_over_week: {
          this_week: {
            requests: wow.this_week_requests,
            tokens: wow.this_week_tokens,
            successful: wow.this_week_successful,
          },
          last_week: {
            requests: wow.last_week_requests,
            tokens: wow.last_week_tokens,
            successful: wow.last_week_successful,
          },
          change_pct: {
            requests: calcChange(wow.this_week_requests, wow.last_week_requests),
            tokens: calcChange(wow.this_week_tokens, wow.last_week_tokens),
          },
        },
        recent_activity: {
          last_hour_requests: recent.last_hour_requests,
          last_24h_requests: recent.last_24h_requests,
          prev_24h_requests: recent.prev_24h_requests,
          last_24h_tokens: recent.last_24h_tokens,
          change_24h_pct: calcChange(recent.last_24h_requests, recent.prev_24h_requests),
        },
        peak_days: peakDays.map((row) => ({
          date: row.date,
          requests: row.requests,
          tokens: row.tokens,
        })),
        peak_hours: peakHours.map((row) => ({
          hour: row.hour,
          requests: row.requests,
        })),
        by_model: modelsFormatted,
        daily: daily.map((row) => ({
          date: row.date,
          requests: row.requests,
          successful: row.successful,
          success_rate: row.requests ? Math.round((row.successful / row.requests) * 1000) / 10 : 0,
          total_tokens: row.total_tokens,
          prompt_tokens: row.prompt_tokens,
          completion_tokens: row.completion_tokens,
          avg_latency_ms: Math.round(row.avg_latency_ms ?? 0),
        })),
        hourly_pattern: hourly.map((row) => ({
          hour: row.hour,
          requests: row.requests,
          successful: row.successful,
          tokens: row.tokens,
        })),
      });
    } catch (error) {
      // On any error, return empty data instead of throwing
      console.error("[Usage] Error fetching usage stats:", error);
      return ctx.json(emptyResponse());
    } finally {
      if (db) {
        db.close();
      }
    }
  });
};
