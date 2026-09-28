import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FitBody, LaunchPreview, RecipeCatalog, SelectionFit } from "@local-studio/contracts";
import type { Ctx, Module, RecipeService, Services } from "../context";
import { migrate } from "../core/db";
import { createExporter } from "./export";
import { createLab } from "./lab";
import { buildRows, fitSelection, hardwareIds, type SelectedMachine, servingModel, stopsFor } from "./fit";
import { buildPlan } from "./plan";
import { createPrOpener } from "./pr";
import { createRegistry, writeSeccomp } from "./registry";
import { recipeRoutes } from "./routes";
import { HttpError } from "./util";
import { createWeightIndex } from "./weights";

export interface RecipesInternal {
  sync(ref?: string): Promise<RecipeCatalog>;
  plan(id: string, gpuKeys?: string[]): Promise<LaunchPreview>;
  assign(id: string, on: boolean): void;
  fit(body: FitBody): Promise<SelectionFit>;
}

export const createRecipes = (ctx: Ctx, svc: Services): Module<RecipeService> => {
  migrate(ctx.db, "recipes", [
    `CREATE TABLE recipe_exports (at INTEGER NOT NULL, model_id TEXT NOT NULL, recipe_id TEXT NOT NULL, saved_to TEXT NOT NULL, refusals INTEGER NOT NULL, launchable INTEGER NOT NULL)`,
    `CREATE TABLE recipe_prs (at INTEGER NOT NULL, model_id TEXT NOT NULL, recipe_id TEXT NOT NULL, branch TEXT NOT NULL, url TEXT NOT NULL)`,
    `CREATE TABLE recipe_assigned (recipe_id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  ]);
  const assigned = (): Set<string> => new Set(ctx.db.query<{ recipe_id: string }, []>("SELECT recipe_id FROM recipe_assigned").all().map((r) => r.recipe_id));
  const registry = createRegistry(ctx);
  const exporter = createExporter(ctx, svc, registry);
  const prs = createPrOpener(ctx, svc, registry, exporter);

  const service: RecipeService = {
    catalog: async () => (await registry.load()).catalog,
    rows: async () => {
      const on = assigned();
      return buildRows(await registry.load(), svc.runtime.view(), createWeightIndex(ctx)).map((r) => ({ ...r, assigned: on.has(r.id) }));
    },
    launch: async (recipeId, gpuKeys, stop) => {
      const loaded = await registry.load();
      const index = createWeightIndex(ctx);
      let view = svc.runtime.view();
      if (stop && gpuKeys?.length) {
        const pre = buildPlan(ctx, view, loaded, index, recipeId, { gpuKeys, strict: false });
        const missing = pre.weights.find((w) => !w.present);
        if (missing) throw new HttpError(409, "WEIGHTS_MISSING", missing.hint ?? `weights ${missing.repository} are not on this machine`);
        for (const s of stopsFor(ctx.identity.machineId, pre.plan.gpuKeys, view.groups)) {
          if (!s.modelId || s.state === "foreign") throw new HttpError(409, "GPU_FOREIGN", `${s.gpuKeys.join(",")} are held by a process Local Studio does not run; stop it on the machine first`);
          const r = await svc.lifecycle.stop(s.modelId, { confirm: s.modelId });
          if (!r.ok) throw new HttpError(409, "STOP_FAILED", `could not stop ${s.modelId}: ${r.detail}`);
          ctx.log.info(`recipes: stopped ${s.modelId} to free ${s.gpuKeys.join(",")} for ${recipeId}`);
        }
        view = await svc.runtime.rescan();
      }
      const res = buildPlan(ctx, view, loaded, index, recipeId, { gpuKeys, strict: true });
      if (res.asset) {
        mkdirSync(dirname(res.asset.path), { recursive: true });
        writeFileSync(res.asset.path, res.asset.text);
      }
      if (res.scratchDir) mkdirSync(res.scratchDir, { recursive: true });
      writeSeccomp(ctx.config.dataDir, res.plan.dockerOpts ?? []);
      ctx.log.info(`recipes: launching ${recipeId} on ${res.plan.gpuKeys.join(",")} as ${res.plan.containerName}`);
      return svc.lifecycle.launch(res.plan);
    },
    exportModel: (modelId) => exporter.exportModel(modelId),
    openPr: (modelId, opts) => prs.openPr(modelId, opts),
  };

  const machinesFor = (body: FitBody): SelectedMachine[] => {
    const fleet = body.selection.some((s) => s.machineId && s.machineId !== ctx.identity.machineId) ? svc.peers.fleet() : null;
    return body.selection.map((s) => {
      const self = !s.machineId || s.machineId === ctx.identity.machineId;
      const snap = self ? null : fleet?.machines.find((m) => m.machineId === s.machineId)?.snapshot;
      if (!self && !snap) throw new HttpError(404, "MACHINE_NOT_FOUND", `no snapshot for machine ${s.machineId}`);
      const v = self ? svc.runtime.view() : { gpus: snap?.gpus ?? [], groups: snap?.groups ?? [] };
      const keys = [...new Set(s.gpuKeys)];
      const gpus = keys.map((k) => v.gpus.find((g) => g.key === k));
      const unknown = keys.filter((_, i) => !gpus[i]);
      if (unknown.length) throw new HttpError(422, "GPU_UNKNOWN", `no GPU ${unknown.join(",")} on ${self ? ctx.identity.name : snap?.machine.name}`);
      return { machineId: self ? ctx.identity.machineId : s.machineId ?? "", name: self ? ctx.identity.name : snap?.machine.name ?? "", gpus: gpus.filter((g) => !!g), groups: v.groups };
    });
  };

  const fit = async (body: FitBody): Promise<SelectionFit> => {
    const first = body.selection[0];
    const peer = body.selection.length === 1 && first?.machineId && first.machineId !== ctx.identity.machineId ? svc.peers.fleet().machines.find((m) => m.machineId === first.machineId)?.peerId : null;
    if (peer) {
      const res = await svc.peers.fetch(peer, "/api/recipes/fit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selection: [{ gpuKeys: first?.gpuKeys }] }), timeoutMs: 30_000 });
      if (!res.ok) throw new HttpError(502, "PEER_FIT", `peer fit failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
      const out = (await res.json()) as SelectionFit;
      return { ...out, machines: out.machines.map((m) => ({ ...m, machineId: first?.machineId ?? m.machineId })) };
    }
    const sel = machinesFor(body);
    const loaded = await registry.load();
    const hw = loaded.catalog.hardware;
    const local = sel.length === 1 && sel[0]?.machineId === ctx.identity.machineId;
    const view = svc.runtime.view();
    const index = createWeightIndex(ctx);
    const on = assigned();
    const rows = loaded.catalog.recipes
      .map((r) => {
        const f = fitSelection(r, sel, hw);
        if (!f) return null;
        const raw = loaded.raw.get(r.id);
        return {
          ...r,
          fit: f.fit,
          freeGroups: f.fit === "fits" && local ? [sel[0]?.gpus.map((g) => g.key) ?? []] : [],
          runningModelId: local ? servingModel(view.models, r.servedName)?.id ?? null : null,
          weightsPresent: local && raw ? raw.weights.every((w) => index.resolve(w).present) : null,
          assigned: on.has(r.id),
          stops: f.stops,
        };
      })
      .filter((r) => !!r)
      .sort((a, b) => Number(b.origin === "yours") - Number(a.origin === "yours") || Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name));
    return { machines: sel.map((m) => ({ machineId: m.machineId, name: m.name, gpuKeys: m.gpus.map((g) => g.key), hardwareIds: [...new Set(m.gpus.flatMap((g) => [...hardwareIds(g, hw)].filter((id) => hw.some((h) => h.hardwareId === id))))] })), rows };
  };

  const internal: RecipesInternal = {
    assign: (id, on) => {
      if (on) ctx.db.query("INSERT OR REPLACE INTO recipe_assigned (recipe_id, at) VALUES (?, ?)").run(id, Date.now());
      else ctx.db.query("DELETE FROM recipe_assigned WHERE recipe_id = ?").run(id);
    },
    sync: async (ref) => {
      if (ref) registry.setRef(ref);
      return (await registry.load({ sync: true })).catalog;
    },
    plan: async (id, gpuKeys) => {
      const view = svc.runtime.view();
      const res = buildPlan(ctx, view, await registry.load(), createWeightIndex(ctx), id, { gpuKeys, strict: false });
      return {
        plan: res.plan,
        dockerArgv: svc.lifecycle.dockerArgv(res.plan),
        dockerArgvSource: "lifecycle",
        weights: res.weights.map((w) => ({ repository: w.repository, revision: w.revision, hostPath: w.hostPath, present: w.present, source: w.source, hint: w.hint })),
        warnings: res.warnings,
        stops: stopsFor(ctx.identity.machineId, res.plan.gpuKeys, view.groups),
        executed: false,
      };
    },
    fit,
  };

  return {
    service,
    routes: recipeRoutes(service, internal).route("/", createLab(ctx, svc).routes),
    start: () => {
      registry.load().catch((e) => ctx.log.warn(`recipes: initial registry load failed: ${e instanceof Error ? e.message : String(e)}`));
    },
  };
};
