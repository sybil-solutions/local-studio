import type { Dialect, Engine } from "./model";

export const ERROR_CODES = [
  "AUTH",
  "QUOTA",
  "RATE_LIMIT",
  "INVALID_REQUEST",
  "MODEL_NOT_FOUND",
  "CONTEXT_WINDOW_EXCEEDED",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT",
  "EMPTY_RESPONSE",
  "ABORTED",
  "UNKNOWN",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type Finish = "stop" | "tool_calls" | "length" | "error" | "aborted";

export type UsageSource = "engine" | "engine+metrics" | "metrics" | "estimated" | "none";

export interface TokenBuckets {
  inputUncached: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

export interface RequestRecord extends TokenBuckets {
  id: string;
  tsStart: number;
  tsUpstream: number | null;
  tsFirstToken: number | null;
  tsEnd: number;
  machineId: string;
  modelId: string | null;
  model: string;
  engine: Engine | null;
  client: string;
  workspaceId: string | null;
  sessionId: string | null;
  dialect: Dialect;
  stream: boolean;
  via: "local" | "peer";
  peerId: string | null;
  status: number;
  finish: Finish;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  promptTotal: number;
  total: number;
  usageSource: UsageSource;
  cacheSource: "engine" | "metrics" | null;
  contextWindow: number | null;
  ttftMs: number | null;
  decodeMs: number | null;
  prefillTps: number | null;
  decodeTps: number | null;
  engineQueueMs: number | null;
  enginePrefillMs: number | null;
  engineDecodeMs: number | null;
  capsStripped: string[];
  chunkTime0: number | null;
  chunkDt: number[] | null;
}

export interface EngineCounters {
  promptTokens: number | null;
  generationTokens: number | null;
  promptTokensCached: number | null;
  promptTokensLocalCompute: number | null;
  prefixCacheQueries: number | null;
  prefixCacheHits: number | null;
  externalPrefixCacheQueries: number | null;
  externalPrefixCacheHits: number | null;
  requestsSuccess: Record<string, number>;
  httpStatus: Record<string, number>;
  preemptions: number | null;
  ttftSum: number | null;
  ttftCount: number | null;
  queueSum: number | null;
  queueCount: number | null;
  prefillSum: number | null;
  prefillCount: number | null;
  decodeSum: number | null;
  decodeCount: number | null;
  e2eSum: number | null;
  e2eCount: number | null;
  genTokensHistSum: number | null;
  specDrafts: number | null;
  specDraftTokens: number | null;
  specAccepted: number | null;
}

export interface EngineGauges {
  kvCacheUsage: number | null;
  running: number | null;
  waiting: number | null;
  sglangCacheHitRate: number | null;
  sglangGenThroughput: number | null;
}

export interface EngineSample {
  ts: number;
  modelId: string;
  engine: Engine;
  counters: EngineCounters;
  gauges: EngineGauges;
}

export interface EngineRates {
  modelId: string;
  windowMs: number;
  prefixHitRate: number | null;
  prefillTps: number | null;
  decodeTps: number | null;
  generationTpsWall: number | null;
  promptTpsWall: number | null;
  meanTtftMs: number | null;
  meanQueueMs: number | null;
  specAcceptLength: number | null;
  kvCacheUsage: number | null;
  running: number | null;
  waiting: number | null;
  finishedByReason: Record<string, number>;
}

export type Window = "1h" | "24h" | "7d" | "30d" | "all";

export interface Percentiles {
  p50: number | null;
  p90: number | null;
  p99: number | null;
}

export interface MetricsSummary extends TokenBuckets {
  window: Window;
  from: number;
  to: number;
  requests: number;
  errors: number;
  errorRate: number | null;
  errorsByCode: Partial<Record<ErrorCode, number>>;
  promptTotal: number;
  cacheUnknownPrompt: number;
  cacheHit: number | null;
  decodeTokens: number;
  decodeMs: number;
  decodeTps: number | null;
  prefillTokens: number;
  prefillMs: number;
  prefillTps: number | null;
  ttftMs: Percentiles;
  meanTtftMs: number | null;
  decodeTpsPerRequest: Percentiles;
  costUsd: number | null;
  byModel: MetricsSlice[];
  byClient: MetricsSlice[];
}

export interface MetricsSlice extends TokenBuckets {
  key: string;
  requests: number;
  errors: number;
  promptTotal: number;
  cacheUnknownPrompt: number;
  cacheHit: number | null;
  decodeTps: number | null;
  prefillTps: number | null;
  meanTtftMs: number | null;
  costUsd: number | null;
}

export interface DailyRow extends TokenBuckets {
  day: string;
  machineId: string;
  model: string;
  client: string;
  requests: number;
  errors: number;
  cacheUnknownPrompt: number;
  decodeTokens: number;
  decodeMs: number;
  prefillTokens: number;
  prefillMs: number;
  ttftSumMs: number;
  ttftN: number;
  costUsd: number;
}

export interface Activity {
  start: string;
  today: number;
  days: number[];
  requests: number;
  total: number;
  week: number;
  since: string | null;
  last: number | null;
}

export interface ModelCardStats {
  modelId: string;
  model: string;
  sessionTokens: number;
  allTokens: number;
  week: number;
  since: string | null;
  last: number | null;
  decodeTps: number | null;
  prefillTps: number | null;
  meanTtftMs: number | null;
  cacheHit: number | null;
  errorRate: number | null;
  line: number[];
}

export interface Price {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const PREFILL_MIN_TOKENS = 256;
export const DECODE_MIN_TOKENS = 2;
export const ACTIVITY_DAYS = 140;
