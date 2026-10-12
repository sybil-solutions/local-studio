import {
  RUNTIME_JOB_BACKENDS,
  RUNTIME_JOB_TYPES,
  type RuntimeJobBackend,
  type RuntimeJobType,
} from "@local-studio/contracts/system";
import { Effect, Schema } from "effect";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { getRocmInfo, resolveRocmSmiTool } from "../system/platform/rocm-info";
import {
  cancelEngineJob,
  createEngineJob,
  getEngineJob,
  listEngineJobs,
} from "./runtimes/engine-jobs";
import { getCudaInfo } from "./runtimes/runtime-info";
import { getDefaultRuntimeTarget, getRuntimeTargets, runtimeTargetToBackendInfo } from "./runtimes/runtime-targets";

/** The docker-only runtime surface: targets are pinned images, jobs are pulls. */

const RuntimeJobBodySchema = Schema.Struct({
  backend: Schema.optional(Schema.Literals(RUNTIME_JOB_BACKENDS)),
  targetId: Schema.optional(Schema.String),
  type: Schema.optional(Schema.Literals(RUNTIME_JOB_TYPES)),
  version: Schema.optional(Schema.String),
  prefer_bundled: Schema.optional(Schema.Boolean),
  command: Schema.optional(Schema.Never),
  args: Schema.optional(Schema.Never),
});

export const registerRuntimeRoutes = defineRoutes((app, context) => {
  const startPullJob = (
    backend: RuntimeJobBackend,
    type: RuntimeJobType,
  ): Effect.Effect<ReturnType<typeof getEngineJob>, ReturnType<typeof badRequest>> =>
    Effect.gen(function* () {
      const host = yield* context.compute.host();
      return yield* createEngineJob({ backend, type, host }).pipe(
        Effect.mapError((error) => badRequest(error.message)),
      );
    });

  return mergeRoutes(
    effectRoute(app.get, "/runtime/targets", (ctx) =>
      Effect.gen(function* () {
        const host = yield* context.compute.host();
        const targets = yield* getRuntimeTargets(host);
        return ctx.json({ targets });
      }),
    ),

    effectRoute(app.post, "/runtime/jobs", (ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, RuntimeJobBodySchema);
        if (!body.backend) return yield* Effect.fail(badRequest("backend is required"));
        const job = yield* startPullJob(body.backend, body.type ?? "update");
        return ctx.json({ job });
      }),
    ),

    effectRoute(app.get, "/runtime/jobs", (ctx) =>
      Effect.sync(() => ctx.json({ jobs: listEngineJobs() })),
    ),

    effectRoute(app.get, "/runtime/jobs/:jobId", (ctx) => {
      const job = getEngineJob(ctx.req.param("jobId") ?? "");
      return job
        ? Effect.succeed(ctx.json({ job }))
        : Effect.fail(notFound("Runtime job not found"));
    }),

    effectRoute(app.post, "/runtime/jobs/:jobId/cancel", (ctx) =>
      cancelEngineJob(ctx.req.param("jobId") ?? "").pipe(
        Effect.flatMap((job) =>
          job ? Effect.succeed(ctx.json({ job })) : Effect.fail(notFound("Runtime job not found")),
        ),
      ),
    ),

    effectRoute(app.get, "/runtime/vllm", (ctx) =>
      Effect.gen(function* () {
        const host = yield* context.compute.host();
        const target = yield* getDefaultRuntimeTarget(host, "vllm");
        return ctx.json(runtimeTargetToBackendInfo(target));
      }),
    ),

    effectRoute(app.get, "/runtime/sglang", (ctx) =>
      Effect.gen(function* () {
        const host = yield* context.compute.host();
        const target = yield* getDefaultRuntimeTarget(host, "sglang");
        return ctx.json(runtimeTargetToBackendInfo(target));
      }),
    ),

    effectRoute(app.get, "/runtime/cuda", (ctx) =>
      getCudaInfo().pipe(Effect.map((info) => ctx.json(info))),
    ),

    effectRoute(app.get, "/runtime/rocm", (ctx) =>
      getRocmInfo(resolveRocmSmiTool()).pipe(Effect.map((info) => ctx.json(info))),
    ),

    effectRoute(app.post, "/runtime/:backend/upgrade", (ctx) =>
      Effect.gen(function* () {
        const requestedBackend = ctx.req.param("backend");
        const backend = RUNTIME_JOB_BACKENDS.find((value) => value === requestedBackend);
        if (!backend) return yield* Effect.fail(notFound("Unknown runtime backend"));
        const job = yield* startPullJob(backend, "update");
        return ctx.json({ job_id: job?.id ?? null, job });
      }),
    ),
  );
});
