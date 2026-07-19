import { cp, mkdir, rename, rm, statfs } from "node:fs/promises";
import { cpus, freemem, totalmem, platform, arch, release } from "node:os";
import { basename, resolve, sep } from "node:path";
import { Effect, Schema } from "effect";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import type { RouteRegistrar } from "../../http/route-registrar";
import { registerStudioProviderRoutes } from "./provider-routes";
import { registerStudioRigRoutes } from "./rig-routes";
import { getGpuInfo } from "../system/platform/gpu";
import type { GpuInfo } from "../models/types";
import { discoverModelDirectories, estimateWeightsSizeBytes } from "../models/model-browser";
import { STUDIO_MODEL_RECOMMENDATIONS, STUDIO_STARTER_PRESETS } from "./configs";
import {
  getPersistedConfigPath,
  loadPersistedConfig,
  savePersistedConfig,
  type PersistedConfig,
} from "../../config/persisted-config";
import { getVllmRuntimeInfo } from "../engines/runtimes/vllm-runtime";

const SettingsUpdateSchema = Schema.Struct({
  models_dir: Schema.optional(Schema.NullOr(Schema.String)),
  ui_preferences: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
});

const ModelDeleteSchema = Schema.Struct({ path: Schema.String });
const ModelMoveSchema = Schema.Struct({ source_path: Schema.String, target_root: Schema.String });

class StudioOperationError extends Schema.TaggedErrorClass<StudioOperationError>()(
  "StudioOperationError",
  {
    operation: Schema.Literals(["disk", "settings", "delete", "move"]),
    message: Schema.String,
    source: Schema.optional(Schema.Unknown),
  },
) {}

interface StudioDiskInfo {
  path: string;
  total_bytes: number | null;
  free_bytes: number | null;
  available_bytes: number | null;
}

const diskInfo = (path: string): Effect.Effect<StudioDiskInfo> =>
  Effect.tryPromise({
    try: () => statfs(path),
    catch: (source) =>
      new StudioOperationError({ operation: "disk", message: "Disk unavailable", source }),
  }).pipe(
    Effect.map((stats) => ({
      path,
      total_bytes: stats.blocks * stats.bsize,
      free_bytes: stats.bfree * stats.bsize,
      available_bytes: stats.bavail * stats.bsize,
    })),
    Effect.catchTag("StudioOperationError", () =>
      Effect.succeed({ path, total_bytes: null, free_bytes: null, available_bytes: null }),
    ),
  );

const insideModelsRoot = (
  modelsDirectory: string,
  target: string,
  label: string,
  allowRoot = false,
): Effect.Effect<string, ReturnType<typeof badRequest>> => {
  const resolved = resolve(target);
  const modelsRoot = resolve(modelsDirectory);
  const rootPrefix = modelsRoot.endsWith(sep) ? modelsRoot : `${modelsRoot}${sep}`;
  return resolved.startsWith(rootPrefix) || (allowRoot && resolved === modelsRoot)
    ? Effect.succeed(resolved)
    : Effect.fail(badRequest(`${label} must be inside models_dir`));
};

const pathExists = (path: string): Effect.Effect<boolean> =>
  Effect.tryPromise({ try: () => statfs(path), catch: (source) => source }).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );

const normalizedOptionalString = (value: string | null | undefined): string | null | undefined => {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const deriveRecommendationVramGb = (gpus: GpuInfo[]): number =>
  gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb / 1024, 0);

export const registerStudioRoutes: RouteRegistrar = (app, context) => {
  const buildSettingsPayload = Effect.gen(function* () {
    const persisted = yield* Effect.try({
      try: () => loadPersistedConfig(context.config.data_dir),
      catch: (source) =>
        new StudioOperationError({
          operation: "settings",
          message: "Could not load settings",
          source,
        }),
    });
    const legacyUiPreferences = (
      persisted as PersistedConfig & { ui_preferences?: Record<string, string> }
    ).ui_preferences;
    const dbUiPreferences = yield* context.stores.controllerSettingsStore.getUiPreferencesEffect();
    const uiPreferences =
      Object.keys(dbUiPreferences).length > 0
        ? dbUiPreferences
        : legacyUiPreferences && typeof legacyUiPreferences === "object"
          ? legacyUiPreferences
          : {};
    if (Object.keys(dbUiPreferences).length === 0 && Object.keys(uiPreferences).length > 0) {
      yield* context.stores.controllerSettingsStore.saveUiPreferencesEffect(uiPreferences);
    }
    return {
      config_path: getPersistedConfigPath(context.config.data_dir),
      persisted: { models_dir: persisted.models_dir, ui_preferences: uiPreferences },
      effective: { models_dir: context.config.models_dir },
    };
  });

  app.get(
    "/studio/settings",
    effectHandler((ctx) => buildSettingsPayload.pipe(Effect.map((payload) => ctx.json(payload)))),
  );

  app.post(
    "/studio/settings",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, SettingsUpdateSchema);
        const modelsDirectory = normalizedOptionalString(body.models_dir);
        const uiPreferences = body.ui_preferences;
        if (modelsDirectory === undefined && uiPreferences === undefined) {
          return yield* Effect.fail(badRequest("No supported settings provided"));
        }
        const saved = yield* Effect.try({
          try: () =>
            modelsDirectory !== undefined
              ? savePersistedConfig(context.config.data_dir, { models_dir: modelsDirectory })
              : loadPersistedConfig(context.config.data_dir),
          catch: (source) =>
            new StudioOperationError({
              operation: "settings",
              message: "Could not save settings",
              source,
            }),
        });
        if (uiPreferences !== undefined) {
          yield* context.stores.controllerSettingsStore.saveUiPreferencesEffect(
            uiPreferences ?? {},
          );
        }
        if (saved.models_dir) context.config.models_dir = resolve(saved.models_dir);
        const payload = yield* buildSettingsPayload;
        return ctx.json({ success: true, ...payload });
      }),
    ),
  );

  app.get(
    "/studio/diagnostics",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const cpuList = cpus();
        const [gpus, runtime, disks] = yield* Effect.all([
          getGpuInfo(),
          getVllmRuntimeInfo(),
          Effect.all([diskInfo(context.config.data_dir), diskInfo(context.config.models_dir)]),
        ]);
        return ctx.json({
          app_version: process.env["LOCAL_STUDIO_VERSION"] ?? "dev",
          timestamp: new Date().toISOString(),
          platform: platform(),
          arch: arch(),
          release: release(),
          cpu_model: cpuList[0]?.model ?? null,
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
            llama_bin: context.config.llama_bin ?? null,
            mlx_python: context.config.mlx_python ?? null,
          },
        });
      }),
    ),
  );

  app.get(
    "/studio/storage",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const directories = yield* discoverModelDirectories([context.config.models_dir], 2, 200);
        const sizes = yield* Effect.forEach(
          directories,
          (directory) =>
            estimateWeightsSizeBytes(directory, false).pipe(
              Effect.map((size) => size ?? 0),
              Effect.orElseSucceed(() => 0),
            ),
          { concurrency: "unbounded" },
        );
        return ctx.json({
          models_dir: context.config.models_dir,
          model_count: directories.length,
          model_bytes: sizes.reduce((total, value) => total + value, 0),
          disk: yield* diskInfo(context.config.models_dir),
        });
      }),
    ),
  );

  app.get(
    "/studio/recommendations",
    effectHandler((ctx) =>
      getGpuInfo().pipe(
        Effect.map((gpus) => {
          const maxVramGb = deriveRecommendationVramGb(gpus);
          const recommendations = STUDIO_MODEL_RECOMMENDATIONS.filter(
            (model) =>
              !model.min_vram_gb ||
              (maxVramGb === 0 ? model.min_vram_gb <= 8 : model.min_vram_gb <= maxVramGb),
          );
          return ctx.json({ recommendations, max_vram_gb: maxVramGb });
        }),
      ),
    ),
  );

  app.get(
    "/studio/presets",
    effectHandler((ctx) =>
      getGpuInfo().pipe(
        Effect.map((gpus) => {
          const maxVramGb = deriveRecommendationVramGb(gpus);
          const presets = STUDIO_STARTER_PRESETS.map((preset) => ({
            ...preset,
            fits: preset.min_vram_gb === null || maxVramGb === 0 || preset.min_vram_gb <= maxVramGb,
          }));
          return ctx.json({ presets, max_vram_gb: maxVramGb });
        }),
      ),
    ),
  );

  app.post(
    "/studio/models/delete",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, ModelDeleteSchema);
        if (!body.path.trim()) return yield* Effect.fail(badRequest("path is required"));
        const target = yield* insideModelsRoot(context.config.models_dir, body.path, "path");
        if (!(yield* pathExists(target)))
          return yield* Effect.fail(notFound("Model path not found"));
        yield* Effect.tryPromise({
          try: () => rm(target, { recursive: true, force: true }),
          catch: (source) =>
            new StudioOperationError({
              operation: "delete",
              message: "Could not delete model",
              source,
            }),
        });
        return ctx.json({ success: true });
      }),
    ),
  );

  app.post(
    "/studio/models/move",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, ModelMoveSchema);
        if (!body.source_path.trim() || !body.target_root.trim()) {
          return yield* Effect.fail(badRequest("source_path and target_root are required"));
        }
        const source = yield* insideModelsRoot(
          context.config.models_dir,
          body.source_path,
          "source_path",
        );
        const targetRoot = yield* insideModelsRoot(
          context.config.models_dir,
          body.target_root,
          "target_root",
          true,
        );
        if (!(yield* pathExists(source)))
          return yield* Effect.fail(notFound("source_path not found"));
        yield* Effect.tryPromise({
          try: () => mkdir(targetRoot, { recursive: true }),
          catch: (sourceError) =>
            new StudioOperationError({
              operation: "move",
              message: "Could not create target",
              source: sourceError,
            }),
        });
        const target = resolve(targetRoot, basename(source));
        if (yield* pathExists(target))
          return yield* Effect.fail(badRequest("Target path already exists"));
        if (source !== target) {
          yield* Effect.tryPromise({
            try: () => rename(source, target),
            catch: (sourceError) => sourceError,
          }).pipe(
            Effect.catch((sourceError) =>
              (sourceError as NodeJS.ErrnoException).code === "EXDEV"
                ? Effect.tryPromise({
                    try: () =>
                      cp(source, target, { recursive: true, force: false, errorOnExist: true }),
                    catch: (copyError) => copyError,
                  }).pipe(
                    Effect.andThen(
                      Effect.tryPromise({
                        try: () => rm(source, { recursive: true, force: true }),
                        catch: (removeError) => removeError,
                      }),
                    ),
                  )
                : Effect.fail(sourceError),
            ),
            Effect.mapError(
              (sourceError) =>
                new StudioOperationError({
                  operation: "move",
                  message: "Could not move model",
                  source: sourceError,
                }),
            ),
          );
        }
        return ctx.json({ success: true, target });
      }),
    ),
  );

  registerStudioProviderRoutes(app, context);
  registerStudioRigRoutes(app, context);
};
