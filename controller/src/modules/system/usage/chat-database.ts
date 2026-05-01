// CRITICAL
import Database from "bun:sqlite";
import { calcChange } from "./usage-utilities";

type UsagePayload = Record<string, unknown>;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.map((entry) => asRecord(entry)) : [];

const asNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mergeRowId = (key: string, row: Record<string, unknown>): string => {
  if (key === "hourly_pattern" || key === "peak_hours") return String(row["hour"] ?? "unknown");
  if (key === "daily" || key === "peak_days") return String(row["date"] ?? "unknown");
  if (key === "daily_by_model") return `${row["date"] ?? ""}\u0000${row["model"] ?? "unknown"}`;
  return String(row["model"] ?? "unknown");
};

const mergeByKey = (
  payloads: UsagePayload[],
  key: string,
  fields: string[],
  options: { limit?: number; sortBy?: string } = {}
): Array<Record<string, unknown>> => {
  const map = new Map<string, Record<string, unknown>>();
  for (const payload of payloads) {
    for (const row of asArray(payload[key])) {
      const id = mergeRowId(key, row);
      const existing = map.get(id) ?? { ...row };
      if (!map.has(id)) {
        for (const field of fields) {
          existing[field] = 0;
        }
        map.set(id, existing);
      }
      for (const field of fields) {
        existing[field] = asNumber(existing[field]) + asNumber(row[field]);
      }
    }
  }
  const rows = [...map.values()];
  if (options.sortBy) {
    rows.sort((a, b) => asNumber(b[options.sortBy!]) - asNumber(a[options.sortBy!]));
  }
  return typeof options.limit === "number" ? rows.slice(0, options.limit) : rows;
};

export const mergeUsagePayloads = (payloads: UsagePayload[]): UsagePayload | null => {
  const valid = payloads.filter(
    (payload) => asNumber(asRecord(payload["totals"])["total_requests"]) > 0
  );
  if (valid.length === 0) return null;

  const totals = {
    total_tokens: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_requests: 0,
    successful_requests: 0,
    failed_requests: 0,
    unique_sessions: 0,
    unique_users: 0,
  };
  const recent = {
    last_hour_requests: 0,
    last_24h_requests: 0,
    prev_24h_requests: 0,
    last_24h_tokens: 0,
  };

  for (const payload of valid) {
    const sourceTotals = asRecord(payload["totals"]);
    totals.total_tokens += asNumber(sourceTotals["total_tokens"]);
    totals.prompt_tokens += asNumber(sourceTotals["prompt_tokens"]);
    totals.completion_tokens += asNumber(sourceTotals["completion_tokens"]);
    totals.total_requests += asNumber(sourceTotals["total_requests"]);
    totals.successful_requests += asNumber(sourceTotals["successful_requests"]);
    totals.failed_requests += asNumber(sourceTotals["failed_requests"]);
    totals.unique_sessions += asNumber(sourceTotals["unique_sessions"]);
    totals.unique_users += asNumber(sourceTotals["unique_users"]);

    const sourceRecent = asRecord(payload["recent_activity"]);
    recent.last_hour_requests += asNumber(sourceRecent["last_hour_requests"]);
    recent.last_24h_requests += asNumber(sourceRecent["last_24h_requests"]);
    recent.prev_24h_requests += asNumber(sourceRecent["prev_24h_requests"]);
    recent.last_24h_tokens += asNumber(sourceRecent["last_24h_tokens"]);
  }

  const totalRequests = totals.total_requests;
  const totalTokens = totals.total_tokens;
  const successRate = totalRequests ? (totals.successful_requests / totalRequests) * 100 : 0;

  const byModel = mergeByKey(
    valid,
    "by_model",
    ["requests", "successful", "total_tokens", "prompt_tokens", "completion_tokens"],
    { sortBy: "total_tokens", limit: 25 }
  ).map((row) => ({
    ...row,
    success_rate: asNumber(row["requests"])
      ? (asNumber(row["successful"]) / asNumber(row["requests"])) * 100
      : 0,
    avg_tokens: asNumber(row["requests"])
      ? Math.round(asNumber(row["total_tokens"]) / asNumber(row["requests"]))
      : 0,
    avg_latency_ms: 0,
    p50_latency_ms: 0,
    avg_ttft_ms: 0,
    tokens_per_sec: null,
    prefill_tps: null,
    generation_tps: null,
  }));

  const daily = mergeByKey(valid, "daily", [
    "requests",
    "successful",
    "total_tokens",
    "prompt_tokens",
    "completion_tokens",
  ]).sort((a, b) => String(b["date"] ?? "").localeCompare(String(a["date"] ?? "")));

  const dailyByModel = mergeByKey(valid, "daily_by_model", [
    "requests",
    "successful",
    "total_tokens",
    "prompt_tokens",
    "completion_tokens",
  ]).sort((a, b) => String(b["date"] ?? "").localeCompare(String(a["date"] ?? "")));

  const hourly = mergeByKey(valid, "hourly_pattern", ["requests", "successful", "tokens"]).sort(
    (a, b) => asNumber(a["hour"]) - asNumber(b["hour"])
  );
  const peakDays = mergeByKey(valid, "peak_days", ["requests", "tokens"], {
    sortBy: "requests",
    limit: 5,
  });
  const peakHours = mergeByKey(valid, "peak_hours", ["requests"], { sortBy: "requests", limit: 5 });

  const avgTokens = totalRequests ? Math.round(totalTokens / totalRequests) : 0;
  const avgPrompt = totalRequests ? Math.round(totals.prompt_tokens / totalRequests) : 0;
  const avgCompletion = totalRequests ? Math.round(totals.completion_tokens / totalRequests) : 0;

  return {
    totals: {
      ...totals,
      success_rate: successRate,
    },
    latency: { avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, min_ms: 0, max_ms: 0 },
    ttft: { avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0 },
    tokens_per_request: {
      avg: avgTokens,
      avg_prompt: avgPrompt,
      avg_completion: avgCompletion,
      max: byModel.reduce((max, row) => Math.max(max, asNumber(row["avg_tokens"])), 0),
      p50: 0,
      p95: 0,
    },
    cache: { hits: 0, misses: 0, hit_tokens: 0, miss_tokens: 0, hit_rate: 0 },
    week_over_week: {
      this_week: { requests: 0, tokens: 0, successful: 0 },
      last_week: { requests: 0, tokens: 0, successful: 0 },
      change_pct: { requests: null, tokens: null },
    },
    recent_activity: {
      ...recent,
      change_24h_pct: calcChange(recent.last_24h_requests, recent.prev_24h_requests),
    },
    peak_days: peakDays,
    peak_hours: peakHours,
    by_model: byModel,
    daily,
    daily_by_model: dailyByModel,
    hourly_pattern: hourly,
  };
};

export const getUsageFromChatDatabases = (
  databasePaths: string[]
): Record<string, unknown> | null => {
  const uniquePaths = [...new Set(databasePaths)];
  return mergeUsagePayloads(
    uniquePaths
      .map((databasePath) => getUsageFromChatDatabase(databasePath))
      .filter((payload): payload is Record<string, unknown> => Boolean(payload))
  );
};

export const getUsageFromChatDatabase = (
  chatsDatabasePath: string
): Record<string, unknown> | null => {
  let db: Database | null = null;
  try {
    const chatDatabasePath = chatsDatabasePath;
    db = new Database(chatDatabasePath, { readonly: true });
    const tableCheck = db
      .query<
        { name: string },
        []
      >(`SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'`)
      .get();
    if (!tableCheck) return null;

    const totals = db
      .query<
        {
          total_requests: number;
          prompt_tokens: number;
          completion_tokens: number;
          unique_sessions: number;
        },
        []
      >(
        `
      SELECT
        SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) as total_requests,
        COALESCE(SUM(CASE WHEN role = 'assistant' THEN
          CASE WHEN request_total_input_tokens > 0 THEN request_total_input_tokens ELSE COALESCE(request_prompt_tokens, 0) END
        ELSE 0 END), 0) as prompt_tokens,
        COALESCE(SUM(CASE WHEN role = 'assistant' THEN COALESCE(request_completion_tokens, 0) ELSE 0 END), 0) as completion_tokens,
        COUNT(DISTINCT session_id) as unique_sessions
      FROM chat_messages
    `
      )
      .get() ?? { total_requests: 0, prompt_tokens: 0, completion_tokens: 0, unique_sessions: 0 };

    if (totals.total_requests === 0) {
      return null;
    }

    const byModel =
      db
        .query<
          {
            model: string;
            requests: number;
            total_tokens: number;
            prompt_tokens: number;
            completion_tokens: number;
            avg_tokens: number;
          },
          []
        >(
          `
      SELECT
        COALESCE(model, '') as model,
        COUNT(*) as requests,
        COALESCE(SUM(CASE WHEN request_total_input_tokens > 0 THEN request_total_input_tokens ELSE COALESCE(request_prompt_tokens, 0) END), 0) as prompt_tokens,
        COALESCE(SUM(COALESCE(request_completion_tokens, 0)), 0) as completion_tokens,
        COALESCE(SUM(COALESCE(request_completion_tokens, 0)), 0) + COALESCE(SUM(CASE WHEN request_total_input_tokens > 0 THEN request_total_input_tokens ELSE COALESCE(request_prompt_tokens, 0) END), 0) as total_tokens,
        AVG(COALESCE(request_completion_tokens, 0) + COALESCE(request_total_input_tokens, request_prompt_tokens, 0)) as avg_tokens
      FROM chat_messages
      WHERE role = 'assistant'
      GROUP BY model
      ORDER BY total_tokens DESC
      LIMIT 25
    `
        )
        .all() ?? [];

    const daily =
      db
        .query<
          {
            date: string;
            requests: number;
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          },
          []
        >(
          `
      SELECT
        DATE(created_at) as date,
        COUNT(*) as requests,
        COALESCE(SUM(CASE WHEN request_total_input_tokens > 0 THEN request_total_input_tokens ELSE COALESCE(request_prompt_tokens, 0) END), 0) as prompt_tokens,
        COALESCE(SUM(COALESCE(request_completion_tokens, 0)), 0) as completion_tokens,
        COALESCE(SUM(COALESCE(request_completion_tokens, 0)), 0) + COALESCE(SUM(CASE WHEN request_total_input_tokens > 0 THEN request_total_input_tokens ELSE COALESCE(request_prompt_tokens, 0) END), 0) as total_tokens
      FROM chat_messages
      WHERE role = 'assistant' AND DATE(created_at) >= DATE('now', '-14 days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `
        )
        .all() ?? [];

    const dailyByModel =
      db
        .query<
          {
            date: string;
            model: string;
            requests: number;
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          },
          []
        >(
          `
      SELECT
        DATE(created_at) as date,
        COALESCE(model, '') as model,
        COUNT(*) as requests,
        COALESCE(SUM(CASE WHEN request_total_input_tokens > 0 THEN request_total_input_tokens ELSE COALESCE(request_prompt_tokens, 0) END), 0) as prompt_tokens,
        COALESCE(SUM(COALESCE(request_completion_tokens, 0)), 0) as completion_tokens,
        COALESCE(SUM(COALESCE(request_completion_tokens, 0)), 0) + COALESCE(SUM(CASE WHEN request_total_input_tokens > 0 THEN request_total_input_tokens ELSE COALESCE(request_prompt_tokens, 0) END), 0) as total_tokens
      FROM chat_messages
      WHERE role = 'assistant' AND DATE(created_at) >= DATE('now', '-14 days')
      GROUP BY DATE(created_at), model
      ORDER BY date DESC
    `
        )
        .all() ?? [];

    const hourly =
      db
        .query<
          {
            hour: number;
            requests: number;
            tokens: number;
          },
          []
        >(
          `
      SELECT
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as requests,
        COALESCE(SUM(COALESCE(request_completion_tokens, 0) + COALESCE(request_total_input_tokens, request_prompt_tokens, 0)), 0) as tokens
      FROM chat_messages
      WHERE role = 'assistant'
      GROUP BY strftime('%H', created_at)
      ORDER BY hour
    `
        )
        .all() ?? [];

    const peakDays =
      db
        .query<
          {
            date: string;
            requests: number;
            tokens: number;
          },
          []
        >(
          `
      SELECT
        DATE(created_at) as date,
        COUNT(*) as requests,
        COALESCE(SUM(COALESCE(request_completion_tokens, 0) + COALESCE(request_total_input_tokens, request_prompt_tokens, 0)), 0) as tokens
      FROM chat_messages
      WHERE role = 'assistant'
      GROUP BY DATE(created_at)
      ORDER BY requests DESC
      LIMIT 5
    `
        )
        .all() ?? [];

    const peakHours =
      db
        .query<
          {
            hour: number;
            requests: number;
          },
          []
        >(
          `
      SELECT
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as requests
      FROM chat_messages
      WHERE role = 'assistant' AND DATE(created_at) >= DATE('now', '-7 days')
      GROUP BY strftime('%H', created_at)
      ORDER BY requests DESC
      LIMIT 5
    `
        )
        .all() ?? [];

    const recent = db
      .query<
        {
          last_24h_requests: number;
          prev_24h_requests: number;
          last_24h_tokens: number;
          last_hour_requests: number;
        },
        []
      >(
        `
      SELECT
        SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) as last_24h_requests,
        SUM(CASE WHEN datetime(created_at) >= datetime('now', '-48 hours') AND datetime(created_at) < datetime('now', '-24 hours') THEN 1 ELSE 0 END) as prev_24h_requests,
        SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours')
          THEN COALESCE(request_completion_tokens, 0) + COALESCE(request_total_input_tokens, request_prompt_tokens, 0)
          ELSE 0 END) as last_24h_tokens,
        SUM(CASE WHEN datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) as last_hour_requests
      FROM chat_messages
      WHERE role = 'assistant'
    `
      )
      .get() ?? {
      last_24h_requests: 0,
      prev_24h_requests: 0,
      last_24h_tokens: 0,
      last_hour_requests: 0,
    };

    const totalTokens = totals.prompt_tokens + totals.completion_tokens;
    const avgTokens = totals.total_requests ? Math.round(totalTokens / totals.total_requests) : 0;
    const avgPrompt = totals.total_requests
      ? Math.round(totals.prompt_tokens / totals.total_requests)
      : 0;
    const avgCompletion = totals.total_requests
      ? Math.round(totals.completion_tokens / totals.total_requests)
      : 0;

    return {
      totals: {
        total_tokens: totalTokens,
        prompt_tokens: totals.prompt_tokens,
        completion_tokens: totals.completion_tokens,
        total_requests: totals.total_requests,
        successful_requests: totals.total_requests,
        failed_requests: 0,
        success_rate: totals.total_requests ? 100 : 0,
        unique_sessions: totals.unique_sessions,
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
      ttft: { avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0 },
      tokens_per_request: {
        avg: avgTokens,
        avg_prompt: avgPrompt,
        avg_completion: avgCompletion,
        max: 0,
        p50: 0,
        p95: 0,
      },
      cache: { hits: 0, misses: 0, hit_tokens: 0, miss_tokens: 0, hit_rate: 0 },
      week_over_week: {
        this_week: { requests: 0, tokens: 0, successful: 0 },
        last_week: { requests: 0, tokens: 0, successful: 0 },
        change_pct: { requests: null, tokens: null },
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
      by_model: byModel.map((row) => ({
        model: row.model || "unknown",
        requests: row.requests,
        successful: row.requests,
        success_rate: row.requests ? 100 : 0,
        total_tokens: row.total_tokens,
        prompt_tokens: row.prompt_tokens,
        completion_tokens: row.completion_tokens,
        avg_tokens: Math.round(row.avg_tokens ?? 0),
        avg_latency_ms: 0,
        p50_latency_ms: 0,
        avg_ttft_ms: 0,
        tokens_per_sec: null,
        prefill_tps: null,
        generation_tps: null,
      })),
      daily: daily.map((row) => ({
        date: row.date,
        requests: row.requests,
        successful: row.requests,
        success_rate: row.requests ? 100 : 0,
        total_tokens: row.total_tokens,
        prompt_tokens: row.prompt_tokens,
        completion_tokens: row.completion_tokens,
        avg_latency_ms: 0,
      })),
      daily_by_model: dailyByModel.map((row) => ({
        date: row.date,
        model: row.model || "unknown",
        requests: row.requests,
        successful: row.requests,
        success_rate: row.requests ? 100 : 0,
        total_tokens: row.total_tokens,
        prompt_tokens: row.prompt_tokens,
        completion_tokens: row.completion_tokens,
      })),
      hourly_pattern: hourly.map((row) => ({
        hour: row.hour,
        requests: row.requests,
        successful: row.requests,
        tokens: row.tokens,
      })),
    };
  } catch (error) {
    console.error("[Usage] Error fetching usage stats from chats DB:", error);
    return null;
  } finally {
    if (db) db.close();
  }
};
