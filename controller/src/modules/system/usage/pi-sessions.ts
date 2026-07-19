import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Effect, Schema, Stream } from "effect";
import type { UsageStats } from "@local-studio/contracts/usage";
import { calcChange } from "./usage-utilities";

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
  cacheHits: number;
  cacheMisses: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
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

type JsonlFile = { path: string; mtimeMs: number; size: number };

type ParsedRecord = {
  sessionId: string;
  model: string;
  timestamp: number;
  prompt: number;
  completion: number;
  total: number;
  cacheRead: number;
  cacheWrite: number;
};

const LARGE_FILE_BYTES = 256 * 1024 * 1024;
const JsonObjectSchema = Schema.Record(Schema.String, Schema.Unknown);

const collectJsonlFiles = (root: string): Effect.Effect<JsonlFile[]> => {
  const files: JsonlFile[] = [];
  const visit = (directory: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const entries = yield* Effect.tryPromise(() =>
        readdir(directory, { withFileTypes: true }),
      ).pipe(Effect.catch(() => Effect.succeed([])));
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          yield* visit(path);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          yield* Effect.tryPromise(() => stat(path)).pipe(
            Effect.tap((stats) =>
              Effect.sync(() => {
                files.push({ path, mtimeMs: stats.mtimeMs, size: stats.size });
              }),
            ),
            Effect.catch(() => Effect.void),
          );
        }
      }
    });
  return visit(root).pipe(Effect.as(files));
};

const fileRecordCache = new Map<
  string,
  { mtimeMs: number; size: number; records: ParsedRecord[] }
>();

const parseFileRecords = (file: JsonlFile): Effect.Effect<ParsedRecord[], unknown> => {
  const cached = fileRecordCache.get(file.path);
  if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) {
    return Effect.succeed(cached.records);
  }
  if (file.size > LARGE_FILE_BYTES) {
    console.warn(
      `[pi-sessions] streaming large session file (${Math.round(file.size / (1024 * 1024))} MB): ${file.path}`,
    );
  }
  const records: ParsedRecord[] = [];
  let sessionId = file.path;
  let currentModel: string | null = null;
  const lines = Stream.scoped(
    Stream.unwrap(
      Effect.acquireRelease(
        Effect.sync(() => {
          const input = createReadStream(file.path, { encoding: "utf8" });
          const reader = createInterface({ input, crlfDelay: Infinity });
          return { input, reader };
        }),
        ({ input, reader }) =>
          Effect.sync(() => {
            reader.close();
            input.destroy();
          }),
      ).pipe(Effect.map(({ reader }) => Stream.fromAsyncIterable(reader, (error) => error))),
    ),
  );
  return lines.pipe(
    Stream.runForEach((line) =>
      Effect.sync(() => {
        if (!line.trim()) return;
        let event: Record<string, unknown>;
        try {
          event = Schema.decodeUnknownSync(JsonObjectSchema)(JSON.parse(line) as unknown);
        } catch {
          return;
        }
        if (event["type"] === "session") {
          sessionId = textValue(event["id"]) ?? sessionId;
        } else if (event["type"] === "model_change") {
          currentModel = textValue(event["modelId"]) ?? currentModel;
        }
        const usage = parseAssistantUsage(event, currentModel);
        if (!usage) return;
        records.push({
          sessionId,
          model: usage.model,
          timestamp: usage.timestamp.getTime(),
          prompt: usage.prompt,
          completion: usage.completion,
          total: usage.total,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
        });
      }),
    ),
    Effect.tap(() =>
      Effect.sync(() => {
        fileRecordCache.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, records });
      }),
    ),
    Effect.as(records),
  );
};

const upsertUsage = (
  map: Map<string, ModelUsage>,
  key: string,
  model: string,
  usage: { prompt: number; completion: number; total: number },
  date?: string,
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
  usage: {
    prompt: number;
    completion: number;
    total: number;
    cacheRead: number;
    cacheWrite: number;
  },
  now: Date,
): void => {
  const date = timestamp.toISOString().slice(0, 10);
  const hour = timestamp.getUTCHours();
  accumulator.totalRequests += 1;
  accumulator.promptTokens += usage.prompt;
  accumulator.completionTokens += usage.completion;
  accumulator.totalTokens += usage.total;
  if (usage.cacheRead > 0) {
    accumulator.cacheHits += 1;
    accumulator.cacheHitTokens += usage.cacheRead;
  }
  if (usage.cacheWrite > 0) {
    accumulator.cacheMisses += 1;
    accumulator.cacheMissTokens += usage.cacheWrite;
  }
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
  fallbackModel: string | null,
): {
  model: string;
  prompt: number;
  completion: number;
  total: number;
  cacheRead: number;
  cacheWrite: number;
  timestamp: Date;
} | null => {
  if (event["type"] !== "message") return null;
  const message = recordValue(event["message"]);
  if (message["role"] !== "assistant") return null;
  const usage = recordValue(message["usage"]);
  const prompt = numberValue(usage["input"] ?? usage["prompt_tokens"]);
  const completion = numberValue(usage["output"] ?? usage["completion_tokens"]);
  const total = numberValue(usage["totalTokens"] ?? usage["total_tokens"]) || prompt + completion;
  if (total <= 0) return null;
  const cacheRead = numberValue(usage["cacheRead"]);
  const cacheWrite = numberValue(usage["cacheWrite"]);
  const model = textValue(message["model"]) ?? fallbackModel ?? "unknown";
  const eventTime = parseTimestamp(event["timestamp"], new Date());
  return {
    model,
    prompt,
    completion,
    total,
    cacheRead,
    cacheWrite,
    timestamp: parseTimestamp(message["timestamp"], eventTime),
  };
};

const RESULT_TTL_MS = 30_000;
const resultCache = new Map<string, { at: number; value: Omit<UsageStats, "controller"> | null }>();

export const getUsageFromPiSessions = (
  root = piSessionsRoot(),
  now = new Date(),
  knownModels?: Set<string>,
): Effect.Effect<Omit<UsageStats, "controller"> | null> =>
  Effect.gen(function* () {
    const cacheKey = `${root}\u0000${knownModels ? [...knownModels].sort().join(",") : ""}`;
    const cachedResult = resultCache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.at < RESULT_TTL_MS) {
      return cachedResult.value;
    }

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
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
    };

    const files = yield* collectJsonlFiles(root);
    const livePaths = new Set(files.map((file) => file.path));
    for (const path of fileRecordCache.keys()) {
      if (!livePaths.has(path)) fileRecordCache.delete(path);
    }

    for (const file of files) {
      const records = yield* parseFileRecords(file).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            console.warn(`[pi-sessions] failed to read ${file.path}: ${String(error)}`);
            return [] as ParsedRecord[];
          }),
        ),
      );
      for (const record of records) {
        if (knownModels && !knownModels.has(record.model)) continue;
        addAssistantUsage(
          accumulator,
          record.sessionId,
          record.model,
          new Date(record.timestamp),
          record,
          now,
        );
      }
    }

    if (accumulator.totalRequests === 0) {
      resultCache.set(cacheKey, { at: Date.now(), value: null });
      return null;
    }
    const byModel = [...accumulator.byModel.values()]
      .sort((a, b) => b.total_tokens - a.total_tokens)
      .slice(0, 25);
    const daily = [...accumulator.daily.values()].sort((a, b) =>
      String(b.date ?? "").localeCompare(String(a.date ?? "")),
    );
    const dailyByModel = [...accumulator.dailyByModel.values()].sort((a, b) =>
      String(b.date ?? "").localeCompare(String(a.date ?? "")),
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

    const result: Omit<UsageStats, "controller"> = {
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
          0,
        ),
        p50: 0,
        p95: 0,
      },
      cache: {
        hits: accumulator.cacheHits,
        misses: accumulator.cacheMisses,
        hit_tokens: accumulator.cacheHitTokens,
        miss_tokens: accumulator.cacheMissTokens,
        hit_rate:
          accumulator.cacheHits + accumulator.cacheMisses > 0
            ? (accumulator.cacheHits / (accumulator.cacheHits + accumulator.cacheMisses)) * 100
            : 0,
      },
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
        date: row.date ?? "",
        requests: row.requests,
        successful: row.successful,
        success_rate: 100,
        total_tokens: row.total_tokens,
        prompt_tokens: row.prompt_tokens,
        completion_tokens: row.completion_tokens,
        avg_latency_ms: 0,
      })),
      daily_by_model: dailyByModel.map((row) => ({
        ...row,
        date: row.date ?? "",
        success_rate: 100,
      })),
      hourly_pattern: hourly,
    };

    resultCache.set(cacheKey, { at: Date.now(), value: result });
    return result;
  });
