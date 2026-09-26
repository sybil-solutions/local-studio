import type { CacheInfo, Dialect, Endpoint, Engine, Gpu, ModelState, RunningModel, RuntimeRef, SpecDecodeInfo, Watchdog } from "@local-studio/contracts";
import type { Ctx, RuntimeView } from "../context";
import { containerName, digestOf, dockerScan, imageInfo, type Inspect, publishedPorts, wantsGpu } from "./docker";
import { computeGroups } from "./groups";
import { type ComputeApp, type HardwareList, intelClients, resolveGpuRefs, scanGpus, setIntelApps } from "./gpus";
import { type Fingerprint, fingerprint, get, type Health, healthCheck, type ModelEntry, PROBE_CONCURRENCY, PROBE_MAX, type ProbeCache } from "./probe";
import { ancestors, cmdline, descendants, type Listener, listListeners, listProcs, type ProcTable, probeHost } from "./procs";
import { ENGINE_RE, embeddingArgv, engineFromArgs, envMap, flag, flagList, hasFlag, num, parseJson, pool, portArg, promLabels } from "./util";
import { findWatchdogs } from "./watchdogs";

export const shortName = (s: string): string => (s.startsWith("/") ? (s.split("/").filter(Boolean).pop() ?? s).replace(/\.(gguf|safetensors|bin)$/i, "") : s);

const LOADING_LIMIT_MS = 30 * 60 * 1000;
const RESERVED_PORTS = new Set([22, 53, 631]);

export interface Track {
  lifeKey: string;
  state: ModelState;
  since: number;
  fails: number;
  everReady: boolean;
  startedAt: number | null;
  note: string;
}

export interface ScanState {
  tracks: Map<string, Track>;
  cacheInfo: Map<string, CacheInfo | null>;
  stopping: Set<string>;
  probes: ProbeCache;
}

export interface ScanResult {
  view: RuntimeView;
  watchdogs: Watchdog[];
  pidOwner: Map<number, string>;
}

interface Candidate {
  id: string;
  port: number;
  bind: string;
  lifeKey: string;
  gpu: boolean;
  engineHint: Engine | null;
  argv: string[];
  env: Record<string, string>;
  runtime: RuntimeRef;
  labels: Record<string, string>;
  gpus: Gpu[];
  vram: number | null;
  startedAt: number | null;
  stopBlocked: string | null;
}

const DIALECTS: Record<Engine, Dialect[]> = {
  vllm: ["chat", "responses", "messages"],
  sglang: ["chat", "responses"],
  llamacpp: ["chat"],
  tabby: ["chat"],
  mlx: ["chat"],
  openai: ["chat"],
};

export const nextTrack = (prev: Track | undefined, lifeKey: string, healthy: boolean, startedAt: number | null, stopping: boolean, note: string): Track => {
  const now = Date.now();
  const age = startedAt ? now - startedAt : 0;
  const fresh = !prev || prev.lifeKey !== lifeKey;
  const base: Track = fresh ? { lifeKey, state: "loading", since: now, fails: 0, everReady: false, startedAt, note: "" } : { ...prev, note };
  let state: ModelState;
  if (stopping) state = "stopping";
  else if (healthy) {
    state = "ready";
    base.fails = 0;
    base.everReady = true;
  } else {
    base.fails += 1;
    if (base.everReady) state = base.fails >= 3 ? "unhealthy" : base.state === "unhealthy" ? "unhealthy" : "ready";
    else state = age >= LOADING_LIMIT_MS ? "unhealthy" : "loading";
  }
  base.note = healthy ? "" : note;
  if (fresh || state !== base.state) {
    base.state = state;
    base.since = now;
  }
  return base;
};

const parseSpec = (argv: string[]): SpecDecodeInfo | null => {
  const raw = flag(argv, "spec");
  if (raw) {
    const j = parseJson<{ method?: string; num_speculative_tokens?: number; model?: string }>(raw);
    if (j) return { method: j.method ?? (j.model ? "draft" : "unknown"), numSpeculativeTokens: j.num_speculative_tokens ?? null };
  }
  const alg = argv.indexOf("--speculative-algorithm");
  if (alg >= 0) {
    const n = argv.indexOf("--speculative-num-draft-tokens");
    return { method: (argv[alg + 1] ?? "unknown").toLowerCase(), numSpeculativeTokens: n >= 0 ? num(argv[n + 1]) : null };
  }
  if (hasFlag(argv, "-md") || hasFlag(argv, "--model-draft")) {
    const n = argv.indexOf("--draft-max");
    return { method: "draft", numSpeculativeTokens: n >= 0 ? num(argv[n + 1]) : null };
  }
  return null;
};

const parseVision = (argv: string[], models: ModelEntry[] | null): boolean | null => {
  const mm = flag(argv, "mm");
  if (mm) {
    const j = parseJson<Record<string, number>>(mm);
    if (j) return (j.image ?? 0) > 0 || (j.video ?? 0) > 0;
    return /image=\s*[1-9]/.test(mm) ? true : null;
  }
  if (hasFlag(argv, "--mmproj") || hasFlag(argv, "--mmproj-url")) return true;
  const meta = models?.[0]?.raw;
  if (meta && typeof meta === "object") {
    const caps = (meta as { capabilities?: unknown; modalities?: unknown }).capabilities ?? (meta as { modalities?: unknown }).modalities;
    if (Array.isArray(caps)) return caps.some((c) => String(c).includes("vision") || String(c).includes("image"));
  }
  return null;
};

const argvCache = (argv: string[]): CacheInfo => ({
  prefixCaching: hasFlag(argv, "--enable-prefix-caching") ? true : hasFlag(argv, "--no-enable-prefix-caching") || hasFlag(argv, "--disable-radix-cache") ? false : null,
  blockSize: argv.includes("--block-size") ? num(argv[argv.indexOf("--block-size") + 1]) : null,
  kvCacheTokens: null,
  kvCacheDtype: flag(argv, "kvDtype"),
  maxConcurrency: num(flag(argv, "maxSeqs")),
});

const vllmCache = async (ctx: Ctx, base: string, argv: string[]): Promise<CacheInfo | null> => {
  const r = await get(ctx, `${base}/metrics`, 3000);
  if (r.status !== 200) return null;
  const l = promLabels(r.body, "vllm:cache_config_info");
  const fromArgv = argvCache(argv);
  if (!l) return fromArgv;
  return {
    prefixCaching: l.enable_prefix_caching ? l.enable_prefix_caching.toLowerCase() === "true" : fromArgv.prefixCaching,
    blockSize: num(l.block_size) ?? fromArgv.blockSize,
    kvCacheTokens: num(l.kv_cache_size_tokens),
    kvCacheDtype: l.cache_dtype && l.cache_dtype !== "auto" ? l.cache_dtype : fromArgv.kvCacheDtype,
    maxConcurrency: num(l.kv_cache_max_concurrency) ?? fromArgv.maxConcurrency,
  };
};

const engineRoot = (t: ProcTable, pid: number): number | null => {
  let root: number | null = null;
  for (const a of ancestors(t, pid)) if (ENGINE_RE.test(t.byPid.get(a)?.args ?? "")) root = a;
  return root;
};

const SHELLISH = /(^|\/)(ba|da|z)?sh(\s|$)|\.sh(\s|$)|docker-init|(^|\/)tini(\s|$)|dumb-init/;
const argsOf = (t: ProcTable, pid: number): string => t.byPid.get(pid)?.args ?? "";

const findEnginePid = (t: ProcTable, root: number, gpuPids: number[]): number | null => {
  const tree = descendants(t, root);
  for (const p of tree) if (ENGINE_RE.test(argsOf(t, p))) return p;
  const withPort = tree.filter((p) => p !== root && portArg(argsOf(t, p)) !== null && !SHELLISH.test(argsOf(t, p)));
  if (withPort.length) return withPort[withPort.length - 1]!;
  const inTree = new Set(tree);
  for (const app of gpuPids) {
    if (!inTree.has(app)) continue;
    const chain = ancestors(t, app).filter((p) => inTree.has(p) && p !== root && !SHELLISH.test(argsOf(t, p)));
    const top = chain[chain.length - 1];
    if (top) return top;
  }
  return null;
};

const myUid = typeof process.getuid === "function" ? process.getuid() : null;

const signalBlock = (uid: number | undefined): string | null =>
  myUid === null || myUid === 0 || uid === undefined || uid === myUid ? null : `process runs as uid ${uid}; this controller (uid ${myUid}) cannot signal it`;

export const fullScan = async (ctx: Ctx, st: ScanState, hw: HardwareList | null, excluded: Set<number>): Promise<ScanResult> => {
  const t0 = performance.now();
  const errors: string[] = [];
  const [gs, procs, listeners, { docker, containers }] = await Promise.all([scanGpus(ctx, hw), listProcs(ctx), listListeners(ctx), dockerScan(ctx)]);
  if (gs.error) errors.push(gs.error);
  if (gs.nodes.size) {
    const engines = [...procs.byPid.values()].filter((p) => ENGINE_RE.test(p.args));
    const names = new Map(engines.map((p) => [p.pid, p.args.split(" ")[0]?.split("/").pop() ?? ""]));
    const apps = await intelClients(engines.map((p) => p.pid), gs.nodes, names);
    for (const c of containers) {
      const uuids = [...new Set((c.HostConfig.Devices ?? []).map((d) => gs.nodes.get(d.PathOnHost)).filter((u): u is string => !!u))];
      const pid = findEnginePid(procs, c.State.Pid, []) ?? c.State.Pid;
      for (const uuid of uuids) if (!apps.some((a) => a.uuid === uuid && ancestors(procs, a.pid).includes(c.State.Pid))) apps.push({ uuid, pid, processName: containerName(c), usedMiB: null });
    }
    setIntelApps(gs, apps);
  }
  const statePids = new Map<number, Inspect>(containers.filter((c) => c.State.Pid > 0).map((c) => [c.State.Pid, c]));
  const gpuByUuid = new Map(gs.gpus.map((g) => [g.uuid, g]));

  const appOwner = new Map<number, string>();
  for (const app of gs.apps) {
    const chain = ancestors(procs, app.pid);
    const c = chain.map((p) => statePids.get(p)).find((x) => !!x);
    if (c) appOwner.set(app.pid, `docker:${c.Id}`);
    else {
      const root = engineRoot(procs, app.pid);
      if (root) appOwner.set(app.pid, `native:${root}`);
    }
  }
  const appsOf = (owner: (app: ComputeApp) => boolean) => {
    const apps = gs.apps.filter(owner);
    const gpus = [...new Set(apps.map((a) => gpuByUuid.get(a.uuid)).filter((g): g is Gpu => !!g))];
    return { gpus, vram: apps.length && apps.every((a) => a.usedMiB !== null) ? apps.reduce((s, a) => s + (a.usedMiB ?? 0), 0) : null };
  };

  const containerPids = new Set<number>();
  const candidates: Candidate[] = [];
  const dockerPorts = new Set<number>();
  for (const c of containers) {
    const tree = descendants(procs, c.State.Pid);
    for (const p of tree) containerPids.add(p);
    const enginePid = findEnginePid(procs, c.State.Pid, gs.apps.map((a) => a.pid));
    const argv = enginePid ? cmdline(procs, enginePid) : [...(c.Config.Entrypoint ?? []), ...(c.Config.Cmd ?? [])];
    const env = envMap(c.Config.Env);
    const own = appsOf((a) => appOwner.get(a.pid) === `docker:${c.Id}`);
    let gpus = own.gpus;
    if (!gpus.length && wantsGpu(c)) {
      const ids = (c.HostConfig.DeviceRequests ?? []).flatMap((d) => d.DeviceIDs ?? []);
      const cvd = env.CUDA_VISIBLE_DEVICES ?? env.NVIDIA_VISIBLE_DEVICES;
      const count = (c.HostConfig.DeviceRequests ?? []).find((d) => d.Count)?.Count;
      gpus = ids.length ? resolveGpuRefs(ids, gs.gpus) : cvd ? resolveGpuRefs(cvd.split(","), gs.gpus) : count === -1 ? gs.gpus : [];
      if (!ids.length && cvd && env.CUDA_VISIBLE_DEVICES && env.NVIDIA_VISIBLE_DEVICES && env.NVIDIA_VISIBLE_DEVICES !== "all" && !gpus.length)
        gpus = resolveGpuRefs(env.NVIDIA_VISIBLE_DEVICES.split(","), gs.gpus);
    }
    const isGpu = own.gpus.length > 0 || wantsGpu(c);
    let ports = publishedPorts(c).map((p) => ({ port: p.hostPort, bind: p.hostIp, container: p.containerPort }));
    if (!ports.length && c.HostConfig.NetworkMode === "host") {
      const lp = listeners.filter((l) => l.pid && tree.includes(l.pid)).map((l) => ({ port: l.port, bind: l.bind, container: l.port }));
      const argPort = num(flag(argv, "port")) ?? tree.map((p) => portArg(argsOf(procs, p))).find((x): x is number => x !== null) ?? null;
      ports = lp.length ? lp : argPort ? [{ port: argPort, bind: "0.0.0.0", container: argPort }] : [];
    }
    if (!ports.length) continue;
    const argPort = num(flag(argv, "port"));
    const chosen = ports.find((p) => p.container === argPort) ?? ports[0]!;
    for (const p of ports) dockerPorts.add(p.port);
    const img = await imageInfo(ctx, c.Image);
    const name = containerName(c);
    candidates.push({
      id: name,
      port: chosen.port,
      bind: chosen.bind,
      lifeKey: c.Id,
      gpu: isGpu,
      engineHint: engineFromArgs(argv.join(" ")) ?? (isGpu ? engineFromArgs(c.Config.Image) : null),
      argv,
      env,
      labels: c.Config.Labels ?? {},
      runtime: {
        kind: "docker",
        containerId: c.Id,
        containerName: name,
        image: c.Config.Image,
        imageDigest: digestOf(c, img),
        statePid: c.State.Pid,
        labels: c.Config.Labels ?? {},
        mounts: c.Mounts.map((m) => ({ source: m.Source, target: m.Destination, readOnly: !m.RW })),
      },
      gpus,
      vram: own.vram,
      startedAt: Date.parse(c.State.StartedAt) || null,
      stopBlocked: null,
    });
  }

  const apple = ctx.config.platform === "darwin" ? gs.gpus.find((g) => g.backend === "apple") : undefined;
  const portOwner = new Map<number, number>();
  for (const app of gs.apps) {
    const owner = appOwner.get(app.pid);
    if (owner?.startsWith("docker:")) continue;
    const chain = ancestors(procs, app.pid);
    const hit = chain.find((p) => portArg(argsOf(procs, p)) !== null);
    if (hit === undefined) continue;
    const root = owner ? Number(owner.slice(7)) : chain.filter((p) => !SHELLISH.test(argsOf(procs, p))).pop() ?? hit;
    if (!owner) appOwner.set(app.pid, `native:${root}`);
    const port = portArg(argsOf(procs, hit))!;
    if (!portOwner.has(port)) portOwner.set(port, root);
  }

  const others: Listener[] = [];
  const nativeRoots = new Set<number>();
  for (const l of listeners) {
    if (excluded.has(l.port) || RESERVED_PORTS.has(l.port) || dockerPorts.has(l.port)) continue;
    if (l.pid && containerPids.has(l.pid)) continue;
    const lpid = l.pid ?? portOwner.get(l.port) ?? null;
    const chain = lpid ? ancestors(procs, lpid) : [];
    const root = lpid ? engineRoot(procs, lpid) : null;
    const ownsGpu = lpid ? gs.apps.some((a) => ancestors(procs, a.pid).includes(lpid)) : false;
    if (lpid && (root || ownsGpu)) {
      const rootPid = root ?? lpid;
      if (nativeRoots.has(rootPid)) continue;
      nativeRoots.add(rootPid);
      const enginePid = root ?? chain.find((p) => ENGINE_RE.test(argsOf(procs, p))) ?? lpid;
      const argv = cmdline(procs, enginePid);
      const own = appsOf((a) => ancestors(procs, a.pid).includes(rootPid) || ancestors(procs, a.pid).includes(lpid));
      const proc = procs.byPid.get(rootPid);
      const onApple = !!apple && (!!root || engineFromArgs(argv.join(" ")) !== null);
      const rssMiB = onApple ? Math.round(descendants(procs, rootPid).reduce((sum, p) => sum + (procs.byPid.get(p)?.rssKiB ?? 0), 0) / 1024) : null;
      candidates.push({
        id: `native-${l.port}`,
        port: l.port,
        bind: l.bind,
        lifeKey: `${rootPid}@${proc?.start ?? ""}`,
        gpu: own.gpus.length > 0 || onApple,
        engineHint: engineFromArgs(argv.join(" ")),
        argv,
        env: {},
        labels: {},
        runtime: { kind: "native", pid: rootPid, startTime: proc?.start ?? "", exe: argv[0] ?? "" },
        gpus: onApple && apple ? [apple] : own.gpus,
        vram: onApple ? rssMiB : own.vram,
        startedAt: proc ? Date.parse(proc.start) || null : null,
        stopBlocked: signalBlock(proc?.uid),
      });
      continue;
    }
    if (l.port >= 1024 || ctx.config.extraScanPorts.includes(l.port)) others.push(l);
  }
  for (const p of ctx.config.extraScanPorts)
    if (!excluded.has(p) && !others.some((o) => o.port === p) && !candidates.some((c) => c.port === p)) others.push({ port: p, bind: "127.0.0.1", pid: null, process: null });

  let budget = PROBE_MAX;
  const models: RunningModel[] = [];
  const endpoints: Endpoint[] = [];
  const liveKeys = new Set<string>();
  const adopt = async (c: Candidate) => {
    const base = `http://${probeHost(c.bind)}:${c.port}`;
    const posKey = `${c.port}:${c.lifeKey}`;
    liveKeys.add(posKey);
    budget -= 1;
    const health: Health = await healthCheck(ctx, base);
    let fp: Fingerprint | null = st.probes.getPos(posKey);
    if (health.ok && !fp) {
      budget -= 1;
      fp = await fingerprint(ctx, base, c.argv.join(" "));
      if (fp.kind === "model" || fp.kind === "openai") st.probes.setPos(posKey, fp);
    }
    const isModel = c.engineHint !== null || fp?.kind === "model" || (c.gpu && (c.runtime.kind !== "native" || health.ok));
    if (!isModel) {
      if (fp?.kind === "openai")
        endpoints.push({ port: c.port, bind: c.bind, kind: "openai-proxy", pid: null, process: `container ${c.id}`, note: "OpenAI-shaped, no engine, no GPU" });
      return;
    }
    const engine: Engine = fp?.kind === "model" ? fp.engine : (c.engineHint ?? "openai");
    const prevTrack = st.tracks.get(c.id);
    const track = nextTrack(prevTrack, c.lifeKey, health.ok, c.startedAt, st.stopping.has(c.id), health.note);
    st.tracks.set(c.id, track);
    const entries = health.models ?? (fp && fp.kind !== "endpoint" && fp.kind !== "down" ? fp.models : null);
    const argvServed = flagList(c.argv, "served");
    const servedModels = entries?.length ? entries.map((e) => e.id) : argvServed.length ? argvServed : c.env.SERVED_MODEL_NAME ? [c.env.SERVED_MODEL_NAME] : [];
    const modelPath = c.argv[c.argv.findIndex((a) => a === "serve") + 1];
    const primaryModel = (servedModels[0] && shortName(servedModels[0])) ?? (modelPath && !modelPath.startsWith("-") ? modelPath.split("/").filter(Boolean).pop() ?? c.id : c.id);
    const contextWindow =
      entries?.find((e) => e.maxModelLen)?.maxModelLen ?? (fp?.kind === "model" ? fp.propsCtx : null) ?? num(flag(c.argv, "ctx")) ?? num(c.env.MAX_MODEL_LEN);
    if (!st.cacheInfo.has(c.lifeKey) || (st.cacheInfo.get(c.lifeKey) === null && track.state === "ready")) {
      if (engine === "vllm" && track.state === "ready") st.cacheInfo.set(c.lifeKey, await vllmCache(ctx, base, c.argv));
      else if (engine !== "vllm") st.cacheInfo.set(c.lifeKey, argvCache(c.argv));
    }
    const managed = c.labels["local-studio.managed"] === "1" && c.labels["local-studio.machine"] === ctx.identity.machineId;
    models.push({
      id: c.id,
      machineId: ctx.identity.machineId,
      engine,
      engineVersion: fp?.kind === "model" ? fp.version : (c.labels["local-inference.vllm.version"] ?? null),
      state: track.state,
      stateSince: track.since,
      origin: managed ? "managed" : "adopted",
      recipeId: managed ? (c.labels["local-studio.recipe"] ?? null) : null,
      servedModels,
      primaryModel,
      contextWindow,
      vision: parseVision(c.argv, entries) ?? (fp?.kind === "model" ? fp.propsVision : null),
      port: c.port,
      baseUrl: `http://${probeHost(c.bind)}:${c.port}`,
      metricsUrl: fp?.kind === "model" && fp.metricsPrefix ? `${base}/metrics` : null,
      nativeDialects: DIALECTS[engine],
      runtime: c.runtime,
      argv: c.argv,
      gpuKeys: c.gpus.sort((a, b) => a.index - b.index).map((g) => g.key),
      vramUsedMiB: c.vram,
      startedAt: c.startedAt,
      cache: st.cacheInfo.get(c.lifeKey) ?? null,
      spec: parseSpec(c.argv),
      watchdog: null,
      error: track.state === "unhealthy" ? track.note || "unhealthy" : null,
      stopBlocked: c.stopBlocked,
      embedding: embeddingArgv(c.argv),
    });
  };
  await pool(candidates, PROBE_CONCURRENCY, adopt);

  const toProbe: Listener[] = [];
  const externals: { l: Listener; fp: Extract<Fingerprint, { kind: "model" }> }[] = [];
  const classify = (l: Listener, fp: Fingerprint) => {
    if (fp.kind === "model" && !l.pid) externals.push({ l, fp });
    else if (fp.kind === "endpoint") endpoints.push({ port: l.port, bind: l.bind, kind: fp.ekind, pid: l.pid, process: l.process, note: fp.note });
  };
  for (const l of others) {
    const cached = st.probes.getNeg(l.port, l.pid);
    if (cached) classify(l, cached);
    else toProbe.push(l);
  }
  const probeList = toProbe.slice(0, Math.max(0, budget));
  await pool(probeList, PROBE_CONCURRENCY, async (l) => {
    let fp = await fingerprint(ctx, `http://${probeHost(l.bind)}:${l.port}`, l.pid ? (procs.byPid.get(l.pid)?.args ?? null) : null);
    if (fp.kind === "openai" || (fp.kind === "model" && l.pid))
      fp = { kind: "endpoint", ekind: "openai-proxy", note: fp.kind === "model" ? `${fp.engine}-shaped API with no GPU process` : "OpenAI-shaped, no engine, no GPU" };
    else if (fp.kind === "down" && fp.status !== null) fp = { kind: "endpoint", ekind: "unknown-http", note: fp.note };
    st.probes.setNeg(l.port, l.pid, fp);
    classify(l, fp);
  });
  if (toProbe.length > probeList.length) errors.push(`probe budget reached: ${toProbe.length - probeList.length} ports skipped`);

  const served = new Set(models.flatMap((m) => m.servedModels.map((x) => x.toLowerCase())));
  const extCandidates: Candidate[] = [];
  const unownedGpuWork = gs.apps.some((a) => !appOwner.has(a.pid)) || gs.gpus.every((g) => g.backend === "apple");
  for (const { l, fp } of externals) {
    const dup = fp.models.find((e) => served.has(e.id.toLowerCase()));
    if (dup || !unownedGpuWork) {
      const id = dup?.id ?? fp.models[0]?.id ?? fp.engine;
      endpoints.push({ port: l.port, bind: l.bind, kind: "openai-proxy", pid: null, process: l.process, note: dup ? `proxy for ${id}` : `forward of ${id}; no GPU process here` });
      continue;
    }
    const posKey = `${l.port}:external:${l.port}`;
    st.probes.setPos(posKey, fp);
    extCandidates.push({
      id: `external-${l.port}`,
      port: l.port,
      bind: l.bind,
      lifeKey: `external:${l.port}`,
      gpu: false,
      engineHint: fp.engine,
      argv: [],
      env: {},
      labels: {},
      runtime: { kind: "external", note: "listener has no visible owner process (another user or namespace)" },
      gpus: [],
      vram: null,
      startedAt: null,
      stopBlocked: "no owner process visible for this port; stop it where it was started",
    });
  }
  candidates.push(...extCandidates);
  await pool(extCandidates, PROBE_CONCURRENCY, adopt);
  st.probes.prune(liveKeys);

  for (const id of [...st.tracks.keys()]) {
    if (!models.some((m) => m.id === id)) {
      st.tracks.delete(id);
      st.stopping.delete(id);
      ctx.log.info(`discovery: model ${id} is gone`);
    }
  }
  for (const k of [...st.cacheInfo.keys()]) if (!candidates.some((c) => c.lifeKey === k)) st.cacheInfo.delete(k);

  const watchdogs = findWatchdogs(procs, ctx.config.watchdogPatterns);
  const wd = watchdogs.length ? [...new Set(watchdogs.map((w) => w.name))].join(", ") : null;
  for (const m of models) m.watchdog = wd;
  models.sort((a, b) => a.id.localeCompare(b.id));
  endpoints.sort((a, b) => a.port - b.port);

  const pidOwner = new Map<number, string>();
  for (const [pid, owner] of appOwner) {
    const c = candidates.find((x) => (owner.startsWith("docker:") ? x.lifeKey === owner.slice(7) : x.runtime.kind === "native" && `native:${x.runtime.pid}` === owner));
    if (c && models.some((m) => m.id === c.id)) pidOwner.set(pid, c.id);
  }
  attachOwners(gs.gpus, pidOwner);
  return {
    view: {
      gpus: gs.gpus,
      groups: computeGroups(gs.gpus, models),
      models,
      endpoints,
      discovery: { lastScanAt: Date.now(), scanMs: Math.round(performance.now() - t0), docker, errors },
    },
    watchdogs,
    pidOwner,
  };
};

export const attachOwners = (gpus: Gpu[], pidOwner: Map<number, string>): void => {
  for (const g of gpus) for (const p of g.processes) p.modelId = pidOwner.get(p.pid) ?? null;
};
