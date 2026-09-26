import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { MetricsSummary, RecipeExport, RunningModel } from "@local-studio/contracts";
import type { Ctx, DockerInspect, Services } from "../context";
import { hardwareOf } from "./fit";
import type { Registry } from "./registry";
import { argValue, argValues, DEVICE_ENV, DIGEST_PINNED, FORBIDDEN_ARG, HttpError, intOrNull, isoSeconds, parseJson, REVISION_40, SECRET_ENV, scrubArgv, slug, stableJson } from "./util";
import { hfRevisionOf } from "./weights";
import { ENGINE_RE } from "../discovery/util";

const ENGINE_NAME: Record<string, string> = { vllm: "vllm", sglang: "sglang", llamacpp: "llama.cpp", tabby: "tabbyapi", mlx: "mlx", openai: "openai" };

interface Mount {
  read_only: boolean;
  source: string;
  target: string;
  provision?: { repository: string; revision: string; size_gb: number | null };
}

interface CacheLabels {
  kvTokens: number | null;
  labels: Record<string, string>;
}

const envMap = (env: string[] | null | undefined): Map<string, string> => {
  const m = new Map<string, string>();
  for (const e of env ?? []) {
    const i = e.indexOf("=");
    if (i > 0) m.set(e.slice(0, i), e.slice(i + 1));
  }
  return m;
};

const dirSizeGb = (dir: string): number | null => {
  let total = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 4) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".cache" || e.name === ".git") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile()) total += statSync(p).size;
    }
  };
  try {
    walk(dir, 0);
    return Math.round((total / 1e9) * 1000) / 1000;
  } catch {
    return null;
  }
};

const isWeightsDir = (p: string): boolean => {
  try {
    if (existsSync(join(p, "config.json")) || existsSync(join(p, "model.safetensors.index.json"))) return true;
    return readdirSync(p).some((f) => /\.(safetensors|gguf)$/.test(f));
  } catch {
    return false;
  }
};

const shmString = (bytes: number | undefined): string | null => {
  if (!bytes) return null;
  const g = 1024 ** 3;
  const m = 1024 ** 2;
  if (bytes % g === 0) return `${bytes / g}g`;
  if (bytes % m === 0) return `${bytes / m}m`;
  return String(bytes);
};

const hardwareShort = (hardwareId: string): string => hardwareId.replace(/-\d+gb$/, "").replace(/-blackwell/, "").replace(/-/g, "");

const imageSourceUrl = (repo: string, labels: Record<string, string>): string => {
  const src = labels["org.opencontainers.image.source"];
  if (src && /^https?:\/\//.test(src)) return src;
  const first = repo.split("/")[0] ?? "";
  if (first.includes(".")) return `https://${repo}`;
  return `https://hub.docker.com/r/${repo.includes("/") ? repo : `library/${repo}`}`;
};

const parseCacheInfo = (text: string): CacheLabels | null => {
  const line = text.split("\n").find((l) => /^(vllm|sglang):cache_config_info\{/.test(l));
  if (!line) return null;
  const labels: Record<string, string> = {};
  for (const m of line.matchAll(/(\w+)="([^"]*)"/g)) labels[m[1] ?? ""] = m[2] ?? "";
  const blocks = intOrNull(labels.num_gpu_blocks);
  const block = intOrNull(labels.block_size);
  const kvTokens = intOrNull(labels.kv_cache_size_tokens) ?? (blocks !== null && block !== null ? blocks * block : null);
  return { kvTokens, labels };
};

const graphMode = (argv: string[]): string | null => {
  const cc = parseJson<{ cudagraph_mode?: string; level?: number; mode?: number }>(argValue(argv, "--compilation-config", "-O"));
  const sizes = argValues(argv, "--cudagraph-capture-sizes");
  const mode = cc?.cudagraph_mode ?? null;
  if (!mode && !sizes.length) return argv.includes("--disable-cuda-graph") ? "disabled" : null;
  return [mode ?? "default", sizes.length ? `capture sizes ${sizes.join(" ")}` : ""].filter(Boolean).join("; ");
};

const measured = (s: MetricsSummary | null, machine: string) => {
  if (!s || s.requests === 0) return { provenance: `local-studio gateway, ${machine}, 7d`, requests: 0, note: "no requests through this controller's gateway in the window" };
  return {
    provenance: `local-studio gateway, ${machine}, 7d`,
    window: { from: new Date(s.from).toISOString(), to: new Date(s.to).toISOString() },
    requests: s.requests,
    errors: s.errors,
    error_rate: s.errorRate,
    errors_by_code: s.errorsByCode,
    tokens: { prompt_total: s.promptTotal, input_uncached: s.inputUncached, cache_read: s.cacheRead, cache_write: s.cacheWrite, output: s.output, reasoning: s.reasoning },
    cache_hit: s.cacheHit,
    decode_tps: s.decodeTps,
    prefill_tps: s.prefillTps,
    ttft_ms: s.ttftMs,
    mean_ttft_ms: s.meanTtftMs,
    decode_tps_per_request: s.decodeTpsPerRequest,
  };
};

export interface Exporter {
  exportModel(modelId: string): Promise<RecipeExport>;
}

export const createExporter = (ctx: Ctx, svc: Services, registry: Registry): Exporter => {
  const baseOf = (m: RunningModel) => m.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

  const getJson = async (url: string): Promise<Record<string, unknown> | null> => {
    try {
      const r = await ctx.fetch(url, { timeoutMs: 4000 });
      return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const engineVersion = async (m: RunningModel, labels: Record<string, string>): Promise<string | null> => {
    const base = baseOf(m);
    if (m.engine === "vllm") {
      const v = await getJson(`${base}/version`);
      if (typeof v?.version === "string") return v.version;
    }
    if (m.engine === "sglang") {
      const v = await getJson(`${base}/get_server_info`);
      if (typeof v?.version === "string") return v.version;
    }
    return m.engineVersion ?? labels["local-inference.vllm.version"] ?? labels["local-inference.sglang.version"] ?? null;
  };

  const cacheInfo = async (m: RunningModel): Promise<CacheLabels | null> => {
    try {
      const r = await ctx.fetch(m.metricsUrl ?? `${baseOf(m)}/metrics`, { timeoutMs: 4000 });
      if (r.ok) return parseCacheInfo(await r.text());
    } catch {}
    return null;
  };

  const imageEntrypoint = (image: string): Promise<string[] | null> => svc.lifecycle.imageEntrypoint(image);

  const exportModel = async (modelId: string): Promise<RecipeExport> => {
    const m = svc.runtime.model(modelId);
    if (!m) throw new HttpError(404, "MODEL_NOT_FOUND", `no running model ${modelId}`);
    const refusals: string[] = [];
    const warnings: string[] = [];
    const now = new Date();
    const capturedAt = isoSeconds(now);
    const machine = ctx.identity.name;
    const loaded = await registry.load().catch(() => null);
    const hw = loaded?.catalog.hardware ?? [];

    const hostArgvRaw = (await svc.lifecycle.hostArgv(modelId).catch(() => null)) ?? m.argv;
    const hostScrub = scrubArgv(hostArgvRaw);
    if (hostScrub.dropped.length) warnings.push(`removed secret-bearing flags from host argv: ${hostScrub.dropped.join(", ")}`);
    const hostArgv = hostScrub.argv;
    if (FORBIDDEN_ARG.test(hostArgv.join(" "))) refusals.push("the engine runs with enforce-eager or disabled CUDA graphs; the registry refuses that");
    if (m.runtime.kind === "external" || !hostArgv.length) refusals.push("the engine process is not visible, so its argv cannot be read or checked");
    else if (!ENGINE_RE.test(hostArgv.join(" "))) warnings.push(`host_argv did not match a known engine command line; it was taken from the process that owns the port or the GPUs (${hostArgv[0] ?? ""})`);

    const gpus = m.gpuKeys.map((k) => svc.runtime.view().gpus.find((g) => g.key === k)).filter((g) => !!g);
    const hwIds = [...new Set(gpus.map((g) => hardwareOf(g, hw)))];
    const hardwareId = hwIds.length === 1 ? hwIds[0] ?? null : null;
    if (!gpus.length) refusals.push("the model owns no GPUs that discovery can see");
    else if (!hardwareId) refusals.push(`the model's GPUs do not map to one registry hardware id (${hwIds.map((x) => x ?? "unknown").join(", ")})`);
    const tp = intOrNull(argValue(hostArgv, "--tensor-parallel-size", "-tp", "--tp", "--tp-size")) ?? (m.gpuKeys.length || null);

    const version = await (m.runtime.kind === "docker" ? engineVersion(m, m.runtime.labels) : engineVersion(m, {}));
    const cache = await cacheInfo(m);
    const kvTokens = cache?.kvTokens ?? m.cache?.kvCacheTokens ?? null;
    const summary = (() => {
      try {
        return svc.metrics.summary("7d", { model: m.primaryModel });
      } catch {
        return null;
      }
    })();

    let launch: Record<string, unknown>;
    let labels: Record<string, string> = {};
    let modelPathRevision: { repository: string; revision: string } | null = null;
    let sourceUrl = `https://github.com/${ctx.config.registryRepo}`;

    if (m.runtime.kind === "docker") {
      const ins: DockerInspect | null = await svc.lifecycle.inspect(modelId).catch(() => null);
      if (!ins) throw new HttpError(502, "INSPECT_FAILED", `docker inspect ${modelId} failed`);
      labels = ins.Config.Labels ?? {};
      const digestRaw = (await svc.lifecycle.imageDigest(ins.Image).catch(() => null)) ?? m.runtime.imageDigest;
      const repo = (ins.Config.Image.split("@")[0] ?? "").replace(/:[^/:]+$/, "");
      const image = digestRaw ? (digestRaw.includes("@") ? digestRaw : `${repo}@${digestRaw}`) : null;
      if (!image || !DIGEST_PINNED.test(image)) refusals.push("the image has no RepoDigest (never pushed or pulled by digest); the registry needs a digest-pinned image");
      sourceUrl = imageSourceUrl((image ?? repo).split("@")[0] ?? repo, labels);

      const env = envMap(ins.Config.Env);
      const imageEnv = new Set(await svc.lifecycle.imageEnv(ins.Image).catch(() => [] as string[]));
      const environment: Record<string, string> = {};
      const droppedSecrets: string[] = [];
      const droppedDevices: string[] = [];
      for (const [k, v] of env) {
        if (imageEnv.has(`${k}=${v}`)) continue;
        if (DEVICE_ENV.has(k)) droppedDevices.push(k);
        else if (SECRET_ENV.test(k)) droppedSecrets.push(k);
        else environment[k] = v;
      }
      if (droppedSecrets.length) warnings.push(`removed secret environment keys: ${droppedSecrets.join(", ")}`);
      if (droppedDevices.length) warnings.push(`removed ${droppedDevices.join(", ")}; the launcher picks the cards`);

      const argScrub = scrubArgv(ins.Config.Cmd ?? []);
      let args = argScrub.argv;
      let entrypoint: string | null = null;
      const ep = ins.Config.Entrypoint ?? [];
      const imageEp = await imageEntrypoint(ins.Image);
      if (ep.length && JSON.stringify(ep) !== JSON.stringify(imageEp ?? [])) {
        entrypoint = ep[0] ?? null;
        args = [...ep.slice(1), ...args];
      }
      if (ep.length && /\.sh$|serve-|entrypoint/.test(ep[0] ?? "")) warnings.push(`the image entrypoint ${ep[0]} is a wrapper; launch.arguments is Config.Cmd and the effective engine argv is metadata.local_studio.host_argv`);
      if (FORBIDDEN_ARG.test([...args, ...Object.values(environment)].join(" ")) && !refusals.some((r) => r.includes("eager"))) refusals.push("launch arguments or environment request enforce-eager / disabled CUDA graphs");

      const envTargets = new Map<string, string>();
      for (const [k, v] of env) if (v.startsWith("/")) envTargets.set(v.replace(/\/+$/, ""), k);
      const provisionFor = (source: string, target: string): Mount["provision"] | null => {
        const envKey = envTargets.get(target.replace(/\/+$/, ""));
        const draft = !!envKey && /DRAFT|DFLASH|SPEC/.test(envKey);
        const revision =
          hfRevisionOf(source) ??
          (envKey && REVISION_40.test(env.get(`${envKey}_REVISION`) ?? "") ? env.get(`${envKey}_REVISION`) ?? null : null) ??
          (!draft && REVISION_40.test(labels["local-inference.model.revision"] ?? "") ? labels["local-inference.model.revision"] ?? null : null) ??
          (basename(source).match(/[0-9a-f]{40}/)?.[0] ?? null);
        const repository = draft
          ? labels["local-inference.draft.repository"] || labels["local-inference.draft.model"] || null
          : labels["local-inference.model.repository"] || labels["local-inference.target.repository"] || null;
        if (!revision || !repository) return null;
        return { repository, revision, size_gb: dirSizeGb(source) };
      };

      const modelPath = ([argValue(hostArgv, "--model"), argValue(hostArgv, "--model-path"), argValue(hostArgv, "-m"), hostArgv.includes("serve") ? hostArgv[hostArgv.indexOf("serve") + 1] : null, env.get("MODEL")].find((x) => x?.startsWith("/")) ?? "").replace(/\/+$/, "");
      const mounts: Mount[] = [];
      const seen = new Map<string, Mount["provision"] | null>();
      for (const mt of [...ins.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination))) {
        const target = mt.Destination;
        const src = mt.Source;
        if (/\/\.cache\/huggingface(\/|$)/.test(src)) {
          mounts.push({ source: `~/.cache/huggingface${src.split("/.cache/huggingface")[1] ?? ""}`, target, read_only: !mt.RW });
          continue;
        }
        if (mt.Type === "bind" && isWeightsDir(src)) {
          if (mt.RW) warnings.push(`weights mount ${target} is read-write on the live container; the record mounts it read-only`);
          const prov = seen.has(src) ? seen.get(src) ?? null : provisionFor(src, target);
          const first = !seen.has(src);
          seen.set(src, prov);
          if (!prov && first) refusals.push(`the weights at ${target} (${basename(src)}) cannot be pinned to a repository + 40-hex revision`);
          if (prov && (target.replace(/\/+$/, "") === modelPath || !modelPathRevision)) modelPathRevision = { repository: prov.repository, revision: prov.revision };
          mounts.push({ source: `\${MODEL_ROOT}/${basename(src)}`, target, read_only: true, ...(prov && first ? { provision: prov } : {}) });
          continue;
        }
        mounts.push({ source: `\${CACHE_ROOT}/${mt.Type === "volume" ? src.split("/").slice(-2, -1)[0] ?? basename(src) : basename(src)}`, target, read_only: !mt.RW });
      }
      const scratch = mounts.filter((x) => x.source.startsWith("${CACHE_ROOT}/"));
      if (scratch.length > 1) warnings.push(`${scratch.length} cache mounts; the plugin catalog (schema 2) exports at most one scratch mount`);

      const bindings = ins.HostConfig.PortBindings ?? {};
      let hostPort: number | null = null;
      let containerPort: number | null = null;
      for (const [cp, bs] of Object.entries(bindings)) {
        for (const b of bs ?? []) {
          const hp = intOrNull(b.HostPort);
          if (hostPort === null || hp === m.port) {
            hostPort = hp;
            containerPort = intOrNull(cp.split("/")[0]);
          }
        }
      }
      const netMode = ins.HostConfig.NetworkMode ?? "bridge";
      if (netMode === "host") refusals.push("the container uses host networking; the registry requires network_mode bridge");
      else if (netMode !== "bridge" && netMode !== "default") warnings.push(`the container runs on network ${netMode}; the record uses bridge`);
      if (containerPort === null) {
        containerPort = intOrNull(argValue(hostArgv, "--port")) ?? m.port;
        if (netMode !== "host") warnings.push("no published port; container_port comes from the engine argv");
      }
      if (ins.HostConfig.IpcMode === "host") warnings.push("the live container runs with --ipc=host; the registry gate refuses host IPC, so the record omits ipc and relies on shm_size");

      launch = {
        kind: "docker",
        image,
        ...(entrypoint ? { entrypoint } : {}),
        arguments: args,
        environment,
        mounts,
        host_port: hostPort ?? containerPort,
        container_port: containerPort,
        accelerator_backend: gpus[0]?.backend ?? "nvidia",
        network_mode: "bridge",
        shm_size: shmString(ins.HostConfig.ShmSize),
        container: {
          captured_at: capturedAt,
          compose_file: null,
          digest: image ? image.split("@")[1] ?? null : null,
          image,
          reason: "runtime-digest-from-live-container",
          runtime: "docker",
          source: [{ kind: "live-container", url: sourceUrl, captured_at: capturedAt }],
          state: image ? "digest-pinned" : "none",
        },
      };
    } else {
      warnings.push("native process: exported as launch.kind native (a record, not launchable by Local Studio)");
      launch = { kind: "native", arguments: hostArgv, container_port: m.port, accelerator_backend: gpus[0]?.backend ?? null };
    }

    const served = m.primaryModel;
    const engineName = ENGINE_NAME[m.engine] ?? m.engine;
    const id = slug(`${served}-${hardwareShort(hardwareId ?? "unknown")}-${engineName.replace(".", "")}-tp${tp ?? m.gpuKeys.length}`);
    const rev = modelPathRevision as { repository: string; revision: string } | null;
    let modelInstanceId = `unknown--${id}`;
    if (rev) {
      const ids = await registry.modelInstanceIds().catch(() => [] as string[]);
      const hit = ids.find((x) => x.endsWith(`--${rev.revision.slice(0, 12)}`));
      if (hit) modelInstanceId = hit;
      else {
        modelInstanceId = `${slug(rev.repository.split("/")[1] ?? rev.repository)}--${rev.revision.slice(0, 12)}`;
        warnings.push(`no model-instance record for ${rev.repository}@${rev.revision.slice(0, 12)}; add registry/model-instance/${modelInstanceId}.json`);
      }
    } else warnings.push("model_instance_id could not be resolved from the weights");

    const record: Record<string, unknown> = {
      schema_version: "local-ai-registry/v1",
      id,
      recipe_source: "local-studio",
      status: "candidate",
      description: `Exported by Local Studio from the live ${m.runtime.kind === "docker" ? `container ${m.runtime.containerName.replace(/^\//, "")}` : `process on port ${m.port}`} on ${machine} (${gpus.length} × ${gpus[0]?.name ?? "GPU"}). Candidate: capabilities and speeds are not proven until accept_recipe.py runs against it.`,
      model_instance_id: modelInstanceId,
      hardware_id: hardwareId,
      hardware_count: gpus.length,
      engine: { name: engineName, version, graph_mode: graphMode(hostArgv) },
      launch,
      serving: {
        max_context_tokens: m.contextWindow ?? intOrNull(argValue(hostArgv, "--max-model-len", "--context-length", "-c", "--ctx-size")),
        kv_cache_tokens: kvTokens,
        max_concurrency: intOrNull(argValue(hostArgv, "--max-num-seqs", "--max-running-requests", "--parallel", "-np")),
        tensor_parallel: tp,
        kv_cache_dtype: argValue(hostArgv, "--kv-cache-dtype") ?? cache?.labels.cache_dtype ?? null,
        decode_context_parallel: intOrNull(argValue(hostArgv, "--decode-context-parallel-size", "-dcp")),
      },
      capabilities: { chat: null, reasoning: null, tools: null, vision: null },
      speed_sweep_ids: [],
      facts: {},
      provenance: { captured_at: capturedAt, sources: [{ kind: "live-container", url: sourceUrl, captured_at: capturedAt }] },
      metadata: {
        capabilities_reason: "not proven; run accept_recipe.py",
        local_studio: {
          exported_at: capturedAt,
          machine,
          machine_id: ctx.identity.machineId,
          model_id: m.id,
          served_models: m.servedModels,
          origin: m.origin,
          host_argv: hostArgv,
          image_tag: m.runtime.kind === "docker" ? m.runtime.image : null,
          release: labels["local-inference.release.name"] ?? null,
          spec_decode: m.spec,
          cache_config: cache
            ? {
                source: "cache_config_info",
                block_size: intOrNull(cache.labels.block_size),
                num_gpu_blocks: intOrNull(cache.labels.num_gpu_blocks),
                kv_cache_size_tokens: intOrNull(cache.labels.kv_cache_size_tokens),
                cache_dtype: cache.labels.cache_dtype ?? null,
                enable_prefix_caching: cache.labels.enable_prefix_caching ?? null,
                kv_cache_max_concurrency: cache.labels.kv_cache_max_concurrency ? Number(cache.labels.kv_cache_max_concurrency) : null,
              }
            : null,
          measured: measured(summary, machine),
        },
      },
    };

    const endpoint = `http://127.0.0.1:${m.port}/v1`;
    const doc = renderDoc({ id, m, record, hostArgv, refusals, warnings, endpoint, machine, hardwareId, gpus: gpus.map((g) => g.name), summary });
    const outDir = join(ctx.config.dataDir, "exports", id);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "recipe.json"), stableJson(record));
    writeFileSync(join(outDir, "README.md"), doc);
    const result: RecipeExport = { modelId, recipeId: id, record, doc, refusals, warnings, launchable: refusals.length === 0 && launch.kind === "docker", savedTo: outDir };
    writeFileSync(join(outDir, "export.json"), stableJson(result));
    return result;
  };

  return { exportModel };
};

const n = (v: number | null | undefined, unit = ""): string => (v === null || v === undefined ? "–" : `${Math.round(v * 10) / 10}${unit}`);

const renderDoc = (a: {
  id: string;
  m: RunningModel;
  record: Record<string, unknown>;
  hostArgv: string[];
  refusals: string[];
  warnings: string[];
  endpoint: string;
  machine: string;
  hardwareId: string | null;
  gpus: string[];
  summary: MetricsSummary | null;
}): string => {
  const launch = a.record.launch as Record<string, unknown>;
  const serving = a.record.serving as Record<string, unknown>;
  const engine = a.record.engine as Record<string, unknown>;
  const s = a.summary;
  const lines = [
    `# ${a.id}`,
    "",
    `Candidate recipe exported by Local Studio from a running model. Status stays \`candidate\` until \`accept_recipe.py\` proves it.`,
    "",
    "## What ran",
    "",
    `| | |`,
    `|---|---|`,
    `| model | \`${a.m.primaryModel}\` (${a.m.id}, ${a.m.origin}) |`,
    `| machine | ${a.machine} |`,
    `| hardware | ${a.gpus.length} × ${a.gpus[0] ?? "?"} (\`${a.hardwareId ?? "unknown"}\`) |`,
    `| engine | ${String(engine.name)} ${String(engine.version ?? "")} |`,
    `| graph mode | ${String(engine.graph_mode ?? "–")} |`,
    `| image | \`${String(launch.image ?? "–")}\` |`,
    `| context | ${String(serving.max_context_tokens ?? "–")} tokens |`,
    `| KV cache | ${String(serving.kv_cache_tokens ?? "–")} tokens (cache_config_info) |`,
    `| TP / max seqs | ${String(serving.tensor_parallel ?? "–")} / ${String(serving.max_concurrency ?? "–")} |`,
    "",
    "## Host argv",
    "",
    "The engine's real argv, read from `/proc` on the host (the container `Cmd` can be a wrapper).",
    "",
    "```",
    a.hostArgv.map((x) => (/[\s{}"'$]/.test(x) ? `'${x}'` : x)).join(" "),
    "```",
    "",
    "## Measured (7 days, Local Studio gateway)",
    "",
  ];
  if (!s || s.requests === 0) lines.push("No requests went through this controller's gateway in the window.", "");
  else
    lines.push(
      `| requests | errors | prompt tokens | cached | output | cache hit | prefill tok/s | decode tok/s | TTFT p50 |`,
      `|---|---|---|---|---|---|---|---|---|`,
      `| ${s.requests} | ${s.errors} | ${s.promptTotal} | ${s.cacheRead} | ${s.output} | ${s.cacheHit === null ? "–" : `${Math.floor(s.cacheHit * 1000) / 10}%`} | ${n(s.prefillTps)} | ${n(s.decodeTps)} | ${n(s.ttftMs.p50, " ms")} |`,
      "",
      `Provenance: local-studio gateway, ${a.machine}, 7d. Aggregate rates are Σtokens / Σtime.`,
      "",
    );
  lines.push("## Refusals", "", ...(a.refusals.length ? a.refusals.map((r) => `- ${r}`) : ["None."]), "");
  lines.push("## Warnings", "", ...(a.warnings.length ? a.warnings.map((r) => `- ${r}`) : ["None."]), "");
  lines.push(
    "## Accept it",
    "",
    "On the same machine, with the model still running:",
    "",
    "```sh",
    `python3 scripts/accept_recipe.py ${a.id} --endpoint ${a.endpoint}`,
    "make trust && make index && make check",
    "```",
    "",
    "Capabilities are `null` on purpose: they are never guessed.",
    "",
  );
  return lines.join("\n");
};
