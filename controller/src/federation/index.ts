import { Hono } from "hono";
import type { Activity, FleetSnapshot, GatewayModel, Snapshot } from "@local-studio/contracts";
import { ConnectPeerBody, emptyActivity, fleetTotals } from "@local-studio/contracts";
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
    const machines = [
      { machineId: ctx.identity.machineId, peerId: null, online: true, error: self ? null : "local snapshot unavailable", snapshot: self },
      ...states.map((s) => ({ machineId: s.row.machine_id, peerId: s.row.id, online: s.online, error: s.error, snapshot: s.snapshot })),
    ];
    return {
      at: Date.now(),
      self: ctx.identity.machineId,
      machines,
      totals: safe(() => fleetTotals(machines), fleetTotals([])),
      peers: safe(() => states.map(toPeer), []),
      activity: safe(() => sumActivity(activities), emptyActivity()),
      harnesses: safe(() => svc.agents.harnesses(), []),
      sessions: safe(() => svc.agents.sessions(), []),
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
        if (m.state !== "ready" || m.embedding || (m.modality ?? "chat") !== "chat") continue;
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
      if (!s) return Response.json({ error: { code: "PEER_NOT_FOUND", message: `no registered peer ${id}` } }, { status: 404 });
      const headers = cleanRequestHeaders(init?.headers as Record<string, string> | Headers | undefined);
      if (key) headers.set("authorization", `Bearer ${key}`);
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
    const { s, adminKey } = await link(parsed.data.url, parsed.data.key);
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

  const knownPeers = () => {
    const peers = service.list();
    return {
      machineIds: new Set([ctx.identity.machineId, ...peers.map((p) => p.machineId)]),
      hosts: new Set(peers.map((p) => safe(() => new URL(p.baseUrl).hostname.toLowerCase(), ""))),
    };
  };

  const link = async (url: string, key?: string) => {
    const { row, snapshot, adminKey } = await store.connect({ url, key });
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
    ctx.log.info(`peer connected: ${row.name} ${row.base_url} (${row.id}${key ? "" : ", tailnet"})`);
    if (s) ctx.bus.emit({ type: "peer", data: toPeer(s) });
    ctx.bus.emit({ type: "fleet", data: fleet() });
    return { s, adminKey };
  };

  const auto = ctx.config.tailnet && (process.env.LOCAL_STUDIO_TAILNET_AUTO ?? "1") !== "0";
  const refused = new Map<string, number>();
  let autoTimer: ReturnType<typeof setInterval> | null = null;
  let autoRunning = false;
  const autoConnect = async () => {
    if (autoRunning) return;
    autoRunning = true;
    try {
      const { candidates, error } = await discoverTailnet(ctx, knownPeers());
      if (error) return;
      for (const c of candidates) {
        if (c.kind !== "local-studio" || c.alreadyConnected || !c.mine || !c.machineId || store.ignored(c.machineId)) continue;
        if ((refused.get(c.machineId) ?? 0) > Date.now()) continue;
        try {
          await link(c.url);
        } catch (e) {
          refused.set(c.machineId, Date.now() + 10 * 60_000);
          ctx.log.info(`tailnet: ${c.hostName} not linked: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      autoRunning = false;
    }
  };

  routes.get("/api/machines/discover", async (c) => {
    const { candidates, error } = await discoverTailnet(ctx, knownPeers());
    if (error) c.header("x-local-studio-warning", error);
    return c.json(candidates);
  });

  routes.get("/api/tailnet", async (c) => {
    const me = await ctx.tail.self();
    return c.json({ signedIn: !!me, login: me?.login ?? null, tailnet: me?.tailnet ?? null, trust: ctx.tail.trust, auto });
  });

  routes.all("/api/peers/:id/*", async (c) => {
    const id = c.req.param("id");
    const s = poller.states.get(id);
    const key = s ? store.keyFor(id) : null;
    if (!s) return c.json({ error: { code: "PEER_NOT_FOUND", message: `no registered peer ${id}` } }, 404);
    const url = new URL(c.req.url);
    const prefix = `/api/peers/${id}`;
    const rest = url.pathname.slice(prefix.length) || "/";
    url.searchParams.delete("key");
    return proxyToPeer(ctx, { baseUrl: s.row.base_url, key }, `${rest}${url.search}`, c.req.raw);
  });

  return {
    service,
    routes,
    start: () => {
      poller.start();
      if (auto) {
        setTimeout(() => void autoConnect(), 3000);
        autoTimer = setInterval(() => void autoConnect(), 60_000);
      }
    },
    stop: () => {
      if (autoTimer) clearInterval(autoTimer);
      poller.stop();
    },
  };
};
