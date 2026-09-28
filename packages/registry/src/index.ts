import { createHash } from "node:crypto";
import type { Card, ConfigFile, Launch, Model, Profile, Recipe, Tree, Value } from "./types";
import { GATES, MAX_RECIPE_BYTES, RegistryError } from "./types";

export * from "./types";

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

const fail = (msg: string): never => {
  throw new RegistryError(msg);
};

const pyString = (s: string): string =>
  `"${[...s]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (ch === '"') return '\\"';
      if (ch === "\\") return "\\\\";
      if (ch === "\n") return "\\n";
      if (ch === "\r") return "\\r";
      if (ch === "\t") return "\\t";
      if (ch === "\b") return "\\b";
      if (ch === "\f") return "\\f";
      if (c < 0x20 || (c > 0x7e && c <= 0xffff)) return `\\u${c.toString(16).padStart(4, "0")}`;
      if (c > 0xffff) {
        const v = c - 0x10000;
        return `\\u${(0xd800 + (v >> 10)).toString(16)}\\u${(0xdc00 + (v & 0x3ff)).toString(16)}`;
      }
      return ch;
    })
    .join("")}"`;

const pyNumber = (n: number): string => (Number.isInteger(n) ? String(n) : String(n).replace(/e([+-])(\d)$/, "e$10$2"));

export const pyDumps = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return pyNumber(v);
  if (typeof v === "string") return pyString(v);
  if (Array.isArray(v)) return `[${v.map(pyDumps).join(", ")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${pyString(k)}: ${pyDumps(o[k])}`)
    .join(", ")}}`;
};

const TEMPLATE = /\$(?:(\$)|([_a-zA-Z][_a-zA-Z0-9]*)|\{([_a-zA-Z][_a-zA-Z0-9]*)\}|())/g;

export const substitute = (t: string, values: Record<string, Value>): string =>
  t.replace(TEMPLATE, (_m, esc: string | undefined, named: string | undefined, braced: string | undefined) => {
    if (esc) return "$";
    const k = named ?? braced;
    if (k === undefined) return fail(`invalid placeholder in ${JSON.stringify(t)}`);
    const v = values[k];
    if (v === undefined) return fail(`template value ${k} is missing in ${JSON.stringify(t)}`);
    return typeof v === "boolean" ? (v ? "True" : "False") : String(v);
  });

export const shlexSplit = (s: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let q: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q === "'") {
      if (c === "'") q = null;
      else cur += c;
    } else if (q === '"') {
      if (c === '"') q = null;
      else if (c === "\\" && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1]!)) cur += s[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else cur += c;
  }
  if (q) fail(`no closing quotation in ${JSON.stringify(s)}`);
  if (has || cur) out.push(cur);
  return out;
};

export const load = (files: Record<string, string> | Map<string, string>): Tree => {
  const all = files instanceof Map ? files : new Map(Object.entries(files));
  const tree: Tree = { cards: new Map(), engines: new Map(), launches: new Map(), files: new Map(), recipes: new Map(), models: {} };
  for (const [path, text] of all) {
    const m = /^registry\/(cards|engines|launches|recipes)\/(.+)$/.exec(path);
    if (path === "registry/models.json") {
      tree.models = (JSON.parse(text) as { models?: Record<string, Model> }).models ?? {};
      continue;
    }
    if (!m) continue;
    const [, dir, rest] = m as unknown as [string, string, string];
    if (!rest.endsWith(".json")) {
      if (dir === "engines" || dir === "launches") tree.files.set(rest, text);
      continue;
    }
    const doc = JSON.parse(text) as Card & Profile & Recipe;
    if (dir === "cards") tree.cards.set(doc.id, doc);
    else if (dir === "engines") tree.engines.set(rest.slice(0, -5), doc);
    else if (dir === "launches") tree.launches.set(rest.slice(0, -5), doc);
    else tree.recipes.set(`registry/recipes/${rest}`, doc);
  }
  return tree;
};

export const card = (tree: Tree, id: string): Card => tree.cards.get(id) ?? fail(`unknown card ${id}`);

const configText = (tree: Tree, p: Profile): string | null => {
  const c = p.config;
  if (!c || Array.isArray(c)) return null;
  if ("text" in c) return c.text;
  return tree.files.get(c.file) ?? fail(`${p.id}: config file ${c.file} is missing`);
};

const HOST_PIN_KEYS = ["command", "install", "pip", "env", "port", "weights", "ctx", "seqs", "vision", "wired_limit_reserve_mb"] as const;

export const pin = (tree: Tree, p: Profile): string => {
  if (p.kind !== "host") return p.image?.split("@sha256:")[1] ?? fail(`${p.id}: image ${p.image} is not pinned by digest`);
  const doc: Record<string, unknown> = {};
  for (const k of HOST_PIN_KEYS) doc[k] = p[k] ?? null;
  doc.config = configText(tree, p);
  return sha256(pyDumps(doc));
};

export const profile = (tree: Tree, ref: string): Profile => {
  const [name = "", digest = ""] = ref.split("@");
  const p = tree.engines.get(name) ?? tree.launches.get(name) ?? fail(`${ref}: no engine profile or launch named ${name}`);
  if (p.kind === "host" || !p.image) {
    if (p.kind === "host" && digest && digest !== "host" && !pin(tree, p).startsWith(digest)) fail(`${ref}: the profile now pins ${pin(tree, p).slice(0, 12)}; rerun the recipe`);
    return p;
  }
  if (digest && p.image.includes("@sha256:") && !(p.image.split("@sha256:")[1] ?? "").startsWith(digest)) fail(`${ref}: the profile's image is now ${p.image}; rerun the recipe`);
  return p;
};

export const dirname = (weights: string): string => {
  const [repo = "", rev = ""] = weights.split("@");
  return `${repo.split("/")[1] ?? repo}-${rev.slice(0, 8)}`;
};

const withSha = (at: string, text: string): ConfigFile => ({ at, text, sha256: sha256(text) });

export const render = (tree: Tree, recipe: Recipe): Launch => {
  const p = profile(tree, recipe.engine);
  const extra = { ...(p.setup !== undefined ? { setup: p.setup } : {}), ...(p.source !== undefined ? { source: p.source } : {}) };
  if (!p.defaults) {
    if (p.kind === "host") {
      const text = configText(tree, p);
      const cfg = p.config && !Array.isArray(p.config) ? p.config : null;
      return {
        kind: "host",
        command: p.command ?? fail(`${p.id}: a host profile needs a command`),
        install: p.install ?? null,
        pip: p.pip ?? [],
        port: p.port,
        env: p.env ?? {},
        weights: p.weights ?? [],
        config: text !== null && cfg ? withSha(cfg.at, text) : null,
        ctx: p.ctx,
        seqs: p.seqs ?? 1,
        vision: p.vision ?? false,
        backend: p.backend ?? null,
        cards: 1,
        ...(p.wired_limit_reserve_mb !== undefined ? { sysctl: { "iogpu.wired_limit_mb": card(tree, recipe.card).vram_gb * 1024 - p.wired_limit_reserve_mb } } : {}),
        ...extra,
      };
    }
    const cfg = p.config && !Array.isArray(p.config) && "text" in p.config ? p.config : null;
    return {
      kind: "container",
      image: p.image ?? (p.build ? null : fail(`${p.id}: a container profile needs an image or a build`)),
      entrypoint: p.entrypoint ?? null,
      args: p.args ?? [],
      port: p.port,
      shm: p.shm ?? null,
      flags: p.flags ?? [],
      machines: p.machines ?? 1,
      ...(p.build !== undefined ? { build: p.build } : {}),
      env: p.env ?? {},
      weights: p.weights ?? [],
      config: cfg ? withSha(cfg.at, cfg.text) : null,
      ctx: p.ctx,
      seqs: p.seqs ?? 1,
      vision: p.vision ?? false,
      backend: p.backend ?? null,
      cards: p.cards ?? 1,
      ...extra,
    };
  }
  const s: Record<string, Value> = { ...p.defaults, ...recipe.set };
  const ctx = Number(s.ctx);
  const seqs = Number(s.seqs);
  const values: Record<string, Value> = {
    ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === "boolean" ? String(v).toLowerCase() : v])),
    name: dirname(recipe.weights),
    cache_tokens: Math.trunc(Number(s.pool || ctx * seqs + 1024 * seqs)),
    draft_block: s.draft === "mtp" ? "{draft_mode: mtp}" : "{}",
  };
  const sub = (t: string) => substitute(t, values);
  const args = (p.args ?? []).flatMap((a) => (/^\$\{\w+\}$/.test(a) ? shlexSplit(sub(a)) : [sub(a)]));
  const text = Array.isArray(p.config) && p.config.length ? `${p.config.map(sub).join("\n")}\n` : null;
  const [repo = "", revision = ""] = recipe.weights.split("@");
  return {
    kind: "container",
    image: p.image ?? fail(`${p.id}: a template profile needs an image`),
    entrypoint: p.entrypoint ?? null,
    args,
    port: p.port,
    shm: p.shm ?? null,
    flags: p.flags ?? [],
    machines: 1,
    env: Object.fromEntries(Object.entries(p.env ?? {}).map(([k, v]) => [k, sub(v)])),
    weights: [{ repo, revision, at: sub(p.weights_at ?? fail(`${p.id}: a template profile needs weights_at`)) }],
    config: text !== null ? withSha(p.config_at ?? fail(`${p.id}: a config template needs config_at`), text) : null,
    ctx,
    seqs,
    vision: Boolean(s.vision ?? false),
    backend: p.backend ?? null,
    cards: 1,
    ...(p.min_cuda !== undefined ? { min_cuda: p.min_cuda } : {}),
  };
};

export const recipePath = (tree: Tree, r: Recipe, launch: Launch): string => {
  const kind = profile(tree, r.engine).engine ?? r.engine.split("@")[0];
  const n = (launch.kind === "container" ? launch.machines : 1) * launch.cards;
  return `registry/recipes/${card(tree, r.card).vendor}/${r.card}/${r.model}.${kind}.${Math.floor(launch.ctx / 1024)}k${n > 1 ? `.${n}x` : ""}.json`;
};

const FIELDS = ["card", "engine", "model", "proof", "set", "weights"];
const PINNED = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;

export const checkRecipe = (tree: Tree, path: string, r: Recipe, bytes: number): string | null => {
  try {
    const keys = Object.keys(r).sort();
    if (keys.join(",") !== FIELDS.join(",")) return `fields ${JSON.stringify(keys)}`;
    if (r.weights !== "baked-into-image" && !PINNED.test(r.weights)) return "weights not pinned";
    const c = card(tree, r.card);
    const parts = path.split("/");
    if (parts.at(-2) !== r.card || parts.at(-3) !== c.vendor) return "path is not recipes/<vendor>/<card>/";
    const launch = render(tree, r);
    const want = recipePath(tree, r, launch);
    if (want !== path) return `file name should be ${want.split("/").pop()}`;
    const first = r.proof[0];
    if (!first) return "no proof";
    const need: readonly string[] = first.reported ? [] : first.legacy ? ["load", "chat"] : GATES;
    if (first.reported && !first.src) return "a reported proof names its source";
    const have = new Set(first.gates.split(/\s+/));
    if (!need.every((g) => have.has(g))) return "latest proof lacks a gate";
    if (bytes > MAX_RECIPE_BYTES) return `${bytes} bytes`;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const check = (tree: Tree, sizes: Map<string, number>): string[] =>
  [...tree.recipes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([path, r]) => {
      const err = checkRecipe(tree, path, r, sizes.get(path) ?? 0);
      return err ? [`${path}: ${err}`] : [];
    });

export const normProduct = (s: string): string =>
  s
    .toLowerCase()
    .replace(/nvidia|geforce|intel|amd|radeon|generation|workstation|edition|\d+\s*gb/g, "")
    .replace(/[^a-z0-9]/g, "");

export type CardMatch = { match: { backend: string; name: string; names: string[]; vramGb: number } };

export const matchCard = <C extends CardMatch>(cards: Iterable<C>, backend: string, product: string, memMiB: number): C | null => {
  const n = normProduct(product);
  const gap = (c: C) => Math.abs(c.match.vramGb * 1024 - memMiB);
  return (
    [...cards]
      .filter((c) => c.match.backend === backend && (c.match.names.includes(n) || normProduct(c.match.name) === n) && gap(c) <= Math.max(1024, c.match.vramGb * 51))
      .sort((a, b) => gap(a) - gap(b))[0] ?? null
  );
};

export const servedName = (l: Launch): string | null => {
  const argv = l.kind === "host" ? l.command : l.args;
  for (const flag of ["--served-model-name", "--alias", "--model_id", "--model-name"]) {
    const i = argv.indexOf(flag);
    if (i >= 0 && argv[i + 1]) return argv[i + 1]!;
  }
  return l.env.SERVED_MODEL_NAME ?? l.env.MODEL_ID ?? null;
};
