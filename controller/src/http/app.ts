// CRITICAL
import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import type { AppContext } from "../types/context";
import { isHttpStatus } from "../core/errors";
import { registerChatsRoutes } from "../routes/chats";
import { registerLifecycleRoutes } from "../routes/lifecycle";
import { registerLogsRoutes } from "../routes/logs";
import { registerMcpRoutes } from "../routes/mcp";
import { registerModelsRoutes } from "../routes/models";
import { registerMonitoringRoutes } from "../routes/monitoring";
import { registerProxyRoutes } from "../routes/proxy";
import { registerProxyRoutesDebug } from "../routes/proxy-debug";
import { registerSystemRoutes } from "../routes/system";
import { registerUsageRoutes } from "../routes/usage";
import { registerTokenizationRoutes } from "../routes/tokenization";

/**
 * Create the Hono application.
 * @param context - App context.
 * @returns Hono app instance.
 */
export const createApp = (context: AppContext): Hono => {
  const app = new Hono();

  app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
  }));

  app.use("*", async (ctx, next) => {
    const skip = new Set(["/health", "/metrics", "/events", "/status", "/api/docs", "/api/spec"]);
    if (!skip.has(ctx.req.path)) {
      context.logger.debug(`${ctx.req.method} ${ctx.req.path}`);
    }
    await next();
  });

  // Register all routes
  registerSystemRoutes(app, context);
  registerModelsRoutes(app, context);
  registerLifecycleRoutes(app, context);
  registerChatsRoutes(app, context);
  registerLogsRoutes(app, context);
  registerMonitoringRoutes(app, context);
  registerMcpRoutes(app, context);
  registerProxyRoutes(app, context);
  registerProxyRoutesDebug(app, context);
  registerUsageRoutes(app, context);
  registerTokenizationRoutes(app, context);

  // OpenAPI documentation endpoints
  app.get("/api/spec", (ctx) => {
    return ctx.json({
      openapi: "3.1.0",
      info: {
        title: "vLLM Studio API",
        version: "0.3.1",
        description: "Model lifecycle management for vLLM, SGLang, and TabbyAPI inference servers",
      },
      servers: [
        {
          url: `http://localhost:${context.config.port}`,
          description: "Local development server",
        },
      ],
      paths: {
        "/health": {
          get: {
            summary: "Health check",
            description: "Check if the controller and inference backend are healthy",
            responses: {
              "200": {
                description: "Service is healthy",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        status: { type: "string", enum: ["ok"] },
                        version: { type: "string" },
                        inference_ready: { type: "boolean" },
                        backend_reachable: { type: "boolean" },
                        running_model: { type: ["string", "null"] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/status": {
          get: {
            summary: "Get status",
            description: "Get current status of the inference backend",
            responses: {
              "200": {
                description: "Status information",
              },
            },
          },
        },
        "/gpus": {
          get: {
            summary: "List GPUs",
            description: "Get GPU information including memory, utilization, temperature",
            responses: {
              "200": {
                description: "GPU list",
              },
            },
          },
        },
        "/recipes": {
          get: {
            summary: "List recipes",
            description: "Get all model launch recipes",
            responses: {
              "200": {
                description: "Recipe list",
              },
            },
          },
          post: {
            summary: "Create recipe",
            description: "Create a new model launch recipe",
            responses: {
              "201": {
                description: "Recipe created",
              },
            },
          },
        },
        "/launch/{recipe_id}": {
          post: {
            summary: "Launch model",
            description: "Launch a model from a recipe",
            parameters: [
              {
                name: "recipe_id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Model launched",
              },
            },
          },
        },
        "/chats": {
          get: {
            summary: "List chat sessions",
            responses: {
              "200": {
                description: "Chat list",
              },
            },
          },
          post: {
            summary: "Create chat session",
            responses: {
              "201": {
                description: "Chat created",
              },
            },
          },
        },
      },
    });
  });

  app.get("/api/docs", swaggerUI({ url: "/api/spec" }));

  app.notFound((ctx) => ctx.json({ detail: "Not Found" }, { status: 404 }));

  app.onError((error, ctx) => {
    if (isHttpStatus(error)) {
      return ctx.json({ detail: error.detail }, { status: error.status });
    }
    context.logger.error("Unhandled error", { error: String(error) });
    return ctx.json({ detail: "Internal Server Error" }, { status: 500 });
  });

  return app;
};
