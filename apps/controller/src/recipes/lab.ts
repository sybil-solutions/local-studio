import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Gate, runGates } from "@local-studio/gates";
import { type Card, type Launch, type Profile, type Recipe as RegRecipe, type Proof, recipePath } from "@local-studio/registry";
import { Hono } from "hono";
import type { Ctx, Env, Services } from "../context";
import { which } from "../core/exec";
import { buildPlan } from "./plan";
import { type LoadedCatalog, toRecipe, toV2 } from "./registry";
import { HttpError } from "./util";
import { createWeightIndex } from "./weights";

export interface LabRun {
  id: string;
  kind: "try" | "verify";
  phase: "weights" | "launching" | "gates" | "passed" | "failed";
  detail: string;
  gates: Partial<Record<Gate, boolean>>;
  startedAt: number;
  updatedAt: number;
  proof: Proof | null;
  recipe: RegRecipe | null;
  files: Record<string, string>;
  evidence: unknown;
}

interface TryBody {
  recipe: Omit<RegRecipe, "proof">;
  launch: Launch;
  profile: Profile;
  card: Card;
  gpuKeys?: string[];
  keep?: boolean;
}

const HF_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/Library/Frameworks/Python.framework/Versions/Current/bin", `${process.env.HOME ?? ""}/.local/bin`];

export const createLab = (ctx: Ctx, svc: Services) => {
  const runs = new Map<string, LabRun>();
  const set = (r: LabRun, patch: Partial<LabRun>) => {
    Object.assign(r, patch, { updatedAt: Date.now() });
    ctx.log.info(`lab ${r.id}: ${r.phase} ${r.detail}`);
  };
  const start = (kind: LabRun["kind"]): LabRun => {
    const r: LabRun = { id: `lab_${randomBytes(4).toString("hex")}`, kind, phase: "launching", detail: "", gates: {}, startedAt: Date.now(), updatedAt: Date.now(), proof: null, recipe: null, files: {}, evidence: null };
    runs.set(r.id, r);
    return r;
  };

  const gateRun = async (r: LabRun, endpoint: string, ctxTokens: number, gpu: string, recipe: Omit<RegRecipe, "proof"> | null) => {
    set(r, { phase: "gates", detail: `${endpoint} at ${ctxTokens} tokens of context` });
    const out = await runGates({ endpoint, ctx: ctxTokens, onGate: (g, ok) => set(r, { gates: { ...r.gates, [g]: ok }, detail: `${g} ${ok ? "passed" : "failed"}` }) });
    const at = new Date();
    const evidence = { recipe, where: { on: "owner", gpu, machine: ctx.identity.name }, passed: out.passed, proof: out.proof, evidence: out.evidence };
    const text = JSON.stringify(evidence, null, 1);
    const dir = join(ctx.config.dataDir, "lab", "runs");
    mkdirSync(dir, { recursive: true });
    const name = `${recipe?.card ?? "model"}.${(recipe?.model ?? "verify").replace(/[^\w.-]/g, "-")}.${at.toISOString().replace(/[-:]/g, "").slice(0, 15)}.json`;
    writeFileSync(join(dir, name), `${text}\n`);
    const proof: Proof = { at: at.toISOString().slice(0, 10), on: "owner", gpu, ...out.proof, log: `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 16)}` };
    r.files[`lab/runs/${name}`] = `${text}\n`;
    return { passed: out.passed, proof, evidence };
  };

  const doTry = async (r: LabRun, b: TryBody) => {
    const key = `${b.card.vendor}/${b.card.id}/${b.recipe.model}.lab`;
    const reg: RegRecipe = { ...b.recipe, proof: [] };
    const v = toV2(key, reg, b.launch, b.profile, { models: {}, builds: {} }, ctx.config.dataDir);
    v.id = `lab-${r.id}`;
    const index = createWeightIndex(ctx);
    set(r, { phase: "weights", detail: "resolving weights" });
    for (const w of v.weights) {
      const res = index.resolve(w);
      if (res.present) continue;
      const hf = await which("hf", HF_DIRS);
      if (!hf || !res.hint?.startsWith("hf download ")) throw new Error(`weights ${w.repository} are missing and cannot be downloaded here${res.hint ? `; run: ${res.hint}` : ""}`);
      set(r, { detail: `downloading ${w.repository}@${w.revision.slice(0, 8)}` });
      const dl = await ctx.exec([hf, ...res.hint.slice(3).split(" ")], { timeoutMs: 6 * 3600_000, env: { HF_HUB_ENABLE_HF_TRANSFER: "1" } });
      if (dl.code !== 0) throw new Error(`download failed: ${(dl.stderr || dl.stdout).trim().split("\n").at(-1)}`);
    }
    const loaded: LoadedCatalog = {
      catalog: { source: "lab", ref: "lab", registryCommit: null, generatedAt: null, fetchedAt: Date.now(), hardware: [{ hardwareId: b.card.id, match: b.card.match }], recipes: [toRecipe(v, b.card.id, false)] },
      raw: new Map([[v.id, v]]),
      tree: null,
    };
    await svc.runtime.rescan();
    const res = buildPlan(ctx, svc.runtime.view(), loaded, createWeightIndex(ctx), v.id, { gpuKeys: b.gpuKeys, strict: true });
    set(r, { phase: "launching", detail: res.plan.host ? res.plan.host.command.slice(0, 3).join(" ") : res.plan.image });
    const p = svc.lifecycle.launch(res.plan);
    let prog = p;
    while (!["ready", "failed", "cancelled"].includes(prog.phase)) {
      await Bun.sleep(2000);
      prog = svc.lifecycle.progress().find((x) => x.launchId === p.launchId) ?? prog;
      set(r, { detail: prog.detail });
    }
    if (prog.phase !== "ready") throw new Error(prog.error ?? prog.detail);
    const endpoint = `http://127.0.0.1:${res.plan.hostPort}`;
    try {
      const out = await gateRun(r, endpoint, b.launch.ctx, b.card.name, b.recipe);
      const recipe: RegRecipe = { ...b.recipe, proof: [out.proof] };
      r.recipe = recipe;
      r.proof = out.proof;
      r.evidence = out.evidence;
      const withProfile = { cards: new Map([[b.card.id, b.card]]), engines: new Map<string, Profile>(), launches: new Map([[b.profile.id, b.profile]]), files: new Map<string, string>(), recipes: new Map(), models: {}, builds: {} };
      if (b.profile.defaults) withProfile.engines.set(b.profile.id, b.profile);
      if (out.passed) r.files[recipePath(withProfile, recipe, b.launch)] = `${JSON.stringify(recipe)}\n`;
      set(r, { phase: out.passed ? "passed" : "failed", detail: `decode ${out.proof.tps} tok/s, prefill ${out.proof.prefill ?? "–"} tok/s` });
    } finally {
      if (!b.keep) {
        await svc.runtime.rescan();
        const m = svc.runtime.models().find((x) => x.port === res.plan.hostPort);
        if (m) await svc.lifecycle.stop(m.id, { confirm: m.id, force: true });
      }
    }
  };

  const doVerify = async (r: LabRun, modelId: string, ctxTokens?: number) => {
    const m = svc.runtime.model(modelId) ?? svc.runtime.resolveServed(modelId);
    if (!m) throw new HttpError(404, "MODEL_NOT_FOUND", `no running model ${modelId}`);
    const n = ctxTokens ?? m.contextWindow;
    if (!n) throw new HttpError(422, "CTX_UNKNOWN", `${modelId} does not report its context window; pass ctx`);
    const g = svc.runtime.view().gpus.find((x) => m.gpuKeys.includes(x.key));
    const out = await gateRun(r, m.baseUrl ?? `http://127.0.0.1:${m.port}`, n, g?.product ?? "unknown", null);
    r.proof = out.proof;
    r.evidence = out.evidence;
    set(r, { phase: out.passed ? "passed" : "failed", detail: `decode ${out.proof.tps} tok/s` });
  };

  const guard = (r: LabRun, p: Promise<void>) =>
    void p.catch((e) => set(r, { phase: "failed", detail: e instanceof Error ? e.message : String(e) }));

  const routes = new Hono<Env>();
  routes.post("/api/lab/try", async (c) => {
    if (!c.get("admin")) return c.json({ error: { code: "AUTH", message: "admin only" } }, 403);
    if (ctx.config.readOnly) return c.json({ error: { code: "READ_ONLY", message: "this controller runs with --read-only" } }, 403);
    const b = (await c.req.json().catch(() => null)) as TryBody | null;
    if (!b?.recipe || !b.launch || !b.profile || !b.card) return c.json({ error: { code: "BAD_REQUEST", message: "recipe, launch, profile and card are required" } }, 400);
    const r = start("try");
    guard(r, doTry(r, b));
    return c.json(r, 202);
  });
  routes.post("/api/lab/verify", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { model?: string; ctx?: number } | null;
    if (!b?.model) return c.json({ error: { code: "BAD_REQUEST", message: "model is required" } }, 400);
    const r = start("verify");
    guard(r, doVerify(r, b.model, b.ctx));
    return c.json(r, 202);
  });
  routes.get("/api/lab/runs/:id", (c) => {
    const r = runs.get(c.req.param("id"));
    return r ? c.json(r) : c.json({ error: { code: "NOT_FOUND", message: "no such lab run" } }, 404);
  });
  return { routes };
};
