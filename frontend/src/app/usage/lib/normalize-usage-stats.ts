// CRITICAL

import type { UsageStats } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function array(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function normalizeUsageStats(input: UsageStats | null | undefined): UsageStats {
  const s = record(input);
  const totals = record(s.totals);
  const latency = record(s.latency);
  const ttft = record(s.ttft);
  const tokensPerRequest = record(s.tokens_per_request);
  const cache = record(s.cache);
  const weekOverWeek = record(s.week_over_week);
  const thisWeek = record(weekOverWeek.this_week);
  const lastWeek = record(weekOverWeek.last_week);
  const changePct = record(weekOverWeek.change_pct);
  const recent = record(s.recent_activity);

  return {
    totals: {
      total_tokens: num(totals.total_tokens),
      prompt_tokens: num(totals.prompt_tokens),
      completion_tokens: num(totals.completion_tokens),
      total_requests: num(totals.total_requests),
      successful_requests: num(totals.successful_requests),
      failed_requests: num(totals.failed_requests),
      success_rate: num(totals.success_rate),
      unique_sessions: num(totals.unique_sessions),
      unique_users: num(totals.unique_users),
    },
    latency: {
      avg_ms: num(latency.avg_ms),
      p50_ms: num(latency.p50_ms),
      p95_ms: num(latency.p95_ms),
      p99_ms: num(latency.p99_ms),
      min_ms: num(latency.min_ms),
      max_ms: num(latency.max_ms),
    },
    ttft: {
      avg_ms: num(ttft.avg_ms),
      p50_ms: num(ttft.p50_ms),
      p95_ms: num(ttft.p95_ms),
      p99_ms: num(ttft.p99_ms),
    },
    tokens_per_request: {
      avg: num(tokensPerRequest.avg),
      avg_prompt: num(tokensPerRequest.avg_prompt),
      avg_completion: num(tokensPerRequest.avg_completion),
      max: num(tokensPerRequest.max),
      p50: num(tokensPerRequest.p50),
      p95: num(tokensPerRequest.p95),
    },
    cache: {
      hits: num(cache.hits),
      misses: num(cache.misses),
      hit_tokens: num(cache.hit_tokens),
      miss_tokens: num(cache.miss_tokens),
      hit_rate: num(cache.hit_rate),
    },
    week_over_week: {
      this_week: {
        requests: num(thisWeek.requests),
        tokens: num(thisWeek.tokens),
        successful: num(thisWeek.successful),
      },
      last_week: {
        requests: num(lastWeek.requests),
        tokens: num(lastWeek.tokens),
        successful: num(lastWeek.successful),
      },
      change_pct: {
        requests: nullableNum(changePct.requests),
        tokens: nullableNum(changePct.tokens),
      },
    },
    recent_activity: {
      last_hour_requests: num(recent.last_hour_requests),
      last_24h_requests: num(recent.last_24h_requests),
      prev_24h_requests: num(recent.prev_24h_requests),
      last_24h_tokens: num(recent.last_24h_tokens),
      change_24h_pct: nullableNum(recent.change_24h_pct),
    },
    peak_days: array(s.peak_days).map((day) => ({
      date: text(day.date, ""),
      requests: num(day.requests),
      tokens: num(day.tokens),
    })),
    peak_hours: array(s.peak_hours).map((hour) => ({
      hour: num(hour.hour),
      requests: num(hour.requests),
    })),
    by_model: array(s.by_model).map((model, index) => ({
      model: text(model.model, `unknown-${index + 1}`),
      requests: num(model.requests),
      successful: num(model.successful),
      success_rate: num(model.success_rate),
      total_tokens: num(model.total_tokens),
      prompt_tokens: num(model.prompt_tokens),
      completion_tokens: num(model.completion_tokens),
      avg_tokens: num(model.avg_tokens),
      avg_latency_ms: num(model.avg_latency_ms),
      p50_latency_ms: num(model.p50_latency_ms),
      avg_ttft_ms: num(model.avg_ttft_ms),
      tokens_per_sec: nullableNum(model.tokens_per_sec),
      prefill_tps: nullableNum(model.prefill_tps),
      generation_tps: nullableNum(model.generation_tps),
    })),
    daily: array(s.daily).map((day) => ({
      date: text(day.date, ""),
      requests: num(day.requests),
      successful: num(day.successful),
      success_rate: num(day.success_rate),
      total_tokens: num(day.total_tokens),
      prompt_tokens: num(day.prompt_tokens),
      completion_tokens: num(day.completion_tokens),
      avg_latency_ms: num(day.avg_latency_ms),
    })),
    daily_by_model: array(s.daily_by_model).map((day, index) => ({
      date: text(day.date, ""),
      model: text(day.model, `unknown-${index + 1}`),
      requests: num(day.requests),
      successful: num(day.successful),
      success_rate: num(day.success_rate),
      total_tokens: num(day.total_tokens),
      prompt_tokens: num(day.prompt_tokens),
      completion_tokens: num(day.completion_tokens),
    })),
    hourly_pattern: array(s.hourly_pattern).map((hour) => ({
      hour: num(hour.hour),
      requests: num(hour.requests),
      successful: num(hour.successful),
      tokens: num(hour.tokens),
    })),
  };
}
