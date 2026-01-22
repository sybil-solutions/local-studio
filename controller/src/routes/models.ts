import type { Hono } from "hono";
import { basename, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { AppContext } from "../types/context";
import type { OpenAIModelInfo, OpenAIModelList, Recipe } from "../types/models";
import { buildModelInfo, discoverModelDirectories } from "../services/model-browser";
import { notFound } from "../core/errors";

/**
 * Register model-related routes.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerModelsRoutes = (app: Hono, context: AppContext): void => {
  app.get("/v1/models", async (ctx) => {
    const recipes = context.stores.recipeStore.list();
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    let activeModelData: { data?: Array<{ max_model_len?: number }> } | null = null;
    if (current) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`http://localhost:${context.config.inference_port}/v1/models`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          activeModelData = (await response.json()) as { data?: Array<{ max_model_len?: number }> };
        }
      } catch {
        activeModelData = null;
      }
    }

    const models: OpenAIModelInfo[] = [];
    const now = Math.floor(Date.now() / 1000);
    for (const recipe of recipes) {
      let isActive = false;
      let maxModelLength = recipe.max_model_len;
      if (current) {
        if (current.served_model_name && recipe.served_model_name === current.served_model_name) {
          isActive = true;
        } else if (current.model_path) {
          if (recipe.model_path.includes(current.model_path) || current.model_path.includes(recipe.model_path)) {
            isActive = true;
          } else if (basename(current.model_path) === basename(recipe.model_path)) {
            isActive = true;
          }
        }
        if (activeModelData?.data?.[0]?.max_model_len) {
          maxModelLength = activeModelData.data[0].max_model_len;
        }
      }
      const modelId = recipe.served_model_name ?? recipe.id;
      models.push({
        id: modelId,
        object: "model",
        created: now,
        owned_by: "vllm-studio",
        active: isActive,
        max_model_len: maxModelLength,
      });
    }

    const payload: OpenAIModelList = { object: "list", data: models };
    return ctx.json(payload);
  });

  app.get("/v1/models/:modelId", async (ctx) => {
    const modelId = ctx.req.param("modelId");
    const recipes = context.stores.recipeStore.list();
    let recipe: Recipe | null = null;
    for (const entry of recipes) {
      if ((entry.served_model_name && entry.served_model_name === modelId) || entry.id === modelId) {
        recipe = entry;
        break;
      }
    }
    if (!recipe) {
      throw notFound("Model not found");
    }

    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    let isActive = false;
    let maxModelLength = recipe.max_model_len;
    if (current && current.model_path && recipe.model_path && current.model_path.includes(recipe.model_path)) {
      isActive = true;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`http://localhost:${context.config.inference_port}/v1/models`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          const data = (await response.json()) as { data?: Array<{ max_model_len?: number }> };
          if (data.data?.[0]?.max_model_len) {
            maxModelLength = data.data[0].max_model_len;
          }
        }
      } catch {
        maxModelLength = recipe.max_model_len;
      }
    }

    const payload: OpenAIModelInfo = {
      id: recipe.served_model_name ?? recipe.id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "vllm-studio",
      active: isActive,
      max_model_len: maxModelLength,
    };

    return ctx.json(payload);
  });

  app.get("/v1/studio/models", async (ctx) => {
    const recipes = context.stores.recipeStore.list();
    const recipesByPath = new Map<string, string[]>();
    const recipesByBasename = new Map<string, string[]>();

    const expandUserPath = (pathValue: string): string => {
      if (pathValue.startsWith("~")) {
        return resolve(pathValue.replace("~", homedir()));
      }
      return resolve(pathValue);
    };

    for (const recipe of recipes) {
      const modelPath = recipe.model_path?.trim();
      if (!modelPath) {
        continue;
      }
      const name = basename(modelPath);
      const existingNames = recipesByBasename.get(name) ?? [];
      existingNames.push(recipe.id);
      recipesByBasename.set(name, existingNames);
      if (modelPath.startsWith("/")) {
        const canonical = expandUserPath(modelPath);
        const existingPaths = recipesByPath.get(canonical) ?? [];
        existingPaths.push(recipe.id);
        recipesByPath.set(canonical, existingPaths);
      }
    }

    const rootIndex = new Map<string, { path: string; exists: boolean; sources: Set<string>; recipeIds: Set<string> }>();

    const addRoot = (pathValue: string, source: string, recipeId?: string): void => {
      const resolvedPath = expandUserPath(pathValue);
      const entry = rootIndex.get(resolvedPath) ?? {
        path: resolvedPath,
        exists: existsSync(resolvedPath),
        sources: new Set<string>(),
        recipeIds: new Set<string>(),
      };
      entry.sources.add(source);
      if (recipeId) {
        entry.recipeIds.add(recipeId);
      }
      rootIndex.set(resolvedPath, entry);
    };

    addRoot(context.config.models_dir, "config");

    for (const recipe of recipes) {
      const modelPath = recipe.model_path?.trim();
      if (!modelPath || !modelPath.startsWith("/")) {
        continue;
      }
      const parent = dirname(expandUserPath(modelPath));
      if (parent === "/") {
        continue;
      }
      addRoot(parent, "recipe_parent", recipe.id);
    }

    const roots = Array.from(rootIndex.values()).sort((left, right) => left.path.localeCompare(right.path));
    const scanRoots = roots.filter((root) => root.exists).map((root) => root.path);

    const modelDirectories = discoverModelDirectories(scanRoots, 2, 1000);
    const models = [];
    for (const directory of modelDirectories) {
      const canonical = resolve(directory);
      let recipeIds = recipesByPath.get(canonical) ?? [];
      if (recipeIds.length === 0) {
        const byName = recipesByBasename.get(basename(directory)) ?? [];
        if (byName.length === 1) {
          recipeIds = [...byName];
        }
      }
      const info = await buildModelInfo(directory, recipeIds);
      models.push(info);
    }
    models.sort((left, right) => String(left.name).toLowerCase().localeCompare(String(right.name).toLowerCase()));

    const rootsPayload = roots.map((root) => ({
      path: root.path,
      exists: Boolean(root.exists),
      sources: Array.from(root.sources).sort(),
      recipe_ids: Array.from(root.recipeIds).sort(),
    }));

    return ctx.json({
      models,
      roots: rootsPayload,
      configured_models_dir: context.config.models_dir,
    });
  });

  app.get("/v1/huggingface/models", async (ctx) => {
    const search = ctx.req.query("search") || undefined;
    const filter = ctx.req.query("filter") || undefined;
    const sort = ctx.req.query("sort") || "trending";
    const limit = Number(ctx.req.query("limit") ?? 50);

    const sortMapping: Record<string, string> = {
      trending: "trendingScore",
      downloads: "downloads",
      likes: "likes",
      modified: "lastModified",
    };
    const hfSort = sortMapping[sort] ?? "trendingScore";
    const params = new URLSearchParams({ limit: String(limit), full: "false", sort: hfSort });
    if (search) {
      params.set("search", search);
    }
    if (filter) {
      params.set("filter", filter);
    }

    const url = `https://huggingface.co/api/models?${params.toString()}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return ctx.json({ detail: `HuggingFace API error: ${response.status}` }, { status: response.status });
      }
      const data = await response.json();
      return ctx.json(data);
    } catch (error) {
      return ctx.json({ detail: `Failed to reach HuggingFace API: ${String(error)}` }, { status: 503 });
    }
  });
};
