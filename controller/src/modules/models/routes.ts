import { basename, dirname, isAbsolute, resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { RouteRegistrar } from "../../http/route-registrar";
import type { Recipe } from "../models/types";
import { resolveModelVision } from "@local-studio/contracts/model-capabilities";

/**
 * OpenAI-compatible model info.
 */
interface OpenAIModelInfo {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  active: boolean;
  max_model_len?: number | null;
  metadata: Record<string, unknown>;
}

/**
 * OpenAI-compatible model list response.
 */
interface OpenAIModelList {
  object: "list";
  data: OpenAIModelInfo[];
}
import { buildModelInfo, discoverModelDirectories } from "./model-browser";
import { notFound } from "../../core/errors";
import { findObservedInferenceProcess } from "../../core/function-observability";
import { parseBooleanFlag } from "../../core/validation";
import { fetchInference } from "../../http/local-fetch";

function isMockInferenceEnabled(): boolean {
  return parseBooleanFlag(process.env["LOCAL_STUDIO_MOCK_INFERENCE"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recipeMetadata(recipe: Recipe): Record<string, unknown> {
  const metadata = recipe.extra_args?.["metadata"];
  return isRecord(metadata) ? metadata : {};
}

function resolvedRecipeMetadata(recipe: Recipe, modelId: string): Record<string, unknown> {
  const metadata = recipeMetadata(recipe);
  return {
    ...metadata,
    vision: resolveModelVision({
      identifiers: [modelId, recipe.id, recipe.name, recipe.model_path],
      recipeOverride: recipe.vision,
      metadata,
    }),
  };
}

export const registerModelsRoutes: RouteRegistrar = (app, context) => {
  app.get("/v1/models", async (ctx) => {
    const recipes = context.stores.recipeStore.list();
    const current = await findObservedInferenceProcess(context, "models.list");
    let activeModelData: { data?: Array<{ max_model_len?: number }> } | null = null;
    if (current) {
      try {
        const response = await fetchInference(context, "/v1/models", { timeoutMs: 5000 });
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
          if (
            recipe.model_path.includes(current.model_path) ||
            current.model_path.includes(recipe.model_path)
          ) {
            isActive = true;
          } else if (basename(current.model_path) === basename(recipe.model_path)) {
            isActive = true;
          }
        }
        if (isActive && activeModelData?.data?.[0]?.max_model_len) {
          maxModelLength = activeModelData.data[0].max_model_len;
        }
      }
      const modelId = recipe.served_model_name ?? recipe.id;
      models.push({
        id: modelId,
        object: "model",
        created: now,
        owned_by: "local-studio",
        active: isActive,
        max_model_len: maxModelLength,
        metadata: resolvedRecipeMetadata(recipe, modelId),
      });
    }

    // Dev / mock-friendly fallback: when there are no recipes configured, still return a model so the UI
    // can render a model selector (and avoid "no models" dead-ends on mobile).
    if (models.length === 0 && (isMockInferenceEnabled() || current)) {
      const inferredId =
        process.env["LOCAL_STUDIO_MOCK_MODEL_ID"]?.trim() ||
        current?.served_model_name ||
        (current?.model_path ? basename(current.model_path) : "") ||
        "mock";
      models.push({
        id: inferredId,
        object: "model",
        created: now,
        owned_by: "local-studio",
        active: true,
        max_model_len: activeModelData?.data?.[0]?.max_model_len ?? 32768,
        metadata: {
          vision: resolveModelVision({ identifiers: [inferredId] }),
        },
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
      if (
        (entry.served_model_name && entry.served_model_name === modelId) ||
        entry.id === modelId
      ) {
        recipe = entry;
        break;
      }
    }
    if (!recipe) {
      throw notFound("Model not found");
    }

    const current = await findObservedInferenceProcess(context, "models.detail");
    let isActive = false;
    let maxModelLength = recipe.max_model_len;
    if (
      current &&
      current.model_path &&
      recipe.model_path &&
      current.model_path.includes(recipe.model_path)
    ) {
      isActive = true;
      try {
        const response = await fetchInference(context, "/v1/models", { timeoutMs: 5000 });
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
      owned_by: "local-studio",
      active: isActive,
      max_model_len: maxModelLength,
      metadata: resolvedRecipeMetadata(recipe, recipe.served_model_name ?? recipe.id),
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
      if (isAbsolute(modelPath)) {
        const canonical = expandUserPath(modelPath);
        const existingPaths = recipesByPath.get(canonical) ?? [];
        existingPaths.push(recipe.id);
        recipesByPath.set(canonical, existingPaths);
      }
    }

    const rootIndex = new Map<
      string,
      { path: string; exists: boolean; sources: Set<string>; recipeIds: Set<string> }
    >();

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
      if (!modelPath || !isAbsolute(modelPath)) {
        continue;
      }
      const parent = dirname(expandUserPath(modelPath));
      if (parent === dirname(parent)) {
        continue;
      }
      addRoot(parent, "recipe_parent", recipe.id);
    }

    const roots = Array.from(rootIndex.values()).sort((left, right) =>
      left.path.localeCompare(right.path),
    );
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
    models.sort((left, right) =>
      String(left.name).toLowerCase().localeCompare(String(right.name).toLowerCase()),
    );

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
    const search = ctx.req.query("search")?.trim() || undefined;
    const filter = ctx.req.query("filter") || undefined;
    const sort = ctx.req.query("sort")?.trim() || undefined;
    const limit = Math.min(Math.max(Number(ctx.req.query("limit") ?? 50), 1), 100);
    const offset = Math.max(Number(ctx.req.query("offset") ?? 0), 0);

    const sortMapping: Record<string, string> = {
      createdAt: "createdAt",
      trending: "trendingScore",
      downloads: "downloads",
      likes: "likes",
      lastModified: "lastModified",
      modified: "lastModified",
    };
    const hfSort = sort ? (sortMapping[sort] ?? "trendingScore") : undefined;
    const requestLimit = Math.min(limit + offset, 500);
    const params = new URLSearchParams({
      limit: String(requestLimit),
      full: "false",
    });
    if (hfSort) {
      params.set("sort", hfSort);
    }
    if (search) {
      params.set("search", search);
    }
    if (filter) {
      params.set("filter", filter);
    }

    const normalize = (model: Record<string, unknown>): Record<string, unknown> => {
      const modelId = String(model["modelId"] ?? model["id"] ?? "");
      return {
        ...model,
        _id: String(model["_id"] ?? modelId),
        modelId,
        downloads: Number(model["downloads"] ?? 0),
        likes: Number(model["likes"] ?? 0),
        tags: Array.isArray(model["tags"]) ? model["tags"] : [],
        private: Boolean(model["private"]),
      };
    };

    const url = `https://huggingface.co/api/models?${params.toString()}`;
    try {
      const [listResponse, exactResponse] = await Promise.all([
        fetch(url),
        search && search.includes("/")
          ? fetch(
              `https://huggingface.co/api/models/${search.split("/").map(encodeURIComponent).join("/")}`,
            )
          : Promise.resolve(null),
      ]);
      if (!listResponse.ok) {
        return ctx.json(
          { detail: `HuggingFace API error: ${listResponse.status}` },
          { status: listResponse.status },
        );
      }
      const data = ((await listResponse.json()) as Record<string, unknown>[]).map(normalize);
      let results = data.slice(offset, offset + limit);

      if (exactResponse?.ok) {
        const exact = normalize((await exactResponse.json()) as Record<string, unknown>);
        const exactId = String(exact["modelId"] ?? "").toLowerCase();
        if (exactId) {
          results = [
            exact,
            ...results.filter((entry) => String(entry["modelId"] ?? "").toLowerCase() !== exactId),
          ];
        }
      }

      return ctx.json(results);
    } catch (error) {
      return ctx.json(
        { detail: `Failed to reach HuggingFace API: ${String(error)}` },
        { status: 503 },
      );
    }
  });
};
