import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadDotEnvironment } from "./config/env";

/**
 * Passthrough proxy mode: a lightweight controller that owns no engine, GPUs,
 * or local stores and transparently forwards every request to an upstream
 * controller. Activated by LOCAL_STUDIO_UPSTREAM_URL. It deliberately skips
 * AppContext (SQLite stores, process/download managers, metrics collector,
 * models_dir requirement) so it can run on machines with no models or GPUs.
 *
 * Local behavior in proxy mode:
 * - `/proxy/health` reports the proxy process itself plus upstream reachability.
 * - Everything else — including `/health` — is forwarded, so clients observe
 *   the upstream's real availability instead of a false local "ok".
 * - Inbound auth uses LOCAL_STUDIO_API_KEY (same rule as the full controller:
 *   required on non-loopback binds); the upstream key is attached on the way
 *   out and never exposed to local clients.
 * - Rate limiting and request observability are intentionally not applied:
 *   the upstream already enforces both, and double-counting would skew its
 *   accounting.
 */
export interface ProxyModeConfig {
  host: string;
  port: number;
  api_key?: string;
  upstream_url: string;
  upstream_api_key?: string;
  cors_origins: string[];
}

/** RFC 9110 connection-scoped headers that must not be forwarded either way. */
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

const PUBLIC_PROXY_PATHS = new Set<string>(["/health", "/proxy/health"]);

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://host.docker.internal:3000",
  "http://host.docker.internal:3001",
];

const isLoopbackHost = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
};

const parseOrigins = (value: string | undefined): string[] => {
  const candidates =
    value && value.trim().length > 0
      ? value.split(",").map((entry) => entry.trim())
      : DEFAULT_CORS_ORIGINS;
  const origins = candidates.flatMap((entry) => {
    try {
      const origin = new URL(entry).origin;
      return origin === "null" ? [] : [origin];
    } catch {
      return [];
    }
  });
  return [...new Set(origins)];
};

export const isProxyModeEnabled = (): boolean =>
  Boolean(process.env["LOCAL_STUDIO_UPSTREAM_URL"]?.trim());

export const createProxyModeConfig = (): ProxyModeConfig => {
  loadDotEnvironment();

  const upstreamRaw = process.env["LOCAL_STUDIO_UPSTREAM_URL"]?.trim();
  if (!upstreamRaw) {
    throw new Error("LOCAL_STUDIO_UPSTREAM_URL is required to start the controller in proxy mode");
  }
  let upstream: URL;
  try {
    upstream = new URL(upstreamRaw);
  } catch {
    throw new Error(`LOCAL_STUDIO_UPSTREAM_URL is not a valid URL: ${upstreamRaw}`);
  }
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error(`LOCAL_STUDIO_UPSTREAM_URL must be http(s), got ${upstream.protocol}`);
  }

  const host = process.env["LOCAL_STUDIO_HOST"]?.trim() || "127.0.0.1";
  const portRaw = process.env["LOCAL_STUDIO_PORT"];
  const port = portRaw === undefined ? 8080 : Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`LOCAL_STUDIO_PORT must be a positive integer, got ${portRaw}`);
  }

  const config: ProxyModeConfig = {
    host,
    port,
    upstream_url: upstream.origin + (upstream.pathname === "/" ? "" : upstream.pathname),
    cors_origins: parseOrigins(process.env["LOCAL_STUDIO_CORS_ORIGINS"]),
  };

  const apiKey = process.env["LOCAL_STUDIO_API_KEY"]?.trim();
  if (apiKey) config.api_key = apiKey;
  const upstreamApiKey = process.env["LOCAL_STUDIO_UPSTREAM_API_KEY"]?.trim();
  if (upstreamApiKey) config.upstream_api_key = upstreamApiKey;

  const allowUnauthenticated =
    process.env["LOCAL_STUDIO_ALLOW_UNAUTHENTICATED"]?.trim().toLowerCase() === "true";
  if (!config.api_key && !allowUnauthenticated && !isLoopbackHost(host)) {
    throw new Error(
      "LOCAL_STUDIO_API_KEY is required when binding the proxy controller to a non-loopback host. Set LOCAL_STUDIO_ALLOW_UNAUTHENTICATED=true only for trusted local environments.",
    );
  }

  return config;
};

export const buildUpstreamUrl = (upstreamBase: string, requestUrl: string): URL => {
  const inbound = new URL(requestUrl);
  const base = new URL(upstreamBase);
  const basePath = base.pathname.endsWith("/") ? base.pathname.slice(0, -1) : base.pathname;
  const target = new URL(base.origin);
  target.pathname = `${basePath}${inbound.pathname}`;
  target.search = inbound.search;
  return target;
};

export const buildForwardHeaders = (
  requestHeaders: Headers,
  upstreamApiKey: string | undefined,
): Headers => {
  const headers = new Headers(requestHeaders);
  headers.delete("host");
  headers.delete("authorization");
  headers.delete("x-api-key");
  // The body is re-streamed, so any inbound framing headers are stale.
  headers.delete("content-length");
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  if (upstreamApiKey) headers.set("authorization", `Bearer ${upstreamApiKey}`);
  return headers;
};

export const buildResponseHeaders = (upstreamHeaders: Headers): Headers => {
  const headers = new Headers(upstreamHeaders);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  // fetch already decoded the body; the original encoding/length no longer apply.
  headers.delete("content-encoding");
  headers.delete("content-length");
  return headers;
};

const extractInboundToken = (headers: Headers): string | null => {
  const bearer = headers.get("authorization");
  if (bearer) {
    const match = bearer.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  return headers.get("x-api-key")?.trim() || null;
};

const inboundTokenMatches = (expected: string, provided: string | null): boolean => {
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
};

const passthrough = async (request: Request, config: ProxyModeConfig): Promise<Response> => {
  const target = buildUpstreamUrl(config.upstream_url, request.url);
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: buildForwardHeaders(request.headers, config.upstream_api_key),
    redirect: "manual",
    signal: request.signal,
  };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    // Stream the body through untouched — audio uploads and model downloads
    // are far too large to buffer.
    init.body = request.body;
    init.duplex = "half";
  }
  const upstream = await fetch(target, init);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildResponseHeaders(upstream.headers),
  });
};

export const createProxyApp = (config: ProxyModeConfig): Hono => {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => (config.cors_origins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "X-API-Key"],
      maxAge: 600,
    }),
  );

  app.use("*", async (ctx, next) => {
    if (ctx.req.method === "OPTIONS" || PUBLIC_PROXY_PATHS.has(ctx.req.path)) return next();
    const expected = config.api_key;
    if (!expected) return next();
    if (inboundTokenMatches(expected, extractInboundToken(ctx.req.raw.headers))) return next();
    ctx.header("WWW-Authenticate", 'Bearer realm="local-studio-controller"');
    return ctx.json({ detail: "Unauthorized" }, { status: 401 });
  });

  app.get("/proxy/health", async (ctx) => {
    let upstreamHealth = "unreachable";
    try {
      const response = await fetch(`${config.upstream_url}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      upstreamHealth = response.ok ? "ok" : `http_${response.status}`;
    } catch {
      // upstream unreachable; reported below
    }
    return ctx.json({
      status: "ok",
      mode: "proxy",
      upstream: config.upstream_url,
      upstream_health: upstreamHealth,
    });
  });

  app.all("*", async (ctx) => {
    try {
      return await passthrough(ctx.req.raw, config);
    } catch (error) {
      const message = String(error);
      if (message.includes("AbortError") || message.includes("aborted")) {
        return new Response(null, { status: 499 });
      }
      return ctx.json({ detail: `Upstream controller unreachable: ${message}` }, { status: 502 });
    }
  });

  return app;
};

export const startProxyMode = (): ReturnType<typeof Bun.serve> => {
  const config = createProxyModeConfig();
  const app = createProxyApp(config);
  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: app.fetch,
    idleTimeout: 120,
  });
  const authMode = config.api_key ? "api-key" : "unauthenticated (no LOCAL_STUDIO_API_KEY)";
  console.log(
    [
      "Controller in passthrough proxy mode:",
      `listen=${config.host}:${server.port}`,
      `upstream=${config.upstream_url}`,
      `upstream_auth=${config.upstream_api_key ? "api-key" : "none"}`,
      `auth=${authMode}`,
    ].join(" "),
  );
  return server;
};
