import { timingSafeEqual } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  LOCAL_STUDIO_CONTROLLER_HEADER,
  type LocalGpu,
  type LocalModel,
  type LocalNode,
  LocalPeerRequest,
  type LocalRecipes,
  LocalRunRequest,
  type LocalSnapshot,
} from "../../../packages/contracts/src/localStudio.ts";
import { errorResponse, HttpError, json, loadConfig, now, port, saveConfig, VERSION } from "./core.ts";
import { listeners, makeScanner } from "./discovery.ts";
import { autoModel, HOP_HEADER, listModels, passthrough, routes } from "./gateway.ts";
import { graphUsage, makeGraph, makeUsage, normUrl } from "./graph.ts";
import { gpuBusy, hardware, type RawGpu, readGpus } from "./hardware.ts";
import { makeJobs } from "./jobs.ts";
import { type Catalog, loadCatalog, matchCard, servedName, toLocalRecipe } from "./registry.ts";

let config = loadConfig();
const SCAN_MS = 10_000;
const REGISTRY_MS = 30 * 60_000;

let catalog: Catalog = { info: { source: config.registry.url, ref: config.registry.ref, commit: null, error: "loading" }, cards: {}, recipes: new Map(), archived: [], captured: [] };
let rawGpus: RawGpu[] = [];
const usage = makeUsage();

const gpus = (): LocalGpu[] => {
  const reserved = jobs.reserved();
  const owner = (i: number) => jobs.list().find((j) => j.gpus.includes(i) && reserved.has(i))?.id ?? null;
  return rawGpus.map(({ apps: _apps, ...g }) => ({
    ...g,
    card: matchCard(catalog, g.name, g.memoryTotalMiB),
    busy: gpuBusy({ ...g, apps: _apps }) || reserved.has(g.index),
    jobId: owner(g.index),
  }));
};

const freeGpus = (): Map<string, number[]> => {
  const out = new Map<string, number[]>();
  for (const g of gpus()) if (g.card && !g.busy) out.set(g.card, [...(out.get(g.card) ?? []), g.index]);
  return out;
};

const listening = () => Effect.map(listeners, (ls) => new Set(ls.map((l) => l.port)));
const jobs = makeJobs({ config: () => config, catalog: () => catalog, freeGpus, listening });
const scanner = makeScanner(config.id, (p) => jobs.jobPort(p));

const selfNode = (): LocalNode => ({
  controller: { id: config.id, name: config.name, url: config.url, version: VERSION },
  endpoints: scanner.current().map(({ base: _base, ...ep }) => ep),
  usage: usage.list(),
  peers: config.peers,
});
const graph = makeGraph(() => config, selfNode);
const gw = { config: () => config, local: () => scanner.current(), usage: () => usage.list(), graph: () => graph.get(), record: usage.record };

const excluded = (): Set<number> => {
  const out = new Set([port, ...config.excludePorts]);
  for (const p of config.peers) {
    try {
      const u = new URL(p);
      if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname)) out.add(Number(u.port || 80));
    } catch {}
  }
  return out;
};

const tick = Effect.gen(function* () {
  rawGpus = yield* readGpus;
  yield* scanner.scan(excluded(), config.engineKeys);
});

const recipeMatches = (model: string): string[] =>
  [...catalog.recipes].filter(([, e]) => servedName(e.launch) === model || e.model === model || e.weights.split("@")[0] === model).map(([k]) => k);

const snapshot = async (): Promise<LocalSnapshot> => {
  const g = await graph.get();
  const live = await routes(gw, false);
  const totals = graphUsage(usage.list(), g);
  const endpoints = [...selfNode().endpoints, ...g.nodes.flatMap((n) => n.node.endpoints)];
  const ids = new Set([...endpoints.flatMap((e) => e.models), ...totals.keys()]);
  const models: LocalModel[] = [...ids].sort().map((id) => {
    const eps = endpoints.filter((e) => e.models.includes(id));
    return {
      id,
      live: live.has(id),
      requests: totals.get(id) ?? 0,
      endpoints: eps.map((e) => e.id),
      controllers: [...new Set(eps.map((e) => e.controllerId))],
      recipes: recipeMatches(id),
    };
  });
  return {
    controller: selfNode().controller,
    generatedAt: now(),
    hardware: hardware(gpus()),
    auto: await autoModel(gw),
    endpoints,
    models,
    controllers: g.links,
    jobs: jobs.list(),
    usage: usage.list(),
    registry: catalog.info,
  };
};

const recipes = (archived: boolean): LocalRecipes => {
  const free = freeGpus();
  const list = [...catalog.recipes].map(([k, e]) => toLocalRecipe(k, e, free));
  return {
    registry: catalog.info,
    archivedRecords: catalog.archived.length,
    capturedConfigs: catalog.captured.length,
    recipes: archived ? [...list, ...catalog.captured, ...catalog.archived] : list,
  };
};

const body = async <S extends Schema.Top>(req: Request, schema: S): Promise<S["Type"]> => {
  const text = await req.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "BAD_JSON", "request body is not valid JSON");
  }
  const r = Schema.decodeUnknownOption(schema as never)(parsed);
  if (r._tag === "None") throw new HttpError(400, "BAD_REQUEST", "request body does not match the schema");
  return r.value as S["Type"];
};

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const authorized = (req: Request): boolean => {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  const key = bearer ?? req.headers.get("x-api-key") ?? req.headers.get("x-local-studio-key") ?? "";
  return safeEq(key, config.fleetKey);
};

const run = <A>(e: Effect.Effect<A, HttpError>) => Effect.runPromise(e.pipe(Effect.mapError((x) => x as unknown as Error)));

const handle = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const p = url.pathname;
  if (req.method === "GET" && p === "/api/health") return json({ ok: true, id: config.id, name: config.name, version: VERSION });
  if (!authorized(req)) return json({ error: { code: "UNAUTHORIZED", message: "fleet key required" } }, 401);
  if (req.method === "GET" && (p === "/v1/models" || p === "/models")) return listModels(gw);
  if (req.method === "POST" && /^\/v1\/(chat\/completions|completions|messages|responses)$/.test(p)) return passthrough(gw, req, p);
  if (req.headers.get(HOP_HEADER)) return json({ error: { code: "NOT_FOUND", message: p } }, 404);
  if (req.method === "GET" && p === "/api/node") return json(selfNode());
  if (req.method === "GET" && p === "/api/snapshot") return json(await snapshot());
  if (req.method === "GET" && p === "/api/recipes") return json(recipes(url.searchParams.get("archived") === "1"));
  const runMatch = /^\/api\/recipes\/(.+)\/run$/.exec(p);
  if (req.method === "POST" && runMatch) return json(await run(jobs.run(decodeURIComponent(runMatch[1] ?? ""), await body(req, LocalRunRequest))));
  const stopMatch = /^\/api\/runs\/([\w-]+)\/stop$/.exec(p);
  if (req.method === "POST" && stopMatch) return json(await run(jobs.stop(stopMatch[1] ?? "")));
  if (req.method === "POST" && p === "/api/peers") {
    const b = await body(req, LocalPeerRequest);
    const u = normUrl(b.url);
    if (!/^https?:\/\/[^/]+$/.test(u)) throw new HttpError(400, "BAD_URL", "peer url must be http(s)://host:port");
    if (u === normUrl(config.url)) throw new HttpError(400, "SELF_PEER", "a controller cannot peer with itself");
    config = { ...config, peers: b.remove ? config.peers.filter((x) => normUrl(x) !== u) : [...new Set([...config.peers.map(normUrl), u])] };
    saveConfig(config);
    graph.invalidate();
    return json({ peers: config.peers });
  }
  return json({ error: { code: "NOT_FOUND", message: `${req.method} ${p}` } }, 404);
};

Bun.serve({
  port,
  hostname: process.env.LOCAL_STUDIO_T3_HOST ?? "127.0.0.1",
  idleTimeout: 0,
  maxRequestBodySize: 256 * 1024 * 1024,
  fetch: async (req) => {
    let res: Response;
    try {
      res = await handle(req);
    } catch (e) {
      res = errorResponse(e);
    }
    res.headers.set(LOCAL_STUDIO_CONTROLLER_HEADER, config.id);
    return res;
  },
});

const loop = async (ms: number, f: () => Promise<unknown>) => {
  for (;;) {
    await f().catch((e) => console.error(String(e)));
    await Bun.sleep(ms);
  }
};

console.log(`local-controller ${config.id} listening on ${process.env.LOCAL_STUDIO_T3_HOST ?? "127.0.0.1"}:${port}`);
void loop(REGISTRY_MS, async () => {
  catalog = await Effect.runPromise(loadCatalog(config.registry, true));
  console.log(`registry ${catalog.info.commit ?? "-"} ${catalog.recipes.size} recipes, ${catalog.archived.length} archived records, ${catalog.captured.length} captured configs${catalog.info.error ? ` (${catalog.info.error})` : ""}`);
});
void Effect.runPromise(jobs.reconcile);
void loop(SCAN_MS, () => Effect.runPromise(tick));
