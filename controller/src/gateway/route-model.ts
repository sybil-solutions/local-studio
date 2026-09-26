import type { GatewayModel, Peer, RunningModel } from "@local-studio/contracts";
import type { Ctx, Services } from "../context";

export type Route =
  | { kind: "local"; model: RunningModel; served: string }
  | { kind: "peer"; peer: Peer; served: string; gm: GatewayModel }
  | { kind: "loading"; model: RunningModel; served: string }
  | { kind: "missing" };

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();


const devUpstream = (): string | null => {
  const u = process.env.LOCAL_STUDIO_DEV_UPSTREAM;
  return u ? u.replace(/\/+$/, "") : null;
};

let devCache: { at: number; models: RunningModel[] } = { at: 0, models: [] };
let devInflight: Promise<RunningModel[]> | null = null;

const devSynth = async (ctx: Ctx): Promise<RunningModel[]> => {
  const base = devUpstream();
  if (!base) return [];
  if (Date.now() - devCache.at < 10_000) return devCache.models;
  devInflight ??= (async () => {
    try {
      const r = await ctx.fetch(`${base}/v1/models`, { timeoutMs: 2000 });
      const j = (await r.json()) as { data?: { id: string; max_model_len?: number }[] };
      const port = Number(new URL(base).port || 80);
      const data = j.data ?? [];
      const first = data[0];
      const models: RunningModel[] = first
        ? [
            {
              id: process.env.LOCAL_STUDIO_DEV_MODEL_ID ?? `dev-${port}`,
              machineId: ctx.identity.machineId,
              engine: "vllm",
              engineVersion: null,
              state: "ready",
              stateSince: Date.now(),
              origin: "adopted",
              recipeId: null,
              servedModels: data.map((d) => d.id),
              primaryModel: first.id,
              contextWindow: first.max_model_len ?? null,
              vision: null,
              port,
              baseUrl: base,
              metricsUrl: `${base}/metrics`,
              nativeDialects: ["chat"],
              runtime: { kind: "external", note: "dev upstream" },
              argv: [],
              gpuKeys: [],
              vramUsedMiB: null,
              startedAt: null,
              cache: null,
              spec: null,
              watchdog: null,
              error: null,
              stopBlocked: "dev upstream",
              embedding: false,
            },
          ]
        : [];
      devCache = { at: Date.now(), models };
      return models;
    } catch {
      devCache = { at: Date.now(), models: [] };
      return [];
    } finally {
      devInflight = null;
    }
  })();
  return devInflight;
};

export const devModels = (): RunningModel[] => (devUpstream() ? devCache.models : []);

export const refreshDevModels = (ctx: Ctx): Promise<RunningModel[]> => devSynth(ctx);

export const localModels = (svc: Services): RunningModel[] => {
  const real = svc.runtime.models();
  const dev = devModels().filter((d) => !real.some((m) => m.baseUrl === d.baseUrl || m.servedModels.some((s) => d.servedModels.includes(s))));
  return [...real, ...dev];
};

export const findModel = (svc: Services, id: string): RunningModel | undefined => svc.runtime.model(id) ?? devModels().find((m) => m.id === id);

const servedName = (m: RunningModel, name: string): string => m.servedModels.find((s) => eq(s, name)) ?? m.primaryModel;

const matchLocal = (models: RunningModel[], name: string): RunningModel | undefined =>
  models.find((m) => m.servedModels.some((s) => eq(s, name))) ?? models.find((m) => m.recipeId !== null && eq(m.recipeId, name)) ?? models.find((m) => eq(m.id, name));

export const resolveModel = async (ctx: Ctx, svc: Services, name: string): Promise<Route> => {
  const real = svc.runtime.resolveServed(name) ?? matchLocal(svc.runtime.models(), name);
  const local = real ?? matchLocal(await devSynth(ctx), name);
  if (local) {
    const served = servedName(local, name);
    if (local.state === "ready") return { kind: "local", model: local, served };
    return { kind: "loading", model: local, served };
  }
  const peers = svc.peers.list();
  const pm = svc.peers.models();
  const byPeer = (gm: GatewayModel) => peers.find((p) => p.machineId === gm.machineId);
  const direct = pm.find((g) => eq(g.id, name));
  const slash = name.indexOf("/");
  const candidates: { gm: GatewayModel; served: string }[] = [];
  if (direct) {
    const prefix = `${byPeer(direct)?.name ?? ""}/`.toLowerCase();
    candidates.push({ gm: direct, served: direct.id.toLowerCase().startsWith(prefix) ? direct.id.slice(prefix.length) : direct.id });
  }
  if (slash > 0) {
    const peerName = name.slice(0, slash);
    const rest = name.slice(slash + 1);
    const peer = peers.find((p) => eq(p.name, peerName) || eq(p.id, peerName));
    const gm = peer && pm.find((g) => g.machineId === peer.machineId && (eq(g.id, rest) || eq(g.id, `${peer.name}/${rest}`)));
    if (gm) candidates.push({ gm, served: rest });
  }
  for (const c of candidates) {
    const peer = byPeer(c.gm);
    if (peer) return { kind: "peer", peer, served: c.served, gm: c.gm };
  }
  return { kind: "missing" };
};

export const gatewayModels = (ctx: Ctx, svc: Services): GatewayModel[] => {
  const machineName = ctx.identity.name;
  const local: GatewayModel[] = localModels(svc)
    .filter((m) => (m.state === "ready" || m.state === "loading") && !m.embedding)
    .flatMap((m) =>
      m.servedModels.map((id) => ({
        id,
        machineId: m.machineId,
        machineName,
        modelId: m.id,
        engine: m.engine,
        state: m.state,
        contextWindow: m.contextWindow,
        vision: m.vision,
        via: "local" as const,
      })),
    );
  const seen = new Set(local.map((g) => g.id.toLowerCase()));
  const peers = svc.peers.models().filter((g) => !seen.has(g.id.toLowerCase()));
  return [...local, ...peers];
};
