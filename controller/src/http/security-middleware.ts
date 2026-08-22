import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import type { MiddlewareHandler, Next } from "hono";
import type { AppContext } from "../app-context";
import { normalizeHttpOrigin, normalizeRequestAuthority } from "../config/request-authority";
import { effectMiddleware } from "./effect-handler";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC_PATHS = new Set<string>(["/health"]);
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 120;
const DEFAULT_READ_RATE_LIMIT_MAX_REQUESTS = 1200;
const READ_RATE_LIMIT_EXEMPT_PATHS = new Set<string>([
  "/health",
  "/status",
  "/metrics",
  "/events",
  "/api/spec",
]);
const RATE_LIMIT_STORE_CAP = 10_000;

type RateLimitEntry = { count: number; resetAt: number };

const mutatingRateLimitStore = new Map<string, RateLimitEntry>();
const readRateLimitStore = new Map<string, RateLimitEntry>();

const isReadRateLimitExempt = (method: string, path: string): boolean =>
  method.toUpperCase() === "OPTIONS" ||
  READ_RATE_LIMIT_EXEMPT_PATHS.has(path) ||
  path.endsWith("/stream") ||
  path.endsWith("/events");

const isMutatingRequest = (method: string): boolean => MUTATING_METHODS.has(method.toUpperCase());

const isPublicRequest = (method: string, path: string): boolean =>
  method.toUpperCase() === "OPTIONS" || PUBLIC_PATHS.has(path);

const getClientIpFromRequestHeaders = (header: (name: string) => string | undefined): string => {
  const cf = header("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = header("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = header("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (forwarded && forwarded.length > 0) return forwarded[forwarded.length - 1]!;
  return "unknown";
};

const pruneRateLimitStore = (store: Map<string, RateLimitEntry>, now: number): void => {
  if (store.size <= RATE_LIMIT_STORE_CAP) return;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
  let toEvict = store.size - RATE_LIMIT_STORE_CAP;
  for (const key of store.keys()) {
    if (toEvict <= 0) break;
    store.delete(key);
    toEvict -= 1;
  }
};

const extractAuthToken = (header: (name: string) => string | undefined): string | null => {
  const bearer = header("authorization");
  if (bearer) {
    const match = bearer.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  const apiKeyHeader = header("x-api-key");
  return apiKeyHeader?.trim() || null;
};

const safeTokenEquals = (expected: string, provided: string): boolean => {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
};

const rateLimitKey = (path: string, method: string, clientIp: string): string =>
  `${clientIp}:${method.toUpperCase()}:${path}`;

const nextEffect = (next: Next): Effect.Effect<void, unknown> =>
  Effect.tryPromise({ try: next, catch: (error) => error });

export function createKeylessRequestGuardMiddleware(context: AppContext): MiddlewareHandler {
  return effectMiddleware((ctx, next) =>
    Effect.suspend(() => {
      if (context.config.api_key?.trim()) return nextEffect(next);
      const authority = ctx.req.header("host");
      const host = authority ? normalizeRequestAuthority(authority, context.config.port) : null;
      const originHeader = ctx.req.header("origin");
      const origin = originHeader === undefined ? undefined : normalizeHttpOrigin(originHeader);
      if (
        !host ||
        !(context.config.allowed_hosts ?? []).includes(host) ||
        origin === null ||
        (origin !== undefined && !(context.config.cors_origins ?? []).includes(origin))
      ) {
        return Effect.succeed(ctx.json({ detail: "Forbidden request origin" }, { status: 403 }));
      }
      return nextEffect(next);
    }),
  );
}

export function createAuthMiddleware(context: AppContext): MiddlewareHandler {
  return effectMiddleware((ctx, next) =>
    Effect.suspend(() => {
      if (isPublicRequest(ctx.req.method, ctx.req.path)) return nextEffect(next);
      const expectedApiKey = context.config.api_key?.trim();
      if (!expectedApiKey) return nextEffect(next);
      const providedToken = extractAuthToken((name) => ctx.req.header(name));
      if (providedToken && safeTokenEquals(expectedApiKey, providedToken)) return nextEffect(next);
      ctx.header("WWW-Authenticate", 'Bearer realm="local-studio-controller"');
      return Effect.succeed(ctx.json({ detail: "Unauthorized" }, { status: 401 }));
    }),
  );
}

function createRateLimitMiddleware(config: {
  gate: (method: string, path: string) => boolean;
  store: Map<string, RateLimitEntry>;
  windowMs: number;
  maxRequests: number;
  emitHeaders: boolean;
}): MiddlewareHandler {
  const { gate, store, windowMs, maxRequests, emitHeaders } = config;
  return effectMiddleware((ctx, next) =>
    Effect.suspend(() => {
      if (!gate(ctx.req.method, ctx.req.path)) return nextEffect(next);
      const now = Date.now();
      const clientIp = getClientIpFromRequestHeaders((name) => ctx.req.header(name));
      const key = rateLimitKey(ctx.req.path, ctx.req.method, clientIp);
      const existing = store.get(key);
      const entry: RateLimitEntry =
        existing && existing.resetAt > now
          ? { count: existing.count + 1, resetAt: existing.resetAt }
          : { count: 1, resetAt: now + windowMs };
      store.set(key, entry);
      if (emitHeaders) {
        ctx.header("X-RateLimit-Limit", String(maxRequests));
        ctx.header("X-RateLimit-Remaining", String(Math.max(maxRequests - entry.count, 0)));
        ctx.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
      }
      if (entry.count > maxRequests) {
        ctx.header("Retry-After", String(Math.max(Math.ceil((entry.resetAt - now) / 1000), 1)));
        return Effect.succeed(ctx.json({ detail: "Rate limit exceeded" }, { status: 429 }));
      }
      pruneRateLimitStore(store, now);
      return nextEffect(next);
    }),
  );
}

export function createMutatingRateLimitMiddleware(
  _context: AppContext,
  options: { windowMs?: number; maxRequests?: number } = {},
): MiddlewareHandler {
  return createRateLimitMiddleware({
    gate: (method) => isMutatingRequest(method),
    store: mutatingRateLimitStore,
    windowMs: options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    maxRequests: options.maxRequests ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    emitHeaders: true,
  });
}

export function createReadRateLimitMiddleware(
  _context: AppContext,
  options: { windowMs?: number; maxRequests?: number } = {},
): MiddlewareHandler {
  return createRateLimitMiddleware({
    gate: (method, path) => !isMutatingRequest(method) && !isReadRateLimitExempt(method, path),
    store: readRateLimitStore,
    windowMs: options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    maxRequests: options.maxRequests ?? DEFAULT_READ_RATE_LIMIT_MAX_REQUESTS,
    emitHeaders: false,
  });
}
