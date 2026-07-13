import type { AppContext } from "../../app-context";
import { modelBasename } from "../../core/paths";
import { getGpuInfo } from "./platform/gpu";
import { getSystemRuntimeInfo } from "../engines/runtimes/runtime-info";
import { delay } from "../../core/async";
import type { UsageAggregate } from "../../stores/inference-request-store";
import {
  SGLANG_METRIC_NAMES,
  VLLM_METRIC_NAMES,
  scrapeEngineMetrics,
} from "./engine-metrics-scrape";
import { LLAMACPP_TPS_STALE_MS, scrapeLlamacppThroughput } from "./llamacpp-throughput";
import {
  bumpBestLower,
  bumpPeak,
  emptyPeaks,
  firstMetric,
  positiveOrUndefined,
  type SessionPeaks,
} from "./metrics-peaks";

const METRICS_HTTP_TIMEOUT_MS = 5_000;
const METRICS_RUNTIME_SUMMARY_INTERVAL_MS = 30_000;
const METRICS_COLLECT_INTERVAL_MS = 5_000;
const METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS = 5;

export const startMetricsCollector = (context: AppContext): (() => void) => {
  let running = true;
  let lastVllmMetrics: Record<string, number> = {};
  let lastMetricsTime = 0;
  let lastRuntimeSummaryAt = 0;
  let lastLlamacppSampleAt = 0;
  let lastLlamacppSampleKey = "";
  let lastLlamacppPromptThroughput = 0;
  let lastLlamacppGenerationThroughput = 0;
  let sessionModelId: string | null = null;
  let sessionPeakId: string | null = null;
  let sessionPeaks: SessionPeaks = emptyPeaks();
  let metricsUnavailableUntil = 0;

  const scrapeVllmMetrics = async (port: number): Promise<Record<string, number>> => {
    if (Date.now() < metricsUnavailableUntil) return {};
    const scrape = await scrapeEngineMetrics(port, METRICS_HTTP_TIMEOUT_MS);
    if (scrape.status === 404) {
      metricsUnavailableUntil = Date.now() + 60_000;
    } else if (scrape.status === 200) {
      metricsUnavailableUntil = 0;
    }
    return scrape.metrics;
  };

  const collect = async (): Promise<void> => {
    try {
      const current = await context.processManager.findInferenceProcess(
        context.config.inference_port,
      );
      const gpuList = getGpuInfo();

      const lifetimeStore = context.stores.lifetimeMetricsStore;
      const totalPowerWatts = gpuList.reduce((sum, gpu) => sum + gpu.power_draw, 0);
      const energyWh = totalPowerWatts * (5 / 3600);
      lifetimeStore.increment("energy_wh", energyWh);
      lifetimeStore.increment("uptime_seconds", METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS);

      await context.eventManager.publishStatus({
        running: Boolean(current),
        process: current,
        inference_port: context.config.inference_port,
        launching: context.launchState.getLaunchingRecipeId(),
      });
      await context.eventManager.publishGpu(gpuList.map((gpu) => ({ ...gpu })));

      if (Date.now() - lastRuntimeSummaryAt > METRICS_RUNTIME_SUMMARY_INTERVAL_MS) {
        try {
          const runtime = await getSystemRuntimeInfo(context.config);
          const leaseHolder = current
            ? (current.served_model_name ?? modelBasename(current.model_path) ?? "inference")
            : null;
          await context.eventManager.publishRuntimeSummary({
            platform: runtime.platform,
            gpu_monitoring: runtime.gpu_monitoring,
            backends: runtime.backends,
            lease: { holder: leaseHolder, since: leaseHolder ? new Date().toISOString() : null },
          });
          lastRuntimeSummaryAt = Date.now();
        } catch (error) {
          context.logger.debug("Runtime summary publish failed", { error: String(error) });
        }
      }

      // Always publish basic metrics (lifetime, power) even when idle
      const lifetimeData = lifetimeStore.getAll();
      const baseMetrics = {
        lifetime_prompt_tokens: lifetimeData["prompt_tokens_total"] ?? 0,
        lifetime_completion_tokens: lifetimeData["completion_tokens_total"] ?? 0,
        lifetime_requests: lifetimeData["requests_total"] ?? 0,
        lifetime_energy_kwh: (lifetimeData["energy_wh"] ?? 0) / 1000,
        lifetime_uptime_hours: (lifetimeData["uptime_seconds"] ?? 0) / 3600,
        current_power_watts: totalPowerWatts,
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

      const totalVramUsedGb = gpuList.reduce((sum, gpu) => sum + gpu.memory_used_mb / 1024, 0);
      const totalVramCapacityGb = gpuList.reduce((sum, gpu) => sum + gpu.memory_total_mb / 1024, 0);
      const totalPowerLimitWatts = gpuList.reduce((sum, gpu) => sum + gpu.power_limit, 0);

      if (current) {
        const modelId =
          current.served_model_name ?? modelBasename(current.model_path) ?? "unknown";

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

        if (current.backend === "vllm" || current.backend === "sglang") {
          const vllmMetrics = await scrapeVllmMetrics(context.config.inference_port);
          const now = Date.now() / 1000;
          const elapsed =
            lastMetricsTime > 0 ? now - lastMetricsTime : METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS;
          const isSglang = current.backend === "sglang";
          const names = isSglang ? SGLANG_METRIC_NAMES : VLLM_METRIC_NAMES;
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

          // Update all-time peaks with observed runtime throughput.
          if (promptThroughput > 0 || generationThroughput > 0 || avgTtftMs > 0) {
            context.stores.peakMetricsStore.updateIfBetter(
              modelId,
              promptThroughput > 0 ? promptThroughput : undefined,
              generationThroughput > 0 ? generationThroughput : undefined,
              avgTtftMs > 0 ? avgTtftMs : undefined,
            );
          }
        } else if (current.backend === "llamacpp") {
          // vLLM counters are unavailable on llama.cpp, so derive throughput from recent llama log output.
          lastVllmMetrics = {};
          lastMetricsTime = 0;
          const sample = scrapeLlamacppThroughput(context, current);
          const isNewSample = Boolean(sample && sample.sampleKey !== lastLlamacppSampleKey);
          if (sample && isNewSample) {
            lastLlamacppSampleAt = Date.now();
            lastLlamacppSampleKey = sample.sampleKey;
            if (sample.promptTps > 0) {
              lastLlamacppPromptThroughput = sample.promptTps;
            }
            if (sample.generationTps > 0) {
              lastLlamacppGenerationThroughput = sample.generationTps;
            }

            context.stores.peakMetricsStore.updateIfBetter(
              modelId,
              sample.promptTps > 0 ? sample.promptTps : undefined,
              sample.generationTps > 0 ? sample.generationTps : undefined,
              undefined,
            );
          }

          const isFresh = Date.now() - lastLlamacppSampleAt <= LLAMACPP_TPS_STALE_MS;
          promptThroughput = isFresh ? lastLlamacppPromptThroughput : 0;
          generationThroughput = isFresh ? lastLlamacppGenerationThroughput : 0;
        } else {
          // Unknown/non-vLLM backend: keep lifetime/power metrics and avoid stale backend-specific values.
          lastVllmMetrics = {};
          lastMetricsTime = 0;
          lastLlamacppSampleAt = 0;
          lastLlamacppSampleKey = "";
          lastLlamacppPromptThroughput = 0;
          lastLlamacppGenerationThroughput = 0;
        }

        bumpPeak(sessionPeaks, "prompt_throughput", promptThroughput);
        bumpPeak(sessionPeaks, "generation_throughput", generationThroughput);
        bumpBestLower(sessionPeaks, "ttft_ms", avgTtftMs);
        bumpPeak(sessionPeaks, "kv_cache_usage", kvCacheUsage);
        bumpPeak(sessionPeaks, "running_requests", runningRequests);
        bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
        bumpPeak(sessionPeaks, "vram_used_gb", totalVramUsedGb);

        if (sessionPeakId) {
          context.stores.peakMetricsStore.updateSessionPeak(
            sessionPeakId,
            modelId,
            sessionPeaks.prompt_throughput > 0 ? sessionPeaks.prompt_throughput : undefined,
            sessionPeaks.generation_throughput > 0 ? sessionPeaks.generation_throughput : undefined,
            sessionPeaks.ttft_ms > 0 ? sessionPeaks.ttft_ms : undefined,
          );
        }

        const peakData = context.stores.peakMetricsStore.get(modelId);
        const sessionPeakData = sessionPeakId
          ? context.stores.peakMetricsStore.getSession(sessionPeakId)
          : null;
        const bestSessionPeakData = context.stores.peakMetricsStore.getBestSession(modelId);
        const usageAggregate: UsageAggregate | null =
          context.stores.inferenceRequestStore.aggregate(new Set([modelId]));
        const usageTotals = usageAggregate?.totals;
        const usageLatencyAvg = positiveOrUndefined(usageAggregate?.latency?.avg_ms);
        const usageTtftAvg = positiveOrUndefined(usageAggregate?.ttft?.avg_ms);
        const promptTokensDisplay =
          positiveOrUndefined(promptTokensTotal) ?? positiveOrUndefined(usageTotals?.prompt_tokens);
        const generationTokensDisplay =
          positiveOrUndefined(generationTokensTotal) ??
          positiveOrUndefined(usageTotals?.completion_tokens);
        const avgTtftDisplay =
          avgTtftMs > 0 ? Math.round(avgTtftMs * 10) / 10 : (usageTtftAvg ?? 0);

        await context.eventManager.publishMetrics({
          ...baseMetrics,
          model_id: modelId,
          model_path: current.model_path ?? null,
          served_model_name: current.served_model_name ?? null,
          running_requests: runningRequests,
          pending_requests: pendingRequests,
          kv_cache_usage: kvCacheUsage,
          prompt_tokens_total: promptTokensDisplay,
          generation_tokens_total: generationTokensDisplay,
          total_tokens: positiveOrUndefined(usageTotals?.total_tokens),
          total_requests: positiveOrUndefined(usageTotals?.total_requests),
          prompt_throughput: Math.round(promptThroughput * 10) / 10,
          generation_throughput: Math.round(generationThroughput * 10) / 10,
          avg_ttft_ms: avgTtftDisplay,
          latency_avg: usageLatencyAvg,
          vram_used_gb: Math.round(totalVramUsedGb * 10) / 10,
          vram_capacity_gb: Math.round(totalVramCapacityGb * 10) / 10,
          power_limit_watts: Math.round(totalPowerLimitWatts),
          // Session peaks (reset on model switch)
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
          best_session_peak_id: bestSessionPeakData?.["session_id"] ?? null,
          best_session_prefill_tps: bestSessionPeakData?.["peak_prefill_tps"] ?? null,
          best_session_generation_tps: bestSessionPeakData?.["peak_generation_tps"] ?? null,
          best_session_ttft_ms: bestSessionPeakData?.["best_ttft_ms"] ?? null,
          // All-time peaks (persisted per model)
          peak_prefill_tps: peakData?.["prefill_tps"] ?? null,
          peak_generation_tps: peakData?.["generation_tps"] ?? null,
          peak_ttft_ms: peakData?.["ttft_ms"] ?? null,
        });
      } else {
        sessionModelId = null;
        sessionPeakId = null;
        sessionPeaks = emptyPeaks();
        bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
        bumpPeak(sessionPeaks, "vram_used_gb", totalVramUsedGb);
        await context.eventManager.publishMetrics({
          ...baseMetrics,
          model_id: null,
          model_path: null,
          served_model_name: null,
          vram_used_gb: Math.round(totalVramUsedGb * 10) / 10,
          vram_capacity_gb: Math.round(totalVramCapacityGb * 10) / 10,
          power_limit_watts: Math.round(totalPowerLimitWatts),
          session_peak_power_watts: Math.round(sessionPeaks.power_watts),
          session_peak_vram_used_gb: Math.round(sessionPeaks.vram_used_gb * 10) / 10,
        });
      }
    } catch (error) {
      context.logger.error("Metrics collection error", { error: String(error) });
    }
  };

  const loop = async (): Promise<void> => {
    while (running) {
      await collect();
      await delay(METRICS_COLLECT_INTERVAL_MS);
    }
  };

  void loop();

  return () => {
    running = false;
  };
};
