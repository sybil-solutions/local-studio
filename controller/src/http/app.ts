// CRITICAL
import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import type { AppContext } from "../types/context";
import { isHttpStatus } from "../core/errors";
import { registerEngineRoutes } from "../modules/engines/routes";
import { registerSystemRoutes } from "../modules/system/routes";
import { registerModelsRoutes } from "../modules/models/routes";

import { registerAllProxyRoutes } from "../modules/proxy/routes";
import { registerStudioRoutes } from "../modules/studio/routes";
import { registerAudioRoutes } from "../modules/audio/routes";
import { registerJobsRoutes } from "../modules/jobs/routes";
import { createOpenApiSpec } from "./openapi-spec";
import {
  createMutatingAuthMiddleware,
  createMutatingRateLimitMiddleware,
} from "./security-middleware";

/**
 * Create the Hono application.
 * @param context - App context.
 * @returns Hono app instance.
 */
export const createApp = (context: AppContext): Hono => {
  const app = new Hono();
  const allowedCorsOrigins = context.config.cors_origins ?? [];

  app.use(
    "*",
    cors({
      origin: (origin) => (allowedCorsOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "X-API-Key"],
      exposeHeaders: [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "Retry-After",
      ],
      maxAge: 600,
    })
  );

  app.use("*", async (ctx, next) => {
    const skip = new Set(["/metrics", "/events", "/status", "/api/docs", "/api/spec"]);
    if (!skip.has(ctx.req.path)) {
      context.logger.debug(`${ctx.req.method} ${ctx.req.path}`);
    }
    await next();
  });

  app.use("*", createMutatingRateLimitMiddleware(context));
  app.use("*", createMutatingAuthMiddleware(context));

  // Register all routes
  registerSystemRoutes(app, context);
  registerEngineRoutes(app, context);
  registerModelsRoutes(app, context);
  registerStudioRoutes(app, context);
  registerAudioRoutes(app, context);
  registerJobsRoutes(app, context, context.jobManager);
  registerAllProxyRoutes(app, context);

  // OpenAPI documentation endpoints
  app.get("/api/spec", (ctx) => ctx.json(createOpenApiSpec(context)));

  app.get("/api/docs", swaggerUI({ url: "/api/spec" }));

  app.notFound((ctx) => ctx.json({ detail: "Not Found" }, { status: 404 }));

  app.onError((error, ctx) => {
    if (isHttpStatus(error)) {
      return ctx.json({ detail: error.detail }, { status: error.status });
    }
    // Client-initiated disconnects (stream cancel, page close, Droid
    // cancelling an in-flight request to start a new turn) are not our
    // bug. They must NEVER surface as 500 "Internal Server Error" or log
    // as "Unhandled error". The client's socket is already closed so the
    // response body will never reach them anyway; emit a terminal 499
    // (client closed request) and move on.
    const name = (error as { name?: string })?.name ?? "";
    const message = String(error);
    if (
      name === "AbortError" ||
      message.includes("AbortError") ||
      message.includes("connection was closed") ||
      message.includes("ERR_STREAM_PREMATURE_CLOSE") ||
      message.includes("Stream was cancelled") ||
      message.includes("stream was cancelled") ||
      message.includes("The operation was aborted") ||
      message.includes("readable stream is cancelled")
    ) {
      context.logger.debug("client disconnected mid-request", {
        method: ctx.req.method,
        path: ctx.req.path,
      });
      return ctx.body(null, { status: 499 });
    }
    context.logger.error("Unhandled error", { error: message });
    return ctx.json({ detail: "Internal Server Error" }, { status: 500 });
  });

  return app;
};
