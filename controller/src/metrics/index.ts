import type { Activity, ModelCardStats } from "@local-studio/contracts";
import type { Ctx, MetricsService, Module, Services } from "../context";
import { createAttribution } from "./attribution";
import { activity, card } from "./rollup";
import { metricsRoutes } from "./routes";
import { SCRAPE_EVERY_MS, createScraper } from "./scrape";
import { createStore } from "./store";
import { summarise } from "./summary";

export const emptyActivity = (): Activity => ({ start: "", today: 0, days: [], requests: 0, total: 0, week: 0, since: null, last: null });

export const createMetrics = (ctx: Ctx, svc: Services): Module<MetricsService> => {
  const store = createStore(ctx.db, ctx.config.tz, (e) => ctx.log.error(`db write: ${String(e)}`, "db.write"));
  const scraper = createScraper(ctx);
  const attribution = createAttribution(ctx, store, scraper, (id) => svc.runtime.model(id));
  ctx.obs.gauge("db.write_queue", store.queued);
  let cache: { at: number; activity: Activity; cards: ModelCardStats[] } | null = null;
  const fresh = () => {
    if (cache && Date.now() - cache.at < 2000) return cache;
    const t = performance.now();
    store.flush();
    const today = store.day(Date.now());
    cache = { at: Date.now(), activity: activity(ctx.db, ctx.identity.machineId, today), cards: svc.runtime.models().map((m) => card(ctx.db, m, store.day)) };
    ctx.obs.observe("rollup_ms", performance.now() - t);
    return cache;
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
    cards: () => fresh().cards,
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
      ];
    },
    stop() {
      for (const t of timers) clearInterval(t);
      store.flush();
    },
  };
};
