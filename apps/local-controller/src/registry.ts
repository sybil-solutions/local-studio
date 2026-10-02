import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { LocalRecipe } from "../../../packages/contracts/src/localStudio.ts";
import { type Config, decodeJson, exec, lastLine } from "./core.ts";

const Opt = Schema.optionalKey;
const OptNull = <S extends Schema.Top>(s: S) => Schema.optionalKey(Schema.NullOr(s));

const Weight = Schema.Struct({ repo: Schema.String, revision: Schema.String, at: Schema.String, layout: OptNull(Schema.String), files: OptNull(Schema.Unknown) });
export type Weight = typeof Weight.Type;

const Launch = Schema.Struct({
  kind: Opt(Schema.String),
  image: OptNull(Schema.String),
  entrypoint: OptNull(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  args: Opt(Schema.Array(Schema.String)),
  env: Opt(Schema.Record(Schema.String, Schema.String)),
  port: Schema.Number,
  shm: OptNull(Schema.String),
  flags: Opt(Schema.Array(Schema.String)),
  machines: Opt(Schema.Number),
  cards: Opt(Schema.Number),
  backend: OptNull(Schema.String),
  ctx: Schema.Number,
  weights: Opt(Schema.Unknown),
  config: OptNull(Schema.Struct({ at: Schema.String, text: Schema.String })),
  build: Opt(Schema.Unknown),
  setup: Opt(Schema.String),
});
export type Launch = typeof Launch.Type;

const Proof = Schema.Struct({ on: Opt(Schema.String), tps: OptNull(Schema.Number), captured: Opt(Schema.Boolean), archived: Opt(Schema.Boolean) });
const Entry = Schema.Struct({ model: Schema.String, card: Schema.String, engine: Schema.String, weights: Schema.String, launch: Launch, proof: Schema.Array(Proof) });
export type Entry = typeof Entry.Type;

const Card = Schema.Struct({ match: Schema.Struct({ backend: Schema.String, name: Schema.String, names: Schema.Array(Schema.String), vramGb: Schema.Number }) });
const CatalogFile = Schema.Struct({ cards: Schema.Record(Schema.String, Card), recipes: Schema.Record(Schema.String, Schema.Unknown) });
const decodeEntry = Schema.decodeUnknownOption(Entry);

export interface Catalog {
  info: { commit: string | null; error: string | null };
  cards: Record<string, typeof Card.Type>;
  recipes: Map<string, Entry>;
  archived: LocalRecipe[];
}

const V1 = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  model_instance_id: Schema.String,
  recipe_source: Schema.String,
  hardware_id: OptNull(Schema.String),
  hardware_count: OptNull(Schema.Number),
  engine: Opt(Schema.Struct({ name: OptNull(Schema.String) })),
  serving: Opt(Schema.Struct({ max_context_tokens: OptNull(Schema.Number) })),
});

const Manifest = Schema.Struct({
  configs: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      host: Schema.String,
      decision: Schema.String,
      gaps: Schema.Array(Schema.String),
      engine: OptNull(Schema.String),
      context: OptNull(Schema.Number),
      hardware: OptNull(Schema.Struct({ id: Schema.NullOr(Schema.String), count: Schema.NullOr(Schema.Number) })),
      runtime: OptNull(Schema.Struct({ ref: OptNull(Schema.String) })),
    }),
  ),
});

const reference = (id: string, model: string, card: string, engine: string, cards: number, ctx: number, blocked: string): LocalRecipe => ({ id, model, card, engine, cards, ctx, tps: null, fits: false, blocked });

const blobs = (dir: string, commit: string, root: string, pattern: RegExp) =>
  Effect.gen(function* () {
    const ls = yield* exec(["git", "-C", dir, "ls-tree", "-r", commit, "--", root], 30_000);
    const oids = ls.stdout.split("\n").flatMap((l) => {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(l);
      return m?.[1] && pattern.test(m[2] ?? "") ? [m[1]] : [];
    });
    if (!oids.length) return [];
    const buf = Buffer.from((yield* exec(["git", "-C", dir, "cat-file", "--batch"], 120_000, { stdin: `${oids.join("\n")}\n` })).stdout);
    const out: string[] = [];
    for (let pos = 0; pos < buf.length; ) {
      const nl = buf.indexOf(10, pos);
      const [, kind, size] = buf.subarray(pos, nl < 0 ? pos : nl).toString().split(" ");
      if (nl < 0 || kind !== "blob") break;
      out.push(buf.subarray(nl + 1, nl + 1 + Number(size)).toString("utf8"));
      pos = nl + 2 + Number(size);
    }
    return out;
  });

const loadArchived = (dir: string, commit: string) =>
  Effect.gen(function* () {
    const seen = new Map<string, number>();
    const captured = (yield* blobs(dir, commit, "data/sources", /^data\/sources\/[^/]+\/manifest\.json$/)).flatMap((t) =>
      (decodeJson(Manifest, t)?.configs ?? []).map((c) => {
        const base = `capture/${c.host}/${c.id}`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        const reason = `captured on ${c.host}: ${c.decision}${c.gaps.length ? `; gaps: ${c.gaps.join(", ")}` : ""}`;
        return reference(n > 1 ? `${base}~${n}` : base, c.id, c.hardware?.id ?? "", c.engine ?? c.runtime?.ref ?? "", c.hardware?.count ?? 1, c.context ?? 0, reason);
      }),
    );
    const records = (yield* blobs(dir, commit, "data/registry/recipe", /\.json$/)).flatMap((t) => {
      const v = decodeJson(V1, t);
      const reason = `captured ${v?.status} record from ${v?.recipe_source}; not an executable launch`;
      return v ? [reference(`v1/${v.id}`, v.model_instance_id, v.hardware_id ?? "", v.engine?.name ?? "", v.hardware_count ?? 1, v.serving?.max_context_tokens ?? 0, reason)] : [];
    });
    return [...captured, ...records];
  });

const SHA = /^[0-9a-f]{40}$/;
const OWNED_FLAGS = new Set(["--network", "--net", "--gpus", "--name", "--rm", "-d", "--detach", "-p", "--publish", "--label", "--entrypoint", "--restart"]);
const BLOCKED_FLAGS = new Set(["--privileged", "-v", "--volume", "--mount", "--device", "--security-opt", "--pid"]);

export const weightsOf = (l: Launch): Weight[] =>
  (Array.isArray(l.weights) ? l.weights : l.weights ? [l.weights] : []).flatMap((w) => {
    const d = Schema.decodeUnknownOption(Weight)(w);
    return d._tag === "Some" ? [d.value] : [];
  });

const splitFlag = (f: string): string[] => {
  const t = f.trim();
  const eq = /^(-[\w-]+)=(.*)$/.exec(t);
  if (eq) return [eq[1] ?? "", eq[2] ?? ""];
  const i = t.search(/\s/);
  return i < 0 ? [t] : [t.slice(0, i), t.slice(i).trim()];
};

export const dockerFlags = (l: Launch): string[] => (l.flags ?? []).map(splitFlag).flatMap((parts) => (OWNED_FLAGS.has(parts[0] ?? "") ? [] : parts));

export const archivedReason = (key: string, e: Entry): string | null => {
  const l = e.launch;
  const p = e.proof[0];
  if (p?.captured || p?.archived || p?.on === "captured" || key.includes("/archive")) return "archived captured configuration";
  if (l.kind === "host") return "host-specific launch, not a portable container";
  if (l.build) return "image is built from source";
  if (!l.image?.includes("@sha256:")) return "image is not pinned by digest";
  if (e.weights !== "baked-into-image" && !SHA.test(e.weights.split("@")[1] ?? "")) return "weights are not pinned";
  return null;
};

export const launchBlock = (e: Entry): string | null => {
  const l = e.launch;
  const bad = (l.flags ?? []).map((f) => splitFlag(f)[0] ?? "").find((k) => !k.startsWith("-") || BLOCKED_FLAGS.has(k));
  if (l.backend && l.backend !== "nvidia") return `backend ${l.backend} is not supported by this controller`;
  if ((l.machines ?? 1) > 1) return `needs ${l.machines} machines; multi-machine launch is not supported`;
  if (bad) return `needs host option ${bad}`;
  return l.setup ? `manual setup required: ${l.setup}` : null;
};

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/nvidia|geforce|intel|amd|radeon|generation|workstation|edition|\d+\s*gb/g, "")
    .replace(/[^a-z0-9]/g, "");

export const matchCard = (cat: Catalog, name: string, memMiB: number): string | null =>
  Object.entries(cat.cards)
    .filter(([, c]) => c.match.backend === "nvidia" && (c.match.names.includes(norm(name)) || norm(c.match.name) === norm(name)))
    .map(([id, c]) => ({ id, gap: Math.abs(c.match.vramGb * 1024 - memMiB), vram: c.match.vramGb }))
    .filter((h) => memMiB <= 0 || h.gap <= Math.max(1024, h.vram * 51))
    .sort((a, b) => a.gap - b.gap)[0]?.id ?? null;

export const toLocalRecipe = (key: string, e: Entry, freeByCard: Map<string, number[]>, allByCard: Map<string, number[]>): LocalRecipe => {
  const cards = e.launch.cards ?? 1;
  const free = freeByCard.get(e.card)?.length ?? 0;
  const policy = archivedReason(key, e) ?? launchBlock(e);
  const blocked = policy ?? (free < cards ? `needs ${cards} free ${e.card} GPU(s), ${free} free` : null);
  const fits = policy === null && (allByCard.get(e.card)?.length ?? 0) >= cards;
  return { id: key, model: e.model, card: e.card, engine: e.engine.split("@")[0] ?? e.engine, cards, ctx: e.launch.ctx, tps: e.proof[0]?.tps ?? null, fits, blocked };
};

export const loadCatalog = (c: Config["registry"], fetchRemote: boolean): Effect.Effect<Catalog> =>
  Effect.gen(function* () {
    const empty = (error: string, commit: string | null = null): Catalog => ({ info: { commit, error }, cards: {}, recipes: new Map(), archived: [] });
    const git = (args: string[], ms: number) => exec(["git", "-C", c.dir, ...args], ms);
    if (!existsSync(join(c.dir, ".git"))) {
      mkdirSync(dirname(c.dir), { recursive: true });
      const r = yield* exec(["git", "clone", "--no-checkout", c.url, c.dir], 180_000);
      if (r.code !== 0) return empty(`clone failed: ${lastLine(r)}`);
    } else if (fetchRemote && !SHA.test(c.ref)) {
      yield* git(["fetch", "--prune", "origin"], 60_000);
    }
    const rev = yield* git(["rev-parse", "--verify", "--quiet", `${c.ref}^{commit}`], 10_000);
    if (rev.code !== 0) return empty(`ref ${c.ref} not found`);
    const commit = rev.stdout.trim();
    const show = yield* git(["show", `${commit}:dist/catalog.json`], 60_000);
    if (show.code !== 0) return empty("dist/catalog.json missing at this ref", commit);
    const cat = decodeJson(CatalogFile, show.stdout);
    if (!cat) return empty("dist/catalog.json has an unknown shape", commit);
    const recipes = new Map<string, Entry>();
    for (const key of Object.keys(cat.recipes).sort()) {
      const e = decodeEntry(cat.recipes[key]);
      if (e._tag === "Some") recipes.set(key, e.value);
    }
    return { info: { commit, error: null }, cards: cat.cards, recipes, archived: yield* loadArchived(c.dir, commit) };
  });
