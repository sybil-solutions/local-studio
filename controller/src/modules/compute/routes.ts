import { Effect, Schema } from "effect";
import { badRequest, HttpStatus, notFound, serviceUnavailable } from "../../core/errors";
import { readBoundedRequestBody } from "../../http/bounded-body";
import { defineRoutes, effectRoute, mergeRoutes } from "../../http/route-registrar";
import { ENGINE_IDS, type EngineId, type ServingOptions } from "./contracts";
import { availableEngines } from "./engines/registry";
import { toHttp } from "./failures";
import { formatLaunchFailureBudgetMessage } from "./launch-failure-budget";

const LAUNCH_REQUEST_LIMIT = 64 * 1024;

const OptionsSchema = Schema.Struct({
  tensorParallel: Schema.optional(Schema.Number),
  pipelineParallel: Schema.optional(Schema.Number),
  maxContextLength: Schema.optional(Schema.Number),
  memoryFraction: Schema.optional(Schema.Number),
  maxConcurrentRequests: Schema.optional(Schema.Number),
  kvCacheDtype: Schema.optional(Schema.String),
  dtype: Schema.optional(Schema.String),
  quantization: Schema.optional(Schema.String),
  trustRemoteCode: Schema.optional(Schema.Boolean),
  toolCallParser: Schema.optional(Schema.String),
  reasoningParser: Schema.optional(Schema.String),
});

const LaunchRequestSchema = Schema.Struct({
  name: Schema.String,
  engine: Schema.Literals(ENGINE_IDS as unknown as [EngineId, ...EngineId[]]),
  modelPath: Schema.String,
  recipeId: Schema.optional(Schema.String),
  deviceCount: Schema.optional(Schema.Number),
  servedModelName: Schema.optional(Schema.String),
  options: Schema.optional(OptionsSchema),
  extraArgs: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  dockerImage: Schema.optional(Schema.String),
});

/** Optional-schema fields decode as `key: undefined`; spreading those over the defaults
 *  would erase them, so undefined entries are dropped before the merge. */
const mergeOptions = (
  overrides: Partial<Record<keyof ServingOptions, ServingOptions[keyof ServingOptions] | undefined>>,
): ServingOptions => {
  const merged: Record<string, unknown> = { ...defaultOptions };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as ServingOptions;
};

const defaultOptions: ServingOptions = {
  tensorParallel: 1,
  pipelineParallel: 1,
  maxContextLength: 8192,
  memoryFraction: 0.9,
  maxConcurrentRequests: 64,
  kvCacheDtype: null,
  dtype: null,
  quantization: null,
  trustRemoteCode: false,
  toolCallParser: null,
  reasoningParser: null,
};

export const registerComputeRoutes = defineRoutes((app, context) =>
  mergeRoutes(
    effectRoute(app.get, "/compute/devices", (ctx) =>
      context.compute.telemetry.snapshot().pipe(Effect.map((snapshot) => ctx.json(snapshot))),
    ),

    effectRoute(app.get, "/compute/engines", (ctx) =>
      context.compute
        .host()
        .pipe(Effect.map((host) => ctx.json({ host, engines: availableEngines(host) }))),
    ),

    effectRoute(app.get, "/compute/instances", (ctx) =>
      context.compute.service
        .instances()
        .pipe(Effect.map((views) => ctx.json({ instances: views }))),
    ),

    effectRoute(app.post, "/compute/launch", (ctx) =>
      Effect.gen(function* () {
        const bytes = yield* readBoundedRequestBody(ctx.req.raw, LAUNCH_REQUEST_LIMIT).pipe(
          Effect.mapError(() => badRequest("unreadable launch request")),
        );
        const parsed = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(LaunchRequestSchema),
        )(new TextDecoder().decode(bytes)).pipe(
          Effect.mapError((error) => badRequest(`invalid launch request: ${String(error)}`)),
        );
        const record = yield* context.compute.service
          .launch({
            name: parsed.name,
            engine: parsed.engine,
            recipeId: parsed.recipeId ?? parsed.name,
            runtime: "docker",
            deviceCount: parsed.deviceCount ?? 1,
            modelPath: parsed.modelPath,
            servedModelName: parsed.servedModelName ?? parsed.name,
            options: mergeOptions(parsed.options ?? {}),
            extraArgs: parsed.extraArgs ?? [],
            env: parsed.env ?? {},
            dockerImage: parsed.dockerImage ?? null,
          })
          .pipe(Effect.mapError(toHttp));
        return ctx.json({ instance: record });
      }),
    ),

    effectRoute(app.post, "/compute/instances/:name/stop", (ctx) =>
      context.compute.service
        .stop(ctx.req.param("name") ?? "")
        .pipe(Effect.map((stopped) => ctx.json({ stopped }))),
    ),

    effectRoute(app.post, "/compute/instances/:name/cancel", (ctx) =>
      context.compute.service
        .cancel(ctx.req.param("name") ?? "")
        .pipe(Effect.map((cancelled) => ctx.json({ cancelled }))),
    ),

    /* ── one-active-model lifecycle, legacy wire shapes preserved ──────────── */

    effectRoute(app.post, "/launch/:recipeId", (ctx) =>
      Effect.gen(function* () {
        const recipeId = ctx.req.param("recipeId") ?? "";
        const recipe = yield* context.stores.recipeStore.get(recipeId);
        if (!recipe) return yield* Effect.fail(notFound("Recipe not found"));
        const blocked = context.launchFailureBudget.isBlocked(recipeId);
        if (blocked) {
          return yield* Effect.fail(
            new HttpStatus({ status: 429, detail: formatLaunchFailureBudgetMessage(blocked) }),
          );
        }
        yield* context.compute.model.launchRecipe(recipe).pipe(
          Effect.mapError((failure) => {
            if (failure.kind !== "already-running" && failure.kind !== "cancelled") {
              context.launchFailureBudget.recordFailure(recipeId);
            }
            return toHttp(failure);
          }),
        );
        context.launchFailureBudget.reset(recipeId);
        return ctx.json({ success: true, message: "Launch started" });
      }),
    ),

    effectRoute(app.post, "/launch/:recipeId/cancel", (ctx) =>
      Effect.gen(function* () {
        const recipeId = ctx.req.param("recipeId") ?? "";
        const cancelled = yield* context.compute.model.cancelLaunch();
        if (!cancelled) {
          return yield* Effect.fail(notFound(`No launch in progress for ${recipeId}`));
        }
        return ctx.json({ success: true, message: `Launch of ${recipeId} cancelled` });
      }),
    ),

    effectRoute(app.post, "/evict", (ctx) =>
      Effect.gen(function* () {
        yield* context.compute.model
          .evict()
          .pipe(
            Effect.mapError((error) => serviceUnavailable(`Failed to evict: ${String(error)}`)),
          );
        return ctx.json({ success: true, evicted_pid: null });
      }),
    ),

    effectRoute(app.get, "/wait-ready", (ctx) =>
      Effect.gen(function* () {
        const timeout = Number(ctx.req.query("timeout") ?? 300);
        const start = Date.now();
        if (yield* context.compute.model.waitForHealthy(timeout * 1000)) {
          return ctx.json({ ready: true, elapsed: Math.floor((Date.now() - start) / 1000) });
        }
        return ctx.json({ ready: false, elapsed: timeout, error: "Timeout waiting for backend" });
      }),
    ),
  ),
);
