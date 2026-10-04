import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { LocalRegistry, LocalRegistryMatch, LocalRegistryRecord, LocalRegistryVariant } from "../../../packages/contracts/src/localStudio.ts";
import { decodeJson, exec, fail, lastLine } from "./core.ts";
import type { RawGpu } from "./hardware.ts";
import { blobs, norm } from "./registry.ts";

const S = Schema.String;
const N = Schema.NullOr;
const Opt = Schema.optionalKey;
const Hardware = Schema.Struct({ id: S, name: S, family: Opt(N(S)), aliases: Opt(Schema.Array(S)), products: Opt(Schema.Array(S)), memory: Schema.Struct({ vram_gb: N(Schema.Number) }) });
const Instance = Schema.Struct({ id: S, model_id: S, repository: S, revision: N(S), weights: Schema.Struct({ format: N(S), precision: N(S), size_gb: N(Schema.Number) }) });
const Row = Schema.Struct({ id: S, status: S, engine: S, hardware_id: S, hardware_count: Schema.Number, model_instance_id: S, launch_kind: S, has_evidence: Schema.Boolean });
const Launch = Schema.Struct({ observed_command: Opt(N(S)), arguments: Opt(N(Schema.Array(S))), container: Opt(N(Schema.Struct({ image: N(S), digest: N(S) }))) });
const decodeRecipe = Schema.decodeUnknownOption(Schema.Struct({ hardware_id: S, model_instance_id: S, launch: Launch }));

export type Instance = typeof Instance.Type;
export interface Library {
  dir: string;
  commit: string;
  hardware: Map<string, typeof Hardware.Type>;
  instances: Map<string, Instance>;
  rows: (typeof Row.Type)[];
  models: Set<string>;
  recommended: Set<string>;
  schemas: unknown[];
}
export interface Detected {
  name: string;
  memoryGb: number | null;
  count: number;
}

const decodeAll = <A>(schema: Schema.Codec<A, unknown>, values: unknown[]): A[] =>
  values.flatMap((v) => {
    const d = Schema.decodeUnknownOption(schema)(v);
    return d._tag === "Some" ? [d.value] : [];
  });
const parse = (text: string): unknown => decodeJson(Schema.Unknown, text) ?? null;

export const show = (lib: Library, path: string) => exec(["git", "-C", lib.dir, "show", `${lib.commit}:${path}`], 30_000).pipe(Effect.map((r) => (r.code === 0 ? parse(r.stdout) : null)));

export const loadLibrary = (dir: string, commit: string): Effect.Effect<Library> =>
  Effect.gen(function* () {
    const lib: Library = { dir, commit, hardware: new Map(), instances: new Map(), rows: [], models: new Set(), recommended: new Set(), schemas: [] };
    const all = (root: string, re: RegExp) => Effect.map(blobs(dir, commit, root, re), (ts) => ts.map(parse));
    for (const h of decodeAll(Hardware, yield* all("data/registry/hardware", /\.json$/))) lib.hardware.set(h.id, h);
    for (const i of decodeAll(Instance, yield* all("data/registry/model-instance", /\.json$/))) lib.instances.set(i.id, i);
    const index = decodeJson(Schema.Struct({ recipes: Schema.Array(Schema.Unknown) }), JSON.stringify((yield* show(lib, "data/registry/index/recipes.json")) ?? {}));
    lib.rows = decodeAll(Row, [...(index?.recipes ?? [])]);
    const recs = decodeJson(Schema.Struct({ recommendations: Schema.Record(S, Schema.Struct({ recipe_id: S })) }), JSON.stringify((yield* show(lib, "data/registry/index/recommendations.json")) ?? {}));
    lib.recommended = new Set(Object.values(recs?.recommendations ?? {}).map((r) => r.recipe_id));
    const ls = yield* exec(["git", "-C", dir, "ls-tree", "--name-only", commit, "data/registry/model/"], 30_000);
    lib.models = new Set(ls.stdout.split("\n").flatMap((l) => /([^/]+)\.json$/.exec(l)?.[1] ?? []));
    lib.schemas = yield* all("data/registry/schema", /\.schema\.json$/);
    return lib;
  });

export const detect = (gpus: RawGpu[]): Effect.Effect<Detected[]> =>
  Effect.gen(function* () {
    const groups = new Map<string, Detected>();
    for (const g of gpus) {
      const memoryGb = g.memoryTotalMiB > 0 ? g.memoryTotalMiB / 1024 : null;
      const key = `${g.name}|${memoryGb?.toFixed(0)}`;
      const prev = groups.get(key);
      groups.set(key, prev ? { ...prev, count: prev.count + 1 } : { name: g.name, memoryGb, count: 1 });
    }
    if (groups.size || NodeOS.platform() !== "darwin" || NodeOS.arch() !== "arm64") return [...groups.values()];
    const chip = (yield* exec(["sysctl", "-n", "machdep.cpu.brand_string"], 5_000)).stdout.trim();
    return [{ name: chip || "Apple Silicon", memoryGb: Math.round(NodeOS.totalmem() / 2 ** 30), count: 1 }];
  });

export const matchHardware = (lib: Library, detected: Detected[]): LocalRegistryMatch[] =>
  detected.map((d) => {
    const best = [...lib.hardware.values()]
      .filter((h) => [h.name, h.family ?? "", ...(h.aliases ?? []), ...(h.products ?? [])].map(norm).includes(norm(d.name)))
      .map((h) => ({ h, gap: d.memoryGb === null || h.memory.vram_gb === null ? 0 : Math.abs(d.memoryGb - h.memory.vram_gb) }))
      .filter((c) => c.gap <= 1)
      .sort((a, b) => a.gap - b.gap || a.h.id.localeCompare(b.h.id))[0]?.h;
    return { name: d.name, memoryGb: d.memoryGb === null ? null : Math.round(d.memoryGb), count: d.count, hardwareId: best?.id ?? null, hardwareName: best?.name ?? null };
  });

const downloads = new Map<string, string>();
const rank = (v: LocalRegistryVariant) => [v.fits ? 0 : 1, v.recommended ? 0 : 1, v.status === "validated" ? 0 : 1, v.evidence ? 0 : 1, v.sizeGb ?? 1e9];
const byRank = (a: LocalRegistryVariant, b: LocalRegistryVariant) => {
  const [x, y] = [rank(a), rank(b)];
  return x.reduce((d, v, i) => d || v - (y[i] ?? 0), 0);
};

export const browse = (lib: Library, matches: LocalRegistryMatch[], all: boolean): LocalRegistry => {
  const have = new Map(matches.flatMap((m) => (m.hardwareId ? [[m.hardwareId, m.count] as const] : [])));
  const variants = lib.rows
    .map((r): [string, LocalRegistryVariant] => {
      const i = lib.instances.get(r.model_instance_id);
      const w = i?.weights;
      const v = { id: r.id, status: r.status, engine: r.engine, hardwareId: r.hardware_id, hardwareCount: r.hardware_count, format: w?.format ?? null, precision: w?.precision ?? null, sizeGb: w?.size_gb ?? null, launchKind: r.launch_kind, evidence: r.has_evidence, recommended: lib.recommended.has(r.id), fits: (have.get(r.hardware_id) ?? 0) >= r.hardware_count };
      return [i?.repository ?? r.model_instance_id, v];
    })
    .sort((a, b) => byRank(a[1], b[1]));
  const seen = new Set<string>();
  const groups = new Map<string, LocalRegistryVariant[]>();
  for (const [repo, v] of variants) {
    const key = [repo.toLowerCase(), v.hardwareId, v.engine, v.format, v.precision].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.set(repo, [...(groups.get(repo) ?? []), v]);
  }
  const models = [...groups].map(([repo, vs]) => ({ repo, variants: vs })).sort((a, b) => byRank(a.variants[0]!, b.variants[0]!) || a.repo.localeCompare(b.repo));
  return { commit: lib.commit, error: null, matches, total: models.length, models: all ? models : models.flatMap((m) => (m.variants[0]?.fits ? [{ ...m, variants: m.variants.filter((v) => v.fits) }] : [])), downloads: Object.fromEntries(downloads) };
};

export const record = (lib: Library, id: string) =>
  Effect.gen(function* () {
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) return yield* fail(400, "BAD_ID", "invalid recipe id");
    const recipe = yield* show(lib, `data/registry/recipe/${id}.json`);
    const r = decodeRecipe(recipe);
    if (r._tag === "None") return yield* fail(404, "RECORD_NOT_FOUND", `no registry recipe ${id} at ${lib.commit.slice(0, 8)}`);
    const i = lib.instances.get(r.value.model_instance_id);
    const l = r.value.launch;
    const image = l.container?.image ? `${l.container.image}${l.container.digest ? `@${l.container.digest}` : ""}` : null;
    const gguf = /gguf/i.test(`${i?.weights.format} ${i?.repository}`) && i?.weights.precision;
    return {
      recipe,
      modelInstance: yield* show(lib, `data/registry/model-instance/${r.value.model_instance_id}.json`),
      model: i ? yield* show(lib, `data/registry/model/${i.model_id}.json`) : null,
      hardware: yield* show(lib, `data/registry/hardware/${r.value.hardware_id}.json`),
      command: l.observed_command ?? (l.arguments ? [image, ...l.arguments].filter(Boolean).join(" ") : null),
      weights: i && /^[^/\s]+\/[^/\s]+$/.test(i.repository) ? { repo: i.repository, revision: i.revision, include: gguf ? `*${gguf}*` : null } : null,
    } satisfies LocalRegistryRecord;
  });

export const download = (lib: Library, id: string) =>
  Effect.gen(function* () {
    const w = (yield* record(lib, id)).weights;
    if (!w) return yield* fail(409, "NO_WEIGHTS", "this record has no Hugging Face repository to download");
    if (!Bun.which("hf")) return yield* fail(409, "HF_MISSING", "the hf CLI is not installed on this machine");
    if (downloads.get(w.repo) !== "downloading") {
      downloads.set(w.repo, "downloading");
      const argv = ["hf", "download", w.repo, ...(w.include ? ["--include", w.include] : []), ...(w.revision ? ["--revision", w.revision] : [])];
      yield* Effect.forkDetach(exec(argv, 24 * 3600_000).pipe(Effect.map((r) => downloads.set(w.repo, r.code === 0 ? "downloaded" : `failed: ${lastLine(r)}`))));
    }
    return { repo: w.repo, state: downloads.get(w.repo) ?? "downloading" };
  });
