import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
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
import { createOpenApiSpec } from "./openapi-spec";
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

export const createApp = (
  context: AppContext,
  runtime: ControllerRuntime,
): Hono<ControllerEnvironment> => {
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

  registerSystemRoutes(app, context);
  registerEngineRoutes(app, context);
  registerModelsRoutes(app, context);
  registerStudioRoutes(app, context);
  registerSpeechRoutes(app, context);
  registerAudioRoutes(app, context);
  registerAllProxyRoutes(app, context);

  app.get(
    "/health",
    effectHandler((ctx) => Effect.succeed(ctx.json({ status: "ok" }))),
  );

  app.get("/api/spec", (ctx) => ctx.json(createOpenApiSpec(context)));

  app.get("/api/docs", swaggerUI({ url: "/api/spec" }));

  app.notFound((ctx) => ctx.json({ detail: "Not Found" }, { status: 404 }));

  app.onError((error, ctx) => {
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

  return app;
};
