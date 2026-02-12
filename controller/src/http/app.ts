// CRITICAL
import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import type { AppContext } from "../types/context";
import { isHttpStatus } from "../core/errors";
import { registerChatsRoutes } from "../routes/chats";
import { registerAgentFilesRoutes } from "../routes/agent-files";
import { registerDownloadsRoutes } from "../routes/downloads";
import { registerLifecycleRoutes } from "../routes/lifecycle";
import { registerLogsRoutes } from "../routes/logs";
import { registerMcpRoutes } from "../routes/mcp";
import { registerModelsRoutes } from "../routes/models";
import { registerMonitoringRoutes } from "../routes/monitoring";
import { registerOpenAIRoutes } from "../routes/openai";
import { registerRuntimeRoutes } from "../routes/runtime";
import { registerStudioRoutes } from "../routes/studio";
import { registerSystemRoutes } from "../routes/system";
import { registerUsageRoutes } from "../routes/usage";
import { registerTokenizationRoutes } from "../routes/tokenization";
import { createOpenApiSpec } from "./openapi-spec";

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
  registerRuntimeRoutes(app, context);
  registerModelsRoutes(app, context);
  registerStudioRoutes(app, context);
  registerDownloadsRoutes(app, context);
  registerLifecycleRoutes(app, context);
  registerChatsRoutes(app, context);
  registerAgentFilesRoutes(app, context);
  registerLogsRoutes(app, context);
  registerMonitoringRoutes(app, context);
  registerMcpRoutes(app, context);
  registerOpenAIRoutes(app, context);
  registerUsageRoutes(app, context);
  registerTokenizationRoutes(app, context);

  // OpenAPI documentation endpoints
  app.get("/api/spec", (ctx) => ctx.json(createOpenApiSpec(context)));

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
