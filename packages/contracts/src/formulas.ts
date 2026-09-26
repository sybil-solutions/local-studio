import type { ErrorCode, Price, TokenBuckets } from "./metrics";
import { DECODE_MIN_TOKENS, PREFILL_MIN_TOKENS } from "./metrics";

export const promptTotal = (b: TokenBuckets): number => b.inputUncached + b.cacheRead + b.cacheWrite;

export const cacheHit = (b: TokenBuckets): number | null => {
  const p = promptTotal(b);
  return p > 0 ? b.cacheRead / p : null;
};

export const ttftMs = (tsStart: number, tsFirstToken: number | null): number | null =>
  tsFirstToken === null ? null : Math.max(0, tsFirstToken - tsStart);

export const decodeMs = (tsFirstToken: number | null, tsEnd: number): number | null =>
  tsFirstToken === null ? null : Math.max(0, tsEnd - tsFirstToken);

export const decodeTps = (output: number, dMs: number | null): number | null =>
  dMs !== null && dMs > 0 && output >= DECODE_MIN_TOKENS ? output / (dMs / 1000) : null;

export const prefillTps = (inputUncached: number, tMs: number | null): number | null =>
  tMs !== null && tMs > 0 && inputUncached >= PREFILL_MIN_TOKENS ? inputUncached / (tMs / 1000) : null;

export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export interface UsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number | null; cache_write_tokens?: number | null } | null;
  input_tokens_details?: { cached_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  output_tokens_details?: { reasoning_tokens?: number | null } | null;
  prompt_cache_hit_tokens?: number;
  cached_tokens?: number;
}

export const bucketsFromOpenAiUsage = (u: UsageLike): TokenBuckets & { cachedReported: boolean } => {
  const prompt = u.prompt_tokens ?? u.input_tokens ?? 0;
  const cachedRaw =
    u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cached_tokens;
  const cacheRead = cachedRaw ?? 0;
  const cacheWrite = u.prompt_tokens_details?.cache_write_tokens ?? 0;
  const output = u.completion_tokens ?? u.output_tokens ?? 0;
  const reasoning = u.completion_tokens_details?.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens ?? 0;
  return {
    inputUncached: Math.max(0, prompt - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output,
    reasoning,
    cachedReported: cachedRaw !== undefined && cachedRaw !== null,
  };
};

export const costUsd = (b: TokenBuckets, p: Price | null): number | null =>
  p === null
    ? null
    : (p.input * b.inputUncached + p.output * b.output + p.cacheRead * b.cacheRead + p.cacheWrite * b.cacheWrite) / 1e6;

export const classifyError = (status: number | null, text: string): ErrorCode => {
  const t = text.toLowerCase();
  const has = (...xs: string[]) => xs.some((x) => t.includes(x));
  if (status === 401 || status === 403 || has(" 401", " 403", "unauthorized", "forbidden")) return "AUTH";
  if (status === 402 || has("quota", "insufficient balance")) return "QUOTA";
  if (status === 429 || has("rate limit")) return "RATE_LIMIT";
  if (has("context length", "context window", "context size", "maximum context", "too many tokens", "prompt is too long", "exceeds the available context")) return "CONTEXT_WINDOW_EXCEEDED";
  if (status === 404 && has("model")) return "MODEL_NOT_FOUND";
  if (status === 413 || status === 400 || status === 422 || has("invalid request", "payload too large", "request body too large")) return "INVALID_REQUEST";
  if (status !== null && status >= 500) return "SERVER";
  if (has("timeout", "timed out")) return "TIMEOUT";
  if (has("abort")) return "ABORTED";
  if (has("stream ended", "network", "connection", "socket", "fetch", "econn", "other side closed", "terminated", "premature close")) return "TRANSPORT";
  return "UNKNOWN";
};

export const TTFT_BUCKETS = 48;
const TTFT_BASE_MS = 10;
const TTFT_STEP = 1.25;

export const ttftBucket = (ms: number): number => Math.max(0, Math.min(TTFT_BUCKETS - 1, Math.floor(Math.log(Math.max(ms, TTFT_BASE_MS) / TTFT_BASE_MS) / Math.log(TTFT_STEP))));

export const histPercentile = (hist: number[], p: number): number | null => {
  const total = hist.reduce((t, x) => t + x, 0);
  if (!total) return null;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i] ?? 0;
    if (seen >= total * p) return TTFT_BASE_MS * TTFT_STEP ** (i + 0.5);
  }
  return null;
};
