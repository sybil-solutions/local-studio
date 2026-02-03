// CRITICAL
import type { Hono } from "hono";
import { connect } from "node:net";
import { hostname } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { AppContext } from "../types/context";
import type { HealthResponse, SystemConfigResponse } from "../types/models";
import { badRequest, notFound } from "../core/errors";
import { estimateWeightsSizeBytes } from "../services/model-browser";
import { getGpuInfo } from "../services/gpu";

/**
 * Register system routes.
 * @param app - Hono application.
 * @param context - App context.
 */
export const registerSystemRoutes = (app: Hono, context: AppContext): void => {
  /**
   * Check if a TCP service is reachable.
   * @param host - Hostname.
   * @param port - Port number.
   * @param timeoutMs - Timeout in ms.
   * @returns Promise resolving to availability.
   */
  const checkService = (host: string, port: number, timeoutMs = 1000): Promise<boolean> => {
    return new Promise((resolve) => {
      const socket = connect(port, host);
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.end();
        resolve(true);
      });
      socket.once("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  };

  app.get("/health", async (ctx) => {
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    let inferenceReady = false;
    if (current) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`http://localhost:${context.config.inference_port}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        inferenceReady = response.status === 200;
      } catch {
        inferenceReady = false;
      }
    }

    const payload: HealthResponse = {
      status: "ok",
      version: "0.3.1",
      inference_ready: inferenceReady,
      backend_reachable: inferenceReady,
      running_model: current ? (current.served_model_name ?? current.model_path ?? null) : null,
    };
    return ctx.json(payload);
  });

  app.get("/status", async (ctx) => {
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    return ctx.json({
      running: Boolean(current),
      process: current,
      inference_port: context.config.inference_port,
      launching: context.launchState.getLaunchingRecipeId(),
    });
  });

  app.get("/gpus", async (ctx) => {
    const gpus = getGpuInfo();
    return ctx.json({
      count: gpus.length,
      gpus,
    });
  });

  app.post("/vram-calculator", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    if (!body || typeof body !== "object") {
      throw badRequest("Invalid payload");
    }

    const model = typeof body["model"] === "string" ? body["model"].trim() : "";
    const contextLength = Number(body["context_length"] ?? 0);
    const tpSize = Number(body["tp_size"] ?? 1);
    const kvDtype = typeof body["kv_dtype"] === "string" ? body["kv_dtype"] : "auto";

    if (!model) {
      throw badRequest("model is required");
    }
    if (!Number.isFinite(contextLength) || contextLength <= 0) {
      throw badRequest("context_length must be a positive number");
    }
    if (!Number.isFinite(tpSize) || tpSize <= 0) {
      throw badRequest("tp_size must be a positive number");
    }

    const resolved = resolve(model);
    const modelsRoot = resolve(context.config.models_dir);
    const rootPrefix = modelsRoot.endsWith(sep) ? modelsRoot : modelsRoot + sep;
    if (!resolved.startsWith(rootPrefix)) {
      throw badRequest("model must be inside models_dir");
    }
    if (!existsSync(resolved)) {
      throw notFound("Model path not found");
    }

    const weightsBytes = estimateWeightsSizeBytes(resolved, false);
    if (!weightsBytes || weightsBytes <= 0) {
      throw notFound("Model weights not found");
    }

    let config: Record<string, unknown> = {};
    const configPath = join(resolved, "config.json");
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        config = {};
      }
    }

    const getNumber = (value: unknown): number | undefined => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
        return Number(value);
      }
      return undefined;
    };

    const layerCount =
      getNumber(config["num_hidden_layers"]) ??
      getNumber(config["n_layer"]) ??
      getNumber(config["num_layers"]);
    const hiddenSize =
      getNumber(config["hidden_size"]) ??
      getNumber(config["n_embd"]) ??
      getNumber(config["d_model"]) ??
      getNumber(config["dim"]);
    const headCount =
      getNumber(config["num_attention_heads"]) ??
      getNumber(config["n_head"]) ??
      getNumber(config["num_heads"]);
    const keyValueHeadCount =
      getNumber(config["num_key_value_heads"]) ??
      getNumber(config["num_kv_heads"]) ??
      headCount;
    const headDim =
      getNumber(config["head_dim"]) ??
      (hiddenSize && headCount ? hiddenSize / headCount : undefined);

    const kvBytesPerValue = kvDtype.toLowerCase() === "fp8" ? 1 : 2;
    let kvCacheBytes = 0;
    if (layerCount && keyValueHeadCount && headDim) {
      kvCacheBytes = contextLength * layerCount * keyValueHeadCount * headDim * 2 * kvBytesPerValue;
    }

    const weightsTotalGb = weightsBytes / 1024 ** 3;
    const weightsPerGpuGb = weightsTotalGb / tpSize;
    const kvCachePerGpuGb = kvCacheBytes > 0 ? kvCacheBytes / 1024 ** 3 / tpSize : 0;
    const activationsPerGpuGb = Math.max(0.5, weightsPerGpuGb * 0.1);
    const overheadPerGpuGb = 2.0;
    const perGpuGb = weightsPerGpuGb + kvCachePerGpuGb + activationsPerGpuGb + overheadPerGpuGb;
    const totalGb = perGpuGb * tpSize;

    const gpus = getGpuInfo();
    let perGpuCapacityGb = 0;
    if (gpus.length >= tpSize && tpSize > 0) {
      const candidates = gpus.slice(0, tpSize).map((gpu) => {
        if (gpu.memory_total_mb) return gpu.memory_total_mb / 1024;
        return gpu.memory_total / 1024 ** 3;
      });
      perGpuCapacityGb = Math.min(...candidates);
    }

    const fits = perGpuCapacityGb > 0 ? perGpuGb <= perGpuCapacityGb : true;
    const utilizationPercent = perGpuCapacityGb > 0 ? (perGpuGb / perGpuCapacityGb) * 100 : 0;

    return ctx.json({
      model_size_gb: weightsTotalGb,
      context_memory_gb: kvCachePerGpuGb * tpSize,
      overhead_gb: overheadPerGpuGb,
      total_gb: totalGb,
      fits_in_vram: fits,
      fits,
      utilization_percent: utilizationPercent,
      breakdown: {
        model_weights_gb: weightsPerGpuGb,
        kv_cache_gb: kvCachePerGpuGb,
        activations_gb: activationsPerGpuGb,
        per_gpu_gb: perGpuGb,
        total_gb: totalGb,
      },
    });
  });

  app.get("/config", async (ctx) => {
    const services: Array<{ name: string; port: number; internal_port: number; protocol: string; status: string; description?: string | null }> = [];
    services.push({
      name: "Controller",
      port: context.config.port,
      internal_port: context.config.port,
      protocol: "http",
      status: "running",
      description: "FastAPI model lifecycle manager",
    });

    let inferenceStatus = "unknown";
    try {
      const current = await context.processManager.findInferenceProcess(context.config.inference_port);
      if (current) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(`http://localhost:${context.config.inference_port}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        inferenceStatus = response.status === 200 ? "running" : "error";
      } else {
        inferenceStatus = "stopped";
      }
    } catch {
      inferenceStatus = "stopped";
    }

    services.push({
      name: "vLLM/SGLang",
      port: context.config.inference_port,
      internal_port: context.config.inference_port,
      protocol: "http",
      status: inferenceStatus,
      description: "Inference backend (vLLM or SGLang)",
    });

    let litellmStatus = "unknown";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const masterKey = process.env["LITELLM_MASTER_KEY"] ?? "sk-master";
      const response = await fetch("http://localhost:4100/health", {
        headers: { Authorization: `Bearer ${masterKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.status === 200) {
        const data = (await response.json()) as { healthy_count?: number };
        litellmStatus = (data.healthy_count ?? 0) > 0 ? "running" : "degraded";
      } else {
        litellmStatus = "error";
      }
    } catch {
      litellmStatus = "stopped";
    }

    services.push({
      name: "LiteLLM",
      port: 4100,
      internal_port: 4000,
      protocol: "http",
      status: litellmStatus,
      description: "API gateway and load balancer",
    });

    const postgresReachable = await checkService("localhost", 5432);
    services.push({
      name: "PostgreSQL",
      port: 5432,
      internal_port: 5432,
      protocol: "tcp",
      status: postgresReachable ? "running" : "stopped",
      description: "Database for LiteLLM",
    });

    const redisReachable = await checkService("localhost", 6379);
    services.push({
      name: "Redis",
      port: 6379,
      internal_port: 6379,
      protocol: "tcp",
      status: redisReachable ? "running" : "stopped",
      description: "Cache and rate limiting",
    });

    let prometheusStatus = "unknown";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetch("http://localhost:9090/-/healthy", { signal: controller.signal });
      clearTimeout(timeout);
      prometheusStatus = response.status === 200 ? "running" : "error";
    } catch {
      prometheusStatus = "stopped";
    }
    services.push({
      name: "Prometheus",
      port: 9090,
      internal_port: 9090,
      protocol: "http",
      status: prometheusStatus,
      description: "Metrics collection",
    });

    const frontendReachable = await checkService("localhost", 3000);
    services.push({
      name: "Frontend",
      port: 3000,
      internal_port: 3000,
      protocol: "http",
      status: frontendReachable ? "running" : "stopped",
      description: "Next.js web UI",
    });

    const payload: SystemConfigResponse = {
      config: {
        host: context.config.host,
        port: context.config.port,
        inference_port: context.config.inference_port,
        api_key_configured: Boolean(context.config.api_key),
        models_dir: context.config.models_dir,
        data_dir: context.config.data_dir,
        db_path: context.config.db_path,
        sglang_python: context.config.sglang_python ?? null,
        tabby_api_dir: context.config.tabby_api_dir ?? null,
      },
      services,
      environment: {
        controller_url: `http://${hostname()}:${context.config.port}`,
        inference_url: `http://${hostname()}:${context.config.inference_port}`,
        litellm_url: `http://${hostname()}:4100`,
        frontend_url: `http://${hostname()}:3000`,
      },
    };

    return ctx.json(payload);
  });
};
