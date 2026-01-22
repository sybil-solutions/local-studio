import type { AppContext } from "./types/context";
import { getGpuInfo } from "./services/gpu";
import { delay } from "./core/async";

/**
 * Start background metrics collection.
 * @param context - App context.
 * @returns Stop function.
 */
export const startMetricsCollector = (context: AppContext): (() => void) => {
  let running = true;
  let lastVllmMetrics: Record<string, number> = {};
  let lastMetricsTime = 0;

  /**
   * Scrape Prometheus metrics from vLLM.
   * @param port - Inference port.
   * @returns Metrics map.
   */
  const scrapeVllmMetrics = async (port: number): Promise<Record<string, number>> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`http://localhost:${port}/metrics`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.status !== 200) {
        return {};
      }
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

  /**
   * Execute a single metrics collection cycle.
   * @returns Promise resolving after the cycle.
   */
  const collect = async (): Promise<void> => {
    try {
      const current = await context.processManager.findInferenceProcess(context.config.inference_port);
      const gpuList = getGpuInfo();

      if (current) {
        context.metrics.updateActiveModel(current.model_path, current.backend, current.served_model_name);
      } else {
        context.metrics.updateActiveModel();
      }

      context.metrics.updateGpuMetrics(gpuList.map((gpu) => ({ ...gpu })));
      context.metrics.updateSseMetrics(context.eventManager.getStats());

      const lifetimeStore = context.stores.lifetimeMetricsStore;
      const totalPowerWatts = gpuList.reduce((sum, gpu) => sum + gpu.power_draw, 0);
      const energyWh = totalPowerWatts * (5 / 3600);
      lifetimeStore.increment("energy_wh", energyWh);
      lifetimeStore.increment("uptime_seconds", 5);

      await context.eventManager.publishStatus({
        running: Boolean(current),
        process: current,
        inference_port: context.config.inference_port,
      });
      await context.eventManager.publishGpu(gpuList.map((gpu) => ({ ...gpu })));

      if (current) {
        const vllmMetrics = await scrapeVllmMetrics(context.config.inference_port);
        const now = Date.now() / 1000;
        const elapsed = lastMetricsTime > 0 ? now - lastMetricsTime : 5;
        let promptThroughput = 0;
        let generationThroughput = 0;
        if (elapsed > 0 && Object.keys(vllmMetrics).length > 0 && Object.keys(lastVllmMetrics).length > 0) {
          const previousPromptTokens = lastVllmMetrics["vllm:prompt_tokens_total"] ?? 0;
          const currentPromptTokens = vllmMetrics["vllm:prompt_tokens_total"] ?? 0;
          const previousGenerationTokens = lastVllmMetrics["vllm:generation_tokens_total"] ?? 0;
          const currentGenerationTokens = vllmMetrics["vllm:generation_tokens_total"] ?? 0;
          if (currentPromptTokens > previousPromptTokens) {
            promptThroughput = (currentPromptTokens - previousPromptTokens) / elapsed;
          }
          if (currentGenerationTokens > previousGenerationTokens) {
            generationThroughput = (currentGenerationTokens - previousGenerationTokens) / elapsed;
          }
        }
        lastVllmMetrics = vllmMetrics;
        lastMetricsTime = now;

        const modelId = current.served_model_name ?? current.model_path?.split("/").pop() ?? "unknown";
        const peakData = context.stores.peakMetricsStore.get(modelId);
        const lifetimeData = lifetimeStore.getAll();

        await context.eventManager.publishMetrics({
          running_requests: Number(vllmMetrics["vllm:num_requests_running"] ?? 0),
          pending_requests: Number(vllmMetrics["vllm:num_requests_waiting"] ?? 0),
          kv_cache_usage: vllmMetrics["vllm:kv_cache_usage_perc"] ?? 0,
          prompt_tokens_total: Number(vllmMetrics["vllm:prompt_tokens_total"] ?? 0),
          generation_tokens_total: Number(vllmMetrics["vllm:generation_tokens_total"] ?? 0),
          prompt_throughput: Math.round(promptThroughput * 10) / 10,
          generation_throughput: Math.round(generationThroughput * 10) / 10,
          peak_prefill_tps: peakData?.["prefill_tps"] ?? null,
          peak_generation_tps: peakData?.["generation_tps"] ?? null,
          peak_ttft_ms: peakData?.["ttft_ms"] ?? null,
          lifetime_prompt_tokens: lifetimeData["prompt_tokens_total"] ?? 0,
          lifetime_completion_tokens: lifetimeData["completion_tokens_total"] ?? 0,
          lifetime_requests: lifetimeData["requests_total"] ?? 0,
          lifetime_energy_kwh: (lifetimeData["energy_wh"] ?? 0) / 1000,
          lifetime_uptime_hours: (lifetimeData["uptime_seconds"] ?? 0) / 3600,
          current_power_watts: totalPowerWatts,
          kwh_per_million_input: lifetimeData["prompt_tokens_total"]
            ? ((lifetimeData["energy_wh"] ?? 0) / 1000) / ((lifetimeData["prompt_tokens_total"] ?? 1) / 1_000_000)
            : null,
          kwh_per_million_output: lifetimeData["completion_tokens_total"]
            ? ((lifetimeData["energy_wh"] ?? 0) / 1000) / ((lifetimeData["completion_tokens_total"] ?? 1) / 1_000_000)
            : null,
        });
      }
    } catch (error) {
      context.logger.error("Metrics collection error", { error: String(error) });
    }
  };

  const loop = async (): Promise<void> => {
    while (running) {
      await collect();
      await delay(5000);
    }
  };

  void loop();

  return () => {
    running = false;
  };
};
