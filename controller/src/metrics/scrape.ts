import type { EngineCounters, EngineRates, EngineSample, RunningModel } from "@local-studio/contracts";
import type { Ctx } from "../context";
import { normalise, parseProm } from "./prom";

export const RING_MS = 60_000;
export const SCRAPE_EVERY_MS = 5_000;

const d = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);
const div = (n: number | null, den: number | null): number | null => (n === null || den === null || den <= 0 ? null : n / den);
const sumRec = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

export const successTotal = (c: EngineCounters): number | null => (Object.keys(c.requestsSuccess).length ? sumRec(c.requestsSuccess) : null);

export const counterDeltas = (a: EngineCounters, b: EngineCounters) => ({
  promptTokens: d(b.promptTokens, a.promptTokens),
  generationTokens: d(b.generationTokens, a.generationTokens),
  promptTokensCached: d(b.promptTokensCached, a.promptTokensCached),
  promptTokensLocalCompute: d(b.promptTokensLocalCompute, a.promptTokensLocalCompute),
  prefixCacheQueries: d(b.prefixCacheQueries, a.prefixCacheQueries),
  prefixCacheHits: d(b.prefixCacheHits, a.prefixCacheHits),
  requestsSuccess: d(successTotal(b), successTotal(a)),
  ttftSum: d(b.ttftSum, a.ttftSum),
  ttftCount: d(b.ttftCount, a.ttftCount),
  queueSum: d(b.queueSum, a.queueSum),
  queueCount: d(b.queueCount, a.queueCount),
  prefillSum: d(b.prefillSum, a.prefillSum),
  prefillCount: d(b.prefillCount, a.prefillCount),
  decodeSum: d(b.decodeSum, a.decodeSum),
  decodeCount: d(b.decodeCount, a.decodeCount),
  e2eSum: d(b.e2eSum, a.e2eSum),
  genTokensHistSum: d(b.genTokensHistSum, a.genTokensHistSum),
  specDrafts: d(b.specDrafts, a.specDrafts),
  specAccepted: d(b.specAccepted, a.specAccepted),
});

const isReset = (prev: EngineCounters, next: EngineCounters): boolean =>
  (["promptTokens", "generationTokens", "prefixCacheQueries", "ttftCount"] as const).some((k) => {
    const a = prev[k];
    const b = next[k];
    return a !== null && b !== null && b < a;
  });

export interface Scraper {
  scrape(m: RunningModel, timeoutMs: number, record?: boolean): Promise<EngineSample | null>;
  rates(modelId: string): EngineRates | null;
  allRates(): EngineRates[];
  tick(models: RunningModel[]): Promise<void>;
}

export const createScraper = (ctx: Ctx): Scraper => {
  const ring = new Map<string, EngineSample[]>();

  const push = (s: EngineSample) => {
    let list = ring.get(s.modelId) ?? [];
    const prev = list[list.length - 1];
    if (prev && isReset(prev.counters, s.counters)) list = [];
    list.push(s);
    while (list.length > 1 && s.ts - list[0]!.ts > RING_MS) list.shift();
    ring.set(s.modelId, list);
  };

  const scrape = async (m: RunningModel, timeoutMs: number, record = false): Promise<EngineSample | null> => {
    if (!m.metricsUrl) return null;
    try {
      const r = await ctx.fetch(m.metricsUrl, { timeoutMs });
      if (!r.ok) {
        ctx.obs.count("scrape.http_error");
        return null;
      }
      const n = normalise(parseProm(await r.text()));
      const s: EngineSample = { ts: Date.now(), modelId: m.id, engine: n.engine ?? m.engine, counters: n.counters, gauges: n.gauges };
      if (record) push(s);
      return s;
    } catch {
      ctx.obs.count("scrape.failed");
      return null;
    }
  };

  const rates = (modelId: string): EngineRates | null => {
    const list = ring.get(modelId);
    const last = list?.[list.length - 1];
    if (!list || !last) return null;
    const first = list[0]!;
    const dt = (last.ts - first.ts) / 1000;
    const x = counterDeltas(first.counters, last.counters);
    const finished: Record<string, number> = {};
    for (const [k, v] of Object.entries(last.counters.requestsSuccess)) {
      const delta = v - (first.counters.requestsSuccess[k] ?? 0);
      if (delta > 0) finished[k] = delta;
    }
    const acc = div(x.specAccepted, x.specDrafts);
    const ttft = div(x.ttftSum, x.ttftCount);
    const queue = div(x.queueSum, x.queueCount);
    return {
      modelId,
      windowMs: last.ts - first.ts,
      prefixHitRate: div(x.prefixCacheHits, x.prefixCacheQueries) ?? (last.gauges.sglangCacheHitRate ?? null),
      prefillTps: div(x.promptTokensLocalCompute ?? x.promptTokens, x.prefillSum),
      decodeTps: div(x.genTokensHistSum, x.decodeSum),
      generationTpsWall: dt > 0 ? div(x.generationTokens, dt) : null,
      promptTpsWall: dt > 0 ? div(x.promptTokens, dt) : null,
      meanTtftMs: ttft === null ? null : ttft * 1000,
      meanQueueMs: queue === null ? null : queue * 1000,
      specAcceptLength: acc === null ? null : 1 + acc,
      kvCacheUsage: last.gauges.kvCacheUsage,
      running: last.gauges.running,
      waiting: last.gauges.waiting,
      finishedByReason: finished,
    };
  };

  const tick = async (models: RunningModel[]) => {
    const live = models.filter((m) => m.state === "ready" && m.metricsUrl);
    const ids = new Set(live.map((m) => m.id));
    for (const id of ring.keys()) if (!ids.has(id)) ring.delete(id);
    await Promise.all(
      live.map(async (m) => {
        if (!(await scrape(m, 2000, true))) return;
        const r = rates(m.id);
        if (r) ctx.bus.emit({ type: "engine", data: r });
      }),
    );
  };

  return {
    scrape,
    rates,
    allRates: () => [...ring.keys()].map(rates).filter((r): r is EngineRates => r !== null),
    tick,
  };
};
