// CRITICAL
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "../types/context";
import {
  HealthResponseSchema,
  StatusResponseSchema,
  GPUListResponseSchema,
  SystemConfigResponseSchema,
} from "../types/schemas";
import { getGpuInfo } from "../services/gpu";

/**
 * Register system routes with OpenAPI.
 * @param app - OpenAPIHono application.
 * @param context - App context.
 */
export const registerSystemRoutes = (app: OpenAPIHono, context: AppContext): void => {
  // GET /health - Health check endpoint
  app.openapi(
    {
      method: "get",
      path: "/health",
      description: "Health check endpoint for monitoring and load balancers",
      responses: {
        200: {
          description: "Service is healthy",
          content: {
            "application/json": {
              schema: HealthResponseSchema,
            },
          },
        },
      },
    },
    async (ctx) => {
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

      return ctx.json({
        status: "ok",
        version: "0.3.1",
        inference_ready: inferenceReady,
        backend_reachable: inferenceReady,
        running_model: current ? (current.served_model_name ?? current.model_path ?? null) : null,
      });
    }
  );

  // GET /status - Get running model status
  app.openapi(
    {
      method: "get",
      path: "/status",
      description: "Get current status of the inference backend and any running model",
      responses: {
        200: {
          description: "Status information",
          content: {
            "application/json": {
              schema: StatusResponseSchema,
            },
          },
        },
      },
    },
    async (ctx) => {
      const current = await context.processManager.findInferenceProcess(context.config.inference_port);

      // Transform process to match schema (narrowing backend type and ensuring model_path is string)
      const processInfo = current ? {
        pid: current.pid,
        backend: current.backend as "vllm" | "sglang" | "tabby",
        model_path: current.model_path ?? "",
        port: current.port,
        served_model_name: current.served_model_name ?? undefined,
      } : undefined;

      return ctx.json({
        running: Boolean(current),
        process: processInfo,
        inference_port: context.config.inference_port,
        launching: context.launchState.getLaunchingRecipeId() ?? undefined,
      });
    }
  );

  // GET /gpus - List available GPUs
  app.openapi(
    {
      method: "get",
      path: "/gpus",
      description: "Get GPU information including memory usage, utilization, and temperature",
      responses: {
        200: {
          description: "GPU information",
          content: {
            "application/json": {
              schema: GPUListResponseSchema,
            },
          },
        },
      },
    },
    async (ctx) => {
      const gpus = getGpuInfo();
      return ctx.json({
        count: gpus.length,
        gpus,
      });
    }
  );

  // GET /config - System configuration
  app.openapi(
    {
      method: "get",
      path: "/config",
      description: "Get system topology and service discovery information",
      responses: {
        200: {
          description: "System configuration",
          content: {
            "application/json": {
              schema: SystemConfigResponseSchema,
            },
          },
        },
      },
    },
    async (ctx) => {
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

      return ctx.json({
        port: context.config.port,
        inference_port: context.config.inference_port,
        models_dir: context.config.models_dir,
        data_dir: context.config.data_dir,
        services,
      });
    }
  );
};
