import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import type { Config } from "./config";
import type { KeyIdentity, KeyStore } from "./keys";

export interface AuthVars {
  client: string;
  admin: boolean;
  keyId: string | null;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

const READ_ONLY_DENY: RegExp[] = [
  /^\/api\/recipes\/[^/]+\/launch$/,
  /^\/api\/models\/[^/]+\/stop$/,
  /^\/api\/launches\/[^/]+\/cancel$/,
  /^\/api\/agents\/launch$/,
  /^\/api\/models\/[^/]+\/export\/pr$/,
  /^\/api\/peers\/[^/]+\/api\//,
];

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

const FEDERATION_DENY = /^\/api\/(keys|peers|agents|workspaces|machines)(\/|$)/;
const FEDERATION_ACTIONS: RegExp[] = [
  /^\/api\/recipes\/[^/]+\/launch$/,
  /^\/api\/models\/[^/]+\/stop$/,
  /^\/api\/launches\/[^/]+\/cancel$/,
  /^\/api\/models\/[^/]+\/export(\/pr)?$/,
  /^\/api\/recipes\/sync$/,
];

const federationAllows = (id: KeyIdentity, method: string, path: string): boolean => {
  if (FEDERATION_DENY.test(path)) return false;
  if (SAFE.has(method)) return true;
  return id.actions && FEDERATION_ACTIONS.some((r) => r.test(path));
};

const ownOrigins = (config: Config): Set<string> => {
  const out = new Set<string>();
  for (const h of ["127.0.0.1", "localhost", "[::1]"]) out.add(`http://${h}:${config.port}`);
  try {
    out.add(new URL(config.publicUrl).origin);
  } catch {}
  for (const o of (process.env.LOCAL_STUDIO_UI_ORIGIN ?? "").split(",")) if (o.trim()) out.add(o.trim().replace(/\/+$/, ""));
  return out;
};

export const normaliseClient = (raw: string | undefined | null): string | null => {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (/^[a-z][a-z0-9-]{1,31}$/.test(v)) return v;
  return null;
};

const clientFromUa = (ua: string | undefined): string => {
  const v = (ua ?? "").toLowerCase();
  if (v.includes("claude-cli") || v.includes("claude-code")) return "claude-code";
  if (v.includes("codex")) return "codex-cli";
  if (v.includes("dsh") || v.includes("pi-ai")) return "dsh";
  if (v.startsWith("omp/")) return "omp";
  if (/^pi(\/| \(|$)/.test(v)) return "pi";
  if (v.includes("zcode")) return "zcode";
  return "api";
};

export const authMiddleware = (config: Config, keys: KeyStore): MiddlewareHandler<{ Variables: AuthVars }> => {
  const origins = ownOrigins(config);
  return async (c, next) => {
    const path = c.req.path;
    if (path === "/health") return next();
    const auth = c.req.header("authorization");
    const token = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : c.req.header("x-api-key") ?? c.req.query("key") ?? "";
    const id = token ? keys.verify(token) : null;
    let remote = "";
    try {
      remote = getConnInfo(c).remote.address ?? "";
    } catch {}
    const origin = c.req.header("origin")?.replace(/\/+$/, "");
    const sameHost = !!origin && origin.replace(/^https?:\/\//, "") === (c.req.header("host") ?? "");
    const foreignOrigin = !!origin && !sameHost && !origins.has(origin);
    const mutating = !SAFE.has(c.req.method);
    if (path.startsWith("/api/") && mutating) {
      if (foreignOrigin) return c.json({ error: { code: "AUTH", message: `cross-origin request from ${origin} refused` } }, 403);
      const hasBody = Number(c.req.header("content-length") ?? 0) > 0 || !!c.req.header("transfer-encoding");
      if (hasBody && !(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json"))
        return c.json({ error: { code: "INVALID_REQUEST", message: "content-type must be application/json" } }, 415);
    }
    const loopbackTrusted = LOOPBACK.has(remote) && LOOPBACK_HOST.test(c.req.header("host") ?? "") && !foreignOrigin;
    const isApi = path.startsWith("/api/") || path.startsWith("/v1/");
    if (isApi && !id && !loopbackTrusted) return c.json({ error: { code: "AUTH", message: "missing or invalid API key" } }, 401);
    if (path.startsWith("/api/") && id && id.scope === "client") return c.json({ error: { code: "AUTH", message: "client keys may only call /v1/*" } }, 403);
    if (path.startsWith("/api/") && id && id.scope === "federation" && !federationAllows(id, c.req.method, path))
      return c.json({ error: { code: "AUTH", message: `federation keys may not call ${c.req.method} ${path}` } }, 403);
    if (config.readOnly && c.req.method !== "GET" && READ_ONLY_DENY.some((r) => r.test(path)))
      return c.json({ error: { code: "READ_ONLY", message: "this controller runs with --read-only" } }, 403);
    const headerClient = normaliseClient(c.req.header("x-local-studio-client"));
    c.set("admin", id ? id.admin : loopbackTrusted);
    c.set("keyId", id?.id ?? null);
    c.set("client", id && id.scope === "client" ? id.client : headerClient ?? (path.startsWith("/v1/") ? clientFromUa(c.req.header("user-agent")) : "ui"));
    return next();
  };
};
