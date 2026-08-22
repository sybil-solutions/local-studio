import type { AppContext } from "../../app-context";
import { Effect, Schedule } from "effect";
import { getGpuInfo } from "./platform/gpu";
import { getSystemRuntimeInfo } from "../engines/runtimes/runtime-info";
import type { UsageAggregate } from "../../stores/inference-request-store";
import {
  SGLANG_METRIC_NAMES,
  LLAMACPP_METRIC_NAMES,
  VLLM_METRIC_NAMES,
  scrapeEngineMetrics,
} from "./engine-metrics-scrape";
import {
  bumpBestLower,
  bumpPeak,
  emptyPeaks,
  firstMetric,
  gpuFields,
  lifetimeFields,
  peakFields,
  positiveOrUndefined,
  rollupGpus,
  tokenTotalFields,
  type SessionPeaks,
} from "./metrics-peaks";

const METRICS_HTTP_TIMEOUT_MS = 5_000;
const METRICS_RUNTIME_SUMMARY_INTERVAL_MS = 30_000;
const METRICS_COLLECT_INTERVAL_MS = 5_000;
const METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS = 5;

export const startMetricsCollector = (context: AppContext): Effect.Effect<never> => {
  let lastVllmMetrics: Record<string, number> = {};
  let lastMetricsTime = 0;
  let lastRuntimeSummaryAt = 0;
  let sessionModelId: string | null = null;
  let sessionPeakId: string | null = null;
  let sessionPeaks: SessionPeaks = emptyPeaks();
  let metricsUnavailableUntil = 0;

  const scrapeVllmMetrics = (port: number): Effect.Effect<Record<string, number>> =>
    Effect.gen(function* () {
      if (Date.now() < metricsUnavailableUntil) return {};
      const scrape = yield* scrapeEngineMetrics(port, METRICS_HTTP_TIMEOUT_MS);
      if (scrape.status === 404) metricsUnavailableUntil = Date.now() + 60_000;
      else if (scrape.status === 200) metricsUnavailableUntil = 0;
      return scrape.metrics;
    });

  const collect = Effect.gen(function* () {
    const current = yield* context.bridge.findInferenceProcess();
    const gpuList = yield* getGpuInfo();

    const lifetimeStore = context.stores.lifetimeMetricsStore;
    const gpuTotals = rollupGpus(gpuList);
    const totalPowerWatts = gpuTotals.powerWatts;
    const energyWh = totalPowerWatts * (5 / 3600);
    yield* lifetimeStore.incrementEffect("energy_wh", energyWh);
    yield* lifetimeStore.incrementEffect(
      "uptime_seconds",
      METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS,
    );

    yield* context.eventManager.publishStatus({
      running: Boolean(current),
      process: current,
      inference_port: context.config.inference_port,
      launching: context.bridge.launchingRecipeId(),
    });
    yield* context.eventManager.publishGpu(gpuList.map((gpu) => ({ ...gpu })));

    if (Date.now() - lastRuntimeSummaryAt > METRICS_RUNTIME_SUMMARY_INTERVAL_MS) {
      yield* getSystemRuntimeInfo(context.config).pipe(
        Effect.flatMap((runtime) => {
          const leaseHolder = current
            ? (current.served_model_name ?? current.model_path?.split("/").pop() ?? "inference")
            : null;
          return context.eventManager
            .publishRuntimeSummary({
              platform: runtime.platform,
              gpu_monitoring: runtime.gpu_monitoring,
              backends: runtime.backends,
              lease: { holder: leaseHolder, since: leaseHolder ? new Date().toISOString() : null },
            })
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  lastRuntimeSummaryAt = Date.now();
                }),
              ),
            );
        }),
        Effect.catch((error) =>
          Effect.sync(() => {
            context.logger.debug("Runtime summary publish failed", { error: String(error) });
          }),
        ),
      );
    }

    const lifetimeData = yield* lifetimeStore.getAllEffect();
    const baseMetrics = {
      ...lifetimeFields(lifetimeData, totalPowerWatts),
      kwh_per_million_input: lifetimeData["prompt_tokens_total"]
        ? (lifetimeData["energy_wh"] ?? 0) /
          1000 /
          ((lifetimeData["prompt_tokens_total"] ?? 1) / 1_000_000)
        : null,
      kwh_per_million_output: lifetimeData["completion_tokens_total"]
        ? (lifetimeData["energy_wh"] ?? 0) /
          1000 /
          ((lifetimeData["completion_tokens_total"] ?? 1) / 1_000_000)
        : null,
    };

    if (current) {
      const modelId =
        current.served_model_name ?? current.model_path?.split("/").pop() ?? "unknown";

      if (sessionModelId !== modelId) {
        sessionModelId = modelId;
        sessionPeakId = `${modelId}:${Date.now()}`;
        sessionPeaks = emptyPeaks();
        metricsUnavailableUntil = 0;
      }

      let promptThroughput = 0;
      let generationThroughput = 0;
      let runningRequests = 0;
      let pendingRequests = 0;
      let kvCacheUsage = 0;
      let promptTokensTotal = 0;
      let generationTokensTotal = 0;
      let avgTtftMs = 0;

      if (
        current.backend === "vllm" ||
        current.backend === "sglang" ||
        current.backend === "llamacpp"
      ) {
        const vllmMetrics = yield* scrapeVllmMetrics(context.config.inference_port);
        const now = Date.now() / 1000;
        const elapsed =
          lastMetricsTime > 0 ? now - lastMetricsTime : METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS;
        const names =
          current.backend === "sglang"
            ? SGLANG_METRIC_NAMES
            : current.backend === "llamacpp"
              ? LLAMACPP_METRIC_NAMES
              : VLLM_METRIC_NAMES;
        if (
          elapsed > 0 &&
          Object.keys(vllmMetrics).length > 0 &&
          Object.keys(lastVllmMetrics).length > 0
        ) {
          const previousPromptTokens = firstMetric(lastVllmMetrics, names.promptTokens);
          const currentPromptTokens = firstMetric(vllmMetrics, names.promptTokens);
          const previousGenerationTokens = firstMetric(lastVllmMetrics, names.generationTokens);
          const currentGenerationTokens = firstMetric(vllmMetrics, names.generationTokens);
          if (currentPromptTokens > previousPromptTokens) {
            promptThroughput = (currentPromptTokens - previousPromptTokens) / elapsed;
          }
          if (currentGenerationTokens > previousGenerationTokens) {
            generationThroughput = (currentGenerationTokens - previousGenerationTokens) / elapsed;
          }
        }

        promptThroughput = firstMetric(vllmMetrics, names.promptThroughput) || promptThroughput;
        generationThroughput =
          firstMetric(vllmMetrics, names.generationThroughput) || generationThroughput;

        runningRequests = firstMetric(vllmMetrics, names.runningRequests);
        pendingRequests = firstMetric(vllmMetrics, names.pendingRequests);
        kvCacheUsage = firstMetric(vllmMetrics, names.kvCacheUsage);
        promptTokensTotal = firstMetric(vllmMetrics, names.promptTokens);
        generationTokensTotal = firstMetric(vllmMetrics, names.generationTokens);

        const previousTtftSum = lastVllmMetrics[names.ttftSum] ?? 0;
        const previousTtftCount = lastVllmMetrics[names.ttftCount] ?? 0;
        const currentTtftSum = vllmMetrics[names.ttftSum] ?? 0;
        const currentTtftCount = vllmMetrics[names.ttftCount] ?? 0;
        const dTtftCount = currentTtftCount - previousTtftCount;
        if (dTtftCount > 0) {
          avgTtftMs = ((currentTtftSum - previousTtftSum) / dTtftCount) * 1000;
        }

        lastVllmMetrics = vllmMetrics;
        lastMetricsTime = now;

        if (promptThroughput > 0 || generationThroughput > 0 || avgTtftMs > 0) {
          yield* context.stores.peakMetricsStore.updateIfBetterEffect(
            modelId,
            promptThroughput > 0 ? promptThroughput : undefined,
            generationThroughput > 0 ? generationThroughput : undefined,
            avgTtftMs > 0 ? avgTtftMs : undefined,
          );
        }
      } else {
        lastVllmMetrics = {};
        lastMetricsTime = 0;
      }

      bumpPeak(sessionPeaks, "prompt_throughput", promptThroughput);
      bumpPeak(sessionPeaks, "generation_throughput", generationThroughput);
      bumpBestLower(sessionPeaks, "ttft_ms", avgTtftMs);
      bumpPeak(sessionPeaks, "kv_cache_usage", kvCacheUsage);
      bumpPeak(sessionPeaks, "running_requests", runningRequests);
      bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
      bumpPeak(sessionPeaks, "vram_used_gb", gpuTotals.vramUsedGb);

      if (sessionPeakId) {
        yield* context.stores.peakMetricsStore.updateSessionPeakEffect(
          sessionPeakId,
          modelId,
          sessionPeaks.prompt_throughput > 0 ? sessionPeaks.prompt_throughput : undefined,
          sessionPeaks.generation_throughput > 0 ? sessionPeaks.generation_throughput : undefined,
          sessionPeaks.ttft_ms > 0 ? sessionPeaks.ttft_ms : undefined,
        );
      }

      const peakData = yield* context.stores.peakMetricsStore.getEffect(modelId);
      const sessionPeakData = sessionPeakId
        ? yield* context.stores.peakMetricsStore.getSessionEffect(sessionPeakId)
        : null;
      const bestSessionPeakData =
        yield* context.stores.peakMetricsStore.getBestSessionEffect(modelId);
      const usageAggregate: UsageAggregate | null =
        yield* context.stores.inferenceRequestStore.aggregateEffect(new Set([modelId]));
      const usageTotals = usageAggregate?.totals;
      const usageLatencyAvg = positiveOrUndefined(usageAggregate?.latency?.avg_ms);
      const usageTtftAvg = positiveOrUndefined(usageAggregate?.ttft?.avg_ms);
      const avgTtftDisplay = avgTtftMs > 0 ? Math.round(avgTtftMs * 10) / 10 : (usageTtftAvg ?? 0);

      yield* context.eventManager.publishMetrics({
        ...baseMetrics,
        model_id: modelId,
        model_path: current.model_path ?? null,
        served_model_name: current.served_model_name ?? null,
        running_requests: runningRequests,
        pending_requests: pendingRequests,
        kv_cache_usage: kvCacheUsage,
        ...tokenTotalFields(usageTotals, promptTokensTotal, generationTokensTotal),
        prompt_throughput: Math.round(promptThroughput * 10) / 10,
        generation_throughput: Math.round(generationThroughput * 10) / 10,
        avg_ttft_ms: avgTtftDisplay,
        latency_avg: usageLatencyAvg,
        ...gpuFields(gpuTotals),
        session_peak_prompt_throughput: Math.round(sessionPeaks.prompt_throughput * 10) / 10,
        session_peak_generation_throughput:
          Math.round(sessionPeaks.generation_throughput * 10) / 10,
        session_peak_ttft_ms: Math.round(sessionPeaks.ttft_ms * 10) / 10,
        session_peak_kv_cache_usage: sessionPeaks.kv_cache_usage,
        session_peak_running_requests: sessionPeaks.running_requests,
        session_peak_power_watts: Math.round(sessionPeaks.power_watts),
        session_peak_vram_used_gb: Math.round(sessionPeaks.vram_used_gb * 10) / 10,
        session_peak_id: sessionPeakId,
        session_peak_prefill_tps: sessionPeakData?.["peak_prefill_tps"] ?? null,
        session_peak_generation_tps: sessionPeakData?.["peak_generation_tps"] ?? null,
        session_peak_best_ttft_ms: sessionPeakData?.["best_ttft_ms"] ?? null,
        ...peakFields(peakData, bestSessionPeakData),
      });
    } else {
      sessionModelId = null;
      sessionPeakId = null;
      sessionPeaks = emptyPeaks();
      bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
      bumpPeak(sessionPeaks, "vram_used_gb", gpuTotals.vramUsedGb);
      yield* context.eventManager.publishMetrics({
        ...baseMetrics,
        model_id: null,
        model_path: null,
        served_model_name: null,
        ...gpuFields(gpuTotals),
        session_peak_power_watts: Math.round(sessionPeaks.power_watts),
        session_peak_vram_used_gb: Math.round(sessionPeaks.vram_used_gb * 10) / 10,
      });
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        context.logger.error("Metrics collection error", { error: String(error) });
      }),
    ),
  );

  return collect.pipe(
    Effect.repeat(Schedule.spaced(METRICS_COLLECT_INTERVAL_MS)),
    Effect.andThen(Effect.never),
  );
};
