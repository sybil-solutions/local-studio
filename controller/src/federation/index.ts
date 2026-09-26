import { Hono } from "hono";
import type { Activity, FleetSnapshot, GatewayModel, Snapshot } from "@local-studio/contracts";
import { ConnectPeerBody, emptyActivity } from "@local-studio/contracts";
import type { Ctx, Env, Module, PeerService, Services } from "../context";
import { buildSnapshot } from "../core/snapshot";
import { createPeerStore, toPeer } from "./peers";
import { createPoller } from "./poll";
import { cleanRequestHeaders, proxyToPeer, upstreamFetch } from "./proxy";
import { discoverTailnet } from "./tailnet";

const DAY_MS = 86_400_000;

const sumActivity = (list: Activity[]): Activity => {
  const valid = list.filter((a) => a && a.start);
  const base = valid[0];
  if (!base) return list[0] ?? emptyActivity();
  const baseT = Date.parse(`${base.start}T00:00:00Z`);
  const days = [...base.days];
  const out: Activity = { ...base, days, since: base.since, last: base.last };
  for (const a of valid.slice(1)) {
    const off = Math.round((Date.parse(`${a.start}T00:00:00Z`) - baseT) / DAY_MS);
    a.days.forEach((v, i) => {
      const j = i + off;
      if (j >= 0 && j < days.length) days[j] = (days[j] ?? 0) + v;
    });
    out.today += a.today;
    out.requests += a.requests;
    out.total += a.total;
    out.week += a.week;
    if (a.since && (!out.since || a.since < out.since)) out.since = a.since;
    if (a.last !== null && (out.last === null || a.last > out.last)) out.last = a.last;
  }
  return out;
};

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const createFederation = (ctx: Ctx, svc: Services): Module<PeerService> => {
  const store = createPeerStore(ctx);
  const poller = createPoller(ctx, store);
  poller.sync();

  const fleet = (): FleetSnapshot => {
    const self = safe<Snapshot | null>(() => buildSnapshot(svc), null);
    const states = [...poller.states.values()];
    const activities = [self?.activity ?? emptyActivity(), ...states.filter((s) => s.online && s.snapshot).map((s) => s.snapshot!.activity)];
    return {
      at: Date.now(),
      self: ctx.identity.machineId,
      machines: [
        { machineId: ctx.identity.machineId, peerId: null, online: true, error: self ? null : "local snapshot unavailable", snapshot: self },
        ...states.map((s) => ({ machineId: s.row.machine_id, peerId: s.row.id, online: s.online, error: s.error, snapshot: s.snapshot })),
      ],
      peers: safe(() => states.map(toPeer), []),
      activity: safe(() => sumActivity(activities), emptyActivity()),
      harnesses: safe(() => svc.agents.harnesses(), []),
      workspaces: safe(() => svc.agents.workspaces(), []),
    };
  };

  poller.onChange(() => {
    try {
      ctx.bus.emit({ type: "fleet", data: fleet() });
    } catch (e) {
      ctx.log.warn(`fleet event: ${String(e)}`, "federation.fleet");
    }
  });

  const models = (): GatewayModel[] => safe(peerModels, []);
  const peerModels = (): GatewayModel[] => {
    const local = new Set<string>();
    for (const m of safe(() => svc.runtime.models(), [])) for (const n of m.servedModels) local.add(n.toLowerCase());
    const taken = new Set(local);
    const out: GatewayModel[] = [];
    for (const s of poller.states.values()) {
      if (!s.online || !s.snapshot) continue;
      for (const m of s.snapshot.models ?? []) {
        if (m.state !== "ready") continue;
        const names = m.servedModels.length > 0 ? m.servedModels.map((s) => (s.startsWith("/") ? m.primaryModel : s)) : [m.primaryModel];
        for (const served of names) {
          const clash = taken.has(served.toLowerCase());
          taken.add(served.toLowerCase());
          out.push({
            id: clash ? `${s.row.name}/${served}` : served,
            machineId: s.row.machine_id,
            machineName: s.row.name,
            modelId: m.id,
            engine: m.engine,
            state: m.state,
            contextWindow: m.contextWindow,
            vision: m.vision,
            via: "peer",
          });
        }
      }
    }
    return out;
  };

  const service: PeerService = {
    list: () => [...poller.states.values()].map(toPeer),
    get: (id) => {
      const s = poller.states.get(id);
      return s ? toPeer(s) : undefined;
    },
    async fetch(id, path, init) {
      const s = poller.states.get(id);
      const key = s ? store.keyFor(id) : null;
      if (!s || !key) return Response.json({ error: { code: "PEER_NOT_FOUND", message: `no registered peer ${id}` } }, { status: 404 });
      const headers = cleanRequestHeaders(init?.headers as Record<string, string> | Headers | undefined);
      headers.set("authorization", `Bearer ${key}`);
      headers.set("x-local-studio-via", ctx.identity.machineId);
      const p = path.startsWith("/") ? path : `/${path}`;
      return upstreamFetch(ctx, `${s.row.base_url}${p}`, { ...init, headers });
    },
    models,
    fleet,
  };

  const routes = new Hono<Env>();
  routes.get("/api/machines", (c) => c.json(service.list()));

  routes.post("/api/machines", async (c) => {
    const parsed = ConnectPeerBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: "BAD_REQUEST", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } }, 400);
    const { row, snapshot, adminKey } = await store.connect(parsed.data);
    if (adminKey) ctx.log.warn(`peer ${row.name}: connected with its admin key; issue a scoped one there with \`local-studio key --federation\` and reconnect`);
    poller.sync();
    const s = poller.states.get(row.id);
    if (s) {
      s.snapshot = snapshot;
      s.online = true;
      s.misses = 0;
      s.error = null;
      s.version = snapshot.machine?.version ?? null;
    }
    ctx.log.info(`peer connected: ${row.name} ${row.base_url} (${row.id})`);
    if (s) ctx.bus.emit({ type: "peer", data: toPeer(s) });
    ctx.bus.emit({ type: "fleet", data: fleet() });
    return c.json(s ? { ...toPeer(s), ...(adminKey ? { warning: "this is the peer's admin key; a scoped key from `local-studio key --federation` limits what this hub can do there" } : {}) } : null, 201);
  });

  routes.delete("/api/machines/:id", (c) => {
    const id = c.req.param("id");
    const s = poller.states.get(id);
    if (!s || !store.remove(id)) return c.json({ error: { code: "PEER_NOT_FOUND", message: `no registered peer ${id}` } }, 404);
    poller.sync();
    ctx.log.info(`peer removed: ${s.row.name} (${id})`);
    ctx.bus.emit({ type: "fleet", data: fleet() });
    return c.json({ ok: true, id });
  });

  routes.get("/api/machines/discover", async (c) => {
    const peers = service.list();
    const known = {
      machineIds: new Set(peers.map((p) => p.machineId)),
      hosts: new Set(peers.map((p) => safe(() => new URL(p.baseUrl).hostname.toLowerCase(), ""))),
    };
    const { candidates, error } = await discoverTailnet(ctx, known);
    if (error) c.header("x-local-studio-warning", error);
    return c.json(candidates);
  });

  routes.all("/api/peers/:id/*", async (c) => {
    const id = c.req.param("id");
    const s = poller.states.get(id);
    const key = s ? store.keyFor(id) : null;
    if (!s || !key) return c.json({ error: { code: "PEER_NOT_FOUND", message: `no registered peer ${id}` } }, 404);
    const url = new URL(c.req.url);
    const prefix = `/api/peers/${id}`;
    const rest = url.pathname.slice(prefix.length) || "/";
    url.searchParams.delete("key");
    return proxyToPeer(ctx, { baseUrl: s.row.base_url, key }, `${rest}${url.search}`, c.req.raw);
  });

  return {
    service,
    routes,
    start: () => poller.start(),
    stop: () => poller.stop(),
  };
};
