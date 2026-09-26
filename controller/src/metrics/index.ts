import type { Activity, ModelCardStats } from "@local-studio/contracts";
import type { Ctx, MetricsService, Module, Services } from "../context";
import { findModel, localModels, refreshDevModels } from "../gateway/route-model";
import { createAttribution } from "./attribution";
import { activity, card } from "./rollup";
import { metricsRoutes } from "./routes";
import { SCRAPE_EVERY_MS, createScraper } from "./scrape";
import { createStore } from "./store";
import { summarise } from "./summary";

export const emptyActivity = (): Activity => ({ start: "", today: 0, days: [], requests: 0, total: 0, week: 0, since: null, last: null });

export const createMetrics = (ctx: Ctx, svc: Services): Module<MetricsService> => {
  const store = createStore(ctx.db, ctx.config.tz);
  const scraper = createScraper(ctx, store);
  const attribution = createAttribution(ctx, store, scraper, (id) => findModel(svc, id));
  let cache: { at: number; activity: Activity; cards: ModelCardStats[] } | null = null;
  const fresh = () => {
    if (cache && Date.now() - cache.at < 2000) return cache;
    const today = store.day(Date.now());
    cache = {
      at: Date.now(),
      activity: activity(ctx.db, ctx.identity.machineId, today),
      cards: localModels(svc).map((m) => card(ctx.db, m, store.day)),
    };
    return cache;
  };
  const service: MetricsService = {
    begin: attribution.begin,
    preview: attribution.preview,
    finish: async (h, draft) => {
      const rec = await attribution.finish(h, draft);
      cache = null;
      return rec;
    },
    latest: (id) => scraper.latest(id),
    scrape: async (id) => {
      const m = findModel(svc, id);
      return m ? scraper.scrape(m, 2000) : null;
    },
    summary: (window, filter) => summarise(ctx.db, window, filter),
    recent: (limit, before) => store.recent(limit, before),
    engineRates: () => scraper.allRates(),
    activity: () => fresh().activity,
    cards: () => fresh().cards,
  };
  let scrapeTimer: ReturnType<typeof setInterval> | undefined;
  let pruneTimer: ReturnType<typeof setInterval> | undefined;
  let busy = false;
  return {
    service,
    routes: metricsRoutes(ctx.db, service, store, scraper),
    start() {
      store.prune();
      scrapeTimer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          if (process.env.LOCAL_STUDIO_DEV_UPSTREAM) await refreshDevModels(ctx);
          await scraper.tick(localModels(svc));
        } catch (e) {
          ctx.log.warn(`metrics scrape: ${String(e)}`);
        } finally {
          busy = false;
        }
      }, SCRAPE_EVERY_MS);
      pruneTimer = setInterval(() => {
        try {
          store.prune();
        } catch (e) {
          ctx.log.warn(`metrics prune: ${String(e)}`);
        }
      }, 3_600_000);
    },
    stop() {
      clearInterval(scrapeTimer);
      clearInterval(pruneTimer);
    },
  };
};
