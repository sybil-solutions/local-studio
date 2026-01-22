import type { Hono } from "hono";
import { performance } from "node:perf_hooks";
import type { AppContext } from "../types/context";
import { getGpuInfo } from "../services/gpu";

/**
 * Register monitoring routes.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerMonitoringRoutes = (app: Hono, context: AppContext): void => {
  app.get("/metrics", async (_ctx) => {
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    if (current) {
      context.metrics.updateActiveModel(current.model_path, current.backend, current.served_model_name);
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
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    if (!current) {
      return ctx.json({ error: "No model running" });
    }
    const modelId = current.served_model_name ?? current.model_path?.split("/").pop() ?? "unknown";
    const prompt = `Please count: ${Array.from({ length: Math.floor(promptTokens / 2) }).map((_, index) => index.toString()).join(" ")}`;

    try {
      const start = performance.now();
      const response = await fetch(`http://localhost:${context.config.inference_port}/v1/chat/completions`, {
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
        const prefillRatio = promptTokensActual / (promptTokensActual + completionTokens * 10);
        const prefillTime = totalTime * prefillRatio;
        const generationTime = totalTime - prefillTime;
        const prefillTps = prefillTime > 0 ? promptTokensActual / prefillTime : 0;
        const generationTps = generationTime > 0 ? completionTokens / generationTime : 0;
        const ttftMs = prefillTime * 1000;

        const result = context.stores.peakMetricsStore.updateIfBetter(
          modelId,
          prefillTps,
          generationTps,
          ttftMs,
        );
        context.stores.peakMetricsStore.addTokens(modelId, completionTokens, 1);

        return ctx.json({
          success: true,
          model_id: modelId,
          benchmark: {
            prompt_tokens: promptTokensActual,
            completion_tokens: completionTokens,
            total_time_s: Math.round(totalTime * 100) / 100,
            prefill_tps: Math.round(prefillTps * 10) / 10,
            generation_tps: Math.round(generationTps * 10) / 10,
            ttft_ms: Math.round(ttftMs),
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
