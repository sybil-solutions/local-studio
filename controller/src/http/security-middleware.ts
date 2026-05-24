// CRITICAL
import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppContext } from "../types/context";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC_PATHS = new Set<string>();
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 120;

type MutatingRateLimitEntry = {
  count: number;
  resetAt: number;
};

const mutatingRateLimitStore = new Map<string, MutatingRateLimitEntry>();

/**
 *
 */
export function resetMutatingRateLimitStoreForTests(): void {
  mutatingRateLimitStore.clear();
}

/**
 *
 * @param method
 */
function isMutatingRequest(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/**
 *
 * @param method
 * @param path
 */
function isPublicRequest(method: string, path: string): boolean {
  return method.toUpperCase() === "OPTIONS" || PUBLIC_PATHS.has(path);
}

/**
 *
 * @param header
 */
function getClientIpFromRequestHeaders(header: (name: string) => string | undefined): string {
  const forwarded = header("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  const direct = header("cf-connecting-ip") ?? header("x-real-ip");
  return forwarded ?? direct ?? "unknown";
}

/**
 *
 * @param header
 */
function extractAuthToken(header: (name: string) => string | undefined): string | null {
  const bearer = header("authorization");
  if (bearer) {
    const match = bearer.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  const apiKeyHeader = header("x-api-key");
  if (apiKeyHeader?.trim()) {
    return apiKeyHeader.trim();
  }

  return null;
}

/**
 *
 * @param expected
 * @param provided
 */
function safeTokenEquals(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 *
 * @param path
 * @param method
 * @param clientIp
 */
function buildMutatingRateLimitKey(path: string, method: string, clientIp: string): string {
  return `${clientIp}:${method.toUpperCase()}:${path}`;
}

/**
 *
 * @param context
 */
export function createMutatingAuthMiddleware(context: AppContext): MiddlewareHandler {
  return async (ctx, next) => {
    if (isPublicRequest(ctx.req.method, ctx.req.path)) {
      return next();
    }

    const expectedApiKey = context.config.api_key?.trim();
    if (!expectedApiKey) {
      // No API key configured and allow_unauthenticated is false -> deny
      if (!context.config.allow_unauthenticated) {
        ctx.header("WWW-Authenticate", 'Bearer realm="vllm-studio-controller"');
        return ctx.json({ detail: "Unauthorized - API key required" }, { status: 401 });
      }
      return next();
    }

    const providedToken = extractAuthToken((name) => ctx.req.header(name));
    if (providedToken && safeTokenEquals(expectedApiKey, providedToken)) {
      return next();
    }

    ctx.header("WWW-Authenticate", 'Bearer realm="vllm-studio-controller"');
    return ctx.json({ detail: "Unauthorized" }, { status: 401 });
  };
}

/**
 *
 * @param _context
 * @param options
 * @param options.windowMs
 * @param options.maxRequests
 */
export function createMutatingRateLimitMiddleware(
  _context: AppContext,
  options: {
    windowMs?: number;
    maxRequests?: number;
  } = {}
): MiddlewareHandler {
  const windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS;

  return async (ctx, next) => {
    if (!isMutatingRequest(ctx.req.method)) {
      return next();
    }

    const now = Date.now();
    const clientIp = getClientIpFromRequestHeaders((name) => ctx.req.header(name));
    const key = buildMutatingRateLimitKey(ctx.req.path, ctx.req.method, clientIp);

    const existing = mutatingRateLimitStore.get(key);
    const inWindow = Boolean(existing && existing.resetAt > now);

    const entry: MutatingRateLimitEntry = inWindow
      ? { count: existing!.count + 1, resetAt: existing!.resetAt }
      : { count: 1, resetAt: now + windowMs };

    mutatingRateLimitStore.set(key, entry);

    const remaining = Math.max(maxRequests - entry.count, 0);
    ctx.header("X-RateLimit-Limit", String(maxRequests));
    ctx.header("X-RateLimit-Remaining", String(remaining));
    ctx.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      const retryAfterSeconds = Math.max(Math.ceil((entry.resetAt - now) / 1000), 1);
      ctx.header("Retry-After", String(retryAfterSeconds));
      return ctx.json({ detail: "Rate limit exceeded" }, { status: 429 });
    }

    if (mutatingRateLimitStore.size > 10_000) {
      for (const [storedKey, storedEntry] of mutatingRateLimitStore) {
        if (storedEntry.resetAt <= now) {
          mutatingRateLimitStore.delete(storedKey);
        }
      }
    }

    return next();
  };
}
