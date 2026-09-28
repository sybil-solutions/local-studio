import { Hono } from "hono";
import type { Context } from "hono";
import { ExportPrBody, FitBody, LaunchRecipeBody, SyncRecipesBody } from "@local-studio/contracts";
import type { Env, RecipeService } from "../context";
import type { RecipesInternal } from "./index";
import { HttpError } from "./util";

const body = async (c: Context<Env>): Promise<unknown> => {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "BAD_JSON", "request body is not JSON");
  }
};

const parse = <T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { message: string } } }, v: unknown): T => {
  const r = schema.safeParse(v);
  if (!r.success) throw new HttpError(400, "BAD_REQUEST", r.error.message);
  return r.data;
};

export const recipeRoutes = (service: RecipeService, internal: RecipesInternal): Hono<Env> => {
  const r = new Hono<Env>();
  r.get("/api/recipes", async (c) => {
    const hardware = c.req.query("hardware");
    let rows = await service.rows();
    if (hardware) rows = rows.filter((x) => x.hardwareId === hardware);
    if (c.req.query("fit") === "1") rows = rows.filter((x) => x.fit === "fits" || x.fit === "busy");
    return c.json(rows);
  });
  r.post("/api/recipes/sync", async (c) => {
    const cat = await internal.sync(parse(SyncRecipesBody, await body(c)).ref);
    return c.json({ source: cat.source, ref: cat.ref, registryCommit: cat.registryCommit, fetchedAt: cat.fetchedAt, hardware: cat.hardware.length, recipes: cat.recipes.length });
  });
  r.post("/api/recipes/fit", async (c) => c.json(await internal.fit(parse(FitBody, await body(c)))));
  r.get("/api/recipes/:id/plan", async (c) => {
    const keys = c.req.query("gpuKeys");
    const gpuKeys = keys ? parse(LaunchRecipeBody, { gpuKeys: keys.split(",").map((s) => s.trim()).filter(Boolean) }).gpuKeys : undefined;
    return c.json(await internal.plan(c.req.param("id"), gpuKeys));
  });
  r.put("/api/recipes/:id/assigned", async (c) => {
    const b = (await body(c)) as { on?: unknown };
    if (typeof b.on !== "boolean") throw new HttpError(400, "BAD_REQUEST", "on must be a boolean");
    internal.assign(c.req.param("id"), b.on);
    return c.json({ id: c.req.param("id"), assigned: b.on });
  });
  r.post("/api/recipes/:id/launch", async (c) => {
    const b = parse(LaunchRecipeBody, await body(c));
    return c.json(await service.launch(c.req.param("id"), b.gpuKeys, b.stop), 202);
  });
  r.post("/api/models/:id/export", async (c) => c.json(await service.exportModel(c.req.param("id"))));
  r.post("/api/models/:id/export/pr", async (c) => {
    const b = parse(ExportPrBody, await body(c));
    return c.json(await service.openPr(c.req.param("id"), { title: b.title, draft: b.draft, dryRun: b.dryRun }));
  });
  return r;
};
