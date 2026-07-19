import { Cause, Effect, Exit, Fiber, Schema } from "effect";
import { AppContextService, getModelsDirectoryState, type AppContext } from "./app-context";
import { createControllerRuntime, type ControllerRuntime } from "./core/effect-runtime";
import { parseBooleanFlag } from "./core/validation";
import { createApp } from "./http/app";
import { startMetricsCollector } from "./modules/system/metrics-collector";
import { detectGpuMonitoringTool } from "./modules/system/platform/gpu";

class ControllerStartupError extends Schema.TaggedErrorClass<ControllerStartupError>()(
  "ControllerStartupError",
  { operation: Schema.String, message: Schema.String, source: Schema.Unknown },
) {}

const startupError = (operation: string, source: unknown): ControllerStartupError =>
  new ControllerStartupError({ operation, message: String(source), source });

const metricsDisabled = (): boolean =>
  parseBooleanFlag(process.env["LOCAL_STUDIO_DISABLE_METRICS"]);

const logBootSummary = (context: AppContext, port: number): Effect.Effect<void> =>
  detectGpuMonitoringTool().pipe(
    Effect.tap((gpuTool) =>
      Effect.sync(() => {
        const { config } = context;
        const directoryState = getModelsDirectoryState();
        const authMode = config.api_key ? "api-key" : "unauthenticated (no LOCAL_STUDIO_API_KEY)";
        context.logger.info(
          [
            "Boot summary:",
            `listen=${config.host}:${port}`,
            `data_dir=${config.data_dir}`,
            `db_path=${config.db_path}`,
            `models_dir=${config.models_dir} (${directoryState === "missing" ? "MISSING" : directoryState})`,
            `auth=${authMode}`,
            `gpu_tool=${gpuTool ?? "none detected"}`,
          ].join(" "),
        );
      }),
    ),
    Effect.asVoid,
  );

const serve = (
  context: AppContext,
  runtime: ControllerRuntime,
): Effect.Effect<ReturnType<typeof Bun.serve>, ControllerStartupError> =>
  Effect.try({
    try: () => {
      const app = createApp(context, runtime);
      return Bun.serve({
        port: context.config.port,
        hostname: context.config.host,
        fetch: app.fetch,
        idleTimeout: 120,
      });
    },
    catch: (source) => startupError("server.start", source),
  });

const runtime = createControllerRuntime();
const program = Effect.scoped(
  Effect.gen(function* () {
    const context = yield* AppContextService;
    if (metricsDisabled()) {
      context.logger.warn("Metrics collector disabled by LOCAL_STUDIO_DISABLE_METRICS");
    } else {
      yield* Effect.forkScoped(startMetricsCollector(context));
    }
    const server = yield* Effect.acquireRelease(serve(context, runtime), (resource) =>
      Effect.tryPromise({
        try: () => resource.stop(),
        catch: (source) => startupError("server.stop", source),
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            context.logger.error("Server failed to stop", { error: String(error) }),
          ),
        ),
      ),
    );
    context.logger.info(`Controller listening on ${context.config.host}:${server.port}`);
    yield* logBootSummary(context, server.port ?? context.config.port);
    return yield* Effect.never;
  }),
);
const fiber = runtime.runFork(program);
let shuttingDown = false;

fiber.addObserver((exit) => {
  if (shuttingDown || Exit.isSuccess(exit)) return;
  shuttingDown = true;
  console.error(Cause.pretty(exit.cause));
  void runtime.dispose().finally(() => process.exit(1));
});

const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  void Effect.runPromise(
    Fiber.interrupt(fiber).pipe(Effect.andThen(runtime.disposeEffect)),
  ).finally(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
