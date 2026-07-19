import { connect } from "node:net";
import { hostname } from "node:os";
import { access, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Effect, Schema } from "effect";
import type { RouteRegistrar } from "../../http/route-registrar";
import type { SystemConfigResponse } from "../models/types";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { findObservedInferenceProcess } from "../../core/function-observability";
import { estimateWeightsSizeBytes } from "../models/model-browser";
import { getGpuInfo } from "./platform/gpu";
import { getSystemRuntimeInfo } from "../engines/runtimes/runtime-info";
import { buildCompatibilityReport } from "./platform/compatibility-report";
import { registerMonitoringRoutes } from "./metrics-routes";
import { registerLogsRoutes } from "./logs-routes";
import { registerUsageRoutes } from "./usage-routes";
const SYSTEM_SERVICE_CHECK_HOST = "127.0.0.1";
const SYSTEM_COMPAT_SERVICE_CHECK_TIMEOUT_MS = 500;
const SYSTEM_DEFAULT_SERVICE_CHECK_TIMEOUT_MS = 1_000;
const PositiveNumberSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThan(0)),
);
const PositiveIntegerSchema = PositiveNumberSchema.pipe(Schema.check(Schema.isInt()));
const ModelDimensionSchema = Schema.Union([Schema.Number, Schema.NumberFromString]).pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThan(0)),
);
const VramCalculatorBodySchema = Schema.Struct({
  model: Schema.String,
  context_length: PositiveNumberSchema,
  tp_size: Schema.optionalKey(PositiveIntegerSchema),
  kv_dtype: Schema.optionalKey(Schema.String),
});
const ModelConfigSchema = Schema.Struct({
  num_hidden_layers: Schema.optionalKey(ModelDimensionSchema),
  n_layer: Schema.optionalKey(ModelDimensionSchema),
  num_layers: Schema.optionalKey(ModelDimensionSchema),
  hidden_size: Schema.optionalKey(ModelDimensionSchema),
  n_embd: Schema.optionalKey(ModelDimensionSchema),
  d_model: Schema.optionalKey(ModelDimensionSchema),
  dim: Schema.optionalKey(ModelDimensionSchema),
  num_attention_heads: Schema.optionalKey(ModelDimensionSchema),
  n_head: Schema.optionalKey(ModelDimensionSchema),
  num_heads: Schema.optionalKey(ModelDimensionSchema),
  num_key_value_heads: Schema.optionalKey(ModelDimensionSchema),
  num_kv_heads: Schema.optionalKey(ModelDimensionSchema),
  head_dim: Schema.optionalKey(ModelDimensionSchema),
});

export const registerSystemRoutes: RouteRegistrar = (app, context) => {
  const checkService = (
    host: string,
    port: number,
    timeoutMs = SYSTEM_DEFAULT_SERVICE_CHECK_TIMEOUT_MS,
  ): Effect.Effect<boolean> =>
    Effect.callback<boolean>((resume, signal) => {
      const socket = connect({ port, host });
      let settled = false;
      const cleanup = (): void => {
        socket.removeListener("connect", onConnect);
        socket.removeListener("timeout", onTimeout);
        socket.removeListener("error", onError);
        signal.removeEventListener("abort", onAbort);
        socket.destroy();
      };
      const finalize = (result: boolean): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resume(Effect.succeed(result));
      };
      const onConnect = (): void => finalize(true);
      const onTimeout = (): void => finalize(false);
      const onError = (): void => finalize(false);
      const onAbort = (): void => finalize(false);

      socket.setTimeout(timeoutMs);
      socket.once("connect", onConnect);
      socket.once("timeout", onTimeout);
      socket.once("error", onError);
      signal.addEventListener("abort", onAbort, { once: true });
      return Effect.sync(cleanup);
    });

  app.get(
    "/status",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const current = yield* findObservedInferenceProcess(context, "status");
        return ctx.json({
          running: Boolean(current),
          process: current,
          inference_port: context.config.inference_port,
          launching: context.launchState.getLaunchingRecipeId(),
          launch_failures: context.launchFailureBudget.listActive(),
        });
      }),
    ),
  );

  app.get(
    "/gpus",
    effectHandler((ctx) =>
      getGpuInfo().pipe(Effect.map((gpus) => ctx.json({ count: gpus.length, gpus }))),
    ),
  );

  app.get(
    "/compat",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const known = yield* findObservedInferenceProcess(context, "compat");
        const runtime = yield* getSystemRuntimeInfo(context.config, known);
        const portOpen = yield* checkService(
          SYSTEM_SERVICE_CHECK_HOST,
          context.config.inference_port,
          SYSTEM_COMPAT_SERVICE_CHECK_TIMEOUT_MS,
        );
        return ctx.json(
          buildCompatibilityReport({
            runtime,
            inference_port: context.config.inference_port,
            inference_port_open: portOpen,
            inference_process_known: Boolean(known),
            gpu_monitoring: runtime.gpu_monitoring,
          }),
        );
      }),
    ),
  );

  app.post(
    "/vram-calculator",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, VramCalculatorBodySchema);
        const model = body.model.trim();
        const contextLength = body.context_length;
        const tpSize = body.tp_size ?? 1;
        const kvDtype = body.kv_dtype ?? "auto";

        if (!model) return yield* Effect.fail(badRequest("model is required"));

        const resolved = resolve(model);
        const modelsRoot = resolve(context.config.models_dir);
        const rootPrefix = modelsRoot.endsWith(sep) ? modelsRoot : modelsRoot + sep;
        if (!resolved.startsWith(rootPrefix)) {
          return yield* Effect.fail(badRequest("model must be inside models_dir"));
        }
        const modelExists = yield* Effect.tryPromise({
          try: () => access(resolved),
          catch: (error) => error,
        }).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );
        if (!modelExists) return yield* Effect.fail(notFound("Model path not found"));

        const weightsBytes = yield* estimateWeightsSizeBytes(resolved, false);
        if (!weightsBytes || weightsBytes <= 0) {
          return yield* Effect.fail(notFound("Model weights not found"));
        }

        const configPath = join(resolved, "config.json");
        const config = yield* Effect.tryPromise({
          try: () => readFile(configPath, "utf-8"),
          catch: (error) => error,
        }).pipe(
          Effect.flatMap((raw) =>
            Effect.try({
              try: () => JSON.parse(raw) as unknown,
              catch: (error) => error,
            }),
          ),
          Effect.flatMap((value) => Schema.decodeUnknownEffect(ModelConfigSchema)(value)),
          Effect.catch(() => Schema.decodeUnknownEffect(ModelConfigSchema)({})),
        );
        const layerCount = config.num_hidden_layers ?? config.n_layer ?? config.num_layers;
        const hiddenSize = config.hidden_size ?? config.n_embd ?? config.d_model ?? config.dim;
        const headCount = config.num_attention_heads ?? config.n_head ?? config.num_heads;
        const keyValueHeadCount = config.num_key_value_heads ?? config.num_kv_heads ?? headCount;
        const headDim =
          config.head_dim ?? (hiddenSize && headCount ? hiddenSize / headCount : undefined);

        const kvBytesPerValue = kvDtype.toLowerCase() === "fp8" ? 1 : 2;
        let kvCacheBytes = 0;
        if (layerCount && keyValueHeadCount && headDim) {
          kvCacheBytes =
            contextLength * layerCount * keyValueHeadCount * headDim * 2 * kvBytesPerValue;
        }

        const weightsTotalGb = weightsBytes / 1024 ** 3;
        const weightsPerGpuGb = weightsTotalGb / tpSize;
        const kvCachePerGpuGb = kvCacheBytes > 0 ? kvCacheBytes / 1024 ** 3 / tpSize : 0;
        const activationsPerGpuGb = Math.max(0.5, weightsPerGpuGb * 0.1);
        const overheadPerGpuGb = 2.0;
        const perGpuGb = weightsPerGpuGb + kvCachePerGpuGb + activationsPerGpuGb + overheadPerGpuGb;
        const totalGb = perGpuGb * tpSize;

        const gpus = yield* getGpuInfo();
        let perGpuCapacityGb = 0;
        if (gpus.length >= tpSize && tpSize > 0) {
          const candidates = gpus.slice(0, tpSize).map((gpu) => gpu.memory_total_mb / 1024);
          perGpuCapacityGb = Math.min(...candidates);
        }

        const fits = perGpuCapacityGb > 0 ? perGpuGb <= perGpuCapacityGb : true;
        const utilizationPercent = perGpuCapacityGb > 0 ? (perGpuGb / perGpuCapacityGb) * 100 : 0;

        return ctx.json({
          model_size_gb: weightsTotalGb,
          context_memory_gb: kvCachePerGpuGb * tpSize,
          overhead_gb: overheadPerGpuGb,
          total_gb: totalGb,
          fits_in_vram: fits,
          fits,
          utilization_percent: utilizationPercent,
          breakdown: {
            model_weights_gb: weightsPerGpuGb,
            kv_cache_gb: kvCachePerGpuGb,
            activations_gb: activationsPerGpuGb,
            per_gpu_gb: perGpuGb,
            total_gb: totalGb,
          },
        });
      }),
    ),
  );

  app.get(
    "/config",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const services: Array<{
          name: string;
          port: number;
          internal_port: number;
          protocol: string;
          status: string;
          description?: string | null;
        }> = [];
        services.push({
          name: "Controller",
          port: context.config.port,
          internal_port: context.config.port,
          protocol: "http",
          status: "running",
          description: "Controller service (Bun/Hono)",
        });

        const current = yield* findObservedInferenceProcess(context, "config");
        const inferenceStatus = current ? "running" : "stopped";

        services.push({
          name: "Inference runtime",
          port: context.config.inference_port,
          internal_port: context.config.inference_port,
          protocol: "http",
          status: inferenceStatus,
          description: "Inference backend (vLLM, SGLang, llama.cpp, or MLX)",
        });

        const frontendReachable = yield* checkService("localhost", 3000);
        services.push({
          name: "Frontend",
          port: 3000,
          internal_port: 3000,
          protocol: "http",
          status: frontendReachable ? "running" : "stopped",
          description: "Next.js web UI",
        });

        const runtime = yield* getSystemRuntimeInfo(context.config, current);

        const payload: SystemConfigResponse = {
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
          services,
          environment: {
            controller_url: `http://${hostname()}:${context.config.port}`,
            inference_url: `http://${hostname()}:${context.config.inference_port}`,
            frontend_url: `http://${hostname()}:3000`,
          },
          runtime,
        };

        return ctx.json(payload);
      }),
    ),
  );

  registerMonitoringRoutes(app, context);
  registerLogsRoutes(app, context);
  registerUsageRoutes(app, context);
};
