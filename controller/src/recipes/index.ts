import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LaunchPreview, RecipeCatalog } from "@local-studio/contracts";
import type { Ctx, Module, RecipeService, Services } from "../context";
import { migrate } from "../core/db";
import { createExporter } from "./export";
import { buildRows } from "./fit";
import { buildPlan, previewArgv } from "./plan";
import { createPrOpener } from "./pr";
import { createRegistry } from "./registry";
import { recipeRoutes } from "./routes";
import { HttpError } from "./util";
import { createWeightIndex } from "./weights";

export type PlanPreview = LaunchPreview;

export interface RecipesInternal {
  sync(): Promise<RecipeCatalog>;
  plan(id: string, gpuKeys?: string[]): Promise<PlanPreview>;
  record(id: string): Promise<Record<string, unknown> | null>;
}

export const createRecipes = (ctx: Ctx, svc: Services): Module<RecipeService> => {
  migrate(ctx.db, "recipes", [
    `CREATE TABLE recipe_exports (at INTEGER NOT NULL, model_id TEXT NOT NULL, recipe_id TEXT NOT NULL, saved_to TEXT NOT NULL, refusals INTEGER NOT NULL, launchable INTEGER NOT NULL)`,
    `CREATE TABLE recipe_prs (at INTEGER NOT NULL, model_id TEXT NOT NULL, recipe_id TEXT NOT NULL, branch TEXT NOT NULL, url TEXT NOT NULL)`,
  ]);
  const registry = createRegistry(ctx);
  const exporter = createExporter(ctx, svc, registry);
  const prs = createPrOpener(ctx, svc, registry, exporter);

  const service: RecipeService = {
    catalog: async () => (await registry.load()).catalog,
    rows: async () => buildRows(await registry.load(), svc.runtime.view(), createWeightIndex(ctx)),
    launch: async (recipeId, gpuKeys) => {
      const view = svc.runtime.view();
      const res = buildPlan(ctx, view, await registry.load(), createWeightIndex(ctx), recipeId, { gpuKeys, strict: true });
      if (res.asset) {
        mkdirSync(dirname(res.asset.path), { recursive: true });
        writeFileSync(res.asset.path, res.asset.text);
      }
      if (res.scratchDir) mkdirSync(res.scratchDir, { recursive: true });
      ctx.log.info(`recipes: launching ${recipeId} on ${res.plan.gpuKeys.join(",")} as ${res.plan.containerName}`);
      return svc.lifecycle.launch(res.plan);
    },
    exportModel: async (modelId) => {
      const exp = await exporter.exportModel(modelId);
      ctx.db
        .query("INSERT INTO recipe_exports (at, model_id, recipe_id, saved_to, refusals, launchable) VALUES (?, ?, ?, ?, ?, ?)")
        .run(Date.now(), modelId, exp.recipeId, exp.savedTo, exp.refusals.length, exp.launchable ? 1 : 0);
      return exp;
    },
    openPr: (modelId, opts) => prs.openPr(modelId, opts),
  };

  const internal: RecipesInternal = {
    sync: async () => (await registry.load({ sync: true })).catalog,
    record: (id) => registry.record(id),
    plan: async (id, gpuKeys) => {
      const res = buildPlan(ctx, svc.runtime.view(), await registry.load(), createWeightIndex(ctx), id, { gpuKeys, strict: false });
      let dockerArgv: string[];
      let dockerArgvSource: PlanPreview["dockerArgvSource"] = "lifecycle";
      try {
        dockerArgv = svc.lifecycle.dockerArgv(res.plan);
      } catch {
        dockerArgv = previewArgv(res.plan);
        dockerArgvSource = "recipes-preview";
      }
      if (!Array.isArray(dockerArgv)) throw new HttpError(500, "ARGV", "lifecycle returned no argv");
      return {
        plan: res.plan,
        dockerArgv,
        dockerArgvSource,
        weights: res.weights.map((w) => ({ repository: w.repository, revision: w.revision, hostPath: w.hostPath, present: w.present, source: w.source, hint: w.hint })),
        warnings: res.warnings,
        executed: false,
      };
    },
  };

  return {
    service,
    routes: recipeRoutes(service, internal),
    start: () => {
      registry.load().catch((e) => ctx.log.warn(`recipes: initial registry load failed: ${e instanceof Error ? e.message : String(e)}`));
    },
  };
};
