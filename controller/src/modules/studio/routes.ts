import type { Hono } from "hono";
import { cpus, freemem, totalmem, platform, arch, release } from "node:os";
import {
  existsSync,
  readdirSync,
  rmSync,
  renameSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statfsSync,
} from "node:fs";
import { basename, resolve, sep } from "node:path";
import { badRequest, notFound } from "../../core/errors";
import type { AppContext } from "../../types/context";
import { getGpuInfo } from "../system/platform/gpu";
import type { GpuInfo } from "../models/types";
import { discoverModelDirectories, estimateWeightsSizeBytes } from "../models/model-browser";
import { STUDIO_MODEL_RECOMMENDATIONS } from "./configs";
import {
  getPersistedConfigPath,
  loadPersistedConfig,
  savePersistedConfig,
  type ProviderConfig,
} from "../../config/persisted-config";
import { getVllmRuntimeInfo } from "../engines/runtimes/vllm-runtime";

const getDiskInfo = (
  path: string
): {
  path: string;
  total_bytes: number | null;
  free_bytes: number | null;
  available_bytes: number | null;
} => {
  try {
    const stats = statfsSync(path);
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const available = stats.bavail * stats.bsize;
    return {
      path,
      total_bytes: total,
      free_bytes: free,
      available_bytes: available,
    };
  } catch {
    return {
      path,
      total_bytes: null,
      free_bytes: null,
      available_bytes: null,
    };
  }
};

const copyDirectory = (source: string, target: string): void => {
  const entries = readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = resolve(source, entry.name);
    const to = resolve(target, entry.name);
    if (entry.isDirectory()) {
      if (!existsSync(to)) {
        mkdirSync(to, { recursive: true });
      }
      copyDirectory(from, to);
    } else if (entry.isFile()) {
      const buffer = readFileSync(from);
      writeFileSync(to, buffer);
    }
  }
};

export const deriveRecommendationVramGb = (gpus: GpuInfo[]): number => {
  if (gpus.length === 0) return 0;
  return gpus.reduce((sum, gpu) => {
    const gb =
      gpu.memory_total_mb > 0
        ? gpu.memory_total_mb / 1024
        : gpu.memory_total > 0
          ? gpu.memory_total / 1024 ** 3
          : 0;
    return sum + gb;
  }, 0);
};

const parseOptionalStringUpdate = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw badRequest("Expected string or null");
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseUiPreferencesUpdate = (value: unknown): Record<string, string> | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("ui_preferences must be an object or null");
  }
  const clean: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key) continue;
    if (typeof entry !== "string") {
      throw badRequest("ui_preferences values must be strings");
    }
    clean[key] = entry;
  }
  return clean;
};

export const registerStudioRoutes = (app: Hono, context: AppContext): void => {
  const buildSettingsPayload = (): {
    config_path: string;
    persisted: {
      models_dir: string | undefined;
      ui_preferences: Record<string, string>;
    };
    effective: {
      models_dir: string;
    };
  } => {
    const persisted = loadPersistedConfig(context.config.data_dir);
    const dbUiPreferences = context.stores.controllerSettingsStore.getUiPreferences();
    const uiPreferences =
      Object.keys(dbUiPreferences).length > 0
        ? dbUiPreferences
        : persisted.ui_preferences && typeof persisted.ui_preferences === "object"
          ? persisted.ui_preferences
          : {};
    if (Object.keys(dbUiPreferences).length === 0 && Object.keys(uiPreferences).length > 0) {
      context.stores.controllerSettingsStore.saveUiPreferences(uiPreferences);
    }
    return {
      config_path: getPersistedConfigPath(context.config.data_dir),
      persisted: {
        models_dir: persisted.models_dir,
        ui_preferences: uiPreferences,
      },
      effective: {
        models_dir: context.config.models_dir,
      },
    };
  };

  app.get("/studio/settings", async (ctx) => {
    return ctx.json(buildSettingsPayload());
  });

  app.post("/studio/settings", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    if (body && typeof body !== "object") {
      throw badRequest("Invalid payload");
    }

    const modelsDirectory = parseOptionalStringUpdate(body?.models_dir);
    const uiPreferences = parseUiPreferencesUpdate(body?.ui_preferences);

    const hasAnyUpdate = modelsDirectory !== undefined || uiPreferences !== undefined;

    if (!hasAnyUpdate) {
      throw badRequest("No supported settings provided");
    }

    const saved = savePersistedConfig(context.config.data_dir, {
      ...(modelsDirectory !== undefined ? { models_dir: modelsDirectory } : {}),
      ...(uiPreferences !== undefined ? { ui_preferences: uiPreferences } : {}),
    });

    if (uiPreferences !== undefined) {
      context.stores.controllerSettingsStore.saveUiPreferences(uiPreferences ?? {});
    }

    if (saved.models_dir) {
      context.config.models_dir = resolve(saved.models_dir);
    }

    return ctx.json({
      success: true,
      ...buildSettingsPayload(),
    });
  });

  app.get("/studio/diagnostics", async (ctx) => {
    const cpuList = cpus();
    const cpuModel = cpuList[0]?.model ?? null;
    const gpus = getGpuInfo();
    const runtime = await getVllmRuntimeInfo();
    const disks = [getDiskInfo(context.config.data_dir), getDiskInfo(context.config.models_dir)];
    return ctx.json({
      app_version: process.env["VLLM_STUDIO_VERSION"] ?? "dev",
      timestamp: new Date().toISOString(),
      platform: platform(),
      arch: arch(),
      release: release(),
      cpu_model: cpuModel,
      cpu_cores: cpuList.length,
      memory_total: totalmem(),
      memory_free: freemem(),
      gpus,
      runtime: {
        vllm_installed: runtime.installed,
        vllm_version: runtime.version,
        python_path: runtime.python_path,
        vllm_bin: runtime.vllm_bin,
      },
      disks,
      config: {
        host: context.config.host,
        port: context.config.port,
        inference_port: context.config.inference_port,
        api_key_configured: Boolean(context.config.api_key),
        models_dir: context.config.models_dir,
        data_dir: context.config.data_dir,
        db_path: context.config.db_path,
        sglang_python: context.config.sglang_python ?? null,
        tabby_api_dir: context.config.tabby_api_dir ?? null,
        llama_bin: context.config.llama_bin ?? null,
        mlx_python: context.config.mlx_python ?? null,
      },
    });
  });

  app.get("/studio/storage", async (ctx) => {
    const modelRoots = [context.config.models_dir];
    const directories = discoverModelDirectories(modelRoots, 2, 200);
    const sizes = directories.map((directory) => estimateWeightsSizeBytes(directory, false) ?? 0);
    const totalModelBytes = sizes.reduce((total, value) => total + value, 0);
    return ctx.json({
      models_dir: context.config.models_dir,
      model_count: directories.length,
      model_bytes: totalModelBytes,
      disk: getDiskInfo(context.config.models_dir),
    });
  });

  app.get("/studio/recommendations", async (ctx) => {
    const gpus = getGpuInfo();
    const maxVramGb = deriveRecommendationVramGb(gpus);
    const recommendations = STUDIO_MODEL_RECOMMENDATIONS.filter((model) => {
      if (!model.min_vram_gb) return true;
      if (maxVramGb === 0) {
        return model.min_vram_gb <= 8;
      }
      return model.min_vram_gb <= maxVramGb;
    });
    return ctx.json({ recommendations, max_vram_gb: maxVramGb });
  });

  app.post("/studio/models/delete", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    if (body && typeof body !== "object") {
      throw badRequest("Invalid payload");
    }
    const target = typeof body?.path === "string" ? body.path : "";
    if (!target) {
      throw badRequest("path is required");
    }
    const resolved = resolve(target);
    const modelsRoot = resolve(context.config.models_dir);
    const rootPrefix = modelsRoot.endsWith(sep) ? modelsRoot : modelsRoot + sep;
    if (!resolved.startsWith(rootPrefix)) {
      throw badRequest("path must be inside models_dir");
    }
    if (!existsSync(resolved)) {
      throw notFound("Model path not found");
    }
    rmSync(resolved, { recursive: true, force: true });
    return ctx.json({ success: true });
  });

  app.post("/studio/models/move", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    if (body && typeof body !== "object") {
      throw badRequest("Invalid payload");
    }
    const source = typeof body?.source_path === "string" ? body.source_path : "";
    const targetRoot = typeof body?.target_root === "string" ? body.target_root : "";
    if (!source || !targetRoot) {
      throw badRequest("source_path and target_root are required");
    }
    const resolvedSource = resolve(source);
    const resolvedTargetRoot = resolve(targetRoot);
    const modelsRoot = resolve(context.config.models_dir);
    const rootPrefix = modelsRoot.endsWith(sep) ? modelsRoot : modelsRoot + sep;
    if (!resolvedSource.startsWith(rootPrefix)) {
      throw badRequest("source_path must be inside models_dir");
    }
    if (!resolvedTargetRoot.startsWith(rootPrefix) && resolvedTargetRoot !== modelsRoot) {
      throw badRequest("target_root must be inside models_dir");
    }
    if (!existsSync(resolvedSource)) {
      throw notFound("source_path not found");
    }
    if (!existsSync(resolvedTargetRoot)) {
      mkdirSync(resolvedTargetRoot, { recursive: true });
    }
    const target = resolve(resolvedTargetRoot, basename(resolvedSource));
    if (existsSync(target)) {
      throw badRequest("Target path already exists");
    }
    if (resolvedSource === target) {
      return ctx.json({ success: true, target });
    }
    try {
      renameSync(resolvedSource, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EXDEV") {
        mkdirSync(target, { recursive: true });
        copyDirectory(resolvedSource, target);
        rmSync(resolvedSource, { recursive: true, force: true });
      } else {
        throw error;
      }
    }
    return ctx.json({ success: true, target });
  });

  app.get("/studio/providers", async (ctx) => {
    const providers = context.config.providers.map((p) => ({
      id: p.id,
      name: p.name,
      base_url: p.base_url,
      enabled: p.enabled,
      has_api_key: Boolean(p.api_key),
    }));
    return ctx.json({ providers });
  });

  app.post("/studio/providers", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    if (!body || typeof body !== "object") throw badRequest("Invalid payload");

    const id = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const baseUrl = typeof body.base_url === "string" ? body.base_url.trim() : "";
    const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;

    if (!id) throw badRequest("id is required");
    if (!name) throw badRequest("name is required");
    if (!baseUrl) throw badRequest("base_url is required");

    const existing = context.config.providers.find((p) => p.id === id);
    if (existing) throw badRequest(`Provider "${id}" already exists`);

    const provider: ProviderConfig = { id, name, base_url: baseUrl, api_key: apiKey, enabled };
    const providers = [...context.config.providers, provider];
    savePersistedConfig(context.config.data_dir, { providers });
    context.config.providers = providers;

    return ctx.json({
      success: true,
      provider: { id, name, base_url: baseUrl, enabled, has_api_key: Boolean(apiKey) },
    });
  });

  app.put("/studio/providers/:id", async (ctx) => {
    const providerId = ctx.req.param("id");
    const body = await ctx.req.json().catch(() => ({}));
    if (!body || typeof body !== "object") throw badRequest("Invalid payload");

    const index = context.config.providers.findIndex((p) => p.id === providerId);
    if (index < 0) throw notFound(`Provider "${providerId}" not found`);

    const current = context.config.providers[index];
    if (!current) throw notFound(`Provider "${providerId}" not found`);

    const name = typeof body.name === "string" ? body.name.trim() : current.name;
    const baseUrl = typeof body.base_url === "string" ? body.base_url.trim() : current.base_url;
    const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : current.api_key;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : current.enabled;

    const updated: ProviderConfig = {
      id: providerId,
      name,
      base_url: baseUrl,
      api_key: apiKey,
      enabled,
    };
    const providers = [...context.config.providers];
    providers[index] = updated;
    savePersistedConfig(context.config.data_dir, { providers });
    context.config.providers = providers;

    return ctx.json({
      success: true,
      provider: { id: providerId, name, base_url: baseUrl, enabled, has_api_key: Boolean(apiKey) },
    });
  });

  app.delete("/studio/providers/:id", async (ctx) => {
    const providerId = ctx.req.param("id");
    const index = context.config.providers.findIndex((p) => p.id === providerId);
    if (index < 0) throw notFound(`Provider "${providerId}" not found`);

    const providers = context.config.providers.filter((p) => p.id !== providerId);
    savePersistedConfig(context.config.data_dir, { providers });
    context.config.providers = providers;

    return ctx.json({ success: true });
  });

  // Fetch models from all configured providers
  app.get("/studio/provider-models", async (ctx) => {
    const enabledProviders = context.config.providers.filter((p) => p.enabled && p.api_key);
    const results: Array<{ provider: string; models: Array<{ id: string; name?: string }> }> = [];

    await Promise.all(
      enabledProviders.map(async (provider) => {
        try {
          const url = `${provider.base_url.replace(/\/+$/, "")}/v1/models`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${provider.api_key}` },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return;
          const data = (await res.json()) as { data?: Array<{ id?: string }> };
          const models = (data.data ?? [])
            .filter((m) => typeof m.id === "string" && m.id.length > 0)
            .map((m) => ({ id: m.id as string }));
          results.push({ provider: provider.id, models });
        } catch {
          // skip unreachable providers
        }
      })
    );

    return ctx.json({ providers: results });
  });
};
