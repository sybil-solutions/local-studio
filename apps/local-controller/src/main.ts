import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { LOCAL_STUDIO_CONTROLLER_HEADER, type LocalGpu, LocalDeployRequest, LocalDownloadRequest, type LocalSharePreview, LocalShareRequest, LocalNameRequest, type LocalNode, LocalPeerRequest, type LocalRecipes, LocalRunRequest, type LocalSnapshot } from "../../../packages/contracts/src/localStudio.ts";
import { decodeJson, errorResponse, exec, fail, type HttpError, httpError, json, loadConfig, now, port, saveConfig, VERSION } from "./core.ts";
import { listeners, makeScanner } from "./discovery.ts";
import { autoModel, HOP_HEADER, listModels, passthrough, routes } from "./gateway.ts";
import { graphUsage, makeGraph, makeUsage, normUrl } from "./graph.ts";
import { hardware, type RawGpu, readGpus } from "./hardware.ts";
import { makeJobs } from "./jobs.ts";
import { browse, detect, download, type Library, loadLibrary, matchHardware, record } from "./library.ts";
import { type Catalog, loadCatalog, matchCard, toLocalRecipe } from "./registry.ts";
import { createPr, previewShare, secretValues } from "./share.ts";
import { deployController, scanTailnet } from "./tailnet.ts";

let config = loadConfig();
let catalog: Catalog = { info: { commit: null, error: "loading" }, cards: {}, recipes: new Map(), archived: [] };
let rawGpus: RawGpu[] = [];
let library: Library | null = null;
const shares = new Map<number, { preview: LocalSharePreview; at: number }>();
const usage = makeUsage();

const gpus = (): LocalGpu[] => {
  const reserved = jobs.reserved();
  return rawGpus.map(({ uuid: _uuid, ...g }) => ({ ...g, card: matchCard(catalog, g.name, g.memoryTotalMiB), busy: g.busy || reserved.has(g.index) }));
};

const byCard = (all: boolean): Map<string, number[]> => {
  const out = new Map<string, number[]>();
  for (const g of gpus()) if (g.card && (all || !g.busy)) out.set(g.card, [...(out.get(g.card) ?? []), g.index]);
  return out;
};
const freeGpus = () => byCard(false);

const jobs = makeJobs({ config: () => config, catalog: () => catalog, freeGpus, listening: () => Effect.map(listeners, (ls) => new Set(ls.map((l) => l.port))) });
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
    const u = URL.parse(p);
    if (u && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname)) out.add(Number(u.port || 80));
  }
  return out;
};

const tick = Effect.gen(function* () {
  rawGpus = yield* readGpus;
  yield* scanner.scan(excluded(), config.engineKeys);
});

const snapshot = async (): Promise<LocalSnapshot> => {
  const g = await graph.get();
  const live = await routes(gw);
  const totals = graphUsage(usage.list(), g);
  const endpoints = [...selfNode().endpoints, ...g.nodes.flatMap((n) => n.node.endpoints)];
  const ids = new Set([...endpoints.flatMap((e) => e.models), ...totals.keys()]);
  return {
    controller: selfNode().controller,
    generatedAt: now(),
    hardware: hardware(gpus()),
    auto: await autoModel(gw),
    endpoints,
    models: [...ids].sort().map((id) => ({ id, live: live.has(id), requests: totals.get(id)?.requests ?? 0 })),
    controllers: g.links,
    jobs: jobs.list(),
    usage: [...totals.values()],
  };
};

const recipes = (archived: boolean): LocalRecipes => {
  const all = byCard(true);
  const list = [...catalog.recipes].map(([k, e]) => toLocalRecipe(k, e, freeGpus(), all));
  return { recipes: archived ? [...list, ...catalog.archived].filter((r) => r.cards <= (all.get(r.card)?.length ?? 0)) : list };
};

const containerOf = (pid: number | null): string | null => {
  try {
    return pid ? (/([0-9a-f]{64})/.exec(readFileSync(`/proc/${pid}/cgroup`, "utf8"))?.[1] ?? null) : null;
  } catch {
    return null;
  }
};

const unload = (p: number) =>
  Effect.gen(function* () {
    const ep = scanner.current().find((e) => e.port === p && e.live);
    if (!ep) return yield* fail(404, "NOT_RUNNING", `nothing is serving on port ${p}`);
    if (ep.jobId) return yield* jobs.stop(ep.jobId);
    const published = (yield* exec(["docker", "ps", "-q", "--filter", `publish=${p}`], 10_000)).stdout.split("\n").filter(Boolean);
    const ids = [...published, containerOf(ep.pid)].filter((id): id is string => !!id);
    const pid = ep.pid;
    if (ids.length) {
      const r = yield* exec(["docker", "stop", "-t", "30", ...ids], 90_000);
      if (r.code !== 0) return yield* fail(500, "UNLOAD_FAILED", r.stderr.trim().slice(0, 300));
    } else if (pid) yield* Effect.try({ try: () => process.kill(pid, "SIGTERM"), catch: (e) => httpError(500, "UNLOAD_FAILED", String(e)) });
    else return yield* fail(409, "UNLOAD_UNSUPPORTED", `can't find the process serving port ${p}`);
    yield* tick;
    return { port: p };
  });

const load = (recipeId: string, req: LocalRunRequest) =>
  Effect.gen(function* () {
    if (req.replace && !req.dryRun) {
      for (const ep of scanner.current().filter((e) => e.live)) yield* unload(ep.port);
      const entry = catalog.recipes.get(recipeId);
      for (let i = 0; entry && i < 60 && (freeGpus().get(entry.card)?.length ?? 0) < (entry.launch.cards ?? 1); i++) {
        yield* Effect.sleep("2 seconds");
        rawGpus = yield* readGpus;
      }
    }
    return yield* jobs.run(recipeId, req);
  });

const lib = () => (library ? Effect.succeed(library) : fail(503, "REGISTRY_LOADING", catalog.info.error ?? "the registry is still loading"));
const matches = (l: Library) => Effect.map(detect(rawGpus), (d) => matchHardware(l, d));

const share = (port: number) =>
  Effect.gen(function* () {
    const ep = scanner.current().find((e) => e.port === port && e.live);
    if (!ep) return yield* fail(404, "NOT_RUNNING", `nothing is serving on port ${port}`);
    const recipeId = jobs.list().find((j) => j.id === ep.jobId)?.recipeId;
    const l = yield* lib();
    const preview = yield* previewShare(l, ep, (recipeId && catalog.recipes.get(recipeId)) || null, yield* matches(l), secretValues([config.fleetKey, ...Object.values(config.engineKeys)]), config.engineKeys[String(port)]);
    shares.set(port, { preview, at: Date.now() });
    return preview;
  });

const publish = (req: LocalShareRequest) =>
  Effect.gen(function* () {
    const cached = shares.get(req.port);
    if (!cached || Date.now() - cached.at > 15 * 60_000) return yield* fail(409, "PREVIEW_REQUIRED", "preview the share first");
    if (cached.preview.blockers.length || cached.preview.issues.length) return yield* fail(409, "SHARE_BLOCKED", [...cached.preview.blockers, ...cached.preview.issues].join("; "));
    if (!req.dryRun && !req.confirm) return yield* fail(400, "CONFIRMATION_REQUIRED", "sharing needs explicit confirmation");
    return yield* createPr(cached.preview, req.dryRun === true);
  });

const body = async <S extends Schema.Top>(req: Request, schema: S): Promise<S["Type"]> => {
  const text = await req.text();
  const value = decodeJson(schema, text || "{}");
  if (value === undefined) throw httpError(400, "BAD_REQUEST", "request body is not JSON matching the schema");
  return value;
};

const authorized = (req: Request): boolean => {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  const key = Buffer.from(bearer ?? req.headers.get("x-api-key") ?? req.headers.get("x-local-studio-key") ?? "");
  const want = Buffer.from(config.fleetKey);
  return key.length === want.length && timingSafeEqual(key, want);
};

const run = <A>(e: Effect.Effect<A, HttpError>) => Effect.runPromise(e);

const saved = <A>(next: typeof config, result: A) => {
  config = next;
  saveConfig(config);
  graph.invalidate();
  return json(result);
};

const handle = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const p = url.pathname;
  const post = req.method === "POST";
  const match = (re: RegExp) => (post ? re.exec(p)?.[1] : undefined);
  if (req.method === "GET" && p === "/api/health") return json({ ok: true, id: config.id, name: config.name, version: VERSION });
  if (!authorized(req)) return json({ error: { code: "UNAUTHORIZED", message: "fleet key required" } }, 401);
  if (req.method === "GET" && (p === "/v1/models" || p === "/models")) return listModels(gw);
  if (post && /^\/v1\/(chat\/completions|completions|messages|responses)$/.test(p)) return passthrough(gw, req, p);
  if (req.headers.get(HOP_HEADER)) return json({ error: { code: "NOT_FOUND", message: p } }, 404);
  if (req.method === "GET" && p === "/api/node") return json(selfNode());
  if (req.method === "GET" && p === "/api/snapshot") return json(await snapshot());
  if (req.method === "GET" && p === "/api/recipes") return json(recipes(url.searchParams.get("archived") === "1"));
  if (req.method === "GET" && p === "/api/tailnet") return json(await Effect.runPromise(scanTailnet(new Set((await graph.get()).links.map((l) => normUrl(l.url))))));
  if (req.method === "GET" && p === "/api/registry") return json(await run(Effect.gen(function* () {
    const l = yield* lib();
    return browse(l, yield* matches(l), url.searchParams.get("all") === "1");
  })));
  const recordId = req.method === "GET" ? /^\/api\/registry\/records\/([^/]+)$/.exec(p)?.[1] : undefined;
  if (recordId) return json(await run(Effect.flatMap(lib(), (l) => record(l, decodeURIComponent(recordId)))));
  if (post && p === "/api/registry/download") {
    const { recipeId } = await body(req, LocalDownloadRequest);
    return json(await run(Effect.flatMap(lib(), (l) => download(l, recipeId))));
  }
  if (req.method === "GET" && p === "/api/registry/share") return json(await run(share(Number(url.searchParams.get("port")))));
  if (post && p === "/api/registry/share") return json(await run(publish(await body(req, LocalShareRequest))));
  const recipe = match(/^\/api\/recipes\/(.+)\/run$/);
  if (recipe) return json(await run(load(decodeURIComponent(recipe), await body(req, LocalRunRequest))));
  const unloadPort = match(/^\/api\/ports\/(\d+)\/stop$/);
  if (unloadPort) return json(await run(unload(Number(unloadPort))));
  const stopId = match(/^\/api\/runs\/([\w-]+)\/stop$/);
  if (stopId) return json(await run(jobs.stop(stopId)));
  if (post && p === "/api/tailnet/deploy") {
    const u = normUrl(await run(deployController(config, await body(req, LocalDeployRequest))));
    return saved({ ...config, peers: [...new Set([...config.peers.map(normUrl), u])] }, { url: u });
  }
  if (post && p === "/api/name") {
    const { name } = await body(req, LocalNameRequest);
    return saved({ ...config, name }, { name });
  }
  if (post && p === "/api/peers") {
    const b = await body(req, LocalPeerRequest);
    const u = normUrl(b.url);
    if (!/^https?:\/\/[^/]+$/.test(u)) throw httpError(400, "BAD_URL", "peer url must be http(s)://host:port");
    if (u === normUrl(config.url)) throw httpError(400, "SELF_PEER", "a controller cannot peer with itself");
    const peers = b.remove ? config.peers.filter((x) => normUrl(x) !== u) : [...new Set([...config.peers.map(normUrl), u])];
    return saved({ ...config, peers }, { peers });
  }
  return json({ error: { code: "NOT_FOUND", message: `${req.method} ${p}` } }, 404);
};

const host = process.env.LOCAL_STUDIO_T3_HOST ?? "127.0.0.1";
Bun.serve({
  port,
  hostname: host,
  idleTimeout: 0,
  maxRequestBodySize: 256 * 1024 * 1024,
  fetch: async (req) => {
    const res = await handle(req).catch(errorResponse);
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

console.log(`local-controller ${config.id} listening on ${host}:${port}`);
void loop(30 * 60_000, async () => {
  catalog = await Effect.runPromise(loadCatalog(config.registry, true));
  if (catalog.info.commit && catalog.info.commit !== library?.commit) library = await Effect.runPromise(loadLibrary(config.registry.dir, catalog.info.commit));
  console.log(`registry ${catalog.info.commit ?? "-"} ${catalog.recipes.size} recipes, ${catalog.archived.length} archived records, ${library?.rows.length ?? 0} indexed${catalog.info.error ? ` (${catalog.info.error})` : ""}`);
});
void Effect.runPromise(jobs.reconcile);
void loop(10_000, () => Effect.runPromise(tick));
