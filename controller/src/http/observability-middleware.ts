import { Cause, Effect, Exit } from "effect";
import type { MiddlewareHandler } from "hono";
import { isHttpStatus } from "../core/errors";
import type { AppContext } from "../app-context";
import { effectMiddleware, type ControllerEnvironment } from "./effect-handler";

export const TELEMETRY_SKIP_PATHS = new Set([
  "/health",
  "/metrics",
  "/events",
  "/status",
  "/api/docs",
  "/api/spec",
]);

function elapsedMs(start: number): number {
  return Math.round(performance.now() - start);
}

function errorClass(error: unknown): string {
  if (isHttpStatus(error)) return `Http${error.status}`;
  return (error as { name?: string } | null)?.name || "Error";
}

function errorMessage(error: unknown): string {
  if (isHttpStatus(error)) return error.detail;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function createControllerRequestObservabilityMiddleware(
  context: AppContext,
): MiddlewareHandler<ControllerEnvironment> {
  return effectMiddleware((ctx, next) => {
    if (TELEMETRY_SKIP_PATHS.has(ctx.req.path)) {
      return Effect.tryPromise({ try: () => next(), catch: (source) => source });
    }
    const start = performance.now();
    const method = ctx.req.method.toUpperCase();
    const path = ctx.req.path;
    const userAgent = ctx.req.header("user-agent") ?? null;
    return Effect.tryPromise({ try: () => next(), catch: (source) => source }).pipe(
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) {
          const status = ctx.res.status || 200;
          return context.stores.controllerRequestStore
            .recordEffect({
              method,
              path,
              status,
              duration_ms: elapsedMs(start),
              success: status >= 200 && status < 400,
              user_agent: userAgent,
            })
            .pipe(Effect.ignore);
        }
        const failure = Cause.findErrorOption(exit.cause);
        const error = failure._tag === "Some" ? failure.value : Cause.squash(exit.cause);
        return context.stores.controllerRequestStore
          .recordEffect({
            method,
            path,
            status: isHttpStatus(error) ? error.status : 500,
            duration_ms: elapsedMs(start),
            success: false,
            error_class: errorClass(error),
            error_message: errorMessage(error),
            user_agent: userAgent,
          })
          .pipe(Effect.ignore);
      }),
    );
  });
}
