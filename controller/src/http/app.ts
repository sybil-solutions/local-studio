import { Hono } from "hono";
import { cors } from "hono/cors";
import { Effect } from "effect";
import type { AppContext } from "../app-context";
import type { ControllerRuntime } from "../core/effect-runtime";
import { isHttpStatus } from "../core/errors";
import { registerComputeRoutes } from "../modules/compute/routes";
import { registerEngineRoutes } from "../modules/engines/routes";
import { registerSystemRoutes } from "../modules/system/routes";
import { registerModelsRoutes } from "../modules/models/routes";

import { registerAllProxyRoutes } from "../modules/proxy/routes";
import { registerStudioRoutes } from "../modules/studio/routes";
import { effectRoute, mergeRoutes, type ControllerRouteApp } from "./route-registrar";
import {
  createAuthMiddleware,
  createKeylessRequestGuardMiddleware,
  createMutatingRateLimitMiddleware,
  createReadRateLimitMiddleware,
} from "./security-middleware";
import { createControllerRequestObservabilityMiddleware } from "./observability-middleware";
import { controllerRuntimeMiddleware, type ControllerEnvironment } from "./effect-handler";

type ControllerApplication = ReturnType<typeof registerComputeRoutes> &
  ReturnType<typeof registerSystemRoutes> &
  ReturnType<typeof registerEngineRoutes> &
  ReturnType<typeof registerModelsRoutes> &
  ReturnType<typeof registerStudioRoutes> &
  ReturnType<typeof registerAllProxyRoutes>;

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

/** Flattens Hono's route table into the method/path list the API reference panel renders. */
const listOperations = (app: ControllerRouteApp) => {
  const seen = new Set<string>();
  return app.routes.flatMap((route) => {
    if (!HTTP_METHODS.has(route.method) || route.path === "/*" || route.path === "/api/spec") {
      return [];
    }
    const path = route.path.replaceAll(/:(\w+)/g, "{$1}");
    const summary = `${route.method} ${path}`;
    if (seen.has(summary)) return [];
    seen.add(summary);
    return [{ method: route.method, path, summary }];
  });
};

export const createApp = (
  context: AppContext,
  runtime: ControllerRuntime,
): ControllerApplication => {
  const app = new Hono<ControllerEnvironment>();
  const allowedCorsOrigins = context.config.cors_origins ?? [];

  app.use("*", controllerRuntimeMiddleware(runtime));
  app.use("*", createKeylessRequestGuardMiddleware(context));

  app.use(
    "*",
    cors({
      origin: (origin) => (allowedCorsOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "X-API-Key",
        // Protocol headers for the Responses and Anthropic Messages dialects.
        "Anthropic-Version",
        "Anthropic-Beta",
        "OpenAI-Beta",
      ],
      exposeHeaders: [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "Retry-After",
      ],
      maxAge: 600,
    }),
  );

  app.use("*", createControllerRequestObservabilityMiddleware(context));
  app.use("*", createMutatingRateLimitMiddleware(context));
  app.use("*", createReadRateLimitMiddleware(context));
  app.use("*", createAuthMiddleware(context));

  const routes = mergeRoutes(
    registerSystemRoutes(app, context),
    registerComputeRoutes(app, context),
    registerEngineRoutes(app, context),
    registerModelsRoutes(app, context),
    registerStudioRoutes(app, context),
    registerAllProxyRoutes(app, context),
    effectRoute(app.get, "/health", (ctx) => Effect.succeed(ctx.json({ status: "ok" }))),
  );

  const documentedRoutes = mergeRoutes(
    routes,
    app.get("/api/spec", (ctx) =>
      ctx.json({
        title: "Local Studio API",
        version: "2.0.0",
        description: "Model lifecycle management for local and remote inference runtimes",
        operations: listOperations(routes as ControllerRouteApp),
      }),
    ),
  );

  documentedRoutes.notFound((ctx) => ctx.json({ detail: "Not Found" }, { status: 404 }));

  documentedRoutes.onError((error, ctx) => {
    if (isHttpStatus(error)) {
      return Response.json({ detail: error.detail }, { status: error.status });
    }
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
      return new Response(null, { status: 499 });
    }
    context.logger.error("Unhandled error", { error: message });
    return ctx.json({ detail: "Internal Server Error" }, { status: 500 });
  });

  return documentedRoutes as ControllerApplication;
};
