import { Hono } from "hono";
import type { Context } from "hono";
import { ExportPrBody, LaunchRecipeBody } from "@local-studio/contracts";
import type { Env, RecipeService } from "../context";
import type { RecipesInternal } from "./index";
import { HttpError } from "./util";

const fail = (c: Context<Env>, e: unknown) => {
  if (e instanceof HttpError) return c.json({ error: { code: e.code, message: e.message } }, e.status);
  throw e;
};

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
    try {
      const hardware = c.req.query("hardware");
      const fitOnly = c.req.query("fit") === "1";
      let rows = await service.rows();
      if (hardware) rows = rows.filter((x) => x.hardwareId === hardware);
      if (fitOnly) rows = rows.filter((x) => x.fit === "fits" || x.fit === "busy");
      return c.json(rows);
    } catch (e) {
      return fail(c, e);
    }
  });

  r.post("/api/recipes/sync", async (c) => {
    try {
      const cat = await internal.sync();
      return c.json({ source: cat.source, registryCommit: cat.registryCommit, generatedAt: cat.generatedAt, fetchedAt: cat.fetchedAt, hardware: cat.hardware.length, recipes: cat.recipes.length });
    } catch (e) {
      return fail(c, e);
    }
  });

  r.get("/api/recipes/:id/plan", async (c) => {
    try {
      const keys = c.req.query("gpuKeys");
      const gpuKeys = keys ? parse(LaunchRecipeBody, { gpuKeys: keys.split(",").map((s) => s.trim()).filter(Boolean) }).gpuKeys : undefined;
      return c.json(await internal.plan(c.req.param("id"), gpuKeys));
    } catch (e) {
      return fail(c, e);
    }
  });

  r.get("/api/recipes/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const row = (await service.rows()).find((x) => x.id === id);
      if (!row) throw new HttpError(404, "RECIPE_NOT_FOUND", `no recipe ${id} in the registry catalog`);
      return c.json({ ...row, record: await internal.record(id) });
    } catch (e) {
      return fail(c, e);
    }
  });

  r.post("/api/recipes/:id/launch", async (c) => {
    try {
      const b = parse(LaunchRecipeBody, await body(c));
      return c.json(await service.launch(c.req.param("id"), b.gpuKeys), 202);
    } catch (e) {
      return fail(c, e);
    }
  });

  r.post("/api/models/:id/export", async (c) => {
    try {
      return c.json(await service.exportModel(c.req.param("id")));
    } catch (e) {
      return fail(c, e);
    }
  });

  r.post("/api/models/:id/export/pr", async (c) => {
    try {
      const b = parse(ExportPrBody, await body(c));
      return c.json(await service.openPr(c.req.param("id"), { title: b.title, draft: b.draft }));
    } catch (e) {
      return fail(c, e);
    }
  });

  return r;
};
