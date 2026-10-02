import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { LocalCapture, LocalProofKind, LocalRecipe, LocalRegistryInfo } from "../../../packages/contracts/src/localStudio.ts";
import { type Config, exec } from "./core.ts";

const Weight = Schema.Struct({
  repo: Schema.String,
  revision: Schema.String,
  at: Schema.String,
  layout: Schema.optionalKey(Schema.NullOr(Schema.String)),
  files: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
});
export type Weight = typeof Weight.Type;

const Launch = Schema.Struct({
  kind: Schema.optionalKey(Schema.String),
  image: Schema.optionalKey(Schema.NullOr(Schema.String)),
  entrypoint: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)]))),
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  command: Schema.optionalKey(Schema.Array(Schema.String)),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  port: Schema.Number,
  shm: Schema.optionalKey(Schema.NullOr(Schema.String)),
  flags: Schema.optionalKey(Schema.Array(Schema.String)),
  machines: Schema.optionalKey(Schema.Number),
  cards: Schema.optionalKey(Schema.Number),
  backend: Schema.optionalKey(Schema.NullOr(Schema.String)),
  ctx: Schema.Number,
  weights: Schema.optionalKey(Schema.Unknown),
  config: Schema.optionalKey(Schema.NullOr(Schema.Struct({ at: Schema.String, text: Schema.String }))),
  build: Schema.optionalKey(Schema.Unknown),
  setup: Schema.optionalKey(Schema.String),
});
export type Launch = typeof Launch.Type;

const Proof = Schema.Struct({
  at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  on: Schema.optionalKey(Schema.String),
  gates: Schema.optionalKey(Schema.String),
  tps: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  legacy: Schema.optionalKey(Schema.Boolean),
  reported: Schema.optionalKey(Schema.Boolean),
  captured: Schema.optionalKey(Schema.Boolean),
  archived: Schema.optionalKey(Schema.Boolean),
});

const Entry = Schema.Struct({
  model: Schema.String,
  card: Schema.String,
  engine: Schema.String,
  weights: Schema.String,
  launch: Launch,
  proof: Schema.Array(Proof),
});
export type Entry = typeof Entry.Type;

const Card = Schema.Struct({
  match: Schema.Struct({ backend: Schema.String, name: Schema.String, names: Schema.Array(Schema.String), vramGb: Schema.Number }),
});

const Catalog = Schema.Struct({
  cards: Schema.Record(Schema.String, Card),
  recipes: Schema.Record(Schema.String, Schema.Unknown),
});
const decodeCatalog = Schema.decodeUnknownOption(Catalog);
const decodeEntry = Schema.decodeUnknownOption(Entry);

export interface Catalog {
  info: LocalRegistryInfo;
  cards: Record<string, typeof Card.Type>;
  recipes: Map<string, Entry>;
  archived: LocalRecipe[];
  captured: LocalRecipe[];
}

const V1 = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  model_instance_id: Schema.String,
  recipe_source: Schema.String,
  hardware_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  hardware_count: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  engine: Schema.optionalKey(Schema.Struct({ name: Schema.optionalKey(Schema.NullOr(Schema.String)) })),
  serving: Schema.optionalKey(Schema.Struct({ max_context_tokens: Schema.optionalKey(Schema.NullOr(Schema.Number)) })),
});
const decodeV1 = Schema.decodeUnknownOption(V1);

const catFiles = (dir: string, oids: string[]) =>
  Effect.promise(async () => {
    const p = Bun.spawn(["git", "-C", dir, "cat-file", "--batch"], { stdin: new TextEncoder().encode(`${oids.join("\n")}\n`), stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill("SIGKILL"), 120_000);
    const buf = Buffer.from(await new Response(p.stdout).arrayBuffer());
    await p.exited;
    clearTimeout(timer);
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

const Manifest = Schema.Struct({
  configs: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      host: Schema.String,
      decision: Schema.String,
      class: Schema.String,
      file: Schema.String,
      gaps: Schema.Array(Schema.String),
      source_kind: Schema.String,
      raw_sha256: Schema.optionalKey(Schema.NullOr(Schema.String)),
      engine: Schema.optionalKey(Schema.NullOr(Schema.String)),
      context: Schema.optionalKey(Schema.NullOr(Schema.Number)),
      hardware: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.NullOr(Schema.String), count: Schema.NullOr(Schema.Number) }))),
      runtime: Schema.optionalKey(Schema.NullOr(Schema.Struct({ ref: Schema.optionalKey(Schema.NullOr(Schema.String)) }))),
      images: Schema.optionalKey(Schema.Array(Schema.Struct({ ref: Schema.optionalKey(Schema.NullOr(Schema.String)) }))),
    }),
  ),
});
const decodeManifest = Schema.decodeUnknownOption(Manifest);

const loadCaptured = (dir: string, commit: string) =>
  Effect.gen(function* () {
    const ls = yield* exec(["git", "-C", dir, "ls-tree", "-r", "--name-only", commit, "--", "data/sources"], 30_000);
    const paths = ls.stdout.split("\n").filter((p) => /^data\/sources\/[^/]+\/manifest\.json$/.test(p));
    const out: LocalRecipe[] = [];
    const seen = new Map<string, number>();
    for (const path of paths) {
      const show = yield* exec(["git", "-C", dir, "show", `${commit}:${path}`], 30_000);
      let raw: unknown = null;
      try {
        raw = JSON.parse(show.stdout);
      } catch {}
      const m = decodeManifest(raw);
      if (m._tag === "None") continue;
      for (const c of m.value.configs) {
        const base = `capture/${c.host}/${c.id}`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        const gaps = c.gaps.length ? `; gaps: ${c.gaps.join(", ")}` : "";
        const reason = `captured on ${c.host}: ${c.decision}${gaps}`;
        const capture: LocalCapture = { manifest: path, host: c.host, decision: c.decision, class: c.class, gaps: [...c.gaps], file: c.file, sourceKind: c.source_kind, rawSha256: c.raw_sha256 ?? null };
        out.push({ id: n > 1 ? `${base}~${n}` : base, model: c.id, card: c.hardware?.id ?? "", engine: c.engine ?? c.runtime?.ref ?? "", cards: c.hardware?.count ?? 1, ctx: c.context ?? 0, image: c.images?.[0]?.ref ?? null, servedName: null, weights: "", status: "archived", reason, proof: null, freeGpus: [], runnable: false, blocked: reason, capture });
      }
    }
    return out;
  });

const loadArchived = (dir: string, commit: string) =>
  Effect.gen(function* () {
    const ls = yield* exec(["git", "-C", dir, "ls-tree", "-r", commit, "--", "data/registry/recipe"], 30_000);
    const oids = ls.stdout.split("\n").flatMap((l) => /^\d+ blob ([0-9a-f]+)\t.+\.json$/.exec(l)?.slice(1, 2) ?? []);
    const texts = oids.length ? yield* catFiles(dir, oids) : [];
    return texts.flatMap((t): LocalRecipe[] => {
      let raw: unknown = null;
      try {
        raw = JSON.parse(t);
      } catch {}
      const r = decodeV1(raw);
      if (r._tag === "None") return [];
      const v = r.value;
      const reason = `captured ${v.status} record from ${v.recipe_source}; not an executable launch`;
      return [{ id: `v1/${v.id}`, model: v.model_instance_id, card: v.hardware_id ?? "", engine: v.engine?.name ?? "", cards: v.hardware_count ?? 1, ctx: v.serving?.max_context_tokens ?? 0, image: null, servedName: null, weights: v.model_instance_id, status: "archived", reason, proof: null, freeGpus: [], runnable: false, blocked: reason, capture: null }];
    });
  });

const SHA = /^[0-9a-f]{40}$/;
const OWNED_FLAGS = new Set(["--network", "--net", "--gpus", "--name", "--rm", "-d", "--detach", "-p", "--publish", "--label", "--entrypoint", "--restart"]);
const BLOCKED_FLAGS = new Set(["--privileged", "-v", "--volume", "--mount", "--device", "--security-opt", "--pid"]);

export const weightsOf = (l: Launch): Weight[] => {
  const raw = Array.isArray(l.weights) ? l.weights : l.weights ? [l.weights] : [];
  return raw.flatMap((w) => {
    const d = Schema.decodeUnknownOption(Weight)(w);
    return d._tag === "Some" ? [d.value] : [];
  });
};

export const splitFlag = (f: string): string[] => {
  const t = f.trim();
  const eq = /^(-[\w-]+)=(.*)$/.exec(t);
  if (eq) return [eq[1] ?? "", eq[2] ?? ""];
  const i = t.search(/\s/);
  return i < 0 ? [t] : [t.slice(0, i), t.slice(i).trim()];
};

export const dockerFlags = (l: Launch): string[] =>
  (l.flags ?? []).flatMap((f) => {
    const parts = splitFlag(f);
    return OWNED_FLAGS.has(parts[0] ?? "") ? [] : parts;
  });

export const servedName = (l: Launch): string | null => {
  const argv = [...(l.args ?? []), ...(l.command ?? [])];
  for (const flag of ["--served-model-name", "--alias", "--model_id", "--model-name"]) {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv[i + 1]) return argv[i + 1] ?? null;
  }
  return l.env?.SERVED_MODEL_NAME ?? l.env?.MODEL_ID ?? null;
};

const proofKind = (p: typeof Proof.Type): LocalProofKind => (p.reported ? "reported" : p.legacy || p.on === "legacy" ? "legacy" : "validated");

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
  if (l.backend && l.backend !== "nvidia") return `backend ${l.backend} is not supported by this controller`;
  if ((l.machines ?? 1) > 1) return `needs ${l.machines} machines; multi-machine launch is not supported`;
  const bad = (l.flags ?? []).map((f) => splitFlag(f)[0] ?? "").find((k) => !k.startsWith("-") || BLOCKED_FLAGS.has(k));
  if (bad) return `needs host option ${bad}`;
  if (l.setup) return `manual setup required: ${l.setup}`;
  return null;
};

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/nvidia|geforce|intel|amd|radeon|generation|workstation|edition|\d+\s*gb/g, "")
    .replace(/[^a-z0-9]/g, "");

export const matchCard = (cat: Catalog, name: string, memMiB: number): string | null => {
  const n = norm(name);
  const hits = Object.entries(cat.cards)
    .filter(([, c]) => c.match.backend === "nvidia" && (c.match.names.includes(n) || norm(c.match.name) === n))
    .map(([id, c]) => ({ id, gap: Math.abs(c.match.vramGb * 1024 - memMiB), c }))
    .filter((h) => memMiB <= 0 || h.gap <= Math.max(1024, h.c.match.vramGb * 51))
    .sort((a, b) => a.gap - b.gap);
  return hits[0]?.id ?? null;
};

export const toLocalRecipe = (key: string, e: Entry, freeByCard: Map<string, number[]>): LocalRecipe => {
  const l = e.launch;
  const reason = archivedReason(key, e);
  const p = e.proof[0];
  const cards = l.cards ?? 1;
  const free = freeByCard.get(e.card) ?? [];
  const blocked = reason ?? launchBlock(e) ?? (free.length < cards ? `needs ${cards} free ${e.card} GPU(s), ${free.length} free` : null);
  return {
    id: key,
    model: e.model,
    card: e.card,
    engine: e.engine.split("@")[0] ?? e.engine,
    cards,
    ctx: l.ctx,
    image: l.image ?? null,
    servedName: servedName(l),
    weights: e.weights,
    status: reason ? "archived" : "executable",
    reason,
    proof: p ? { kind: proofKind(p), at: p.at ?? null, gates: p.gates ?? "", tps: p.tps ?? null } : null,
    freeGpus: free,
    runnable: blocked === null,
    blocked,
    capture: null,
  };
};

export const loadCatalog = (c: Config["registry"], fetchRemote: boolean): Effect.Effect<Catalog> =>
  Effect.gen(function* () {
    const empty = (error: string, commit: string | null = null): Catalog => ({ info: { source: c.url, ref: c.ref, commit, error }, cards: {}, recipes: new Map(), archived: [], captured: [] });
    const git = (args: string[], ms: number) => exec(["git", "-C", c.dir, ...args], ms);
    if (!existsSync(join(c.dir, ".git"))) {
      mkdirSync(dirname(c.dir), { recursive: true });
      const r = yield* exec(["git", "clone", "--no-checkout", c.url, c.dir], 180_000);
      if (r.code !== 0) return empty(`clone failed: ${r.stderr.trim().split("\n").pop() ?? r.code}`);
    } else if (fetchRemote && !SHA.test(c.ref)) {
      yield* git(["fetch", "--prune", "origin"], 60_000);
    }
    const rev = yield* git(["rev-parse", "--verify", "--quiet", `${c.ref}^{commit}`], 10_000);
    if (rev.code !== 0) return empty(`ref ${c.ref} not found`);
    const commit = rev.stdout.trim();
    const show = yield* git(["show", `${commit}:dist/catalog.json`], 60_000);
    if (show.code !== 0) return empty("dist/catalog.json missing at this ref", commit);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(show.stdout);
    } catch {
      return empty("dist/catalog.json is not JSON", commit);
    }
    const cat = decodeCatalog(parsed);
    if (cat._tag === "None") return empty("dist/catalog.json has an unknown shape", commit);
    const recipes = new Map<string, Entry>();
    for (const key of Object.keys(cat.value.recipes).sort()) {
      const e = decodeEntry(cat.value.recipes[key]);
      if (e._tag === "Some") recipes.set(key, e.value);
    }
    const archived = yield* loadArchived(c.dir, commit);
    const captured = yield* loadCaptured(c.dir, commit);
    return { info: { source: c.url, ref: c.ref, commit, error: null }, cards: cat.value.cards, recipes, archived, captured };
  });
