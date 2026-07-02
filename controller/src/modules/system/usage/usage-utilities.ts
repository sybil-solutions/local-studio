import type { UsageStats } from "@local-studio/contracts/usage";

export const calcChange = (current: number, previous: number): number | null => {
  if (!previous || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

export const emptyResponse = (): Omit<UsageStats, "controller"> => ({
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
  daily_by_model: [],
  hourly_pattern: [],
});
