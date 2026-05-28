import type { MiddlewareHandler } from "hono";
import { isHttpStatus } from "../core/errors";
import type { AppContext } from "../types/context";

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
  context: AppContext
): MiddlewareHandler {
  return async (ctx, next) => {
    const start = performance.now();
    const method = ctx.req.method.toUpperCase();
    const path = ctx.req.path;
    const userAgent = ctx.req.header("user-agent") ?? null;

    try {
      await next();
      const status = ctx.res.status || 200;
      context.stores.controllerRequestStore.record({
        method,
        path,
        status,
        duration_ms: elapsedMs(start),
        success: status >= 200 && status < 400,
        user_agent: userAgent,
      });
    } catch (error) {
      context.stores.controllerRequestStore.record({
        method,
        path,
        status: isHttpStatus(error) ? error.status : 500,
        duration_ms: elapsedMs(start),
        success: false,
        error_class: errorClass(error),
        error_message: errorMessage(error),
        user_agent: userAgent,
      });
      throw error;
    }
  };
}
