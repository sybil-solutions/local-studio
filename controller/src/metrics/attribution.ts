import type { EngineSample, RequestRecord, RunningModel } from "@local-studio/contracts";
import { costUsd, decodeTps, prefillTps, promptTotal } from "@local-studio/contracts";
import type { Ctx, FinishDraft, RequestHandle } from "../context";
import type { Scraper } from "./scrape";
import { counterDeltas, successTotal } from "./scrape";
import type { Store } from "./store";

interface Pending {
  modelId: string;
  exclusive: boolean;
  reasons: string[];
  before: EngineSample | null;
  ready: Promise<void>;
  settling: boolean;
  handoff: Promise<EngineSample | null> | null;
}


const msOf = (s: number | null): number | null => (s === null ? null : Math.round(s * 1000));

export interface Attribution {
  begin(modelId: string | null, tsStart: number): Promise<RequestHandle>;
  preview(h: RequestHandle, draft: FinishDraft): RequestRecord;
  finish(h: RequestHandle, draft: FinishDraft): Promise<RequestRecord>;
}

const cacheKnown = (r: RequestRecord): boolean => r.cacheSource !== null;

export const baseRecord = (h: RequestHandle, draft: FinishDraft): RequestRecord => {
  const { cachedReported = false, ...base } = draft;
  const rec: RequestRecord = { ...base, id: h.id, cacheSource: cachedReported ? "engine" : null, engineQueueMs: null, enginePrefillMs: null, engineDecodeMs: null };
  return cacheKnown(rec) ? rec : { ...rec, prefillTps: null };
}

export const createAttribution = (ctx: Ctx, store: Store, scraper: Scraper, find: (id: string) => RunningModel | undefined): Attribution => {
  const inflight = new Map<string, Set<Pending>>();
  const pending = new Map<string, Pending>();

  const begin = async (modelId: string | null, tsStart: number): Promise<RequestHandle> => {
    const h: RequestHandle = { id: `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`, modelId, tsStart };
    if (!modelId) return h;
    const set = inflight.get(modelId) ?? new Set<Pending>();
    inflight.set(modelId, set);
    const active = [...set].filter((o) => !o.settling);
    const settling = [...set].filter((o) => o.settling);
    const p: Pending = { modelId, exclusive: active.length === 0, reasons: [], before: null, ready: Promise.resolve(), settling: false, handoff: null };
    if (!p.exclusive) {
      p.reasons.push("concurrent gateway request");
      for (const o of active) {
        if (o.exclusive) o.reasons.push("concurrent gateway request");
        o.exclusive = false;
      }
    }
    set.add(p);
    pending.set(h.id, p);
    const m = find(modelId);
    if (p.exclusive && m?.metricsUrl) {
      const sample = scraper.scrape(m, 250);
      for (const o of settling) o.handoff ??= sample;
      p.ready = (async () => {
        p.before = await sample;
        if (!p.before) {
          p.exclusive = false;
          p.reasons.push("before scrape failed");
        } else if ((p.before.gauges.running ?? 0) !== 0 || (p.before.gauges.waiting ?? 0) !== 0) {
          p.exclusive = false;
          p.reasons.push(`engine busy before (running=${p.before.gauges.running} waiting=${p.before.gauges.waiting})`);
        }
      })();
      await p.ready;
    } else if (p.exclusive) {
      p.exclusive = false;
      p.reasons.push("no metrics endpoint");
    }
    return h;
  };

  const release = (h: RequestHandle, p: Pending | undefined) => {
    pending.delete(h.id);
    if (!p) return;
    const set = inflight.get(p.modelId);
    set?.delete(p);
    if (set && set.size === 0) inflight.delete(p.modelId);
  };

  const blendedCost = (rec: RequestRecord): number | null => {
    const price = store.price(rec.model);
    if (cacheKnown(rec) || rec.via !== "local" || !price) return costUsd(rec, price);
    if (rec.usageSource === "none" || rec.promptTotal === 0) return costUsd(rec, price);
    const hit = rec.modelId ? scraper.rates(rec.modelId)?.prefixHitRate ?? null : null;
    if (hit === null) return null;
    const cacheRead = Math.round(rec.promptTotal * Math.min(1, Math.max(0, hit)));
    return costUsd({ ...rec, cacheRead, cacheWrite: 0, inputUncached: rec.promptTotal - cacheRead }, price);
  };

  const finish = async (h: RequestHandle, draft: FinishDraft): Promise<RequestRecord> => {
    const cachedReported = draft.cachedReported ?? false;
    const p = pending.get(h.id);
    if (p) p.settling = true;
    let rec = baseRecord(h, draft);
    try {
      if (p) await p.ready;
      const m = p ? find(p.modelId) : undefined;
      if (p?.before && m) {
        let after: EngineSample | null = null;
        await Bun.sleep(60);
        const beforeSuccess = successTotal(p.before.counters);
        const aborted = rec.errorCode === "ABORTED";
        const settled = (a: EngineSample): boolean => {
          if (aborted) return (a.gauges.running ?? 0) === 0 && (a.gauges.waiting ?? 0) === 0;
          if (beforeSuccess !== null) return (successTotal(a.counters) ?? 0) >= beforeSuccess + 1;
          const dl = counterDeltas(p.before!.counters, a.counters);
          return (a.gauges.running ?? 0) === 0 && ((dl.generationTokens ?? 0) > 0 || (dl.promptTokens ?? 0) > 0);
        };
        for (let i = 0; i < 4; i++) {
          const handed = p.handoff;
          after = handed ? await handed : await scraper.scrape(m, 250);
          if (handed || (after && settled(after))) break;
          await Bun.sleep(100);
          if (p.handoff) {
            after = await p.handoff;
            break;
          }
        }
        rec = attribute(rec, p, after, cachedReported);
      } else if (p) store.check(rec.id, null, null, null, { exclusive: false, reasons: p.reasons });
    } catch (e) {
      ctx.log.warn(`metrics attribution ${h.id}: ${String(e)}`, "metrics.attribution");
    } finally {
      release(h, p);
    }
    const cost = blendedCost(rec);
    store.insert(rec, cost);
    ctx.obs.count(`requests.${rec.errorCode ?? "ok"}`);
    ctx.bus.emit({ type: "request", data: rec });
    return rec;
  };

  const attribute = (rec: RequestRecord, p: Pending, after: EngineSample | null, cachedReported: boolean): RequestRecord => {
    const before = p.before!;
    if (!after) {
      store.check(rec.id, before, null, null, { exclusive: false, reasons: [...p.reasons, "after scrape failed"] });
      return rec;
    }
    const dl = counterDeltas(before.counters, after.counters);
    const reasons = [...p.reasons];
    const usageReported = rec.usageSource === "engine";
    if (rec.errorCode === "ABORTED") {
      if ((dl.requestsSuccess ?? 0) > 1) reasons.push(`engine finished ${dl.requestsSuccess} requests in the window`);
      if ((after.gauges.running ?? 0) !== 0 || (after.gauges.waiting ?? 0) !== 0) reasons.push("engine still busy after the aborted request");
    } else if (dl.requestsSuccess !== null) {
      if (dl.requestsSuccess !== 1) reasons.push(`engine finished ${dl.requestsSuccess} requests in the window`);
    } else {
      if ((after.gauges.running ?? 0) !== 0 || (after.gauges.waiting ?? 0) !== 0) reasons.push("engine still busy after the request");
      if (!usageReported) reasons.push("engine has no request counter and no usage to match");
      else if (dl.generationTokens !== rec.output) reasons.push(`output mismatch usage=${rec.output} engine=${dl.generationTokens}`);
    }
    if (usageReported && dl.promptTokens !== rec.promptTotal) reasons.push(`prompt mismatch usage=${rec.promptTotal} engine=${dl.promptTokens}`);
    const exclusive = p.exclusive && reasons.length === 0;
    let out = rec;
    if (exclusive) {
      out = { ...rec, engineQueueMs: msOf(dl.queueSum), enginePrefillMs: msOf(dl.prefillSum), engineDecodeMs: msOf(dl.decodeSum) };
      if (!usageReported && dl.promptTokens !== null && dl.generationTokens !== null) {
        const cacheRead = dl.promptTokensCached ?? 0;
        out = {
          ...out,
          cacheRead,
          cacheWrite: 0,
          inputUncached: Math.max(0, dl.promptTokens - cacheRead),
          output: dl.generationTokens,
          usageSource: "metrics",
          cacheSource: dl.promptTokensCached === null ? null : "metrics",
          decodeTps: decodeTps(dl.generationTokens, out.decodeMs),
        };
      } else if (!cachedReported && dl.promptTokensCached !== null) {
        const cacheRead = Math.min(dl.promptTokensCached, out.promptTotal);
        out = { ...out, cacheRead, inputUncached: Math.max(0, out.promptTotal - cacheRead - out.cacheWrite), usageSource: "engine+metrics", cacheSource: "metrics" };
      }
      const pt = promptTotal(out);
      out = { ...out, promptTotal: pt, total: pt + out.output, prefillTps: cacheKnown(out) ? prefillTps(out.inputUncached, out.ttftMs) : null };
    }
    const engineTtftMs = dl.ttftCount && dl.ttftCount > 0 && dl.ttftSum !== null ? (dl.ttftSum / dl.ttftCount) * 1000 : null;
    const agreement = {
      exclusive,
      reasons,
      prompt: { usage: rec.promptTotal, engine: dl.promptTokens, ok: dl.promptTokens === rec.promptTotal },
      output: { usage: rec.output, engine: dl.generationTokens, ok: dl.generationTokens === rec.output },
      cached: { usage: cachedReported ? rec.cacheRead : null, engine: dl.promptTokensCached, recorded: out.cacheRead, cacheSource: out.cacheSource, ok: !cachedReported || dl.promptTokensCached === rec.cacheRead },
      ttftVsEngine: {
        gatewayTtftMs: rec.ttftMs,
        engineTtftMs,
        engineQueueMs: out.engineQueueMs,
        enginePrefillMs: out.enginePrefillMs,
        prefillWithinTtft: out.enginePrefillMs === null || rec.ttftMs === null ? null : out.enginePrefillMs <= rec.ttftMs,
        enginePrefillTps: out.enginePrefillMs ? out.inputUncached / (out.enginePrefillMs / 1000) : null,
      },
      decodeVsEngine: {
        gatewayDecodeMs: rec.decodeMs,
        engineDecodeMs: out.engineDecodeMs,
        ratio: rec.decodeMs && out.engineDecodeMs ? out.engineDecodeMs / rec.decodeMs : null,
        engineDecodeTps: out.engineDecodeMs && dl.genTokensHistSum !== null ? dl.genTokensHistSum / (out.engineDecodeMs / 1000) : null,
        gatewayDecodeTps: rec.decodeTps,
      },
    };
    const disagree = p.exclusive && (dl.requestsSuccess === 1 || dl.requestsSuccess === null) && (!agreement.prompt.ok || !agreement.output.ok || !agreement.cached.ok);
    if (disagree)
      ctx.log.warn(
        `metrics disagreement ${rec.id} ${rec.model}: prompt ${rec.promptTotal}/${dl.promptTokens} output ${rec.output}/${dl.generationTokens} cached ${agreement.cached.usage}/${dl.promptTokensCached}`,
      );
    store.check(rec.id, before, after, dl, agreement);
    return out;
  };

  return { begin, preview: baseRecord, finish };
};
