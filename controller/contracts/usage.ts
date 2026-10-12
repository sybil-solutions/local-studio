import type { ControllerUsageStatsSchema, UsageStatsSchema } from "./usage-schema";

type UnknownRecord = Record<string, unknown>;

const objectOrEmpty = (value: unknown): UnknownRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const nonEmptyObject = (value: unknown): UnknownRecord | undefined => {
  const object = objectOrEmpty(value);
  return Object.keys(object).length > 0 ? object : undefined;
};

const rows = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.map(objectOrEmpty) : [];

const finiteNumber = (value: unknown, fallback = 0): number => {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
};

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = finiteNumber(value, NaN);
  return Number.isFinite(number) ? number : null;
};

const stringValue = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const nullableString = (value: unknown): string | null => stringValue(value) || null;

const fields = <const Key extends string, Value>(
  source: UnknownRecord,
  keys: readonly Key[],
  decode: (value: unknown) => Value,
): Record<Key, Value> =>
  Object.fromEntries(keys.map((key) => [key, decode(source[key])])) as Record<Key, Value>;

const numbers = <const Key extends string>(
  source: UnknownRecord,
  keys: readonly Key[],
): Record<Key, number> => fields(source, keys, finiteNumber);

const nullableNumbers = <const Key extends string>(
  source: UnknownRecord,
  keys: readonly Key[],
): Record<Key, number | null> => fields(source, keys, nullableNumber);

const strings = <const Key extends string>(
  source: UnknownRecord,
  keys: readonly Key[],
): Record<Key, string> => fields(source, keys, stringValue);

const projector = <Output>(decode: (value: unknown) => Output): ((value: unknown) => Output) =>
  decode;

export const normalizeControllerUsage = projector((value) => {
  const controller = nonEmptyObject(value);
  if (!controller) return undefined;
  const totals = objectOrEmpty(controller["totals"]);
  const latency = objectOrEmpty(controller["latency"]);
  const recent = objectOrEmpty(controller["recent_activity"]);
  const functionCalls = nonEmptyObject(controller["function_calls"]);

  return {
    totals: numbers(totals, [
      "total_requests",
      "successful_requests",
      "failed_requests",
      "success_rate",
    ]),
    latency: nullableNumbers(latency, ["avg_ms", "max_ms"]),
    recent_activity: numbers(recent, [
      "last_hour_requests",
      "last_24h_requests",
      "last_24h_failed_requests",
    ]),
    by_path: rows(controller["by_path"]).map((path) => ({
      ...strings(path, ["method", "path"]),
      ...numbers(path, ["requests", "successful", "failed", "success_rate"]),
      ...nullableNumbers(path, ["avg_duration_ms", "max_duration_ms"]),
    })),
    by_status: rows(controller["by_status"]).map((status) =>
      numbers(status, ["status", "requests"]),
    ),
    recent_errors: rows(controller["recent_errors"]).map((error) => ({
      ...strings(error, ["method", "path"]),
      status: finiteNumber(error["status"]),
      error_class: nullableString(error["error_class"]),
      error_message: nullableString(error["error_message"]),
      created_at: stringValue(error["created_at"]),
    })),
    ...(functionCalls
      ? {
          function_calls: {
            totals: numbers(objectOrEmpty(functionCalls["totals"]), [
              "total_calls",
              "successful_calls",
              "failed_calls",
              "success_rate",
            ]),
            latency: nullableNumbers(objectOrEmpty(functionCalls["latency"]), ["avg_ms", "max_ms"]),
            by_function: rows(functionCalls["by_function"]).map((entry) => ({
              function_name: stringValue(entry["function_name"]),
              ...numbers(entry, ["calls", "successful", "failed", "success_rate"]),
              ...nullableNumbers(entry, ["avg_duration_ms", "max_duration_ms"]),
            })),
            recent_errors: rows(functionCalls["recent_errors"]).map((error) => ({
              function_name: stringValue(error["function_name"]),
              error_class: nullableString(error["error_class"]),
              error_message: nullableString(error["error_message"]),
              created_at: stringValue(error["created_at"]),
            })),
          },
        }
      : {}),
  };
});

export const normalizeUsageStats = projector((input) => {
  const usage = objectOrEmpty(input);
  const weekOverWeek = objectOrEmpty(usage["week_over_week"]);
  const recent = objectOrEmpty(usage["recent_activity"]);
  const controller = normalizeControllerUsage(usage["controller"]);

  return {
    totals: numbers(objectOrEmpty(usage["totals"]), [
      "total_tokens",
      "prompt_tokens",
      "completion_tokens",
      "total_requests",
      "successful_requests",
      "failed_requests",
      "success_rate",
      "unique_sessions",
      "unique_users",
    ]),
    latency: nullableNumbers(objectOrEmpty(usage["latency"]), [
      "avg_ms",
      "p50_ms",
      "p95_ms",
      "p99_ms",
      "min_ms",
      "max_ms",
    ]),
    ttft: nullableNumbers(objectOrEmpty(usage["ttft"]), ["avg_ms", "p50_ms", "p95_ms", "p99_ms"]),
    tokens_per_request: numbers(objectOrEmpty(usage["tokens_per_request"]), [
      "avg",
      "avg_prompt",
      "avg_completion",
      "max",
      "p50",
      "p95",
    ]),
    cache: numbers(objectOrEmpty(usage["cache"]), [
      "hits",
      "misses",
      "hit_tokens",
      "miss_tokens",
      "hit_rate",
    ]),
    week_over_week: {
      this_week: numbers(objectOrEmpty(weekOverWeek["this_week"]), [
        "requests",
        "tokens",
        "successful",
      ]),
      last_week: numbers(objectOrEmpty(weekOverWeek["last_week"]), [
        "requests",
        "tokens",
        "successful",
      ]),
      change_pct: nullableNumbers(objectOrEmpty(weekOverWeek["change_pct"]), [
        "requests",
        "tokens",
      ]),
    },
    recent_activity: {
      ...numbers(recent, [
        "last_hour_requests",
        "last_24h_requests",
        "prev_24h_requests",
        "last_24h_tokens",
      ]),
      change_24h_pct: nullableNumber(recent["change_24h_pct"]),
    },
    peak_days: rows(usage["peak_days"]).map((day) => ({
      date: stringValue(day["date"]),
      ...numbers(day, ["requests", "tokens"]),
    })),
    peak_hours: rows(usage["peak_hours"]).map((hour) => numbers(hour, ["hour", "requests"])),
    by_model: rows(usage["by_model"]).map((model, index) => ({
      model: stringValue(model["model"], `unknown-${index + 1}`),
      ...numbers(model, [
        "requests",
        "successful",
        "success_rate",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
        "avg_tokens",
      ]),
      ...nullableNumbers(model, [
        "avg_latency_ms",
        "p50_latency_ms",
        "avg_ttft_ms",
        "tokens_per_sec",
        "prefill_tps",
        "generation_tps",
      ]),
    })),
    daily: rows(usage["daily"]).map((day) => ({
      date: stringValue(day["date"]),
      ...numbers(day, [
        "requests",
        "successful",
        "success_rate",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
        "avg_latency_ms",
      ]),
    })),
    daily_by_model: rows(usage["daily_by_model"]).map((day, index) => ({
      date: stringValue(day["date"]),
      model: stringValue(day["model"], `unknown-${index + 1}`),
      ...numbers(day, [
        "requests",
        "successful",
        "success_rate",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
      ]),
    })),
    hourly_pattern: rows(usage["hourly_pattern"]).map((hour) =>
      numbers(hour, ["hour", "requests", "successful", "tokens"]),
    ),
    ...(controller ? { controller } : {}),
  };
});

export type ControllerUsageStats = typeof ControllerUsageStatsSchema.Type;
export type UsageStats = typeof UsageStatsSchema.Type;

export const usageRate = (successful: unknown, total: unknown): number => {
  const count = finiteNumber(total);
  return count ? (finiteNumber(successful) / count) * 100 : 0;
};

export const usageAverage = (value: unknown, total: unknown): number => {
  const count = finiteNumber(total);
  return count ? Math.round(finiteNumber(value) / count) : 0;
};
