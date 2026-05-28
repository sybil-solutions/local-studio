import type { AppContext } from "../../../types/context";
import { getGpuInfo } from "../platform/gpu";
import { getSystemRuntimeInfo } from "../../engines/runtimes/runtime-info";
import { delay } from "../../../core/async";
import { listLogFiles, resolveExistingLogPath, tailFileLines } from "../../../core/log-files";
import { fetchLocal } from "../../../http/local-fetch";
import { isRecipeRunning } from "../../models/recipes/recipe-matching";
import type { ProcessInfo, Recipe } from "../../models/types";
import {
  METRICS_COLLECT_INTERVAL_MS,
  METRICS_HTTP_TIMEOUT_MS,
  METRICS_RUNTIME_SUMMARY_INTERVAL_MS,
  METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS,
} from "./configs";

const LLAMACPP_LOG_TAIL_LINES = 240;
const LLAMACPP_TPS_STALE_MS = 15_000;
const TOKENS_PER_SECOND_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*tokens\s+per\s+second/i;
const PROMPT_EVAL_PATTERN = /prompt eval time\s*=/i;
const EVAL_PATTERN = /(^|\s)eval time\s*=/i;

interface LlamacppThroughputSample {
  promptTps: number;
  generationTps: number;
  sampleKey: string;
}

type UsageAggregate = {
  totals?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_requests?: number;
  };
  latency?: { avg_ms?: number | null };
  ttft?: { avg_ms?: number | null };
};

const parseTokensPerSecond = (line: string): number | null => {
  const match = line.match(TOKENS_PER_SECOND_PATTERN);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
};

const parseLlamacppThroughputFromLines = (lines: string[]): LlamacppThroughputSample | null => {
  if (lines.length === 0) return null;

  let promptLine = "";
  let evalLine = "";

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!promptLine && PROMPT_EVAL_PATTERN.test(line)) {
      promptLine = line;
      continue;
    }
    if (!evalLine && EVAL_PATTERN.test(line) && !PROMPT_EVAL_PATTERN.test(line)) {
      evalLine = line;
    }
    if (promptLine && evalLine) break;
  }

  const promptTps = promptLine ? (parseTokensPerSecond(promptLine) ?? 0) : 0;
  const generationTps = evalLine ? (parseTokensPerSecond(evalLine) ?? 0) : 0;
  if (promptTps <= 0 && generationTps <= 0) return null;

  return {
    promptTps,
    generationTps,
    sampleKey: `${promptLine}::${evalLine}`,
  };
};

const findRunningRecipeForProcess = (context: AppContext, current: ProcessInfo): Recipe | null => {
  const recipes = context.stores.recipeStore.list();
  return (
    recipes.find((recipe) =>
      isRecipeRunning(recipe, current, {
        allowCurrentContainsRecipePath: true,
      })
    ) ?? null
  );
};

const scrapeLlamacppThroughput = (
  context: AppContext,
  current: ProcessInfo
): LlamacppThroughputSample | null => {
  const recipe = findRunningRecipeForProcess(context, current);
  const recipeLogPath = recipe ? resolveExistingLogPath(context.config.data_dir, recipe.id) : null;
  const servedName = (current.served_model_name ?? "").toLowerCase();

  let logPath = recipeLogPath;
  if (!logPath) {
    const entries = listLogFiles(context.config.data_dir).filter(
      (entry) => entry.sessionId !== "controller"
    );
    const byName =
      servedName.length > 0
        ? entries.find((entry) => entry.sessionId.toLowerCase().includes(servedName))
        : null;
    logPath = byName?.path ?? entries[0]?.path ?? null;
  }

  if (!logPath) return null;
  const lines = tailFileLines(logPath, LLAMACPP_LOG_TAIL_LINES);
  return parseLlamacppThroughputFromLines(lines);
};

const positiveOrUndefined = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

interface SessionPeaks {
  prompt_throughput: number;
  generation_throughput: number;
  ttft_ms: number;
  kv_cache_usage: number;
  running_requests: number;
  power_watts: number;
  vram_used_gb: number;
}

const emptyPeaks = (): SessionPeaks => ({
  prompt_throughput: 0,
  generation_throughput: 0,
  ttft_ms: 0,
  kv_cache_usage: 0,
  running_requests: 0,
  power_watts: 0,
  vram_used_gb: 0,
});

const bumpPeak = (peaks: SessionPeaks, key: keyof SessionPeaks, value: number): void => {
  if (Number.isFinite(value) && value > peaks[key]) peaks[key] = value;
};

const bumpBestLower = (peaks: SessionPeaks, key: keyof SessionPeaks, value: number): void => {
  if (!Number.isFinite(value) || value <= 0) return;
  if (peaks[key] === 0 || value < peaks[key]) peaks[key] = value;
};

/**
 * Return the first finite Prometheus metric value for a list of compatible metric names.
 * @param metrics - Scraped Prometheus metrics keyed by metric name.
 * @param names - Candidate metric names in priority order.
 * @returns First finite metric value, or zero when none exists.
 */
const firstMetric = (metrics: Record<string, number>, names: string[]): number => {
  for (const name of names) {
    const value = metrics[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
};

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
    try {
      if (Date.now() < metricsUnavailableUntil) {
        return {};
      }
      const response = await fetchLocal(port, "/metrics", {
        timeoutMs: METRICS_HTTP_TIMEOUT_MS,
      });
      if (response.status !== 200) {
        if (response.status === 404) {
          metricsUnavailableUntil = Date.now() + 60_000;
        }
        return {};
      }
      metricsUnavailableUntil = 0;
      const text = await response.text();
      const metrics: Record<string, number> = {};
      for (const line of text.split("\n")) {
        if (line.startsWith("#") || line.trim().length === 0) {
          continue;
        }
        const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{?[^}]*\}?\s+([\d.eE+-]+)$/);
        if (match) {
          const value = Number(match[2]);
          const metricName = match[1];
          if (!Number.isNaN(value) && metricName) {
            metrics[metricName] = value;
          }
        }
      }
      return metrics;
    } catch {
      return {};
    }
  };

  const collect = async (): Promise<void> => {
    try {
      const current = await context.processManager.findInferenceProcess(
        context.config.inference_port
      );
      const gpuList = getGpuInfo();

      if (current) {
        context.metrics.updateActiveModel(
          current.model_path,
          current.backend,
          current.served_model_name
        );
      } else {
        context.metrics.updateActiveModel();
      }

      context.metrics.updateGpuMetrics(gpuList.map((gpu) => ({ ...gpu })));
      context.metrics.updateSseMetrics(context.eventManager.getStats());

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
            ? (current.served_model_name ?? current.model_path?.split("/").pop() ?? "inference")
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

      const totalVramUsedGb = gpuList.reduce(
        (sum, gpu) => sum + Number(gpu.memory_used_mb ?? 0) / 1024,
        0
      );
      const totalVramCapacityGb = gpuList.reduce(
        (sum, gpu) => sum + Number(gpu.memory_total_mb ?? 0) / 1024,
        0
      );
      const totalPowerLimitWatts = gpuList.reduce(
        (sum, gpu) => sum + Number(gpu.power_limit ?? 0),
        0
      );

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

        if (current.backend === "vllm" || current.backend === "sglang") {
          const vllmMetrics = await scrapeVllmMetrics(context.config.inference_port);
          const now = Date.now() / 1000;
          const elapsed =
            lastMetricsTime > 0 ? now - lastMetricsTime : METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS;
          const isSglang = current.backend === "sglang";
          const promptTokenNames = isSglang
            ? ["sglang:prompt_tokens_total", "sglang:prefill_tokens_total"]
            : ["vllm:prompt_tokens_total"];
          const generationTokenNames = isSglang
            ? [
                "sglang:generation_tokens_total",
                "sglang:completion_tokens_total",
                "sglang:gen_tokens_total",
              ]
            : ["vllm:generation_tokens_total"];
          if (
            elapsed > 0 &&
            Object.keys(vllmMetrics).length > 0 &&
            Object.keys(lastVllmMetrics).length > 0
          ) {
            const previousPromptTokens = firstMetric(lastVllmMetrics, promptTokenNames);
            const currentPromptTokens = firstMetric(vllmMetrics, promptTokenNames);
            const previousGenerationTokens = firstMetric(lastVllmMetrics, generationTokenNames);
            const currentGenerationTokens = firstMetric(vllmMetrics, generationTokenNames);
            if (currentPromptTokens > previousPromptTokens) {
              promptThroughput = (currentPromptTokens - previousPromptTokens) / elapsed;
            }
            if (currentGenerationTokens > previousGenerationTokens) {
              generationThroughput = (currentGenerationTokens - previousGenerationTokens) / elapsed;
            }
          }

          promptThroughput =
            firstMetric(vllmMetrics, [
              isSglang ? "sglang:prompt_throughput" : "vllm:prompt_throughput",
              isSglang ? "sglang:prefill_throughput" : "vllm:prefill_throughput",
            ]) || promptThroughput;
          generationThroughput =
            firstMetric(vllmMetrics, [
              isSglang ? "sglang:gen_throughput" : "vllm:gen_throughput",
              isSglang ? "sglang:generation_throughput" : "vllm:generation_throughput",
            ]) || generationThroughput;

          runningRequests = Number(
            firstMetric(
              vllmMetrics,
              isSglang
                ? ["sglang:num_running_reqs", "sglang:num_requests_running"]
                : ["vllm:num_requests_running"]
            )
          );
          pendingRequests = Number(
            firstMetric(
              vllmMetrics,
              isSglang
                ? [
                    "sglang:num_queue_reqs",
                    "sglang:num_pending_reqs",
                    "sglang:num_requests_waiting",
                  ]
                : ["vllm:num_requests_waiting"]
            )
          );
          kvCacheUsage = firstMetric(
            vllmMetrics,
            isSglang
              ? ["sglang:token_usage", "sglang:kv_cache_usage_perc"]
              : ["vllm:kv_cache_usage_perc"]
          );
          promptTokensTotal = Number(firstMetric(vllmMetrics, promptTokenNames));
          generationTokensTotal = Number(firstMetric(vllmMetrics, generationTokenNames));

          const ttftSumName = isSglang
            ? "sglang:time_to_first_token_seconds_sum"
            : "vllm:time_to_first_token_seconds_sum";
          const ttftCountName = isSglang
            ? "sglang:time_to_first_token_seconds_count"
            : "vllm:time_to_first_token_seconds_count";
          const previousTtftSum = lastVllmMetrics[ttftSumName] ?? 0;
          const previousTtftCount = lastVllmMetrics[ttftCountName] ?? 0;
          const currentTtftSum = vllmMetrics[ttftSumName] ?? 0;
          const currentTtftCount = vllmMetrics[ttftCountName] ?? 0;
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
              avgTtftMs > 0 ? avgTtftMs : undefined
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
              undefined
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
            sessionPeaks.ttft_ms > 0 ? sessionPeaks.ttft_ms : undefined
          );
        }

        const peakData = context.stores.peakMetricsStore.get(modelId);
        const sessionPeakData = sessionPeakId
          ? context.stores.peakMetricsStore.getSession(sessionPeakId)
          : null;
        const bestSessionPeakData = context.stores.peakMetricsStore.getBestSession(modelId);
        const usageAggregate = context.stores.inferenceRequestStore.aggregate(
          new Set([modelId])
        ) as UsageAggregate | null;
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
