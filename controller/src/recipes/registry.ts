import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Engine, Recipe, RecipeCatalog, RecipeProof } from "@local-studio/contracts";
import type { Ctx } from "../context";
import seccompIoUring from "./seccomp-default-plus-io_uring.json";
import { argValue, HttpError, RECIPE_ID } from "./util";

export interface V2Weights {
  repository: string;
  revision: string;
  sizeGb: number;
  layout: "dir" | "hub";
  mountPath: string;
  dir: string;
  files: string;
  hostPath?: string;
}

export interface V2Mount {
  source: string;
  target: string;
  readOnly: boolean;
}

export interface V2Recipe {
  id: string;
  name: string;
  family: string;
  format: string;
  engine: string;
  servedName: string;
  sizeGb: number;
  cards: number;
  image: string;
  minDriver: string;
  weights: V2Weights[];
  asset: { name: string; mountPath: string; text: string } | null;
  scratch: string | null;
  launch: { entrypoint: string | null; arguments: string[]; environment: Record<string, string>; port: number; shm: string | null; docker?: string[]; mounts?: V2Mount[] };
  serving: { ctxTokens: number; kvTokens: number };
  capabilities: Record<string, boolean | undefined>;
  hardwareId?: string;
  local?: boolean;
  saved?: boolean;
  origin?: "yours" | "registry";
  key?: string;
  profile?: string;
  machines?: number;
  flags?: string[];
  proof?: RecipeProof | null;
}

export interface Card {
  id: string;
  name: string;
  vendor: string;
  backend: string;
  vram_gb: number;
  match: { backend: string; name: string; names: string[]; vramGb: number };
}

export interface ProfileWeight {
  repo: string;
  revision: string;
  at: string;
  layout?: "dir" | "hub";
  files?: string | null;
}

export interface Profile {
  id: string;
  kind?: string;
  engine?: string;
  about?: string;
  image?: string;
  backend?: string | null;
  port: number;
  entrypoint?: string | null;
  args?: string[];
  env?: Record<string, string>;
  shm?: string | null;
  weights?: ProfileWeight[];
  weights_at?: string;
  config_at?: string;
  config?: string[] | { at: string; text: string } | null;
  defaults?: Record<string, string | number | boolean>;
  ctx: number;
  seqs?: number;
  vision?: boolean;
  cards?: number;
  flags?: string[];
  machines?: number;
  plugin?: { name: string; family: string; format: string; servedName: string; sizeGb: number; minDriver: string; capabilities: Record<string, boolean>; serving: { kvTokens: number } };
  ids?: Record<string, string>;
  frozen_from?: string[];
}

export interface RegRecipe {
  model: string;
  weights: string;
  engine: string;
  set: Record<string, string | number | boolean>;
  card: string;
  proof: RecipeProof[];
}

export interface Rendered {
  image: string;
  entrypoint: string | null;
  args: string[];
  env: Record<string, string>;
  port: number;
  shm: string | null;
  weights: ProfileWeight[];
  config: { at: string; text: string } | null;
  ctx: number;
  seqs: number;
  vision: boolean;
  cards: number;
  machines: number;
  flags: string[];
}

interface ModelsDoc {
  models: Record<string, { name: string; family: string }>;
  builds: Record<string, { format: string; size_gb: number }>;
}

export interface Tree {
  commit: string | null;
  cards: Map<string, Card>;
  profiles: Map<string, Profile>;
  recipes: Map<string, RegRecipe>;
  models: ModelsDoc;
}

export interface LoadedCatalog {
  catalog: RecipeCatalog;
  raw: Map<string, V2Recipe>;
  tree: Tree | null;
}

interface CacheFile {
  source: string;
  ref: string;
  commit: string | null;
  fetchedAt: number;
  files: Record<string, string>;
}

const STALE_MS = 6 * 3600_000;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const WANTED = /^(registry\/(models\.json|cards\/[\w.-]+\/[\w.-]+\.json|engines\/[\w.-]+\.json|recipes\/[\w.-]+\/[\w.-]+\/[\w.-]+\.json)|dist\/catalog\.json)$/;
const MIN_DRIVER: Record<string, string> = { tabbyapi: "575.0", sglang: "570.0", vllm: "570.0", "llama.cpp": "535.0" };
export const SECCOMP: Record<string, unknown> = { "seccomp-default-plus-io_uring.json": seccompIoUring };

const ENGINE: Record<string, Engine> = { vllm: "vllm", sglang: "sglang", "llama-cpp": "llamacpp", "llama.cpp": "llamacpp", llamacpp: "llamacpp", tabbyapi: "tabby", tabby: "tabby", mlx: "mlx" };

export const normEngine = (e: string): Engine | string => ENGINE[e.toLowerCase()] ?? e;

const tpl = (s: string, v: Record<string, string>): string =>
  s.replace(/\$(?:(\$)|\{(\w+)\}|(\w+))/g, (_m, d: string | undefined, a: string | undefined, b: string | undefined) => {
    if (d) return "$";
    const k = a ?? b ?? "";
    const x = v[k];
    if (x === undefined) throw new Error(`template value ${k} is missing`);
    return x;
  });

export const render = (r: RegRecipe, p: Profile): Rendered => {
  const common = { image: p.image ?? "", entrypoint: p.entrypoint ?? null, args: p.args ?? [], port: p.port, shm: p.shm ?? null, flags: p.flags ?? [], machines: p.machines ?? 1 };
  if (!p.defaults) {
    const config = p.config && !Array.isArray(p.config) ? p.config : null;
    return { ...common, env: p.env ?? {}, weights: p.weights ?? [], config, ctx: p.ctx, seqs: p.seqs ?? 1, vision: !!p.vision, cards: p.cards ?? 1 };
  }
  const s = { ...p.defaults, ...r.set };
  const [repo = "", rev = ""] = r.weights.split("@");
  const name = `${repo.split("/")[1] ?? repo}-${rev.slice(0, 8)}`;
  const ctx = Number(s.ctx);
  const seqs = Number(s.seqs);
  const v: Record<string, string> = { ...Object.fromEntries(Object.entries(s).map(([k, x]) => [k, String(x)])), name, cache_tokens: String(ctx * seqs + 1024 * seqs), draft_block: s.draft === "mtp" ? "{draft_mode: mtp}" : "{}" };
  const text = `${(Array.isArray(p.config) ? p.config : []).map((l) => tpl(l, v)).join("\n")}\n`;
  return { ...common, env: {}, weights: [{ repo, revision: rev, at: tpl(p.weights_at ?? "", { name }), layout: "dir" }], config: { at: p.config_at ?? "", text }, ctx, seqs, vision: s.vision === true || s.vision === "true", cards: 1 };
};

export const dockerFlags = (flags: string[], dataDir: string): string[] =>
  flags.map((f) => {
    const [k = "", ...rest] = f.trim().split(/\s+/);
    const v = rest.join(" ");
    const sec = /^seccomp=([\w.-]+\.json)$/.exec(v)?.[1];
    if (k === "--security-opt" && sec && SECCOMP[sec]) return `--security-opt=seccomp=${join(dataDir, "seccomp", sec)}`;
    return v ? `${k}=${v}` : k;
  });

export const writeSeccomp = (dataDir: string, opts: string[]): void => {
  for (const o of opts) {
    const name = /^--security-opt=seccomp=.*\/([\w.-]+\.json)$/.exec(o)?.[1];
    const doc = name ? SECCOMP[name] : undefined;
    if (!name || !doc) continue;
    mkdirSync(join(dataDir, "seccomp"), { recursive: true });
    writeFileSync(join(dataDir, "seccomp", name), `${JSON.stringify(doc, null, 1)}\n`);
  }
};

const proofOwner = (p: RecipeProof | undefined, prof: Profile): boolean => p?.on === "owner" || /\bowner'?s?\b/i.test(prof.about ?? "");

export const toV2 = (key: string, r: RegRecipe, p: Profile, models: ModelsDoc, dataDir: string): V2Recipe => {
  const L = render(r, p);
  const m = models.models[r.model];
  const b = models.builds[r.weights];
  const x = p.plugin;
  const stem = key.split("/").pop() ?? key;
  const proof = r.proof[0] ?? null;
  const gates = proof?.gates ?? "";
  const engine = p.engine ?? r.engine.split("@")[0] ?? "";
  const served = x?.servedName ?? (p.defaults ? basename(L.weights[0]?.at ?? r.model) : argValue(L.args, "--served-model-name") ?? L.env.SERVED_MODEL_NAME ?? argValue(L.args, "--alias") ?? r.model);
  return {
    id: p.ids?.[r.card] ?? `${stem}.${r.card}`,
    name: x?.name ?? m?.name ?? r.model,
    family: x?.family ?? m?.family ?? "",
    format: x?.format ?? b?.format ?? "",
    engine,
    servedName: served,
    sizeGb: x?.sizeGb ?? b?.size_gb ?? 0,
    cards: L.cards,
    image: L.image,
    minDriver: x?.minDriver ?? (p.backend === "nvidia" ? MIN_DRIVER[engine] ?? "" : ""),
    weights: L.weights.map((w, i) => ({ repository: w.repo, revision: w.revision, sizeGb: i === 0 ? x?.sizeGb ?? b?.size_gb ?? 0 : 0, layout: w.layout ?? "dir", mountPath: w.at, dir: "", files: w.files ?? "" })),
    asset: L.config ? { name: basename(L.config.at), mountPath: L.config.at, text: L.config.text } : null,
    scratch: null,
    launch: { entrypoint: L.entrypoint, arguments: L.args, environment: L.env, port: L.port, shm: L.shm, docker: dockerFlags(L.flags.filter((f) => !/^--network\b/.test(f)), dataDir) },
    serving: { ctxTokens: L.ctx, kvTokens: x?.serving.kvTokens ?? (p.defaults ? L.ctx * L.seqs + 1024 * L.seqs : 0) },
    capabilities: { chat: true, reasoning: gates.includes("reasoning"), tools: gates.includes("tools"), vision: L.vision },
    hardwareId: r.card,
    origin: proofOwner(proof ?? undefined, p) ? "yours" : "registry",
    key,
    profile: p.id,
    machines: L.machines,
    flags: L.flags,
    proof,
  };
};

export const recipeFile = (r: RegRecipe, p: Profile, card: Card): string => `registry/recipes/${card.vendor}/${r.card}/${r.model}.${p.engine ?? r.engine.split("@")[0]}.${Math.floor(render(r, p).ctx / 1024)}k.json`;

const parseTree = (files: Record<string, string>, commit: string | null): Tree => {
  const cards = new Map<string, Card>();
  const profiles = new Map<string, Profile>();
  const recipes = new Map<string, RegRecipe>();
  let models: ModelsDoc = { models: {}, builds: {} };
  for (const [path, text] of Object.entries(files)) {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      continue;
    }
    if (path === "registry/models.json") models = { models: {}, builds: {}, ...(doc as Partial<ModelsDoc>) };
    else if (path.startsWith("registry/cards/")) cards.set((doc as Card).id, doc as Card);
    else if (path.startsWith("registry/engines/")) profiles.set((doc as Profile).id, doc as Profile);
    else if (path.startsWith("registry/recipes/")) recipes.set(path.slice("registry/recipes/".length, -".json".length), doc as RegRecipe);
  }
  return { commit, cards, profiles, recipes, models };
};

const picksOf = (files: Record<string, string>): Set<string> => {
  try {
    const cat = JSON.parse(files["dist/catalog.json"] ?? "{}") as { cards?: Record<string, { picks?: string[] }> };
    return new Set(Object.values(cat.cards ?? {}).map((c) => c.picks?.[0] ?? "").filter(Boolean));
  } catch {
    return new Set();
  }
};

export const toRecipe = (r: V2Recipe, hardwareId: string, recommended: boolean): Recipe => {
  const caps = r.capabilities ?? {};
  return {
    id: r.id,
    name: r.name,
    family: r.family || null,
    hardwareId,
    cards: r.cards || 1,
    engine: normEngine(r.engine),
    format: r.format,
    servedName: r.servedName,
    sizeGb: r.sizeGb || null,
    image: r.image,
    minDriver: r.minDriver || null,
    weights: r.weights.map((w) => ({ repository: w.repository, revision: w.revision, sizeGb: w.sizeGb || null, layout: w.layout, mountPath: w.mountPath, hostPath: w.hostPath ?? null })),
    asset: r.asset ?? null,
    scratch: r.scratch ?? null,
    launch: { entrypoint: r.launch.entrypoint, arguments: r.launch.arguments ?? [], environment: r.launch.environment ?? {}, port: r.launch.port, shm: r.launch.shm },
    ctxTokens: r.serving?.ctxTokens || null,
    kvTokens: r.serving?.kvTokens || null,
    caps: { chat: caps.chat, reasoning: caps.reasoning, tools: caps.tools, vision: caps.vision, video: caps.video },
    recommended,
    ...(r.local || r.saved ? { source: "local" as const } : {}),
    origin: r.local || r.saved ? "yours" : r.origin ?? "registry",
    key: r.key ?? null,
    profile: r.profile ?? null,
    machines: r.machines ?? 1,
    flags: r.flags ?? [],
    proof: r.proof ?? null,
  };
};

const build = (ctx: Ctx, cache: CacheFile, source: string): LoadedCatalog => {
  const tree = parseTree(cache.files, cache.commit);
  const picks = picksOf(cache.files);
  const raw = new Map<string, V2Recipe>();
  const recipes: Recipe[] = [];
  let skipped = 0;
  for (const [key, r] of [...tree.recipes].sort(([a], [b]) => a.localeCompare(b))) {
    const p = tree.profiles.get(r.engine?.split("@")[0] ?? "");
    const digest = r.engine?.split("@")[1] ?? "";
    if (!p || p.kind === "host" || !tree.cards.has(r.card) || (p.image && digest && !(p.image.split("@sha256:")[1] ?? "").startsWith(digest))) {
      skipped++;
      continue;
    }
    try {
      const v = toV2(key, r, p, tree.models, ctx.config.dataDir);
      if (!RECIPE_ID.test(v.id) || raw.has(v.id)) continue;
      raw.set(v.id, v);
      recipes.push(toRecipe(v, r.card, picks.has(key) && v.cards === 1 && (v.machines ?? 1) === 1));
    } catch (e) {
      skipped++;
      ctx.log.warn(`recipes: ${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (skipped) ctx.log.info(`recipes: ${skipped} registry recipe(s) are not container launches on a known card and are not listed`);
  const hardware = [...tree.cards.values()].sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({ hardwareId: c.id, match: c.match }));
  return { catalog: { source, ref: cache.ref, registryCommit: cache.commit, generatedAt: null, fetchedAt: cache.fetchedAt, hardware, recipes }, raw, tree };
};

const validV2 = (r: V2Recipe): boolean => !!r && typeof r === "object" && RECIPE_ID.test(r.id) && !!r.hardwareId && typeof r.image === "string" && Array.isArray(r.launch?.arguments) && Array.isArray(r.weights);

const readLocal = (ctx: Ctx, dir: string): V2Recipe[] => {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: V2Recipe[] = [];
  for (const n of names) {
    try {
      const doc = JSON.parse(readFileSync(join(dir, n), "utf8")) as V2Recipe | V2Recipe[] | { recipe: RegRecipe; profile: Profile; key: string };
      if (!Array.isArray(doc) && "recipe" in doc && "profile" in doc) {
        out.push({ ...toV2(doc.key, doc.recipe, doc.profile, { models: {}, builds: {} }, ctx.config.dataDir), saved: true, origin: "yours" });
        continue;
      }
      for (const r of Array.isArray(doc) ? doc : [doc as V2Recipe]) {
        if (validV2(r)) out.push({ ...r, local: true });
        else ctx.log.warn(`recipes: skipped an invalid local recipe in ${n}`);
      }
    } catch (e) {
      ctx.log.warn(`recipes: cannot read ${n}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
};

const withLocal = (base: LoadedCatalog, local: V2Recipe[]): LoadedCatalog => {
  if (!local.length) return base;
  const raw = new Map<string, V2Recipe>();
  const recipes: Recipe[] = [];
  for (const r of local) {
    if (raw.has(r.id)) continue;
    raw.set(r.id, r);
    recipes.push(toRecipe(r, r.hardwareId ?? "", false));
  }
  for (const r of base.catalog.recipes) {
    const v = base.raw.get(r.id);
    if (v && !raw.has(r.id)) {
      raw.set(r.id, v);
      recipes.push(r);
    }
  }
  return { catalog: { ...base.catalog, recipes }, raw, tree: base.tree };
};

export interface Registry {
  load(opts?: { sync?: boolean }): Promise<LoadedCatalog>;
  ref(): string;
  setRef(ref: string): void;
  git(args: string[], timeoutMs: number, cwd?: string): ReturnType<Ctx["exec"]>;
  ensureClone(): Promise<boolean>;
}

export const createRegistry = (ctx: Ctx): Registry => {
  const dir = ctx.config.registryDir;
  const cachePath = join(ctx.config.dataDir, "recipes-cache.json");
  const refPath = join(ctx.config.dataDir, "registry-ref");
  const gitEnv = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true" };
  let ref = (() => {
    try {
      return readFileSync(refPath, "utf8").trim() || ctx.config.registryRef;
    } catch {
      return ctx.config.registryRef;
    }
  })();
  let current: LoadedCatalog | null = null;
  let inflight: Promise<LoadedCatalog> | null = null;

  const git = (args: string[], timeoutMs: number, cwd?: string) => ctx.exec(["git", "-C", cwd ?? dir, ...args], { timeoutMs, env: gitEnv });
  const tail = (r: { timedOut: boolean; stderr: string }) => (r.timedOut ? "timed out" : r.stderr.trim().split("\n").pop());

  const ensureClone = async (): Promise<boolean> => {
    if (existsSync(join(dir, ".git"))) return true;
    mkdirSync(dirname(dir), { recursive: true });
    ctx.log.info(`recipes: cloning ${ctx.config.registryUrl} into ${dir}`);
    const r = await ctx.exec(["git", "clone", "--filter=blob:none", "--no-checkout", ctx.config.registryUrl, dir], { timeoutMs: 180_000, env: gitEnv });
    if (r.code !== 0) ctx.log.warn(`recipes: clone failed: ${tail(r)}`);
    return r.code === 0;
  };

  const lastFetchAt = (): number => {
    try {
      return statSync(join(dir, ".git", "FETCH_HEAD")).mtimeMs;
    } catch {
      return 0;
    }
  };

  const readCache = (): CacheFile | null => {
    try {
      const c = JSON.parse(readFileSync(cachePath, "utf8")) as CacheFile;
      return c.files && c.ref === ref ? c : null;
    } catch {
      return null;
    }
  };

  const fromGit = async (sync: boolean): Promise<CacheFile | null> => {
    if (!(await ensureClone())) return null;
    const sha = /^[0-9a-f]{40}$/.test(ref);
    const target = sha ? `${ref}^{commit}` : `refs/remotes/origin/${ref}`;
    const fetch = async () => {
      const f = await git(["fetch", "--prune", "origin", sha ? ref : `+refs/heads/${ref}:refs/remotes/origin/${ref}`], 90_000);
      if (f.code !== 0) ctx.log.warn(`recipes: git fetch ${ref} failed: ${tail(f)}`);
    };
    let rev = await git(["rev-parse", "--verify", "--quiet", target], 10_000);
    if (sync || rev.code !== 0 || Date.now() - lastFetchAt() > STALE_MS) {
      await fetch();
      rev = await git(["rev-parse", "--verify", "--quiet", target], 10_000);
    }
    if (rev.code !== 0) return null;
    const commit = rev.stdout.trim();
    const ls = await git(["ls-tree", "-r", commit, "--", "registry", "dist/catalog.json"], 30_000);
    if (ls.code !== 0) return null;
    const entries = ls.stdout
      .split("\n")
      .map((l) => /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m && WANTED.test(m[2] ?? ""))
      .map((m) => ({ oid: m[1] ?? "", path: m[2] ?? "" }));
    await git(["diff", "--no-renames", "--numstat", EMPTY_TREE, commit, "--", "registry", "dist/catalog.json"], 180_000);
    const cat = await ctx.exec(["git", "-C", dir, "cat-file", "--batch"], { timeoutMs: 120_000, env: gitEnv, input: `${entries.map((e) => e.oid).join("\n")}\n`, maxBytes: 64 * 1024 * 1024 });
    if (cat.code !== 0) {
      ctx.log.warn(`recipes: git cat-file failed: ${tail(cat)}`);
      return null;
    }
    const buf = Buffer.from(cat.stdout, "utf8");
    const byOid = new Map<string, string>();
    let pos = 0;
    while (pos < buf.length) {
      const nl = buf.indexOf(10, pos);
      if (nl < 0) break;
      const [oid = "", kind, size] = buf.subarray(pos, nl).toString("utf8").split(" ");
      if (kind !== "blob") return null;
      const n = Number(size);
      byOid.set(oid, buf.subarray(nl + 1, nl + 1 + n).toString("utf8"));
      pos = nl + 1 + n + 1;
    }
    const files: Record<string, string> = {};
    for (const e of entries) {
      const t = byOid.get(e.oid);
      if (t !== undefined) files[e.path] = t;
    }
    return { source: `git:${ctx.config.registryRepo}@${ref}`, ref, commit, fetchedAt: Date.now(), files };
  };

  const doLoad = async (sync: boolean): Promise<LoadedCatalog> => {
    const got = await fromGit(sync);
    if (got) {
      try {
        writeFileSync(cachePath, JSON.stringify(got));
      } catch (e) {
        ctx.log.warn(`recipes: cache write failed: ${String(e)}`);
      }
      current = build(ctx, got, got.source);
      return current;
    }
    const cached = readCache();
    if (cached) {
      current = build(ctx, cached, `cache:${cached.source}`);
      return current;
    }
    throw new HttpError(503, "REGISTRY_UNAVAILABLE", `registry unavailable: git could not read ${ref} and no cache exists`);
  };

  const localDir = join(ctx.config.home, "recipes");
  let localSig = "";
  let localCache: V2Recipe[] = [];
  const local = (): V2Recipe[] => {
    let sig = "";
    try {
      sig = readdirSync(localDir)
        .filter((n) => n.endsWith(".json"))
        .map((n) => `${n}:${statSync(join(localDir, n)).mtimeMs}`)
        .join("|");
    } catch {}
    if (sig !== localSig) {
      localSig = sig;
      localCache = sig ? readLocal(ctx, localDir) : [];
    }
    return localCache;
  };

  const loadRegistry = (sync: boolean): Promise<LoadedCatalog> => {
    if (current && !sync) {
      if (Date.now() - current.catalog.fetchedAt > STALE_MS && !inflight) {
        inflight = doLoad(false).finally(() => {
          inflight = null;
        });
        inflight.catch(() => {});
      }
      return Promise.resolve(current);
    }
    if (inflight && !sync) return inflight;
    const p = (inflight ?? Promise.resolve(null)).catch(() => null).then(() => doLoad(sync));
    inflight = p.finally(() => {
      if (inflight === p) inflight = null;
    });
    return p;
  };

  const load = async (opts?: { sync?: boolean }): Promise<LoadedCatalog> => {
    const extra = local();
    try {
      return withLocal(await loadRegistry(!!opts?.sync), extra);
    } catch (e) {
      if (!extra.length) throw e;
      return withLocal({ catalog: { source: localDir, ref, registryCommit: null, generatedAt: null, fetchedAt: Date.now(), hardware: [], recipes: [] }, raw: new Map(), tree: null }, extra);
    }
  };

  const setRef = (next: string) => {
    if (next === ref) return;
    ref = next;
    current = null;
    writeFileSync(refPath, `${next}\n`);
  };

  return { load, ref: () => ref, setRef, git, ensureClone };
};
