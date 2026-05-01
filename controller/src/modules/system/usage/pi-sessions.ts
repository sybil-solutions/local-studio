import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { calcChange } from "./usage-utilities";

type UsagePayload = Record<string, unknown>;

type UsageAccumulator = {
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  sessions: Set<string>;
  byModel: Map<string, ModelUsage>;
  daily: Map<string, ModelUsage>;
  dailyByModel: Map<string, ModelUsage>;
  hourly: Map<number, { hour: number; requests: number; successful: number; tokens: number }>;
  lastHourRequests: number;
  last24hRequests: number;
  prev24hRequests: number;
  last24hTokens: number;
};

type ModelUsage = {
  model: string;
  date?: string;
  requests: number;
  successful: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
};

const numberValue = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const textValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const piSessionsRoot = (): string =>
  process.env["PI_CODING_AGENT_DIR"]
    ? join(process.env["PI_CODING_AGENT_DIR"], "sessions")
    : join(homedir(), ".pi", "agent", "sessions");

const collectJsonlFiles = (root: string): string[] => {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        visit(path);
      } else if (stats.isFile() && entry.endsWith(".jsonl")) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files;
};

const upsertUsage = (
  map: Map<string, ModelUsage>,
  key: string,
  model: string,
  usage: { prompt: number; completion: number; total: number },
  date?: string
): void => {
  const existing =
    map.get(key) ??
    ({
      ...(date ? { date } : {}),
      model,
      requests: 0,
      successful: 0,
      total_tokens: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
    } satisfies ModelUsage);
  existing.requests += 1;
  existing.successful += 1;
  existing.prompt_tokens += usage.prompt;
  existing.completion_tokens += usage.completion;
  existing.total_tokens += usage.total;
  map.set(key, existing);
};

const addAssistantUsage = (
  accumulator: UsageAccumulator,
  sessionId: string,
  model: string,
  timestamp: Date,
  usage: { prompt: number; completion: number; total: number },
  now: Date
): void => {
  const date = timestamp.toISOString().slice(0, 10);
  const hour = timestamp.getUTCHours();
  accumulator.totalRequests += 1;
  accumulator.promptTokens += usage.prompt;
  accumulator.completionTokens += usage.completion;
  accumulator.totalTokens += usage.total;
  accumulator.sessions.add(sessionId);
  upsertUsage(accumulator.byModel, model, model, usage);
  upsertUsage(accumulator.daily, date, "all", usage, date);
  upsertUsage(accumulator.dailyByModel, `${date}\u0000${model}`, model, usage, date);

  const hourly = accumulator.hourly.get(hour) ?? { hour, requests: 0, successful: 0, tokens: 0 };
  hourly.requests += 1;
  hourly.successful += 1;
  hourly.tokens += usage.total;
  accumulator.hourly.set(hour, hourly);

  const ageMs = now.getTime() - timestamp.getTime();
  if (ageMs >= 0 && ageMs <= 60 * 60 * 1000) accumulator.lastHourRequests += 1;
  if (ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000) {
    accumulator.last24hRequests += 1;
    accumulator.last24hTokens += usage.total;
  } else if (ageMs > 24 * 60 * 60 * 1000 && ageMs <= 48 * 60 * 60 * 1000) {
    accumulator.prev24hRequests += 1;
  }
};

const parseTimestamp = (value: unknown, fallback: Date): Date => {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return fallback;
};

const parseAssistantUsage = (
  event: Record<string, unknown>,
  fallbackModel: string | null
): { model: string; prompt: number; completion: number; total: number; timestamp: Date } | null => {
  if (event["type"] !== "message") return null;
  const message = recordValue(event["message"]);
  if (message["role"] !== "assistant") return null;
  const usage = recordValue(message["usage"]);
  const prompt = numberValue(usage["input"] ?? usage["prompt_tokens"]);
  const completion = numberValue(usage["output"] ?? usage["completion_tokens"]);
  const total = numberValue(usage["totalTokens"] ?? usage["total_tokens"]) || prompt + completion;
  if (total <= 0) return null;
  const model = textValue(message["model"]) ?? fallbackModel ?? "unknown";
  const eventTime = parseTimestamp(event["timestamp"], new Date());
  return {
    model,
    prompt,
    completion,
    total,
    timestamp: parseTimestamp(message["timestamp"], eventTime),
  };
};

export const getUsageFromPiSessions = (
  root = piSessionsRoot(),
  now = new Date()
): UsagePayload | null => {
  const accumulator: UsageAccumulator = {
    totalRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    sessions: new Set(),
    byModel: new Map(),
    daily: new Map(),
    dailyByModel: new Map(),
    hourly: new Map(),
    lastHourRequests: 0,
    last24hRequests: 0,
    prev24hRequests: 0,
    last24hTokens: 0,
  };

  for (const file of collectJsonlFiles(root)) {
    let sessionId = file;
    let currentModel: string | null = null;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event["type"] === "session") {
        sessionId = textValue(event["id"]) ?? sessionId;
      } else if (event["type"] === "model_change") {
        currentModel = textValue(event["modelId"]) ?? currentModel;
      }
      const usage = parseAssistantUsage(event, currentModel);
      if (usage)
        addAssistantUsage(accumulator, sessionId, usage.model, usage.timestamp, usage, now);
    }
  }

  if (accumulator.totalRequests === 0) return null;
  const byModel = [...accumulator.byModel.values()]
    .sort((a, b) => b.total_tokens - a.total_tokens)
    .slice(0, 25);
  const daily = [...accumulator.daily.values()].sort((a, b) =>
    String(b.date ?? "").localeCompare(String(a.date ?? ""))
  );
  const dailyByModel = [...accumulator.dailyByModel.values()].sort((a, b) =>
    String(b.date ?? "").localeCompare(String(a.date ?? ""))
  );
  const hourly = [...accumulator.hourly.values()].sort((a, b) => a.hour - b.hour);
  const peakDays = daily
    .map((row) => ({ date: row.date ?? "", requests: row.requests, tokens: row.total_tokens }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 5);
  const peakHours = hourly
    .map((row) => ({ hour: row.hour, requests: row.requests }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 5);
  const successRate = accumulator.totalRequests ? 100 : 0;

  return {
    totals: {
      total_tokens: accumulator.totalTokens,
      prompt_tokens: accumulator.promptTokens,
      completion_tokens: accumulator.completionTokens,
      total_requests: accumulator.totalRequests,
      successful_requests: accumulator.totalRequests,
      failed_requests: 0,
      success_rate: successRate,
      unique_sessions: accumulator.sessions.size,
      unique_users: 0,
    },
    latency: { avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, min_ms: 0, max_ms: 0 },
    ttft: { avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0 },
    tokens_per_request: {
      avg: Math.round(accumulator.totalTokens / accumulator.totalRequests),
      avg_prompt: Math.round(accumulator.promptTokens / accumulator.totalRequests),
      avg_completion: Math.round(accumulator.completionTokens / accumulator.totalRequests),
      max: byModel.reduce(
        (max, row) => Math.max(max, Math.round(row.total_tokens / row.requests)),
        0
      ),
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
      last_hour_requests: accumulator.lastHourRequests,
      last_24h_requests: accumulator.last24hRequests,
      prev_24h_requests: accumulator.prev24hRequests,
      last_24h_tokens: accumulator.last24hTokens,
      change_24h_pct: calcChange(accumulator.last24hRequests, accumulator.prev24hRequests),
    },
    peak_days: peakDays,
    peak_hours: peakHours,
    by_model: byModel.map((row) => ({
      ...row,
      success_rate: 100,
      avg_tokens: Math.round(row.total_tokens / row.requests),
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
      successful: row.successful,
      success_rate: 100,
      total_tokens: row.total_tokens,
      prompt_tokens: row.prompt_tokens,
      completion_tokens: row.completion_tokens,
      avg_latency_ms: 0,
    })),
    daily_by_model: dailyByModel.map((row) => ({ ...row, success_rate: 100 })),
    hourly_pattern: hourly,
  };
};
