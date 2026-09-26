import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Engine, Recipe, RecipeCatalog } from "@local-studio/contracts";
import type { Ctx } from "../context";
import { HttpError, RECIPE_ID } from "./util";

export interface V2Weights {
  repository: string;
  revision: string;
  sizeGb: number;
  layout: "dir" | "hub";
  mountPath: string;
  dir: string;
  files: string;
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
  launch: { entrypoint: string | null; arguments: string[]; environment: Record<string, string>; port: number; shm: string | null };
  serving: { ctxTokens: number; kvTokens: number };
  capabilities: Record<string, boolean | undefined>;
}

interface V2Doc {
  schemaVersion: string;
  generatedAt?: string;
  registryCommit?: string;
  hardware: Record<string, { match: { backend: string; name: string; names: string[]; vramGb: number }; recipes: V2Recipe[] }>;
}

export interface LoadedCatalog {
  catalog: RecipeCatalog;
  raw: Map<string, V2Recipe>;
}

interface CacheFile {
  source: string;
  commit: string | null;
  fetchedAt: number;
  text: string;
}

const STALE_MS = 6 * 3600_000;
const V2_PATH = "plugin/v2/recipes.json";
const SCHEMA = "omarchy-local-ai/recipes/2";

const ENGINE: Record<string, Engine> = { vllm: "vllm", sglang: "sglang", "llama-cpp": "llamacpp", "llama.cpp": "llamacpp", llamacpp: "llamacpp", tabbyapi: "tabby", tabby: "tabby", mlx: "mlx" };

export const normEngine = (e: string): Engine | string => ENGINE[e.toLowerCase()] ?? e;

const flatten = (doc: V2Doc, source: string, commit: string | null, fetchedAt: number): LoadedCatalog => {
  if (doc.schemaVersion !== SCHEMA) throw new HttpError(502, "REGISTRY_SCHEMA", `registry catalog schema is ${doc.schemaVersion}, expected ${SCHEMA}`);
  const recipes: Recipe[] = [];
  const raw = new Map<string, V2Recipe>();
  const hardware: RecipeCatalog["hardware"] = [];
  for (const [hardwareId, hw] of Object.entries(doc.hardware).sort(([a], [b]) => a.localeCompare(b))) {
    hardware.push({ hardwareId, match: hw.match });
    hw.recipes.forEach((r, i) => {
      if (!RECIPE_ID.test(r.id) || raw.has(r.id)) return;
      raw.set(r.id, r);
      const caps = r.capabilities ?? {};
      recipes.push({
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
        weights: r.weights.map((w) => ({ repository: w.repository, revision: w.revision, sizeGb: w.sizeGb || null, layout: w.layout, mountPath: w.mountPath })),
        asset: r.asset,
        scratch: r.scratch,
        launch: { entrypoint: r.launch.entrypoint, arguments: r.launch.arguments ?? [], environment: r.launch.environment ?? {}, port: r.launch.port, shm: r.launch.shm },
        ctxTokens: r.serving?.ctxTokens || null,
        kvTokens: r.serving?.kvTokens || null,
        caps: { chat: caps.chat, reasoning: caps.reasoning, tools: caps.tools, vision: caps.vision, video: caps.video },
        recommended: i === 0 && (r.cards || 1) === 1,
      });
    });
  }
  return {
    catalog: { source, registryCommit: commit ?? doc.registryCommit ?? null, generatedAt: doc.generatedAt ?? null, fetchedAt, hardware, recipes },
    raw,
  };
};

export interface Registry {
  load(opts?: { sync?: boolean }): Promise<LoadedCatalog>;
  modelInstanceIds(): Promise<string[]>;
  git(args: string[], timeoutMs: number, cwd?: string): ReturnType<Ctx["exec"]>;
  ensureClone(): Promise<boolean>;
}

export const createRegistry = (ctx: Ctx): Registry => {
  const dir = ctx.config.registryDir;
  const cachePath = join(ctx.config.dataDir, "recipes-cache.json");
  const rawBase = `https://raw.githubusercontent.com/${ctx.config.registryRepo}/main`;
  const gitEnv = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true" };
  let current: LoadedCatalog | null = null;
  let inflight: Promise<LoadedCatalog> | null = null;
  let instanceIds: { commit: string | null; ids: string[] } | null = null;

  const git = (args: string[], timeoutMs: number, cwd?: string) => ctx.exec(["git", "-C", cwd ?? dir, ...args], { timeoutMs, env: gitEnv });

  const ensureClone = async (): Promise<boolean> => {
    if (existsSync(join(dir, ".git"))) return true;
    mkdirSync(dirname(dir), { recursive: true });
    ctx.log.info(`recipes: cloning ${ctx.config.registryUrl} into ${dir}`);
    const r = await ctx.exec(["git", "clone", "--filter=blob:none", "--no-checkout", ctx.config.registryUrl, dir], { timeoutMs: 180_000, env: gitEnv });
    if (r.code !== 0) {
      ctx.log.warn(`recipes: clone failed: ${r.timedOut ? "timed out" : r.stderr.trim().split("\n").pop()}`);
      return false;
    }
    return true;
  };

  const lastFetchAt = (): number => {
    for (const f of ["FETCH_HEAD", "HEAD"]) {
      try {
        return statSync(join(dir, ".git", f)).mtimeMs;
      } catch {}
    }
    return 0;
  };

  const writeCache = (c: CacheFile) => {
    try {
      writeFileSync(cachePath, JSON.stringify(c));
    } catch (e) {
      ctx.log.warn(`recipes: cache write failed: ${String(e)}`);
    }
  };

  const readCache = (): CacheFile | null => {
    try {
      return JSON.parse(readFileSync(cachePath, "utf8")) as CacheFile;
    } catch {
      return null;
    }
  };

  const fromGit = async (sync: boolean): Promise<CacheFile | null> => {
    if (!(await ensureClone())) return null;
    if (sync || Date.now() - lastFetchAt() > STALE_MS) {
      const f = await git(["fetch", "--prune", "origin"], 60_000);
      if (f.code !== 0) ctx.log.warn(`recipes: git fetch failed: ${f.timedOut ? "timed out" : f.stderr.trim().split("\n").pop()}`);
    }
    const [show, rev] = await Promise.all([git(["show", `origin/main:${V2_PATH}`], 90_000), git(["rev-parse", "origin/main"], 10_000)]);
    if (show.code !== 0 || !show.stdout) {
      ctx.log.warn(`recipes: git show failed: ${show.timedOut ? "timed out" : show.stderr.trim().split("\n").pop()}`);
      return null;
    }
    return { source: `git:${dir}`, commit: rev.code === 0 ? rev.stdout.trim() : null, fetchedAt: Date.now(), text: show.stdout };
  };

  const fromRaw = async (): Promise<CacheFile | null> => {
    try {
      const res = await ctx.fetch(`${rawBase}/${V2_PATH}`, { timeoutMs: 15_000 });
      if (!res.ok) return null;
      return { source: `${rawBase}/${V2_PATH}`, commit: null, fetchedAt: Date.now(), text: await res.text() };
    } catch (e) {
      ctx.log.warn(`recipes: raw fetch failed: ${String(e)}`);
      return null;
    }
  };

  const doLoad = async (sync: boolean): Promise<LoadedCatalog> => {
    const got = (await fromGit(sync)) ?? (await fromRaw());
    if (got) {
      const loaded = flatten(JSON.parse(got.text) as V2Doc, got.source, got.commit, got.fetchedAt);
      writeCache(got);
      current = loaded;
      return loaded;
    }
    const cached = readCache();
    if (cached) {
      current = flatten(JSON.parse(cached.text) as V2Doc, `cache:${cached.source}`, cached.commit, cached.fetchedAt);
      return current;
    }
    throw new HttpError(503, "REGISTRY_UNAVAILABLE", "registry unavailable: git clone/fetch and raw.githubusercontent.com both failed, and no cache exists");
  };

  const load = (opts?: { sync?: boolean }): Promise<LoadedCatalog> => {
    const sync = !!opts?.sync;
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

  const modelInstanceIds = async (): Promise<string[]> => {
    const commit = current?.catalog.registryCommit ?? null;
    if (instanceIds && instanceIds.commit === commit) return instanceIds.ids;
    if (!existsSync(join(dir, ".git"))) return [];
    const r = await git(["ls-tree", "--name-only", "origin/main", "registry/model-instance/"], 30_000);
    if (r.code !== 0) return [];
    const ids = r.stdout
      .split("\n")
      .map((l) => l.trim().replace(/^registry\/model-instance\//, "").replace(/\.json$/, ""))
      .filter(Boolean);
    instanceIds = { commit, ids };
    return ids;
  };

  return { load, modelInstanceIds, git, ensureClone };
};
