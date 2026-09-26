import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import type { DailyRow, GpuSample, HourlyRow, TtftHour } from "@local-studio/contracts";
import { PriceBody, TTFT_BUCKETS, WindowParam, ttftBucket } from "@local-studio/contracts";
import type { Env, MetricsService } from "../context";
import type { Store } from "./store";
import { AGG, type AggRow, n } from "./summary";

const err = (code: string, message: string) => ({ error: { code, message } });

const usageRow = (r: AggRow): Omit<DailyRow, "day"> => ({
  machineId: String(r.machine_id),
  model: String(r.model),
  client: String(r.client),
  requests: n(r.requests),
  errors: n(r.errors),
  cacheUnknownPrompt: n(r.cache_unknown_prompt),
  inputUncached: n(r.input_uncached),
  cacheRead: n(r.cache_read),
  cacheWrite: n(r.cache_write),
  output: n(r.output),
  reasoning: n(r.reasoning),
  decodeTokens: n(r.decode_tokens),
  decodeMs: n(r.decode_ms),
  prefillTokens: n(r.prefill_tokens),
  prefillMs: n(r.prefill_ms),
  ttftSumMs: n(r.ttft_sum_ms),
  ttftN: n(r.ttft_n),
  costUsd: n(r.cost_usd),
});
const dailyRow = (r: AggRow): DailyRow => ({ day: String(r.day), ...usageRow(r) });
const hourlyRow = (r: AggRow): HourlyRow => ({ hour: n(r.hour), ...usageRow(r) });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COLS = ["requests", "errors", "input_uncached", "cache_read", "cache_write", "output", "reasoning", "decode_tokens", "decode_ms", "prefill_tokens", "prefill_ms", "ttft_sum_ms", "ttft_n", "cost_usd", "cache_unknown_prompt"];

export const metricsRoutes = (db: Database, svc: MetricsService, store: Store): Hono<Env> => {
  const r = new Hono<Env>();
  r.get("/api/metrics/summary", (c) => {
    const w = WindowParam.safeParse(c.req.query("window") ?? undefined);
    if (!w.success) return c.json(err("INVALID_REQUEST", "window must be one of 1h, 24h, 7d, 30d, all"), 400);
    return c.json(svc.summary(w.data, { model: c.req.query("model"), client: c.req.query("client"), machineId: c.req.query("machine") }));
  });
  r.get("/api/metrics/requests", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    const before = c.req.query("before");
    return c.json(svc.recent(Number.isFinite(limit) ? limit : 50, before ? Number(before) : undefined));
  });
  r.get("/api/usage/daily", (c) => {
    const from = c.req.query("from") ?? "0000-01-01";
    const to = c.req.query("to") ?? "9999-12-31";
    if (!DAY.test(from) || !DAY.test(to))
      return c.json(err("INVALID_REQUEST", "from/to must be YYYY-MM-DD"), 400);
    const group = new Set((c.req.query("group") ?? "model,client").split(",").map((s) => s.trim()));
    const keys = ["day", "machine_id", ...(group.has("model") ? ["model"] : []), ...(group.has("client") ? ["client"] : [])];
    const sel = [...keys, group.has("model") ? "" : "'*' AS model", group.has("client") ? "" : "'*' AS client"].filter(Boolean).join(", ");
    store.flush();
    const rows = db
      .query<AggRow, [string, string]>(
        `SELECT ${sel}, ${COLS.map((k) => `SUM(${k}) AS ${k}`).join(", ")} FROM usage_daily WHERE day >= ? AND day <= ? GROUP BY ${keys.join(", ")} ORDER BY day, ${keys.slice(1).join(", ")}`,
      )
      .all(from, to);
    return c.json(rows.map(dailyRow));
  });
  r.get("/api/usage/hourly", (c) => {
    const from = Number(c.req.query("from") ?? Date.now() - 86_400_000);
    const to = Number(c.req.query("to") ?? Date.now());
    if (!Number.isFinite(from) || !Number.isFinite(to)) return c.json(err("INVALID_REQUEST", "from/to must be epoch ms"), 400);
    store.flush();
    const rows = db
      .query<AggRow, [number, number]>(
        `SELECT (ts_start / 3600000) * 3600000 AS hour, machine_id, model, client, ${AGG} FROM requests WHERE via = 'local' AND ts_start >= ? AND ts_start < ? GROUP BY hour, machine_id, model, client ORDER BY hour`,
      )
      .all(from, to);
    return c.json(rows.map(hourlyRow));
  });
  r.get("/api/metrics/ttft", (c) => {
    const from = Number(c.req.query("from") ?? Date.now() - 86_400_000);
    if (!Number.isFinite(from)) return c.json(err("INVALID_REQUEST", "from must be epoch ms"), 400);
    store.flush();
    const hours = new Map<number, number[]>();
    for (const x of db
      .query<AggRow, [number]>(
        "SELECT (ts_start / 3600000) * 3600000 AS hour, ttft_ms AS t FROM requests WHERE via = 'local' AND ts_start >= ? AND ttft_ms IS NOT NULL AND usage_source NOT IN ('estimated','none')",
      )
      .all(from)) {
      const h = hours.get(n(x.hour)) ?? new Array<number>(TTFT_BUCKETS).fill(0);
      h[ttftBucket(n(x.t))]! += 1;
      hours.set(n(x.hour), h);
    }
    return c.json([...hours].sort((a, b) => a[0] - b[0]).map(([hour, hist]): TtftHour => ({ hour, hist })));
  });
  r.get("/api/metrics/gpus", (c) => {
    const from = Number(c.req.query("from") ?? Date.now() - 86_400_000);
    if (!Number.isFinite(from)) return c.json(err("INVALID_REQUEST", "from must be epoch ms"), 400);
    const rows = db.query<AggRow, [number]>("SELECT * FROM gpu_samples WHERE ts >= ? ORDER BY ts").all(from);
    const opt = (v: unknown) => (typeof v === "number" ? v : null);
    return c.json(rows.map((x): GpuSample => ({ ts: n(x.ts), utilPct: opt(x.util), memUsedMiB: opt(x.mem_used), memTotalMiB: n(x.mem_total), powerW: opt(x.power), tempC: opt(x.temp) })));
  });
  r.get("/api/prices", (c) => c.json(store.prices()));
  r.put("/api/prices", async (c) => {
    const body = await c.req.json().catch(() => null);
    const list = Array.isArray(body) ? body : [body];
    const parsed = list.map((x) => PriceBody.safeParse(x));
    const bad = parsed.find((p) => !p.success);
    if (bad && !bad.success) return c.json(err("INVALID_REQUEST", bad.error.message), 400);
    for (const p of parsed) if (p.success) store.putPrice(p.data);
    return c.json(store.prices());
  });
  return r;
};
