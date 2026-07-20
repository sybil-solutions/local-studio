import { Effect, Schema } from "effect";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { getRocmInfo, resolveRocmSmiTool } from "../system/platform/rocm-info";
import { getEngineSpec } from "./engine-spec";
import { createGetObservedProcess } from "./observed-process";
import {
  cancelEngineJob,
  createEngineJob,
  getEngineJob,
  listEngineJobs,
} from "./runtimes/engine-jobs";
import { getCudaInfo } from "./runtimes/runtime-info";
import {
  getDefaultRuntimeTarget,
  getRuntimeTargets,
  runtimeTargetToBackendInfo,
  selectRuntimeTarget,
} from "./runtimes/runtime-targets";
import { getVllmConfigHelp, getVllmRuntimeInfo } from "./runtimes/vllm-runtime";

const RUNTIME_JOB_BACKENDS = ["vllm", "sglang", "llamacpp", "mlx", "cuda", "rocm"] as const;
const RUNTIME_JOB_TYPES = ["install", "update", "download", "inspect"] as const;

type RuntimeJobBody = {
  backend?: (typeof RUNTIME_JOB_BACKENDS)[number];
  targetId?: string;
  type?: (typeof RUNTIME_JOB_TYPES)[number];
  version?: string;
  preferBundled?: boolean;
};

const RuntimeJobBodySchema = Schema.Struct({
  backend: Schema.optional(Schema.Literals(RUNTIME_JOB_BACKENDS)),
  targetId: Schema.optional(Schema.String),
  type: Schema.optional(Schema.Literals(RUNTIME_JOB_TYPES)),
  version: Schema.optional(Schema.String),
  prefer_bundled: Schema.optional(Schema.Boolean),
  command: Schema.optional(Schema.Never),
  args: Schema.optional(Schema.Never),
});

const parseRuntimeJobBody = (
  ctx: Parameters<typeof decodeJsonBody>[0],
): Effect.Effect<RuntimeJobBody, ReturnType<typeof badRequest>> =>
  decodeJsonBody(ctx, RuntimeJobBodySchema).pipe(
    Effect.map((body): RuntimeJobBody => ({
      ...(body.backend ? { backend: body.backend } : {}),
      ...(body.targetId ? { targetId: body.targetId } : {}),
      ...(body.type ? { type: body.type } : {}),
      ...(body.version ? { version: body.version } : {}),
      ...(body.prefer_bundled !== undefined ? { preferBundled: body.prefer_bundled } : {}),
    })),
  );

export const registerRuntimeRoutes = defineRoutes((app, context) => {
  const getObservedProcess = createGetObservedProcess(context);

  return mergeRoutes(
    app.get(
      "/runtime/targets",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const current = yield* getObservedProcess("runtime.targets");
          const targets = yield* getRuntimeTargets(context.config, current);
          return ctx.json({ targets });
        }),
      ),
    ),

    app.post(
      "/runtime/targets/:targetId/select",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const current = yield* getObservedProcess("runtime.target.select");
          const target = yield* selectRuntimeTarget(
            context.config,
            ctx.req.param("targetId") ?? "",
            current,
          );
          return target
            ? ctx.json({ target })
            : yield* Effect.fail(notFound("Runtime target not found"));
        }),
      ),
    ),

    app.post(
      "/runtime/jobs",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* parseRuntimeJobBody(ctx);
          if (!body.backend) return yield* Effect.fail(badRequest("backend is required"));
          const current = yield* getObservedProcess("runtime.jobs");
          const job = yield* createEngineJob(context.config, {
            backend: body.backend,
            type: body.type ?? "update",
            ...(body.targetId ? { targetId: body.targetId } : {}),
            ...(body.version ? { version: body.version } : {}),
            ...(body.preferBundled !== undefined ? { preferBundled: body.preferBundled } : {}),
            runningProcess: current,
          });
          return ctx.json({ job });
        }),
      ),
    ),

    app.get(
      "/runtime/jobs",
      documentRoute,
      effectHandler((ctx) => Effect.sync(() => ctx.json({ jobs: listEngineJobs() }))),
    ),

    app.get(
      "/runtime/jobs/:jobId",
      documentRoute,
      effectHandler((ctx) => {
        const job = getEngineJob(ctx.req.param("jobId") ?? "");
        return job
          ? Effect.succeed(ctx.json({ job }))
          : Effect.fail(notFound("Runtime job not found"));
      }),
    ),

    app.post(
      "/runtime/jobs/:jobId/cancel",
      documentRoute,
      effectHandler((ctx) =>
        cancelEngineJob(ctx.req.param("jobId") ?? "").pipe(
          Effect.flatMap((job) =>
            job
              ? Effect.succeed(ctx.json({ job }))
              : Effect.fail(notFound("Runtime job not found")),
          ),
        ),
      ),
    ),

    app.get(
      "/runtime/vllm",
      documentRoute,
      effectHandler((ctx) => getVllmRuntimeInfo().pipe(Effect.map((info) => ctx.json(info)))),
    ),

    app.get(
      "/runtime/vllm/config",
      documentRoute,
      effectHandler((ctx) => getVllmConfigHelp().pipe(Effect.map((config) => ctx.json(config)))),
    ),

    app.get(
      "/runtime/llamacpp/config",
      documentRoute,
      effectHandler((ctx) => {
        const configHelp = getEngineSpec("llamacpp").getConfigHelp;
        return configHelp
          ? configHelp(context.config).pipe(Effect.map((config) => ctx.json(config)))
          : Effect.fail(notFound("llama.cpp config help not available"));
      }),
    ),

    app.get(
      "/runtime/sglang",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const current = yield* getObservedProcess("runtime.backend.sglang");
          const target = yield* getDefaultRuntimeTarget(context.config, "sglang", current);
          return ctx.json(runtimeTargetToBackendInfo(target));
        }),
      ),
    ),

    app.get(
      "/runtime/llamacpp",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const current = yield* getObservedProcess("runtime.backend.llamacpp");
          const target = yield* getDefaultRuntimeTarget(context.config, "llamacpp", current);
          return ctx.json(runtimeTargetToBackendInfo(target));
        }),
      ),
    ),

    app.get(
      "/runtime/mlx",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const current = yield* getObservedProcess("runtime.backend.mlx");
          const info = yield* getEngineSpec("mlx").getRuntimeInfo!(context.config, current);
          return ctx.json(info);
        }),
      ),
    ),

    app.get(
      "/runtime/cuda",
      documentRoute,
      effectHandler((ctx) => getCudaInfo().pipe(Effect.map((info) => ctx.json(info)))),
    ),

    app.get(
      "/runtime/rocm",
      documentRoute,
      effectHandler((ctx) =>
        getRocmInfo(resolveRocmSmiTool()).pipe(Effect.map((info) => ctx.json(info))),
      ),
    ),

    app.post(
      "/runtime/:backend/upgrade",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const requestedBackend = ctx.req.param("backend");
          const backend = RUNTIME_JOB_BACKENDS.find((value) => value === requestedBackend);
          if (!backend) return yield* Effect.fail(notFound("Unknown runtime backend"));
          const body = yield* parseRuntimeJobBody(ctx);
          const current = yield* getObservedProcess(`runtime.upgrade.${backend}`);
          const job = yield* createEngineJob(context.config, {
            backend,
            type: "update",
            ...(body.targetId ? { targetId: body.targetId } : {}),
            ...(body.version ? { version: body.version.trim() } : {}),
            ...(body.preferBundled !== undefined ? { preferBundled: body.preferBundled } : {}),
            runningProcess: current,
          });
          return ctx.json({ job_id: job.id, job });
        }),
      ),
    ),
  );
});
