import type { Hono } from "hono";
import { performance } from "node:perf_hooks";
import { observeControllerFunction } from "../../core/function-observability";
import type { AppContext } from "../../types/context";
import { getGpuInfo } from "./platform/gpu";
import { fetchInference } from "../../services/inference/inference-client";
import { fetchLocal } from "../../http/local-fetch";

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

const positiveOrUndefined = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const firstMetric = (metrics: Record<string, number>, names: string[]): number => {
  for (const name of names) {
    const value = metrics[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
};

const scrapePrometheusMetrics = async (port: number): Promise<Record<string, number>> => {
  try {
    const response = await fetchLocal(port, "/metrics", { timeoutMs: 1500 });
    if (response.status !== 200) return {};
    const text = await response.text();
    const metrics: Record<string, number> = {};
    for (const line of text.split("\n")) {
      if (line.startsWith("#") || line.trim().length === 0) continue;
      const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{?[^}]*\}?\s+([\d.eE+-]+)$/);
      if (!match?.[1] || !match[2]) continue;
      const value = Number(match[2]);
      if (Number.isFinite(value)) metrics[match[1]] = value;
    }
    return metrics;
  } catch {
    return {};
  }
};

const buildModelKeys = (modelId: string, modelPath: string | null | undefined): Set<string> => {
  const keys = new Set<string>([modelId]);
  if (modelPath) {
    keys.add(modelPath);
    keys.add(modelPath.split("/").pop() ?? modelPath);
  }
  return keys;
};

const buildCurrentMetrics = async (context: AppContext): Promise<Record<string, unknown>> => {
  const current = await observeControllerFunction(
    context,
    "metrics.current.findInferenceProcess",
    () => context.processManager.findInferenceProcess(context.config.inference_port)
  );
  const gpus = getGpuInfo();
  const lifetimeData = context.stores.lifetimeMetricsStore.getAll();
  const currentPowerWatts = gpus.reduce((sum, gpu) => sum + gpu.power_draw, 0);
  const vramUsedGb = gpus.reduce((sum, gpu) => sum + Number(gpu.memory_used_mb ?? 0) / 1024, 0);
  const vramCapacityGb = gpus.reduce(
    (sum, gpu) => sum + Number(gpu.memory_total_mb ?? 0) / 1024,
    0
  );
  const powerLimitWatts = gpus.reduce((sum, gpu) => sum + Number(gpu.power_limit ?? 0), 0);
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

  if (!current) {
    return {
      ...baseMetrics,
      model_id: null,
      model_path: null,
      served_model_name: null,
    };
  }

  const modelId = current.served_model_name ?? current.model_path?.split("/").pop() ?? "unknown";
  const isSglang = current.backend === "sglang";
  const prometheus =
    current.backend === "vllm" || current.backend === "sglang"
      ? await scrapePrometheusMetrics(context.config.inference_port)
      : {};
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
  const usageAggregate = context.stores.inferenceRequestStore.aggregate(
    buildModelKeys(modelId, current.model_path)
  ) as UsageAggregate | null;
  const usageTotals = usageAggregate?.totals;
  const promptTokensTotal = firstMetric(prometheus, promptTokenNames);
  const generationTokensTotal = firstMetric(prometheus, generationTokenNames);
  const ttftSumName = isSglang
    ? "sglang:time_to_first_token_seconds_sum"
    : "vllm:time_to_first_token_seconds_sum";
  const ttftCountName = isSglang
    ? "sglang:time_to_first_token_seconds_count"
    : "vllm:time_to_first_token_seconds_count";
  const ttftCount = prometheus[ttftCountName] ?? 0;
  const avgTtftMs = ttftCount > 0 ? ((prometheus[ttftSumName] ?? 0) / ttftCount) * 1000 : 0;
  const peakData = context.stores.peakMetricsStore.get(modelId);
  const bestSessionPeakData = context.stores.peakMetricsStore.getBestSession(modelId);

  return {
    ...baseMetrics,
    model_id: modelId,
    model_path: current.model_path ?? null,
    served_model_name: current.served_model_name ?? null,
    running_requests: firstMetric(
      prometheus,
      isSglang
        ? ["sglang:num_running_reqs", "sglang:num_requests_running"]
        : ["vllm:num_requests_running"]
    ),
    pending_requests: firstMetric(
      prometheus,
      isSglang
        ? ["sglang:num_queue_reqs", "sglang:num_pending_reqs", "sglang:num_requests_waiting"]
        : ["vllm:num_requests_waiting"]
    ),
    kv_cache_usage: firstMetric(
      prometheus,
      isSglang ? ["sglang:token_usage", "sglang:kv_cache_usage_perc"] : ["vllm:kv_cache_usage_perc"]
    ),
    prompt_tokens_total:
      positiveOrUndefined(promptTokensTotal) ?? positiveOrUndefined(usageTotals?.prompt_tokens),
    generation_tokens_total:
      positiveOrUndefined(generationTokensTotal) ??
      positiveOrUndefined(usageTotals?.completion_tokens),
    total_tokens: positiveOrUndefined(usageTotals?.total_tokens),
    total_requests: positiveOrUndefined(usageTotals?.total_requests),
    prompt_throughput: firstMetric(
      prometheus,
      isSglang
        ? ["sglang:prompt_throughput", "sglang:prefill_throughput"]
        : ["vllm:prompt_throughput", "vllm:prefill_throughput"]
    ),
    generation_throughput: firstMetric(
      prometheus,
      isSglang
        ? ["sglang:gen_throughput", "sglang:generation_throughput"]
        : ["vllm:gen_throughput", "vllm:generation_throughput"]
    ),
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
};

export const registerMonitoringRoutes = (app: Hono, context: AppContext): void => {
  app.get("/metrics", async (_ctx) => {
    const current = await observeControllerFunction(
      context,
      "metrics.prometheus.findInferenceProcess",
      () => context.processManager.findInferenceProcess(context.config.inference_port)
    );
    if (current) {
      context.metrics.updateActiveModel(
        current.model_path,
        current.backend,
        current.served_model_name
      );
    } else {
      context.metrics.updateActiveModel();
    }

    const gpus = getGpuInfo();
    context.metrics.updateGpuMetrics(gpus.map((gpu) => ({ ...gpu })));
    context.metrics.updateSseMetrics(context.eventManager.getStats());

    const content = await context.metricsRegistry.getMetrics();
    return new Response(content, {
      headers: { "Content-Type": context.metricsRegistry.contentType },
    });
  });

  app.get("/v1/metrics/vllm", async (ctx) => {
    const latest = context.eventManager.getLatestMetrics();
    if (Object.keys(latest).length > 0) return ctx.json(latest);

    const fallback = await buildCurrentMetrics(context);
    await context.eventManager.publishMetrics(fallback);
    return ctx.json(fallback);
  });

  app.get("/peak-metrics", async (ctx) => {
    const modelId = ctx.req.query("model_id");
    if (modelId) {
      const result = context.stores.peakMetricsStore.get(modelId);
      return ctx.json(result ?? { error: "No metrics for this model" });
    }
    return ctx.json({ metrics: context.stores.peakMetricsStore.getAll() });
  });

  app.get("/lifetime-metrics", async (ctx) => {
    const data = context.stores.lifetimeMetricsStore.getAll();
    const uptimeHours = (data["uptime_seconds"] ?? 0) / 3600;
    const energyKwh = (data["energy_wh"] ?? 0) / 1000;
    const tokens = data["tokens_total"] ?? 0;
    const kwhPerMillion = tokens > 0 ? energyKwh / (tokens / 1_000_000) : 0;
    const gpus = getGpuInfo();
    const currentPower = gpus.reduce((sum, gpu) => sum + gpu.power_draw, 0);

    return ctx.json({
      tokens_total: Math.floor(data["tokens_total"] ?? 0),
      requests_total: Math.floor(data["requests_total"] ?? 0),
      energy_wh: data["energy_wh"] ?? 0,
      energy_kwh: energyKwh,
      uptime_seconds: data["uptime_seconds"] ?? 0,
      uptime_hours: uptimeHours,
      first_started_at: data["first_started_at"] ?? 0,
      kwh_per_million_tokens: kwhPerMillion,
      current_power_watts: currentPower,
    });
  });

  app.post("/benchmark", async (ctx) => {
    const promptTokens = Number(ctx.req.query("prompt_tokens") ?? 1000);
    const maxTokens = Number(ctx.req.query("max_tokens") ?? 100);
    const current = await observeControllerFunction(context, "benchmark.findInferenceProcess", () =>
      context.processManager.findInferenceProcess(context.config.inference_port)
    );
    if (!current) {
      return ctx.json({ error: "No model running" });
    }
    const modelId = current.served_model_name ?? current.model_path?.split("/").pop() ?? "unknown";
    const prompt = `Please count: ${Array.from({ length: Math.floor(promptTokens / 2) })
      .map((_, index) => index.toString())
      .join(" ")}`;

    try {
      const start = performance.now();
      const response = await fetchInference(context, "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          stream: false,
        }),
      });
      const totalTime = (performance.now() - start) / 1000;
      if (!response.ok) {
        return ctx.json({ error: `Request failed: ${response.status}` });
      }
      const data = (await response.json()) as { usage?: Record<string, number> };
      const usage = data.usage ?? {};
      const promptTokensActual = usage["prompt_tokens"] ?? 0;
      const completionTokens = usage["completion_tokens"] ?? 0;

      if (completionTokens > 0 && promptTokensActual > 0) {
        const generationTps = completionTokens / totalTime;

        const result = context.stores.peakMetricsStore.updateIfBetter(
          modelId,
          undefined,
          generationTps,
          undefined
        );
        context.stores.peakMetricsStore.addTokens(modelId, completionTokens, 1);

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
    } catch (error) {
      return ctx.json({ error: String(error) });
    }
  });
};
