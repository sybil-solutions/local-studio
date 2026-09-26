import type { GatewayModel, Peer, RunningModel } from "@local-studio/contracts";
import type { Ctx, Services } from "../context";

export type Route =
  | { kind: "local"; model: RunningModel; served: string }
  | { kind: "peer"; peer: Peer; served: string; gm: GatewayModel }
  | { kind: "loading"; model: RunningModel; served: string }
  | { kind: "missing" };

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const servedName = (m: RunningModel, name: string): string => m.servedModels.find((s) => eq(s, name)) ?? m.servedModels[0] ?? m.primaryModel;

export const listedName = (m: { primaryModel: string }, id: string): string => (id.startsWith("/") ? m.primaryModel : id);

const matchLocal = (models: RunningModel[], name: string): RunningModel | undefined =>
  models.find((m) => m.servedModels.some((s) => eq(s, name))) ?? models.find((m) => m.recipeId !== null && eq(m.recipeId, name)) ?? models.find((m) => eq(m.primaryModel, name)) ?? models.find((m) => eq(m.id, name));

export const resolveModel = (svc: Services, name: string): Route => {
  const local = svc.runtime.resolveServed(name) ?? matchLocal(svc.runtime.models(), name);
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
  const local: GatewayModel[] = svc.runtime.models()
    .filter((m) => (m.state === "ready" || m.state === "loading") && !m.embedding)
    .flatMap((m) =>
      m.servedModels.map((id) => ({
        id: listedName(m, id),
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
