import { join } from "node:path";
import type { LaunchMount, LaunchPlan } from "@local-studio/contracts";
import type { Ctx, RuntimeView } from "../context";
import { availableKeys, fitFor, hardwareOf } from "./fit";
import { type LoadedCatalog, normEngine, type V2Recipe } from "./registry";
import { DEVICE_ENV, DIGEST_PINNED, DOCKER_OPT, ENV_KEY, FORBIDDEN_ARG, HttpError, REVISION_40 } from "./util";
import type { ResolvedWeight, WeightIndex } from "./weights";

export interface PlanResult {
  plan: LaunchPlan;
  weights: ResolvedWeight[];
  warnings: string[];
  asset: { path: string; text: string } | null;
  scratchDir: string | null;
}

const gate = (r: V2Recipe): void => {
  const bad = (msg: string) => {
    throw new HttpError(422, "RECIPE_GATE", `${r.id}: ${msg}`);
  };
  if (!r.local && !DIGEST_PINNED.test(r.image)) bad("image is not pinned by digest");
  if (!/^[\w./:@-]+$/.test(r.image)) bad(`image ${r.image} is invalid`);
  if (!(r.cards >= 1 && r.cards <= 8)) bad(`cards ${r.cards} out of range`);
  for (const w of r.weights) {
    if (w.hostPath !== undefined) {
      if (!r.local || !w.hostPath.startsWith("/")) bad(`weights host path ${w.hostPath} is not allowed`);
    } else {
      if (!/^[\w.-]+\/[\w.-]+$/.test(w.repository)) bad(`weights repository ${w.repository} is not owner/name`);
      if (!REVISION_40.test(w.revision)) bad(`weights ${w.repository} revision is not a 40-hex commit`);
    }
    if (!w.mountPath.startsWith("/")) bad(`weights mount path ${w.mountPath} is not absolute`);
  }
  for (const o of r.launch.docker ?? []) if (!DOCKER_OPT.test(o)) bad(`docker option ${o} is not allowed`);
  for (const m of r.launch.mounts ?? []) if (!r.local || !m.source.startsWith("/") || !m.target.startsWith("/") || /[:,]/.test(m.source + m.target)) bad(`mount ${m.source}:${m.target} is not allowed`);
  if (!r.launch.arguments.every((a) => typeof a === "string")) bad("arguments must all be strings");
  const hay = [r.launch.entrypoint ?? "", ...r.launch.arguments, ...Object.values(r.launch.environment ?? {})].join(" ");
  if (FORBIDDEN_ARG.test(hay)) bad("enforce-eager / disabled CUDA graphs are not allowed");
  for (const k of Object.keys(r.launch.environment ?? {})) if (!ENV_KEY.test(k)) bad(`environment key ${k} is invalid`);
  if (!Number.isInteger(r.launch.port) || r.launch.port < 1 || r.launch.port > 65535) bad("container port is invalid");
  if (r.launch.shm !== null && r.launch.shm !== undefined && !/^[0-9]+[bkmg]?$/i.test(r.launch.shm)) bad(`shm ${r.launch.shm} is invalid`);
  if (r.launch.entrypoint && !/^[\w./-]+$/.test(r.launch.entrypoint)) bad(`entrypoint ${r.launch.entrypoint} is invalid`);
};

const containerNameFor = (id: string, view: RuntimeView): string => {
  const taken = new Set(view.models.map((m) => (m.runtime.kind === "docker" ? m.runtime.containerName.replace(/^\//, "") : m.id)));
  const base = `ls-${id}`.slice(0, 120);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
};

const hostPortFor = (ctx: Ctx, view: RuntimeView): number => {
  const used = new Set<number>([...view.models.map((m) => m.port), ...view.endpoints.map((e) => e.port), ctx.config.port]);
  const [lo, hi] = ctx.config.managedPortRange;
  for (let p = lo; p <= hi; p++) if (!used.has(p)) return p;
  throw new HttpError(409, "NO_PORT", `no free port in ${lo}-${hi}`);
};

const injectedFlags = (engine: string, args: string[]): string[] => {
  if (!args.includes("--served-model-name")) return [];
  if (engine === "vllm" && !args.includes("--enable-prompt-tokens-details")) return ["--enable-prompt-tokens-details"];
  if (engine === "sglang" && !args.includes("--enable-metrics")) return ["--enable-metrics"];
  return [];
};

export const buildPlan = (
  ctx: Ctx,
  view: RuntimeView,
  loaded: LoadedCatalog,
  index: WeightIndex,
  recipeId: string,
  opts: { gpuKeys?: string[]; strict: boolean },
): PlanResult => {
  const raw = loaded.raw.get(recipeId);
  const recipe = loaded.catalog.recipes.find((r) => r.id === recipeId);
  if (!raw || !recipe) throw new HttpError(404, "RECIPE_NOT_FOUND", `no recipe ${recipeId} in the registry catalog`);
  gate(raw);
  const warnings: string[] = [];
  const hw = loaded.catalog.hardware;
  const fit = fitFor(recipe.hardwareId, recipe.cards, view, hw);
  let gpuKeys: string[];
  if (opts.gpuKeys?.length) {
    gpuKeys = [...new Set(opts.gpuKeys)];
    if (gpuKeys.length !== recipe.cards) throw new HttpError(422, "GPU_COUNT", `${recipeId} needs ${recipe.cards} GPU(s), got ${gpuKeys.length}`);
    for (const k of gpuKeys) {
      const g = view.gpus.find((x) => x.key === k);
      if (!g) throw new HttpError(422, "GPU_UNKNOWN", `no GPU ${k} on this machine`);
      if (hardwareOf(g, hw) !== recipe.hardwareId) throw new HttpError(422, "GPU_HARDWARE", `${k} is not ${recipe.hardwareId}`);
    }
    const avail = availableKeys(view);
    const held = gpuKeys.filter((k) => !avail.has(k));
    if (held.length) {
      const msg = `GPU(s) ${held.join(",")} are not available (${view.groups.filter((g) => g.gpuKeys.some((k) => held.includes(k))).map((g) => `${g.state}${g.modelId ? ` by ${g.modelId}` : ""}`).join(", ")})`;
      if (opts.strict) throw new HttpError(409, "GPU_BUSY", msg);
      warnings.push(msg);
    }
  } else {
    const first = fit.freeGroups[0];
    if (fit.fit !== "fits" || !first) throw new HttpError(409, "RECIPE_NO_FIT", `${recipeId} does not fit this machine (${fit.fit}); pass gpuKeys to preview a plan`);
    gpuKeys = first;
  }
  const gpuUuids = gpuKeys.map((k) => view.gpus.find((g) => g.key === k)?.uuid ?? "");
  if (gpuUuids.some((u) => !u)) throw new HttpError(422, "GPU_UUID", "a chosen GPU has no UUID");

  const weights = raw.weights.map((w) => index.resolve(w));
  const mounts: LaunchMount[] = [];
  const addMount = (m: LaunchMount) => {
    if (!mounts.some((x) => x.target === m.target)) mounts.push(m);
  };
  for (const w of weights) {
    if (!w.present) {
      const msg = w.source === "missing" && w.hint?.startsWith("/") ? w.hint : `weights ${w.repository}@${w.revision.slice(0, 12)} are not on this machine; run: ${w.hint}`;
      if (opts.strict) throw new HttpError(409, "WEIGHTS_MISSING", msg);
      warnings.push(msg);
    }
    addMount({ source: w.hostPath, target: w.mountPath, readOnly: w.layout === "dir" });
  }
  for (const m of raw.launch.mounts ?? []) addMount({ source: m.source, target: m.target, readOnly: m.readOnly !== false });
  if (raw.local && !DIGEST_PINNED.test(raw.image)) warnings.push(`image ${raw.image} is not pinned by digest`);
  let asset: PlanResult["asset"] = null;
  if (raw.asset) {
    if (!/^[\w.-]+$/.test(raw.asset.name)) throw new HttpError(422, "RECIPE_GATE", `asset name ${raw.asset.name} is invalid`);
    const path = join(ctx.config.dataDir, "assets", recipeId, raw.asset.name);
    asset = { path, text: raw.asset.text };
    addMount({ source: path, target: raw.asset.mountPath, readOnly: true });
  }
  let scratchDir: string | null = null;
  if (raw.scratch) {
    scratchDir = join(ctx.config.dataDir, "scratch", recipeId);
    addMount({ source: scratchDir, target: raw.scratch, readOnly: false });
  }

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.launch.environment ?? {})) {
    if (DEVICE_ENV.has(k)) {
      warnings.push(`dropped ${k} from the recipe; the controller picks the cards`);
      continue;
    }
    env[k] = String(v);
  }
  const engine = String(normEngine(raw.engine));
  const injected = injectedFlags(engine, raw.launch.arguments);
  const plan: LaunchPlan = {
    recipeId,
    containerName: containerNameFor(recipeId, view),
    image: raw.image,
    entrypoint: raw.launch.entrypoint ?? null,
    args: [...raw.launch.arguments, ...injected],
    env,
    mounts,
    gpuUuids,
    gpuKeys,
    hostPort: hostPortFor(ctx, view),
    containerPort: raw.launch.port,
    shm: raw.launch.shm ?? null,
    dockerOpts: raw.launch.docker ?? [],
    labels: { "local-studio.managed": "1", "local-studio.recipe": recipeId, "local-studio.machine": ctx.identity.machineId },
    servedName: raw.servedName,
    injected,
  };
  return { plan, weights, warnings, asset, scratchDir };
};
