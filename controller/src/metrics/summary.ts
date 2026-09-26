import type { Database } from "bun:sqlite";
import type { ErrorCode, MetricsSlice, MetricsSummary, Percentiles, Window } from "@local-studio/contracts";
import { DECODE_MIN_TOKENS, PREFILL_MIN_TOKENS, ratio } from "@local-studio/contracts";

const WINDOW_MS: Record<Window, number | null> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, all: null };

export interface Filter {
  model?: string;
  client?: string;
  machineId?: string;
  modelId?: string;
}

type Bind = string | number;

export const whereFor = (from: number, f: Filter = {}): { sql: string; args: Bind[] } => {
  const parts = ["ts_start >= ?"];
  const args: Bind[] = [from];
  if (f.model) (parts.push("lower(model) = lower(?)"), args.push(f.model));
  if (f.client) (parts.push("client = ?"), args.push(f.client));
  if (f.machineId) (parts.push("machine_id = ?"), args.push(f.machineId));
  if (f.modelId) (parts.push("model_id = ?"), args.push(f.modelId));
  return { sql: parts.join(" AND "), args };
};

const MEASURED = "usage_source NOT IN ('estimated','none')";
export const CACHE_KNOWN = "cache_source IS NOT NULL";

export const AGG = `
  COUNT(*) AS requests,
  SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) AS errors,
  SUM(CASE WHEN via = 'local' THEN input_uncached ELSE 0 END) AS input_uncached,
  SUM(CASE WHEN via = 'local' THEN cache_read ELSE 0 END) AS cache_read,
  SUM(CASE WHEN via = 'local' THEN cache_write ELSE 0 END) AS cache_write,
  SUM(CASE WHEN via = 'local' THEN output ELSE 0 END) AS output,
  SUM(CASE WHEN via = 'local' THEN reasoning ELSE 0 END) AS reasoning,
  SUM(CASE WHEN via = 'local' AND NOT (${CACHE_KNOWN}) THEN prompt_total ELSE 0 END) AS cache_unknown_prompt,
  SUM(CASE WHEN via = 'local' AND ${MEASURED} AND decode_tps IS NOT NULL AND output >= ${DECODE_MIN_TOKENS} THEN output ELSE 0 END) AS decode_tokens,
  SUM(CASE WHEN via = 'local' AND ${MEASURED} AND decode_tps IS NOT NULL AND output >= ${DECODE_MIN_TOKENS} THEN decode_ms ELSE 0 END) AS decode_ms,
  SUM(CASE WHEN via = 'local' AND ${MEASURED} AND ${CACHE_KNOWN} AND prefill_tps IS NOT NULL AND input_uncached >= ${PREFILL_MIN_TOKENS} THEN input_uncached ELSE 0 END) AS prefill_tokens,
  SUM(CASE WHEN via = 'local' AND ${MEASURED} AND ${CACHE_KNOWN} AND prefill_tps IS NOT NULL AND input_uncached >= ${PREFILL_MIN_TOKENS} THEN ttft_ms ELSE 0 END) AS prefill_ms,
  SUM(CASE WHEN ${MEASURED} AND ttft_ms IS NOT NULL THEN ttft_ms ELSE 0 END) AS ttft_sum,
  SUM(CASE WHEN ${MEASURED} AND ttft_ms IS NOT NULL THEN 1 ELSE 0 END) AS ttft_n,
  SUM(CASE WHEN via = 'local' THEN cost_usd END) AS cost_usd`;

export type AggRow = Record<string, number | string | null>;
export const n = (v: unknown): number => (typeof v === "number" ? v : 0);

export const sliceOf = (key: string, r: AggRow): MetricsSlice => {
  const b = { inputUncached: n(r.input_uncached), cacheRead: n(r.cache_read), cacheWrite: n(r.cache_write), output: n(r.output), reasoning: n(r.reasoning) };
  const promptTotal = b.inputUncached + b.cacheRead + b.cacheWrite;
  const cacheUnknownPrompt = n(r.cache_unknown_prompt);
  const dtok = n(r.decode_tokens);
  const dms = n(r.decode_ms);
  return {
    key,
    ...b,
    requests: n(r.requests),
    errors: n(r.errors),
    promptTotal,
    cacheUnknownPrompt,
    cacheHit: ratio(b.cacheRead, promptTotal - cacheUnknownPrompt),
    decodeTps: dms > 0 ? dtok / (dms / 1000) : null,
    prefillTps: n(r.prefill_ms) > 0 ? n(r.prefill_tokens) / (n(r.prefill_ms) / 1000) : null,
    meanTtftMs: n(r.ttft_n) > 0 ? n(r.ttft_sum) / n(r.ttft_n) : null,
    costUsd: typeof r.cost_usd === "number" ? r.cost_usd : null,
  };
};

const percentiles = (db: Database, col: string, where: { sql: string; args: Bind[] }, extra: string): Percentiles => {
  const cond = `${where.sql} AND ${col} IS NOT NULL AND ${MEASURED} ${extra}`;
  const count = n(db.query<AggRow, Bind[]>(`SELECT COUNT(*) AS c FROM requests WHERE ${cond}`).get(...where.args)?.c);
  if (count === 0) return { p50: null, p90: null, p99: null };
  const q = db.query<AggRow, Bind[]>(`SELECT ${col} AS v FROM requests WHERE ${cond} ORDER BY ${col} LIMIT 1 OFFSET ?`);
  const at = (p: number) => {
    const v = q.get(...where.args, Math.min(count - 1, Math.floor(p * count)))?.v;
    return typeof v === "number" ? v : null;
  };
  return { p50: at(0.5), p90: at(0.9), p99: at(0.99) };
};

export const summarise = (db: Database, window: Window, f: Filter = {}): MetricsSummary => {
  const to = Date.now();
  const span = WINDOW_MS[window];
  const from = span === null ? 0 : to - span;
  const where = whereFor(from, f);
  const agg = db.query<AggRow, Bind[]>(`SELECT ${AGG} FROM requests WHERE ${where.sql}`).get(...where.args) ?? {};
  const top = sliceOf("all", agg);
  const errorsByCode: Partial<Record<ErrorCode, number>> = {};
  for (const r of db
    .query<AggRow, Bind[]>(`SELECT error_code AS code, COUNT(*) AS c FROM requests WHERE ${where.sql} AND error_code IS NOT NULL GROUP BY error_code`)
    .all(...where.args))
    errorsByCode[r.code as ErrorCode] = n(r.c);
  const group = (col: string) =>
    db
      .query<AggRow, Bind[]>(`SELECT ${col} AS k, ${AGG} FROM requests WHERE ${where.sql} GROUP BY ${col} ORDER BY requests DESC`)
      .all(...where.args)
      .map((r) => sliceOf(String(r.k), r));
  return {
    window,
    from,
    to,
    requests: top.requests,
    errors: top.errors,
    errorRate: ratio(top.errors, top.requests),
    errorsByCode,
    inputUncached: top.inputUncached,
    cacheRead: top.cacheRead,
    cacheWrite: top.cacheWrite,
    output: top.output,
    reasoning: top.reasoning,
    promptTotal: top.promptTotal,
    cacheUnknownPrompt: top.cacheUnknownPrompt,
    cacheHit: top.cacheHit,
    decodeTokens: n(agg.decode_tokens),
    decodeMs: n(agg.decode_ms),
    decodeTps: top.decodeTps,
    prefillTokens: n(agg.prefill_tokens),
    prefillMs: n(agg.prefill_ms),
    prefillTps: top.prefillTps,
    ttftMs: percentiles(db, "ttft_ms", where, ""),
    meanTtftMs: top.meanTtftMs,
    decodeTpsPerRequest: percentiles(db, "decode_tps", where, "AND via = 'local'"),
    costUsd: top.costUsd,
    byModel: group("model"),
    byClient: group("client"),
  };
};
