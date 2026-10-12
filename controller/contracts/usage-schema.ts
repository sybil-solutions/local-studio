import { Schema } from "effect";

const ControllerTotalsSchema = Schema.Struct({
  total_requests: Schema.Number,
  successful_requests: Schema.Number,
  failed_requests: Schema.Number,
  success_rate: Schema.Number,
});

const ControllerLatencySchema = Schema.Struct({
  avg_ms: Schema.NullOr(Schema.Number),
  max_ms: Schema.NullOr(Schema.Number),
});

const ControllerRecentActivitySchema = Schema.Struct({
  last_hour_requests: Schema.Number,
  last_24h_requests: Schema.Number,
  last_24h_failed_requests: Schema.Number,
});

const ControllerPathSchema = Schema.Struct({
  method: Schema.String,
  path: Schema.String,
  requests: Schema.Number,
  successful: Schema.Number,
  failed: Schema.Number,
  success_rate: Schema.Number,
  avg_duration_ms: Schema.NullOr(Schema.Number),
  max_duration_ms: Schema.NullOr(Schema.Number),
});

const ControllerStatusSchema = Schema.Struct({
  status: Schema.Number,
  requests: Schema.Number,
});

const ControllerErrorSchema = Schema.Struct({
  method: Schema.String,
  path: Schema.String,
  status: Schema.Number,
  error_class: Schema.NullOr(Schema.String),
  error_message: Schema.NullOr(Schema.String),
  created_at: Schema.String,
});

const FunctionTotalsSchema = Schema.Struct({
  total_calls: Schema.Number,
  successful_calls: Schema.Number,
  failed_calls: Schema.Number,
  success_rate: Schema.Number,
});

const FunctionUsageSchema = Schema.Struct({
  function_name: Schema.String,
  calls: Schema.Number,
  successful: Schema.Number,
  failed: Schema.Number,
  success_rate: Schema.Number,
  avg_duration_ms: Schema.NullOr(Schema.Number),
  max_duration_ms: Schema.NullOr(Schema.Number),
});

const FunctionErrorSchema = Schema.Struct({
  function_name: Schema.String,
  error_class: Schema.NullOr(Schema.String),
  error_message: Schema.NullOr(Schema.String),
  created_at: Schema.String,
});

const FunctionCallsSchema = Schema.Struct({
  totals: FunctionTotalsSchema,
  latency: ControllerLatencySchema,
  by_function: Schema.mutable(Schema.Array(FunctionUsageSchema)),
  recent_errors: Schema.mutable(Schema.Array(FunctionErrorSchema)),
});

export const ControllerUsageStatsSchema = Schema.Struct({
  totals: ControllerTotalsSchema,
  latency: ControllerLatencySchema,
  recent_activity: ControllerRecentActivitySchema,
  by_path: Schema.mutable(Schema.Array(ControllerPathSchema)),
  by_status: Schema.mutable(Schema.Array(ControllerStatusSchema)),
  recent_errors: Schema.mutable(Schema.Array(ControllerErrorSchema)),
  function_calls: Schema.optionalKey(FunctionCallsSchema),
});

const UsageTotalsSchema = Schema.Struct({
  total_tokens: Schema.Number,
  prompt_tokens: Schema.Number,
  completion_tokens: Schema.Number,
  total_requests: Schema.Number,
  successful_requests: Schema.Number,
  failed_requests: Schema.Number,
  success_rate: Schema.Number,
  unique_sessions: Schema.Number,
  unique_users: Schema.Number,
});

const UsageLatencySchema = Schema.Struct({
  avg_ms: Schema.NullOr(Schema.Number),
  p50_ms: Schema.NullOr(Schema.Number),
  p95_ms: Schema.NullOr(Schema.Number),
  p99_ms: Schema.NullOr(Schema.Number),
  min_ms: Schema.NullOr(Schema.Number),
  max_ms: Schema.NullOr(Schema.Number),
});

const UsageTtftSchema = Schema.Struct({
  avg_ms: Schema.NullOr(Schema.Number),
  p50_ms: Schema.NullOr(Schema.Number),
  p95_ms: Schema.NullOr(Schema.Number),
  p99_ms: Schema.NullOr(Schema.Number),
});

const TokensPerRequestSchema = Schema.Struct({
  avg: Schema.Number,
  avg_prompt: Schema.Number,
  avg_completion: Schema.Number,
  max: Schema.Number,
  p50: Schema.Number,
  p95: Schema.Number,
});

const CacheSchema = Schema.Struct({
  hits: Schema.Number,
  misses: Schema.Number,
  hit_tokens: Schema.Number,
  miss_tokens: Schema.Number,
  hit_rate: Schema.Number,
});

const WeekSchema = Schema.Struct({
  requests: Schema.Number,
  tokens: Schema.Number,
  successful: Schema.Number,
});

const WeekOverWeekSchema = Schema.Struct({
  this_week: WeekSchema,
  last_week: WeekSchema,
  change_pct: Schema.Struct({
    requests: Schema.NullOr(Schema.Number),
    tokens: Schema.NullOr(Schema.Number),
  }),
});

const RecentActivitySchema = Schema.Struct({
  last_hour_requests: Schema.Number,
  last_24h_requests: Schema.Number,
  prev_24h_requests: Schema.Number,
  last_24h_tokens: Schema.Number,
  change_24h_pct: Schema.NullOr(Schema.Number),
});

const PeakDaySchema = Schema.Struct({
  date: Schema.String,
  requests: Schema.Number,
  tokens: Schema.Number,
});

const PeakHourSchema = Schema.Struct({
  hour: Schema.Number,
  requests: Schema.Number,
});

const ModelUsageSchema = Schema.Struct({
  model: Schema.String,
  requests: Schema.Number,
  successful: Schema.Number,
  success_rate: Schema.Number,
  total_tokens: Schema.Number,
  prompt_tokens: Schema.Number,
  completion_tokens: Schema.Number,
  avg_tokens: Schema.Number,
  avg_latency_ms: Schema.NullOr(Schema.Number),
  p50_latency_ms: Schema.NullOr(Schema.Number),
  avg_ttft_ms: Schema.NullOr(Schema.Number),
  tokens_per_sec: Schema.NullOr(Schema.Number),
  prefill_tps: Schema.NullOr(Schema.Number),
  generation_tps: Schema.NullOr(Schema.Number),
});

const DailyUsageSchema = Schema.Struct({
  date: Schema.String,
  requests: Schema.Number,
  successful: Schema.Number,
  success_rate: Schema.Number,
  total_tokens: Schema.Number,
  prompt_tokens: Schema.Number,
  completion_tokens: Schema.Number,
  avg_latency_ms: Schema.Number,
});

const DailyModelUsageSchema = Schema.Struct({
  date: Schema.String,
  model: Schema.String,
  requests: Schema.Number,
  successful: Schema.Number,
  success_rate: Schema.Number,
  total_tokens: Schema.Number,
  prompt_tokens: Schema.Number,
  completion_tokens: Schema.Number,
});

const HourlyUsageSchema = Schema.Struct({
  hour: Schema.Number,
  requests: Schema.Number,
  successful: Schema.Number,
  tokens: Schema.Number,
});

export const UsageStatsSchema = Schema.Struct({
  totals: UsageTotalsSchema,
  latency: UsageLatencySchema,
  ttft: UsageTtftSchema,
  tokens_per_request: TokensPerRequestSchema,
  cache: CacheSchema,
  week_over_week: WeekOverWeekSchema,
  recent_activity: RecentActivitySchema,
  peak_days: Schema.mutable(Schema.Array(PeakDaySchema)),
  peak_hours: Schema.mutable(Schema.Array(PeakHourSchema)),
  by_model: Schema.mutable(Schema.Array(ModelUsageSchema)),
  daily: Schema.mutable(Schema.Array(DailyUsageSchema)),
  daily_by_model: Schema.optionalKey(Schema.mutable(Schema.Array(DailyModelUsageSchema))),
  hourly_pattern: Schema.mutable(Schema.Array(HourlyUsageSchema)),
  controller: Schema.optionalKey(ControllerUsageStatsSchema),
});

const isUsageStats = Schema.is(UsageStatsSchema);

export const validateUsageStats = (value: unknown): typeof UsageStatsSchema.Type => {
  if (!isUsageStats(value)) throw new TypeError("Invalid normalized usage projection");
  return value;
};
