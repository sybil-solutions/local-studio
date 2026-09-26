import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { Hono } from "hono";
import type { ControllerEventType } from "@local-studio/contracts";
import type { Ctx, Env, Module, Services } from "./context";
import { createAgents } from "./agents";
import { authMiddleware } from "./core/auth";
import { createBus } from "./core/bus";
import type { Config } from "./core/config";
import { openDb } from "./core/db";
import { exec, fetchWithTimeout } from "./core/exec";
import { loadIdentity } from "./core/identity";
import { createKeyStore } from "./core/keys";
import { createLog } from "./core/log";
import { buildSnapshot, snapshotKey } from "./core/snapshot";
import { sseResponse } from "./core/sse";
import { createDiscovery } from "./discovery";
import { createFederation } from "./federation";
import { createGateway } from "./gateway";
import { createMetrics } from "./metrics";
import { createRecipes } from "./recipes";

export interface App {
  ctx: Ctx;
  svc: Services;
  hono: Hono<Env>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const createApp = (config: Config): App => {
  const bus = createBus();
  const db = openDb(config.dataDir);
  const ctx: Ctx = {
    config,
    db,
    bus,
    log: createLog(bus),
    keys: createKeyStore(db, config.dataDir, config.apiKeyOverride),
    identity: loadIdentity(config),
    exec,
    fetch: fetchWithTimeout,
  };
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
  hono.onError((err, c) => {
    ctx.log.error(`${c.req.method} ${c.req.path}: ${err.message}`);
    return c.json({ error: { code: "INTERNAL", message: err.message } }, 500);
  });
  hono.get("/health", (c) => c.json(ctx.identity.health()));
  hono.use("*", authMiddleware(config, ctx.keys));
  hono.get("/api/snapshot", (c) => c.json(buildSnapshot(svc)));
  hono.get("/api/fleet", (c) => c.json(svc.peers.fleet()));
  hono.get("/api/events", (c) => {
    const types = c.req.query("types");
    const filter = types ? new Set(types.split(",") as ControllerEventType[]) : null;
    return sseResponse(bus, [{ type: "snapshot", data: buildSnapshot(svc) }], filter, c.req.raw.signal);
  });
  hono.get("/api/keys", (c) => c.json(ctx.keys.list()));
  for (const m of modules) if (m.routes) hono.route("/", m.routes);

  const uiDir = config.uiDir;
  if (uiDir) {
    hono.get("*", async (c) => {
      const p = normalize(c.req.path).replace(/^(\.\.[/\\])+/, "");
      const file = join(uiDir, p);
      if (file.startsWith(uiDir) && p !== "/" && existsSync(file)) return new Response(Bun.file(file));
      return new Response(Bun.file(join(uiDir, "index.html")), { headers: { "content-type": "text/html; charset=utf-8" } });
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
        try {
          const s = buildSnapshot(svc);
          const key = snapshotKey(s);
          if (key !== lastKey) {
            lastKey = key;
            bus.emit({ type: "snapshot", data: s });
          }
        } catch (e) {
          ctx.log.warn(`snapshot: ${String(e)}`);
        }
      }, 1000);
    },
    async stop() {
      clearInterval(snapTimer);
      for (const m of [...modules].reverse()) await m.stop?.();
      db.close();
    },
  };
};
