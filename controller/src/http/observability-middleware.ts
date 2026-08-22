import { Cause, Effect, Exit } from "effect";
import type { MiddlewareHandler } from "hono";
import { isHttpStatus } from "../core/errors";
import { elapsedMs, errorClass, errorMessage } from "../core/function-observability";
import type { AppContext } from "../app-context";
import { effectMiddleware, type ControllerEnvironment } from "./effect-handler";

const TELEMETRY_SKIP_PATHS = new Set([
  "/health",
  "/metrics",
  "/events",
  "/status",
  "/api/spec",
]);

const httpErrorClass = (error: unknown): string =>
  isHttpStatus(error) ? `Http${error.status}` : errorClass(error);

const httpErrorMessage = (error: unknown): string =>
  isHttpStatus(error) ? error.detail : errorMessage(error);

export function createControllerRequestObservabilityMiddleware(
  context: AppContext,
): MiddlewareHandler<ControllerEnvironment> {
  return effectMiddleware((ctx, next) => {
    if (TELEMETRY_SKIP_PATHS.has(ctx.req.path)) {
      return Effect.tryPromise({ try: () => next(), catch: (source) => source });
    }
    context.logger.debug(`${ctx.req.method} ${ctx.req.path}`);
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
            error_class: httpErrorClass(error),
            error_message: httpErrorMessage(error),
            user_agent: userAgent,
          })
          .pipe(Effect.ignore);
      }),
    );
  });
}
