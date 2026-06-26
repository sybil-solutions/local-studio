import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import type { AppContext } from "../app-context";
import { isHttpStatus } from "../core/errors";
import { registerEngineRoutes } from "../modules/engines/routes";
import { registerSystemRoutes } from "../modules/system/routes";
import { registerModelsRoutes } from "../modules/models/routes";

import { registerAllProxyRoutes } from "../modules/proxy/routes";
import { registerStudioRoutes } from "../modules/studio/routes";
import { registerAudioRoutes } from "../modules/audio/routes";
import { createOpenApiSpec } from "./openapi-spec";
import {
  createMutatingAuthMiddleware,
  createMutatingRateLimitMiddleware,
  createReadRateLimitMiddleware,
} from "./security-middleware";
import { createControllerRequestObservabilityMiddleware } from "./observability-middleware";

// Parse a comma-separated list of controller URLs into a set of origins. Used to
// allowlist cross-controller passthrough targets so the route cannot be turned
// into an SSRF/credential-reflection primitive against arbitrary hosts.
const parseOriginAllowlist = (raw: string | undefined): Set<string> => {
  const origins = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Ignore malformed entries.
    }
  }
  return origins;
};

export const createApp = (context: AppContext): Hono => {
  const app = new Hono();
  const allowedCorsOrigins = context.config.cors_origins ?? [];
  const allowedControllerOrigins = parseOriginAllowlist(
    process.env["LOCAL_STUDIO_CONTROLLER_ROUTE_ALLOWLIST"]
  );

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
    const skip = new Set(["/health", "/metrics", "/events", "/status", "/api/docs", "/api/spec"]);
    if (!skip.has(ctx.req.path)) {
      context.logger.debug(`${ctx.req.method} ${ctx.req.path}`);
    }
    await next();
  });

  app.use("*", createControllerRequestObservabilityMiddleware(context));
  app.use("*", createMutatingRateLimitMiddleware(context));
  app.use("*", createReadRateLimitMiddleware(context));
  app.use("*", createMutatingAuthMiddleware(context));

  registerSystemRoutes(app, context);
  registerEngineRoutes(app, context);
  registerModelsRoutes(app, context);
  registerStudioRoutes(app, context);
  registerAudioRoutes(app, context);
  registerAllProxyRoutes(app, context);

  app.get("/health", (ctx) => ctx.json({ status: "ok" }));

  app.all("/controllers/route/*", async (ctx) => {
    const target = ctx.req.query("target") || ctx.req.header("x-vllm-target-controller") || "";
    if (!target) return ctx.json({ detail: "target controller is required" }, { status: 400 });
    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
      if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      return ctx.json({ detail: "target must be an http(s) controller URL" }, { status: 400 });
    }
    // SSRF guard: only forward to controller origins the operator has explicitly
    // allowlisted. Without this, `target` could point at internal services
    // (cloud metadata, RFC1918 hosts) and the forwarded Authorization header
    // would leak the controller key to an attacker-chosen host. The feature is
    // off by default (empty allowlist => all targets rejected).
    if (!allowedControllerOrigins.has(targetUrl.origin)) {
      return ctx.json(
        {
          detail:
            "target controller origin is not allowlisted; set LOCAL_STUDIO_CONTROLLER_ROUTE_ALLOWLIST",
        },
        { status: 403 }
      );
    }
    const suffix = ctx.req.path.replace(/^\/controllers\/route\/?/, "");
    const upstream = new URL(suffix, `${targetUrl.toString().replace(/\/+$/, "")}/`);
    for (const [key, value] of new URL(ctx.req.url).searchParams.entries()) {
      if (key !== "target") upstream.searchParams.append(key, value);
    }
    const init: RequestInit = {
      method: ctx.req.method,
      headers: {
        "content-type": ctx.req.header("content-type") ?? "application/json",
        authorization: ctx.req.header("authorization") ?? "",
      },
    };
    if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") {
      init.body = await ctx.req.raw.clone().arrayBuffer();
    }
    // Do not auto-follow redirects: an allowlisted-but-compromised target must
    // not be able to bounce this request (with the forwarded key) elsewhere.
    init.redirect = "manual";
    const response = await fetch(upstream, init);
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "x-vllm-routed-controller": targetUrl.origin,
      },
    });
  });

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
