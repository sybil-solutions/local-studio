import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { scanGpus } from "@local-studio/probe";
import { check, matchCard, pin, profile, type Recipe, render, type Tree, type Value } from "@local-studio/registry";
import { readTree } from "@local-studio/registry/fs";
import { exec } from "./core/exec";
import type { LabRun } from "./recipes/lab";

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flags = (argv: string[], name: string): string[] => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]!] : []));

const registryRoot = (argv: string[]): string => {
  const dir = resolve(flag(argv, "--registry") ?? process.env.LOCAL_AI_REGISTRY ?? (existsSync("registry/cards") ? "." : join(homedir(), "projects", "local-ai-registry")));
  if (!existsSync(join(dir, "registry", "cards"))) throw new Error(`${dir} has no registry/; pass --registry <checkout of local-ai-registry>`);
  return dir;
};

const api = async <T>(base: string, method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(out.error?.message ?? `HTTP ${res.status}`);
  return out;
};

const follow = async (base: string, run: LabRun): Promise<LabRun> => {
  let last = "";
  let r = run;
  while (!["passed", "failed"].includes(r.phase)) {
    await Bun.sleep(3000);
    r = await api<LabRun>(base, "GET", `/api/lab/runs/${run.id}`);
    const line = `${r.phase}: ${r.detail}`;
    if (line !== last) console.error(line);
    last = line;
  }
  const g = Object.entries(r.gates).map(([k, v]) => `${k} ${v ? "pass" : "FAIL"}`);
  console.error(`gates: ${g.join(", ") || "none"}`);
  return r;
};

const parseSet = (tree: Tree, engine: string, kvs: string[]): Record<string, Value> => {
  const p = profile(tree, engine);
  const out: Record<string, Value> = {};
  for (const kv of kvs) {
    const [k = "", v = ""] = kv.split(/=(.*)/s);
    if (!p.defaults || !(k in p.defaults)) throw new Error(`${k} is not a setting of ${p.id}: ${Object.keys(p.defaults ?? {}).sort().join(", ")}`);
    const val: Value = /^\d+$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v;
    if (val !== p.defaults[k]) out[k] = val;
  }
  return out;
};

const writeFiles = (root: string, files: Record<string, string>) => {
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    if (rel.startsWith("registry/recipes/") && existsSync(path)) {
      const now = JSON.parse(text) as Recipe;
      const old = JSON.parse(readFileSync(path, "utf8")) as Recipe;
      const same = old.weights === now.weights && old.engine === now.engine && JSON.stringify(old.set) === JSON.stringify(now.set);
      writeFileSync(path, `${JSON.stringify({ ...now, proof: [...now.proof, ...(same ? old.proof.slice(0, 2) : [])] })}\n`);
    } else writeFileSync(path, text);
    console.log(`wrote ${rel}`);
  }
};

export const CLI_USAGE = `  probe   [--registry DIR]                 this machine's accelerators and the registry card each one matches
  check   [--registry DIR]                 every recipe: format, pins, profile, card, proof
  render  <recipe.json> [--registry DIR]   the launch a recipe renders to
  try     <repo>@<rev> --model ID --engine PROFILE --card CARD [--set k=v ...] [--gpus KEYS] [--keep] [--dry-run] [--registry DIR] [--url URL]
                                           launch it on this machine, run the six gates, and write the recipe only if all pass
  verify  <model> [--ctx N] [--url URL]    run the six gates against a model that is already running`;

export const runCli = async (cmd: string, argv: string[]): Promise<number> => {
  const url = (flag(argv, "--url") ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
  if (cmd === "check") {
    const { tree, sizes } = readTree(registryRoot(argv));
    const bad = check(tree, sizes);
    console.log(bad.join("\n") || `recipes ok: ${tree.recipes.size}`);
    return bad.length ? 1 : 0;
  }
  if (cmd === "render") {
    const { tree } = readTree(registryRoot(argv));
    const file = argv.find((a) => a.endsWith(".json"));
    if (!file) throw new Error("render <recipe.json>");
    console.log(JSON.stringify(render(tree, JSON.parse(readFileSync(file, "utf8")) as Recipe), null, 2));
    return 0;
  }
  if (cmd === "probe") {
    const cards = (() => {
      try {
        return [...readTree(registryRoot(argv)).tree.cards.values()];
      } catch {
        return [];
      }
    })();
    const scan = await scanGpus({ platform: process.platform, exec }, (b, p, m) => matchCard(cards, b, p, m)?.id ?? null);
    for (const g of scan.gpus) console.log(`${g.key}\t${g.backend}\t${g.product}\t${Math.round(g.memTotalMiB / 1024)} GB\t${g.hardwareId ?? "no registry card"}`);
    if (!scan.gpus.length) console.log(scan.error ?? "no accelerator found");
    return 0;
  }
  if (cmd === "verify") {
    const model = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--ctx" && argv[argv.indexOf(a) - 1] !== "--url");
    if (!model) throw new Error("verify <model>");
    const ctx = flag(argv, "--ctx");
    const r = await follow(url, await api<LabRun>(url, "POST", "/api/lab/verify", { model, ...(ctx ? { ctx: Number(ctx) } : {}) }));
    console.log(JSON.stringify(r.proof));
    return r.phase === "passed" ? 0 : 1;
  }
  if (cmd === "try") {
    const weights = argv[0] ?? "";
    if (!/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(weights)) throw new Error("weights must be <repo>@<40-hex revision>");
    const root = registryRoot(argv);
    const { tree } = readTree(root);
    const model = flag(argv, "--model");
    const engine = flag(argv, "--engine");
    const cardId = flag(argv, "--card");
    if (!model || !engine || !cardId) throw new Error("try needs --model, --engine and --card");
    const card = tree.cards.get(cardId);
    if (!card) throw new Error(`unknown card ${cardId}`);
    const p = profile(tree, engine);
    const recipe = { model, weights, engine: `${p.id}@${pin(tree, p).slice(0, 12)}`, set: parseSet(tree, engine, flags(argv, "--set")), card: cardId };
    const launch = render(tree, { ...recipe, proof: [] });
    if (argv.includes("--dry-run")) {
      console.log(JSON.stringify({ recipe, launch }, null, 2));
      return 0;
    }
    const gpuKeys = flag(argv, "--gpus")?.split(",");
    const r = await follow(url, await api<LabRun>(url, "POST", "/api/lab/try", { recipe, launch, profile: p, card, ...(gpuKeys ? { gpuKeys } : {}), keep: argv.includes("--keep") }));
    writeFiles(root, r.files);
    console.log(r.phase === "passed" ? `PASSED: decode ${r.proof?.tps} tok/s, prefill ${r.proof?.prefill ?? "–"} tok/s` : `FAILED: ${r.detail}; no recipe written`);
    return r.phase === "passed" ? 0 : 1;
  }
  return -1;
};
