import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { Hono } from "hono";
import type { ControllerEventType } from "@local-studio/contracts";
import type { Ctx, Env, Module, Services } from "./context";
import { createAgents } from "./agents";
import { authMiddleware } from "./core/auth";
import { createBus } from "./core/bus";
import type { Config } from "./core/config";
import { checkpoint, dbBytes, openDb } from "./core/db";
import { exec, fetchWithTimeout } from "./core/exec";
import { loadIdentity } from "./core/identity";
import { createKeyStore } from "./core/keys";
import { createLog, errText } from "./core/log";
import { createObs } from "./core/obs";
import { mountPairing } from "./core/pair";
import { buildSnapshot, snapshotKey } from "./core/snapshot";
import { createSse } from "./core/sse";
import { createDiscovery } from "./discovery";
import { createFederation } from "./federation";
import { createTailId, type TailId } from "./federation/tailid";
import { createGateway } from "./gateway";
import { createMetrics } from "./metrics";
import { createRecipes } from "./recipes";
import { HttpError } from "./recipes/util";

export interface App {
  ctx: Ctx;
  svc: Services;
  hono: Hono<Env>;
  start(): Promise<void>;
  quiesce(): void;
  stop(): Promise<void>;
}

export const createApp = (config: Config): App => {
  const bus = createBus();
  const db = openDb(config.dataDir);
  const obs = createObs();
  const sse = createSse(bus, obs);
  const ctx: Ctx = {
    config,
    db,
    bus,
    obs,
    log: createLog(bus, obs),
    keys: createKeyStore(db, config.dataDir, config.apiKeyOverride),
    identity: loadIdentity(config),
    exec,
    fetch: fetchWithTimeout,
    tail: undefined as unknown as TailId,
  };
  ctx.tail = createTailId(ctx);
  const svc = {} as Services;
  const discovery = createDiscovery(ctx, svc);
  svc.runtime = discovery.service.runtime;
  svc.lifecycle = discovery.service.lifecycle;
  const metrics = createMetrics(ctx, svc);
  svc.metrics = metrics.service;
  const federation = createFederation(ctx, svc);
  svc.peers = federation.service;
  const gateway = createGateway(ctx, svc);
  svc.gateway = gateway.service;
  const recipes = createRecipes(ctx, svc);
  svc.recipes = recipes.service;
  const agents = createAgents(ctx, svc);
  svc.agents = agents.service;
  const modules: Module<unknown>[] = [discovery, metrics, federation, gateway, recipes, agents];

  const hono = new Hono<Env>();
  obs.gauge("db.bytes", () => dbBytes(config.dataDir).db);
  obs.gauge("db.wal_bytes", () => dbBytes(config.dataDir).wal);
  hono.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    ctx.log.error(`${c.req.method} ${c.req.path}: ${errText(err)}`, "http");
    return c.json({ error: { code: "INTERNAL", message: err.message } }, 500);
  });
  hono.get("/health", (c) => c.json(ctx.identity.health()));
  hono.use("*", authMiddleware(config, ctx.keys, ctx.tail));
  hono.get("/metrics", (c) => c.text(obs.prom(), 200, { "content-type": "text/plain; version=0.0.4" }));
  hono.get("/api/health/detail", (c) => c.json(obs.health()));
  hono.get("/api/snapshot", (c) => c.json(buildSnapshot(svc)));
  hono.get("/api/fleet", (c) => c.json(svc.peers.fleet()));
  hono.get("/api/events", (c) => {
    const types = c.req.query("types");
    const filter = types ? new Set(types.split(",") as ControllerEventType[]) : null;
    return sse.response([{ type: "snapshot", data: buildSnapshot(svc) }], filter, c.req.raw.signal);
  });
  hono.get("/api/keys", (c) => c.json(ctx.keys.list()));
  mountPairing(hono, ctx.keys);
  for (const m of modules) if (m.routes) hono.route("/", m.routes);

  const uiDir = config.uiDir;
  if (uiDir) {
    hono.get("*", async (c) => {
      const p = normalize(c.req.path).replace(/^(\.\.[/\\])+/, "");
      if (/^\/(api|v1)\//.test(p)) return c.json({ error: { code: "NOT_FOUND", message: `no route ${p}` } }, 404);
      const file = join(uiDir, p);
      if (file.startsWith(uiDir) && p !== "/" && existsSync(file))
        return new Response(Bun.file(file), { headers: { "cache-control": p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" } });
      return new Response(Bun.file(join(uiDir, "index.html")), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    });
  }

  let snapTimer: ReturnType<typeof setInterval> | undefined;
  let lastKey = "";
  return {
    ctx,
    svc,
    hono,
    async start() {
      for (const m of modules) await m.start?.();
      snapTimer = setInterval(() => {
        const t = performance.now();
        try {
          const s = buildSnapshot(svc);
          obs.observe("snapshot_ms", performance.now() - t);
          const key = snapshotKey(s);
          if (key !== lastKey) {
            lastKey = key;
            bus.emit({ type: "snapshot", data: s });
          }
        } catch (e) {
          ctx.log.warn(`snapshot: ${errText(e)}`, "snapshot");
        }
      }, 1000);
    },
    quiesce() {
      clearInterval(snapTimer);
      sse.stop();
    },
    async stop() {
      this.quiesce();
      for (const m of [...modules].reverse()) {
        try {
          await m.stop?.();
        } catch (e) {
          ctx.log.warn(`shutdown: ${errText(e)}`, "shutdown");
        }
      }
      try {
        checkpoint(db);
      } catch {}
      obs.stop();
      db.close();
    },
  };
};
