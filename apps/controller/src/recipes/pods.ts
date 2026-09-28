import { randomBytes } from "node:crypto";
import { type LaunchProgress, PodLaunchBody, type PodRank } from "@local-studio/contracts";
import { type FabricPort, fabricPorts } from "@local-studio/probe";
import { Hono } from "hono";
import type { Ctx, Env, RecipeService, Services } from "../context";
import { HttpError } from "./util";

const subnet = (ip: string) => ip.split(".").slice(0, 3).join(".");

export const podRoutes = (ctx: Ctx, svc: Services, recipes: RecipeService): Hono<Env> => {
  const r = new Hono<Env>();

  const member = (machineId: string) => {
    if (machineId === ctx.identity.machineId) return { machineId, peerId: null as string | null, name: ctx.identity.name, gpus: svc.runtime.view().gpus };
    const m = svc.peers.fleet().machines.find((x) => x.machineId === machineId);
    if (!m?.peerId || !m.online || !m.snapshot) throw new HttpError(404, "MACHINE_NOT_FOUND", `machine ${machineId} is not connected`);
    return { machineId, peerId: m.peerId, name: m.snapshot.machine.name, gpus: m.snapshot.gpus };
  };

  const call = async <T>(peerId: string | null, method: string, path: string, body?: unknown): Promise<T> => {
    if (peerId === null) throw new Error("local call");
    const res = await svc.peers.fetch(peerId, path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), timeoutMs: 60_000 });
    const text = await res.text();
    const out = (text ? JSON.parse(text) : {}) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(out.error?.message ?? `HTTP ${res.status}`);
    return out;
  };

  const fabricOf = (peerId: string | null): Promise<FabricPort[]> => (peerId === null ? fabricPorts() : call<FabricPort[]>(peerId, "GET", "/api/host/fabric"));

  r.get("/api/host/fabric", async (c) => c.json(await fabricPorts()));

  r.delete("/api/pods/:id", async (c) => c.json({ removed: await svc.lifecycle.removePod(c.req.param("id")) }));

  r.post("/api/pods/:id/stop", async (c) => {
    const id = c.req.param("id");
    const peers = svc.peers.fleet().machines.filter((m) => m.peerId && m.online);
    const results = await Promise.all([
      svc.lifecycle.removePod(id).then((n) => ({ machine: ctx.identity.name, removed: n })),
      ...peers.map((m) => call<{ removed: number }>(m.peerId, "DELETE", `/api/pods/${id}`).then((x) => ({ machine: m.snapshot?.machine.name ?? m.machineId, removed: x.removed }), (e: unknown) => ({ machine: m.snapshot?.machine.name ?? m.machineId, removed: 0, error: String(e) }))),
    ]);
    return c.json({ podId: id, results });
  });

  r.post("/api/pods/launch", async (c) => {
    const parsed = PodLaunchBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    const { recipeId, machineIds } = parsed.data;
    const members = machineIds.map(member);
    const fabrics = await Promise.all(members.map((m) => fabricOf(m.peerId).catch(() => [] as FabricPort[])));
    const head = fabrics[0]?.[0];
    if (!head) throw new HttpError(409, "NO_FABRIC", `${members[0]?.name} has no RDMA port that is up with an address; a pod needs the fast network between machines`);
    const ports = fabrics.map((f, i) => {
      const p = f.find((x) => subnet(x.ip) === subnet(head.ip));
      if (!p) throw new HttpError(409, "NO_FABRIC", `${members[i]?.name} has no RDMA port on ${subnet(head.ip)}.0/24, where ${members[0]?.name} is`);
      return { port: p, hcas: f.map((x) => x.hca) };
    });
    const id = randomBytes(4).toString("hex");
    const size = members.length;
    const started: { m: (typeof members)[number]; rank: number; launch: LaunchProgress }[] = [];
    try {
      for (let rank = size - 1; rank >= 0; rank--) {
        const m = members[rank]!;
        const { port, hcas } = ports[rank]!;
        const pod: PodRank = {
          id,
          rank,
          size,
          vars: { NODE_RANK: String(rank), R: String(rank), HEAD_IP: head.ip, MASTER: head.ip, MASTER_ADDR: head.ip, MPORT: "29521", NNODES: String(size), MIP: port.ip, IB_HCA: hcas.join(","), MGMT_IF: port.ifname },
        };
        const gpuKeys = m.gpus.slice(0, 1).map((g) => g.key);
        const launch = m.peerId === null ? await recipes.launch(recipeId, gpuKeys, false, pod) : await call<LaunchProgress>(m.peerId, "POST", `/api/recipes/${encodeURIComponent(recipeId)}/launch`, { gpuKeys, pod });
        if (launch.phase === "failed") throw new Error(`${m.name}: ${launch.error ?? launch.detail}`);
        started.push({ m, rank, launch });
        ctx.log.info(`pod ${id}: rank ${rank} on ${m.name} (${port.ip} ${port.ifname})`);
      }
    } catch (e) {
      for (const s of started) await (s.m.peerId === null ? svc.lifecycle.removePod(id) : call(s.m.peerId, "DELETE", `/api/pods/${id}`)).catch(() => {});
      throw new HttpError(502, "POD_LAUNCH", `pod ${recipeId} not started: ${e instanceof Error ? e.message : String(e)}`);
    }
    return c.json({ podId: id, head: members[0]!.name, ranks: started.map((s) => ({ machine: s.m.name, rank: s.rank, launchId: s.launch.launchId, phase: s.launch.phase })) }, 202);
  });

  return r;
};
