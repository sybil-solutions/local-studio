// CRITICAL
import type { Hono } from "hono";
import { connect } from "node:net";
import { hostname } from "node:os";
import type { AppContext } from "../types/context";
import type { HealthResponse, SystemConfigResponse } from "../types/models";
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
