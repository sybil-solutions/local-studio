import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { openAPIRouteHandler } from "hono-openapi";
import { Effect } from "effect";
import type { AppContext } from "../app-context";
import type { ControllerRuntime } from "../core/effect-runtime";
import { isHttpStatus } from "../core/errors";
import { registerEngineRoutes } from "../modules/engines/routes";
import { registerSystemRoutes } from "../modules/system/routes";
import { registerModelsRoutes } from "../modules/models/routes";

import { registerAllProxyRoutes } from "../modules/proxy/routes";
import { registerStudioRoutes } from "../modules/studio/routes";
import { registerAudioRoutes } from "../modules/audio/routes";
import { registerSpeechRoutes } from "../modules/speech/routes";
import { documentRoute, mergeRoutes, type ControllerRouteApp } from "./route-registrar";
import {
  createMutatingAuthMiddleware,
  createMutatingRateLimitMiddleware,
  createReadRateLimitMiddleware,
} from "./security-middleware";
import {
  createControllerRequestObservabilityMiddleware,
  TELEMETRY_SKIP_PATHS,
} from "./observability-middleware";
import {
  controllerRuntimeMiddleware,
  effectHandler,
  effectMiddleware,
  type ControllerEnvironment,
} from "./effect-handler";

type ControllerApplication = ReturnType<typeof registerSystemRoutes> &
  ReturnType<typeof registerEngineRoutes> &
  ReturnType<typeof registerModelsRoutes> &
  ReturnType<typeof registerStudioRoutes> &
  ReturnType<typeof registerSpeechRoutes> &
  ReturnType<typeof registerAudioRoutes> &
  ReturnType<typeof registerAllProxyRoutes>;

export const createApp = (
  context: AppContext,
  runtime: ControllerRuntime,
): ControllerApplication => {
  const app = new Hono<ControllerEnvironment>();
  const allowedCorsOrigins = context.config.cors_origins ?? [];

  app.use("*", controllerRuntimeMiddleware(runtime));

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
    }),
  );

  app.use(
    "*",
    effectMiddleware((ctx, next) =>
      Effect.sync(() => {
        if (!TELEMETRY_SKIP_PATHS.has(ctx.req.path)) {
          context.logger.debug(`${ctx.req.method} ${ctx.req.path}`);
        }
      }).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () => next(),
            catch: (error) => error,
          }),
        ),
      ),
    ),
  );

  app.use("*", createControllerRequestObservabilityMiddleware(context));
  app.use("*", createMutatingRateLimitMiddleware(context));
  app.use("*", createReadRateLimitMiddleware(context));
  app.use("*", createMutatingAuthMiddleware(context));

  const routes = mergeRoutes(
    registerSystemRoutes(app, context),
    registerEngineRoutes(app, context),
    registerModelsRoutes(app, context),
    registerStudioRoutes(app, context),
    registerSpeechRoutes(app, context),
    registerAudioRoutes(app, context),
    registerAllProxyRoutes(app, context),
    app.get(
      "/health",
      documentRoute,
      effectHandler((ctx) => Effect.succeed(ctx.json({ status: "ok" }))),
    ),
  );

  const documentedRoutes = mergeRoutes(
    routes,
    app.get(
      "/api/spec",
      openAPIRouteHandler(routes as ControllerRouteApp, {
        includeEmptyPaths: true,
        exclude: ["/*", "/api/spec", "/api/docs"],
        documentation: {
          info: {
            title: "Local Studio API",
            version: "2.0.0",
            description: "Model lifecycle management for local and remote inference runtimes",
          },
          servers: [
            {
              url: `http://localhost:${context.config.port}`,
              description: "Local Studio controller",
            },
          ],
        },
      }),
    ),
    app.get("/api/docs", swaggerUI({ url: "/api/spec" })),
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
