import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import type { DailyRow } from "@local-studio/contracts";
import { PriceBody, WindowParam } from "@local-studio/contracts";
import type { Env, MetricsService } from "../context";
import type { Scraper } from "./scrape";
import type { Store } from "./store";

const err = (code: string, message: string) => ({ error: { code, message } });

type R = Record<string, number | string | null>;
const n = (v: unknown): number => (typeof v === "number" ? v : 0);

const dailyRow = (r: R): DailyRow => ({
  day: String(r.day),
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

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COLS = ["requests", "errors", "input_uncached", "cache_read", "cache_write", "output", "reasoning", "decode_tokens", "decode_ms", "prefill_tokens", "prefill_ms", "ttft_sum_ms", "ttft_n", "cost_usd", "cache_unknown_prompt"];

export const metricsRoutes = (db: Database, svc: MetricsService, store: Store, scraper: Scraper): Hono<Env> => {
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
  r.get("/api/metrics/engine/:modelId", (c) => {
    const id = c.req.param("modelId");
    const latest = scraper.latest(id);
    if (!latest) return c.json(err("NOT_FOUND", `no engine samples for ${id}`), 404);
    return c.json({ latest, rates: scraper.rates(id), cache: scraper.cacheInfo(id) });
  });
  r.get("/api/metrics/check/:requestId", (c) => {
    const id = c.req.param("requestId");
    const record = store.get(id);
    if (!record) return c.json(err("NOT_FOUND", `no request ${id}`), 404);
    const check = store.getCheck(id);
    return c.json({ record, ...(check ?? { before: null, after: null, deltas: null, agreement: null }) });
  });
  r.get("/api/usage/daily", (c) => {
    const from = c.req.query("from") ?? "0000-01-01";
    const to = c.req.query("to") ?? "9999-12-31";
    if (!DAY.test(from) || !DAY.test(to))
      return c.json(err("INVALID_REQUEST", "from/to must be YYYY-MM-DD"), 400);
    const group = new Set((c.req.query("group") ?? "model,client").split(",").map((s) => s.trim()));
    const keys = ["day", "machine_id", ...(group.has("model") ? ["model"] : []), ...(group.has("client") ? ["client"] : [])];
    const sel = [...keys, group.has("model") ? "" : "'*' AS model", group.has("client") ? "" : "'*' AS client"].filter(Boolean).join(", ");
    const rows = db
      .query<R, [string, string]>(
        `SELECT ${sel}, ${COLS.map((k) => `SUM(${k}) AS ${k}`).join(", ")} FROM usage_daily WHERE day >= ? AND day <= ? GROUP BY ${keys.join(", ")} ORDER BY day, ${keys.slice(1).join(", ")}`,
      )
      .all(from, to);
    return c.json(rows.map(dailyRow));
  });
  r.get("/api/usage/activity", (c) => c.json(svc.activity()));
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
