// CRITICAL
import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import type { AppContext } from "../types/context";
import { isHttpStatus } from "../core/errors";
import { registerAllChatRoutes } from "../modules/chat/routes";
import { registerDownloadsRoutes } from "../modules/downloads/routes";
import { registerAllLifecycleRoutes } from "../modules/lifecycle/routes";
import { registerMcpRoutes } from "../modules/mcp/routes";
import { registerModelsRoutes } from "../modules/models/routes";
import { registerAllMonitoringRoutes } from "../modules/monitoring/routes";
import { registerAllProxyRoutes } from "../modules/proxy/routes";
import { registerStudioRoutes } from "../modules/studio/routes";
import { registerAudioRoutes } from "../modules/audio/routes";
import { registerJobsRoutes } from "../modules/jobs/routes";
import { registerDistributedRoutes } from "../modules/distributed/routes";
import { createOpenApiSpec } from "./openapi-spec";

/**
 * Create the Hono application.
 * @param context - App context.
 * @returns Hono app instance.
 */
export const createApp = (context: AppContext): Hono => {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["*"],
    })
  );

  app.use("*", async (ctx, next) => {
    const skip = new Set(["/health", "/metrics", "/events", "/status", "/api/docs", "/api/spec"]);
    if (!skip.has(ctx.req.path)) {
      context.logger.debug(`${ctx.req.method} ${ctx.req.path}`);
    }
    await next();
  });

  // Register all routes
  registerAllLifecycleRoutes(app, context);
  registerModelsRoutes(app, context);
  registerStudioRoutes(app, context);
  registerDownloadsRoutes(app, context);
  registerAllChatRoutes(app, context);
  registerAllMonitoringRoutes(app, context);
  registerMcpRoutes(app, context);
  registerAudioRoutes(app, context);
  registerJobsRoutes(app, context, context.jobManager);
  registerDistributedRoutes(app, context.distributedManager);
  registerAllProxyRoutes(app, context);

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
