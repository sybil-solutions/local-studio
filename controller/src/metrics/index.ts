import type { Activity, ModelCardStats, RequestRecord } from "@local-studio/contracts";
import type { Ctx, MetricsService, Module, Services } from "../context";
import { createAttribution } from "./attribution";
import { activity, card } from "./rollup";
import { metricsRoutes } from "./routes";
import { SCRAPE_EVERY_MS, createScraper } from "./scrape";
import { createStore } from "./store";
import { summarise } from "./summary";

const CARD_TTL_MS = 30_000;
const CARD_DIRTY_MS = 5_000;

export const createMetrics = (ctx: Ctx, svc: Services): Module<MetricsService> => {
  const store = createStore(ctx.db, ctx.config.tz, (e) => ctx.log.error(`db write: ${String(e)}`, "db.write"));
  const scraper = createScraper(ctx);
  const dirty = new Set<string>();
  const tracked = { ...store, insert: (rec: RequestRecord, cost: number | null) => (rec.modelId && dirty.add(rec.modelId), store.insert(rec, cost)) };
  const attribution = createAttribution(ctx, tracked, scraper, (id) => svc.runtime.model(id));
  ctx.obs.gauge("db.write_queue", store.queued);
  let cache: { at: number; activity: Activity } | null = null;
  const cardCache = new Map<string, { at: number; key: string; card: ModelCardStats }>();
  const fresh = () => {
    if (cache && Date.now() - cache.at < 2000) return cache;
    const t = performance.now();
    store.flush();
    cache = { at: Date.now(), activity: activity(ctx.db, ctx.identity.machineId, store.day(Date.now())) };
    ctx.obs.observe("rollup_ms", performance.now() - t);
    return cache;
  };
  const cards = (): ModelCardStats[] => {
    const now = Date.now();
    const models = svc.runtime.models();
    const ids = new Set(models.map((m) => m.id));
    for (const id of cardCache.keys()) if (!ids.has(id)) cardCache.delete(id);
    return models.map((m) => {
      const key = `${m.startedAt}|${m.primaryModel}|${m.servedModels.join(",")}`;
      const hit = cardCache.get(m.id);
      if (hit && hit.key === key && now - hit.at < (dirty.has(m.id) ? CARD_DIRTY_MS : CARD_TTL_MS)) return hit.card;
      dirty.delete(m.id);
      const t = performance.now();
      const c = card(ctx.db, m, ctx.identity.machineId, store.day);
      ctx.obs.observe("card_ms", performance.now() - t);
      cardCache.set(m.id, { at: now, key, card: c });
      return c;
    });
  };
  const service: MetricsService = {
    begin: attribution.begin,
    preview: attribution.preview,
    finish: attribution.finish,
    summary: (window, filter) => {
      store.flush();
      return summarise(ctx.db, window, filter);
    },
    recent: (limit, before) => store.recent(limit, before),
    engineRates: () => scraper.allRates(),
    activity: () => fresh().activity,
    cards,
  };
  let timers: ReturnType<typeof setInterval>[] = [];
  let busy = false;
  const housekeep = () => {
    try {
      const t = performance.now();
      store.prune();
      ctx.obs.observe("db.prune_ms", performance.now() - t);
    } catch (e) {
      ctx.log.warn(`db prune: ${String(e)}`, "db.prune");
    }
  };
  const sampleGpus = () => {
    try {
      const gs = svc.runtime.view().gpus;
      if (!gs.length) return;
      const known = <K extends "utilPct" | "memUsedMiB" | "powerW" | "tempC">(k: K) => gs.map((g) => g[k]).filter((x): x is number => x !== null);
      const util = known("utilPct");
      const mem = known("memUsedMiB");
      const power = known("powerW");
      const temp = known("tempC");
      ctx.db
        .query("INSERT OR REPLACE INTO gpu_samples VALUES (?, ?, ?, ?, ?, ?)")
        .run(
          Math.floor(Date.now() / 60_000) * 60_000,
          util.length ? util.reduce((t, x) => t + x, 0) / util.length : null,
          mem.length === gs.length ? mem.reduce((t, x) => t + x, 0) : null,
          gs.reduce((t, g) => t + g.memTotalMiB, 0),
          power.length ? power.reduce((t, x) => t + x, 0) : null,
          temp.length ? Math.max(...temp) : null,
        );
    } catch (e) {
      ctx.log.warn(`gpu sample: ${String(e)}`, "gpu.sample");
    }
  };
  return {
    service,
    routes: metricsRoutes(ctx.db, service, store),
    start() {
      housekeep();
      timers = [
        setInterval(async () => {
          if (busy) return ctx.obs.count("scrape.skipped_busy");
          busy = true;
          const t = performance.now();
          try {
            await scraper.tick(svc.runtime.models());
          } catch (e) {
            ctx.log.warn(`metrics scrape: ${String(e)}`, "scrape");
          } finally {
            ctx.obs.observe("scrape_ms", performance.now() - t);
            busy = false;
          }
        }, SCRAPE_EVERY_MS),
        setInterval(housekeep, 3_600_000),
        setInterval(sampleGpus, 60_000),
      ];
    },
    stop() {
      for (const t of timers) clearInterval(t);
      store.flush();
    },
  };
};
