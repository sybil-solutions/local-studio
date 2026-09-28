import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { RecipeExport, RecipeProof, RunningModel } from "@local-studio/contracts";
import type { Ctx, DockerInspect, Services } from "../context";
import { hardwareOf } from "./fit";
import type { Weight as ProfileWeight } from "@local-studio/registry";
import { type Profile, type Registry, type RegRecipe, recipeFile, SECCOMP } from "./registry";
import { argValue, DEVICE_ENV, DIGEST_PINNED, FORBIDDEN_ARG, HttpError, REVISION_40, SECRET_ENV, scrubArgv, slug, stableJson } from "./util";
import { hfRevisionOf, readMap } from "./weights";

const ENGINE_NAME: Record<string, string> = { vllm: "vllm", sglang: "sglang", llamacpp: "llama.cpp", tabby: "tabbyapi", mlx: "mlx" };

const envMap = (env: string[] | null | undefined): Map<string, string> => {
  const m = new Map<string, string>();
  for (const e of env ?? []) {
    const i = e.indexOf("=");
    if (i > 0) m.set(e.slice(0, i), e.slice(i + 1));
  }
  return m;
};

const isWeightsDir = (p: string): boolean => {
  try {
    if (existsSync(join(p, "config.json")) || existsSync(join(p, "model.safetensors.index.json"))) return true;
    return readdirSync(p).some((f) => /\.(safetensors|gguf)$/.test(f));
  } catch {
    return false;
  }
};

const textFile = (p: string): string | null => {
  try {
    if (!statSync(p).isFile() || statSync(p).size > 256 * 1024) return null;
    const t = readFileSync(p, "utf8");
    return t.includes("\u0000") ? null : t;
  } catch {
    return null;
  }
};

const shmString = (bytes: number | undefined): string | null => {
  if (!bytes) return null;
  if (bytes % 1024 ** 3 === 0) return `${bytes / 1024 ** 3}g`;
  if (bytes % 1024 ** 2 === 0) return `${bytes / 1024 ** 2}m`;
  return String(bytes);
};

const sameLaunch = (a: Profile, b: Profile): boolean => {
  const strip = ({ about: _a, frozen_from: _f, id: _i, ...rest }: Profile) => stableJson(rest);
  return strip(a) === strip(b);
};

export interface Exporter {
  exportModel(modelId: string): Promise<RecipeExport>;
}

export const createExporter = (ctx: Ctx, svc: Services, registry: Registry): Exporter => {
  const exportModel = async (modelId: string): Promise<RecipeExport> => {
    const m: RunningModel | undefined = svc.runtime.model(modelId);
    if (!m) throw new HttpError(404, "MODEL_NOT_FOUND", `no running model ${modelId}`);
    if (m.runtime.kind !== "docker") throw new HttpError(422, "NOT_A_CONTAINER", `${modelId} is not a container; the registry records container launches only`);
    const refusals: string[] = [];
    const warnings: string[] = [];
    const machine = ctx.identity.name;
    const loaded = await registry.load().catch(() => null);
    const tree = loaded?.tree ?? null;
    const hw = loaded?.catalog.hardware ?? [];
    const ins: DockerInspect | null = await svc.lifecycle.inspect(modelId).catch(() => null);
    if (!ins) throw new HttpError(502, "INSPECT_FAILED", `docker inspect ${modelId} failed`);
    const labels = ins.Config.Labels ?? {};

    const gpus = m.gpuKeys.map((k) => svc.runtime.view().gpus.find((g) => g.key === k)).filter((g) => !!g);
    const cardIds = [...new Set(gpus.map((g) => hardwareOf(g, hw)))];
    const card = cardIds.length === 1 && cardIds[0] ? tree?.cards.get(cardIds[0]) ?? null : null;
    if (!gpus.length) refusals.push("the model owns no GPUs that discovery can see");
    else if (!card) refusals.push(`the model's GPUs are not one registry card (${cardIds.map((x) => x ?? "unknown").join(", ")})`);

    const digestRaw = (await svc.lifecycle.imageDigest(ins.Image).catch(() => null)) ?? m.runtime.imageDigest;
    const repo = (ins.Config.Image.split("@")[0] ?? "").replace(/:[^/:]+$/, "");
    const image = digestRaw ? (digestRaw.includes("@") ? digestRaw : `${repo}@${digestRaw}`) : "";
    if (!DIGEST_PINNED.test(image)) refusals.push("the image has no registry digest (built locally or never pulled by digest)");

    const env = envMap(ins.Config.Env);
    const imageEnv = new Set(await svc.lifecycle.imageEnv(ins.Image).catch(() => [] as string[]));
    const environment: Record<string, string> = {};
    const dropped: string[] = [];
    for (const [k, v] of env) {
      if (imageEnv.has(`${k}=${v}`)) continue;
      if (DEVICE_ENV.has(k) || SECRET_ENV.test(k)) dropped.push(k);
      else environment[k] = v;
    }
    if (dropped.length) warnings.push(`left out ${dropped.join(", ")}`);

    const cmd = scrubArgv(ins.Config.Cmd ?? []);
    if (cmd.dropped.length) warnings.push(`left out secret flags ${cmd.dropped.join(", ")}`);
    let args = cmd.argv;
    let entrypoint: string | null = null;
    const ep = ins.Config.Entrypoint ?? [];
    if (ep.length && JSON.stringify(ep) !== JSON.stringify((await svc.lifecycle.imageEntrypoint(ins.Image)) ?? [])) {
      entrypoint = ep[0] ?? null;
      args = [...ep.slice(1), ...args];
    }
    if (FORBIDDEN_ARG.test([...args, ...Object.values(environment)].join(" "))) refusals.push("the launch uses enforce-eager or disabled CUDA graphs");

    const byPath = new Map(Object.entries(readMap(ctx.config.home)).map(([k, p]) => [p.replace(/\/+$/, ""), k]));
    const pin = (source: string, target: string): { repo: string; revision: string } | null => {
      const mapped = byPath.get(source.replace(/\/+$/, ""))?.split("@");
      if (mapped?.[0] && REVISION_40.test(mapped[1] ?? "")) return { repo: mapped[0], revision: mapped[1] ?? "" };
      const canon = /^([\w.-]+)--([\w.-]+)@[0-9a-f]{12}$/.exec(basename(source));
      const draft = [...env].some(([k, v]) => v.replace(/\/+$/, "") === target.replace(/\/+$/, "") && /DRAFT|DFLASH|SPEC/.test(k));
      const revision = hfRevisionOf(source) ?? (draft ? null : REVISION_40.test(labels["local-inference.model.revision"] ?? "") ? labels["local-inference.model.revision"] ?? null : null) ?? basename(source).match(/[0-9a-f]{40}/)?.[0] ?? null;
      const repository = draft ? labels["local-inference.draft.repository"] || null : labels["local-inference.model.repository"] || labels["local-inference.target.repository"] || (canon ? `${canon[1]}/${canon[2]}` : null);
      return revision && repository ? { repo: repository, revision } : null;
    };

    const weights: ProfileWeight[] = [];
    let config: { at: string; text: string } | null = null;
    for (const mt of [...ins.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination))) {
      if (mt.Type === "bind" && isWeightsDir(mt.Source)) {
        const p = pin(mt.Source, mt.Destination);
        if (p) weights.push({ repo: p.repo, revision: p.revision, at: mt.Destination, layout: "dir" });
        else refusals.push(`the weights at ${mt.Destination} (${basename(mt.Source)}) cannot be pinned to a repository and 40-hex revision; add "<owner>/<name>@<revision>": "${mt.Source}" to ${join(ctx.config.home, "weights.json")}`);
        continue;
      }
      const text = mt.Type === "bind" ? textFile(mt.Source) : null;
      if (text !== null && !config) {
        config = { at: mt.Destination, text };
        continue;
      }
      if (text !== null) refusals.push(`a second file mount (${mt.Destination}); a registry profile carries one config file`);
      else warnings.push(`left out the ${mt.RW ? "writable" : "read-only"} mount ${mt.Destination} (cache or scratch)`);
    }
    const modelPath = [argValue(args, "--model", "--model-path", "-m"), env.get("MODEL"), env.get("MODEL_PATH")].find((x) => x?.startsWith("/"))?.replace(/\/+$/, "");
    const main = weights.find((w) => w.at === modelPath) ?? weights[0];

    const flags: string[] = [];
    if (ins.HostConfig.IpcMode === "host") flags.push("--ipc host");
    for (const o of ins.HostConfig.SecurityOpt ?? []) {
      if (o === "seccomp=unconfined" || o === "seccomp:unconfined") flags.push("--security-opt seccomp=unconfined");
      else if (o.startsWith("seccomp")) {
        const body = o.replace(/^seccomp[=:]/, "");
        const name = Object.keys(SECCOMP).find((n) => {
          try {
            return stableJson(JSON.parse(body)) === stableJson(SECCOMP[n]);
          } catch {
            return false;
          }
        });
        if (name) flags.push(`--security-opt seccomp=${name}`);
        else refusals.push("the container runs with a custom seccomp profile the registry does not ship");
      } else warnings.push(`left out --security-opt ${o.split("=")[0]}`);
    }
    for (const u of ins.HostConfig.Ulimits ?? []) flags.push(`--ulimit ${u.Name}=${u.Soft === u.Hard ? u.Soft : `${u.Soft}:${u.Hard}`}`);
    if (ins.HostConfig.NetworkMode === "host") refusals.push("the container uses host networking; a single-machine recipe publishes its port on a bridge network");

    let port: number | null = null;
    for (const [cp, bs] of Object.entries(ins.HostConfig.PortBindings ?? {})) if ((bs ?? []).some((b) => Number(b.HostPort) === m.port) || port === null) port = Number(cp.split("/")[0]);
    port ??= Number(argValue(args, "--port")) || m.port;

    const engine = ENGINE_NAME[m.engine] ?? m.engine;
    const model = tree?.models[m.primaryModel] ? m.primaryModel : slug(m.primaryModel);
    if (!tree?.models[model]) warnings.push(`${model} is not in registry/models.json; add it there for the catalog to name it`);
    const ctxTokens = m.contextWindow ?? (Number(argValue(args, "--max-model-len", "--context-length", "--ctx-size", "-c")) || 0);
    if (!ctxTokens) refusals.push("the context window is not known");
    const cards = gpus.length || 1;
    const summary = (() => {
      try {
        return svc.metrics.summary("7d", { model: m.primaryModel });
      } catch {
        return null;
      }
    })();

    const frozen: Profile = {
      id: "",
      engine,
      about: `${m.primaryModel} on ${cards} x ${gpus[0]?.name ?? "GPU"}, the owner's launch saved by Local Studio from ${m.runtime.containerName.replace(/^\//, "")} on ${machine}`,
      image,
      backend: gpus[0]?.backend ?? null,
      port,
      entrypoint,
      args,
      env: environment,
      shm: shmString(ins.HostConfig.ShmSize),
      weights,
      config,
      ctx: ctxTokens,
      seqs: 1,
      vision: !!m.vision,
      cards,
      ...(flags.length ? { flags } : {}),
      frozen_from: [`local-studio:${machine}/${m.runtime.containerName.replace(/^\//, "")}`],
    };
    const same = tree ? [...tree.launches.values()].find((p) => sameLaunch(p, frozen)) : undefined;
    const base = `${engine}-${model}-${Math.floor(ctxTokens / 1024)}k${cards > 1 ? `-tp${cards}` : ""}`.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    let name = same?.id ?? base;
    for (let n = 2; !same && (tree?.launches.has(name) || tree?.engines.has(name)); n++) name = `${base}-v${n}`;
    const profile: Profile = same ?? { ...frozen, id: name };

    const today = new Date().toISOString().slice(0, 10);
    const decode = summary && summary.requests > 0 && summary.decodeTps !== null ? Math.round(summary.decodeTps * 10) / 10 : null;
    const proof: RecipeProof = { at: today, on: "owner", gpu: `${gpus[0]?.name ?? "GPU"} (owner: ${machine})`, gates: "load chat", tps: decode, served: m.primaryModel, legacy: true };
    const recipe: RegRecipe = { model, weights: main ? `${main.repo}@${main.revision}` : "baked-into-image", engine: `${profile.id}@${image.split("@sha256:")[1]?.slice(0, 12) ?? "none"}`, set: {}, card: card?.id ?? cardIds[0] ?? "unknown", proof: [proof] };
    const recipeText = `${JSON.stringify(recipe)}\n`;
    if (recipeText.length > 1024) refusals.push(`the recipe is ${recipeText.length} bytes; the registry allows 1024`);
    const withProfile = tree ? { ...tree, launches: new Map([...tree.launches, [profile.id, profile]]) } : null;
    const recipePath = card && withProfile ? recipeFile(withProfile, recipe) : `registry/recipes/unknown/${recipe.card}/${model}.${engine}.${Math.floor(ctxTokens / 1024)}k.json`;
    const files: Record<string, string> = { [recipePath]: recipeText };
    if (!same) files[`registry/launches/${profile.id}.json`] = `${JSON.stringify(profile, null, 2)}\n`;
    if (tree?.recipes.has(recipePath)) warnings.push(`${recipePath} exists in the registry; saving replaces its proof`);

    const key = recipePath.slice("registry/recipes/".length, -".json".length);
    const id = `${key.split("/").pop()}.${recipe.card}`;
    const outDir = join(ctx.config.dataDir, "exports", id);
    mkdirSync(outDir, { recursive: true });
    for (const [p, t] of Object.entries(files)) writeFileSync(join(outDir, basename(p)), t);
    const launchable = refusals.length === 0;
    if (launchable) {
      mkdirSync(join(ctx.config.home, "recipes"), { recursive: true });
      writeFileSync(join(ctx.config.home, "recipes", `${id}.json`), `${JSON.stringify({ key, recipe, profile }, null, 1)}\n`);
    }
    const doc = [`# ${key}`, "", `Saved from ${m.runtime.containerName.replace(/^\//, "")} on ${machine}.`, "", ...Object.keys(files).map((p) => `- \`${p}\``), "", ...refusals.map((r) => `- refused: ${r}`), ...warnings.map((w) => `- ${w}`), ""].join("\n");
    const result: RecipeExport = { modelId, recipeId: id, record: recipe as unknown as Record<string, unknown>, profile: profile as unknown as Record<string, unknown>, files, doc, refusals, warnings, launchable, savedTo: outDir };
    writeFileSync(join(outDir, "export.json"), `${JSON.stringify(result, null, 1)}\n`);
    ctx.db.query("INSERT INTO recipe_exports (at, model_id, recipe_id, saved_to, refusals, launchable) VALUES (?, ?, ?, ?, ?, ?)").run(Date.now(), modelId, id, outDir, refusals.length, launchable ? 1 : 0);
    return result;
  };

  return { exportModel };
};
