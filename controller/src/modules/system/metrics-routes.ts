import { performance } from "node:perf_hooks";
import { Effect, Schema } from "effect";
import { findObservedInferenceProcess } from "../../core/function-observability";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { effectHandler } from "../../http/effect-handler";
import { badRequest, serviceUnavailable } from "../../core/errors";
import type { AppContext } from "../../app-context";
import { getGpuInfo } from "./platform/gpu";
import { fetchInference } from "../../http/local-fetch";
import type { UsageAggregate } from "../../stores/inference-request-store";
import {
  SGLANG_METRIC_NAMES,
  VLLM_METRIC_NAMES,
  scrapeEngineMetrics,
} from "./engine-metrics-scrape";
import { firstMetric, positiveOrUndefined } from "./metrics-peaks";

const throughputSamples = new Map<
  string,
  { promptTokens: number; genTokens: number; ts: number; promptTps: number; genTps: number }
>();
const MIN_RATE_INTERVAL_MS = 1500;
const BenchmarkQuerySchema = Schema.Struct({
  prompt_tokens: Schema.optionalKey(
    Schema.FiniteFromString.pipe(
      Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100_000 })),
    ),
  ),
});
const BenchmarkResponseSchema = Schema.Struct({
  usage: Schema.optionalKey(
    Schema.Struct({
      prompt_tokens: Schema.optionalKey(Schema.Number),
      completion_tokens: Schema.optionalKey(Schema.Number),
    }),
  ),
});

const buildModelKeys = (modelId: string, modelPath: string | null | undefined): Set<string> => {
  const keys = new Set<string>([modelId]);
  if (modelPath) {
    keys.add(modelPath);
    keys.add(modelPath.split("/").pop() ?? modelPath);
  }
  return keys;
};

const buildCurrentMetrics = (
  context: AppContext,
): Effect.Effect<Record<string, unknown>, unknown> =>
  Effect.gen(function* () {
    const current = yield* findObservedInferenceProcess(context, "metrics.current");
    const gpus = yield* getGpuInfo();
    const lifetimeData = yield* context.stores.lifetimeMetricsStore.getAllEffect();
    const currentPowerWatts = gpus.reduce((sum, gpu) => sum + gpu.power_draw, 0);
    const vramUsedGb = gpus.reduce((sum, gpu) => sum + gpu.memory_used_mb / 1024, 0);
    const vramCapacityGb = gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb / 1024, 0);
    const powerLimitWatts = gpus.reduce((sum, gpu) => sum + gpu.power_limit, 0);
    const baseMetrics: Record<string, unknown> = {
      lifetime_prompt_tokens: lifetimeData["prompt_tokens_total"] ?? 0,
      lifetime_completion_tokens: lifetimeData["completion_tokens_total"] ?? 0,
      lifetime_requests: lifetimeData["requests_total"] ?? 0,
      lifetime_energy_kwh: (lifetimeData["energy_wh"] ?? 0) / 1000,
      lifetime_uptime_hours: (lifetimeData["uptime_seconds"] ?? 0) / 3600,
      current_power_watts: currentPowerWatts,
      vram_used_gb: Math.round(vramUsedGb * 10) / 10,
      vram_capacity_gb: Math.round(vramCapacityGb * 10) / 10,
      power_limit_watts: Math.round(powerLimitWatts),
    };

    const scrape = yield* scrapeEngineMetrics(context.config.inference_port, 1500);
    const engineActive = scrape.hasVllm || scrape.hasSglang;

    if (!current && !engineActive) {
      return {
        ...baseMetrics,
        model_id: null,
        model_path: null,
        served_model_name: null,
      };
    }

    const isSglang = current?.backend === "sglang" || (!current && scrape.hasSglang);
    const modelId =
      current?.served_model_name ??
      current?.model_path?.split("/").pop() ??
      scrape.modelName ??
      "active";
    const prometheus = scrape.metrics;
    const names = isSglang ? SGLANG_METRIC_NAMES : VLLM_METRIC_NAMES;
    const usageAggregate: UsageAggregate | null =
      yield* context.stores.inferenceRequestStore.aggregateEffect(
        buildModelKeys(modelId, current?.model_path),
      );
    const usageTotals = usageAggregate?.totals;
    const promptTokensTotal = firstMetric(prometheus, names.promptTokens);
    const generationTokensTotal = firstMetric(prometheus, names.generationTokens);

    let promptThroughput = isSglang ? firstMetric(prometheus, names.promptThroughput) : 0;
    let generationThroughput = isSglang ? firstMetric(prometheus, names.generationThroughput) : 0;
    if (!isSglang) {
      const nowMs = Date.now();
      const previous = throughputSamples.get(modelId);
      if (previous && nowMs - previous.ts >= MIN_RATE_INTERVAL_MS) {
        const elapsedSeconds = (nowMs - previous.ts) / 1000;
        promptThroughput = Math.max(
          0,
          (promptTokensTotal - previous.promptTokens) / elapsedSeconds,
        );
        generationThroughput = Math.max(
          0,
          (generationTokensTotal - previous.genTokens) / elapsedSeconds,
        );
        throughputSamples.set(modelId, {
          promptTokens: promptTokensTotal,
          genTokens: generationTokensTotal,
          ts: nowMs,
          promptTps: promptThroughput,
          genTps: generationThroughput,
        });
      } else if (previous) {
        promptThroughput = previous.promptTps;
        generationThroughput = previous.genTps;
      } else {
        throughputSamples.set(modelId, {
          promptTokens: promptTokensTotal,
          genTokens: generationTokensTotal,
          ts: nowMs,
          promptTps: 0,
          genTps: 0,
        });
      }
    }
    const ttftCount = prometheus[names.ttftCount] ?? 0;
    const avgTtftMs = ttftCount > 0 ? ((prometheus[names.ttftSum] ?? 0) / ttftCount) * 1000 : 0;
    const peakData = yield* context.stores.peakMetricsStore.getEffect(modelId);
    const bestSessionPeakData =
      yield* context.stores.peakMetricsStore.getBestSessionEffect(modelId);

    return {
      ...baseMetrics,
      model_id: modelId,
      model_path: current?.model_path ?? null,
      served_model_name: current?.served_model_name ?? scrape.modelName ?? null,
      running_requests: firstMetric(prometheus, names.runningRequests),
      pending_requests: firstMetric(prometheus, names.pendingRequests),
      kv_cache_usage: firstMetric(prometheus, names.kvCacheUsage),
      prompt_tokens_total:
        positiveOrUndefined(promptTokensTotal) ?? positiveOrUndefined(usageTotals?.prompt_tokens),
      generation_tokens_total:
        positiveOrUndefined(generationTokensTotal) ??
        positiveOrUndefined(usageTotals?.completion_tokens),
      total_tokens: positiveOrUndefined(usageTotals?.total_tokens),
      total_requests: positiveOrUndefined(usageTotals?.total_requests),
      prompt_throughput: promptThroughput,
      generation_throughput: generationThroughput,
      avg_ttft_ms: avgTtftMs > 0 ? Math.round(avgTtftMs * 10) / 10 : usageAggregate?.ttft?.avg_ms,
      latency_avg: positiveOrUndefined(usageAggregate?.latency?.avg_ms),
      best_session_peak_id: bestSessionPeakData?.["session_id"] ?? null,
      best_session_prefill_tps: bestSessionPeakData?.["peak_prefill_tps"] ?? null,
      best_session_generation_tps: bestSessionPeakData?.["peak_generation_tps"] ?? null,
      best_session_ttft_ms: bestSessionPeakData?.["best_ttft_ms"] ?? null,
      peak_prefill_tps: peakData?.["prefill_tps"] ?? null,
      peak_generation_tps: peakData?.["generation_tps"] ?? null,
      peak_ttft_ms: peakData?.["ttft_ms"] ?? null,
    };
  });

const PEAK_METRICS_CACHE_TTL_MS = 15_000;

export const registerMonitoringRoutes = defineRoutes((app, context) => {
  type PeakMetricsBody = Record<string, unknown> | { metrics: Array<Record<string, unknown>> };
  const peakMetricsCache = new Map<string, { at: number; body: PeakMetricsBody }>();

  return mergeRoutes(
    app.get(
      "/v1/metrics/vllm",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const current = yield* buildCurrentMetrics(context).pipe(
            Effect.tap((metrics) => context.eventManager.publishMetrics(metrics)),
            Effect.catch((error) => {
              context.logger.warn(`Failed to build current metrics: ${(error as Error).message}`);
              const latest = context.eventManager.getLatestMetrics();
              return Object.keys(latest).length > 0 ? Effect.succeed(latest) : Effect.fail(error);
            }),
          );
          return ctx.json(current);
        }),
      ),
    ),

    app.get(
      "/peak-metrics",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const modelId = ctx.req.query("model_id");
          const cacheKey = modelId ?? "\u0000all";
          const cached = peakMetricsCache.get(cacheKey);
          if (cached && Date.now() - cached.at < PEAK_METRICS_CACHE_TTL_MS) {
            return ctx.json(cached.body);
          }
          const body = yield* modelId
            ? context.stores.peakMetricsStore
                .getEffect(modelId)
                .pipe(Effect.map((metrics) => metrics ?? { error: "No metrics for this model" }))
            : context.stores.peakMetricsStore
                .getAllEffect()
                .pipe(Effect.map((metrics) => ({ metrics })));
          peakMetricsCache.set(cacheKey, { at: Date.now(), body });
          return ctx.json(body);
        }),
      ),
    ),

    app.post(
      "/benchmark",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const promptTokensRaw = ctx.req.query("prompt_tokens");
          const query = yield* Schema.decodeUnknownEffect(BenchmarkQuerySchema)(
            promptTokensRaw === undefined ? {} : { prompt_tokens: promptTokensRaw },
          ).pipe(Effect.mapError(() => badRequest("Invalid benchmark query")));
          const promptTokens = query.prompt_tokens ?? 1000;
          const current = yield* findObservedInferenceProcess(context, "benchmark");
          if (!current) {
            return ctx.json({ error: "No model running" });
          }
          const modelId =
            current.served_model_name ?? current.model_path?.split("/").pop() ?? "unknown";
          const prompt = `Please count: ${Array.from({ length: Math.floor(promptTokens / 2) })
            .map((_, index) => index.toString())
            .join(" ")}`;

          const start = performance.now();
          const response = yield* fetchInference(context, "/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: modelId,
              messages: [{ role: "user", content: prompt }],
              stream: false,
            }),
          }).pipe(Effect.mapError(() => serviceUnavailable("Benchmark request failed")));
          const totalTime = (performance.now() - start) / 1000;
          if (!response.ok) {
            return ctx.json({ error: `Request failed: ${response.status}` });
          }
          const data = yield* Effect.tryPromise({
            try: () => response.json(),
            catch: (error) => error,
          }).pipe(
            Effect.flatMap((value) => Schema.decodeUnknownEffect(BenchmarkResponseSchema)(value)),
            Effect.mapError(() => serviceUnavailable("Invalid benchmark response")),
          );
          const usage = data.usage ?? {};
          const promptTokensActual = usage["prompt_tokens"] ?? 0;
          const completionTokens = usage["completion_tokens"] ?? 0;

          if (completionTokens > 0 && promptTokensActual > 0) {
            const generationTps = completionTokens / totalTime;

            const result = yield* context.stores.peakMetricsStore
              .updateIfBetterEffect(modelId, undefined, generationTps, undefined)
              .pipe(
                Effect.tap(() =>
                  context.stores.peakMetricsStore.addTokensEffect(modelId, completionTokens, 1),
                ),
              );

            return ctx.json({
              success: true,
              model_id: modelId,
              benchmark: {
                prompt_tokens: promptTokensActual,
                completion_tokens: completionTokens,
                total_time_s: Math.round(totalTime * 100) / 100,
                generation_tps: Math.round(generationTps * 10) / 10,
              },
              peak_metrics: result,
            });
          }
          return ctx.json({ error: "No tokens in response" });
        }),
      ),
    ),
  );
});
