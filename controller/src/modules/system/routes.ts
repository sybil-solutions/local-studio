import type { Hono } from "hono";
import { connect } from "node:net";
import { hostname } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { AppContext } from "../../types/context";
import type { SystemConfigResponse } from "../models/types";
import { badRequest, notFound } from "../../core/errors";
import { observeControllerFunction } from "../../core/function-observability";
import { estimateWeightsSizeBytes } from "../models/model-browser";
import { getGpuInfo } from "./platform/gpu";
import { getSystemRuntimeInfo } from "../engines/runtimes/runtime-info";
import { buildCompatibilityReport } from "./platform/compatibility-report";
import { fetchLocal } from "../../http/local-fetch";
import { registerMonitoringRoutes } from "./metrics-routes";
import { registerLogsRoutes } from "./logs-routes";
import { registerUsageRoutes } from "./usage-routes";
import {
  SYSTEM_COMPAT_SERVICE_CHECK_TIMEOUT_MS,
  SYSTEM_DEFAULT_SERVICE_CHECK_TIMEOUT_MS,
  SYSTEM_SERVICE_CHECK_HOST,
} from "./configs";

export const registerSystemRoutes = (app: Hono, context: AppContext): void => {
  const checkService = (
    host: string,
    port: number,
    timeoutMs = SYSTEM_DEFAULT_SERVICE_CHECK_TIMEOUT_MS
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const socket = connect({ port, host });
      let settled = false;
      const finalize = (result: boolean): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.once("connect", () => finalize(true));
      socket.once("timeout", () => finalize(false));
      socket.once("error", () => finalize(false));
    });
  };

  app.get("/status", async (ctx) => {
    const current = await observeControllerFunction(context, "status.findInferenceProcess", () =>
      context.processManager.findInferenceProcess(context.config.inference_port)
    );
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

  app.get("/compat", async (ctx) => {
    const known = await observeControllerFunction(context, "compat.findInferenceProcess", () =>
      context.processManager.findInferenceProcess(context.config.inference_port)
    );
    const runtime = await getSystemRuntimeInfo(context.config, known);
    const portOpen = await checkService(
      SYSTEM_SERVICE_CHECK_HOST,
      context.config.inference_port,
      SYSTEM_COMPAT_SERVICE_CHECK_TIMEOUT_MS
    );

    const report = buildCompatibilityReport({
      runtime,
      inference_port: context.config.inference_port,
      inference_port_open: portOpen,
      inference_process_known: Boolean(known),
      gpu_monitoring: runtime.gpu_monitoring,
    });

    return ctx.json(report);
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
      getNumber(config["num_key_value_heads"]) ?? getNumber(config["num_kv_heads"]) ?? headCount;
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
    const services: Array<{
      name: string;
      port: number;
      internal_port: number;
      protocol: string;
      status: string;
      description?: string | null;
    }> = [];
    services.push({
      name: "Controller",
      port: context.config.port,
      internal_port: context.config.port,
      protocol: "http",
      status: "running",
      description: "Controller service (Bun/Hono)",
    });

    const current = await observeControllerFunction(context, "config.findInferenceProcess", () =>
      context.processManager.findInferenceProcess(context.config.inference_port)
    );
    const inferenceStatus = current ? "running" : "stopped";

    services.push({
      name: "Inference runtime",
      port: context.config.inference_port,
      internal_port: context.config.inference_port,
      protocol: "http",
      status: inferenceStatus,
      description: "Inference backend (vLLM, SGLang, llama.cpp, or MLX)",
    });

    const redisReachable = await checkService("localhost", 6379);
    if (redisReachable) {
      services.push({
        name: "Redis",
        port: 6379,
        internal_port: 6379,
        protocol: "tcp",
        status: "running",
        description: "Cache and rate limiting",
      });
    }

    let prometheusStatus = "unknown";
    try {
      const response = await fetchLocal(9090, "/-/healthy", { timeoutMs: 2000 });
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

    const runtime = await getSystemRuntimeInfo(context.config, current);

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
        llama_bin: context.config.llama_bin ?? null,
        mlx_python: context.config.mlx_python ?? null,
      },
      services,
      environment: {
        controller_url: `http://${hostname()}:${context.config.port}`,
        inference_url: `http://${hostname()}:${context.config.inference_port}`,
        frontend_url: `http://${hostname()}:3000`,
      },
      runtime,
    };

    return ctx.json(payload);
  });

  registerMonitoringRoutes(app, context);
  registerLogsRoutes(app, context);
  registerUsageRoutes(app, context);
};
