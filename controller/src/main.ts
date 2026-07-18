import { Cause, Effect, Exit, Fiber } from "effect";
import { AppContextService, getModelsDirectoryState, type AppContext } from "./app-context";
import { createControllerRuntime } from "./core/effect-runtime";
import { createApp } from "./http/app";
import { detectGpuMonitoringTool } from "./modules/system/platform/gpu";
import { startMetricsCollector } from "./modules/system/metrics-collector";
import { parseBooleanFlag } from "./core/validation";

const metricsDisabled = (): boolean =>
  parseBooleanFlag(process.env["LOCAL_STUDIO_DISABLE_METRICS"]);

const startBackgroundMetrics = (context: AppContext): (() => void) => {
  if (metricsDisabled()) {
    context.logger.warn("Metrics collector disabled by LOCAL_STUDIO_DISABLE_METRICS");
    return () => {};
  }
  try {
    return startMetricsCollector(context);
  } catch (error) {
    context.logger.error("Metrics collector failed to start", { error: String(error) });
    return () => {};
  }
};

const start = (
  context: AppContext,
  runtime: ReturnType<typeof createControllerRuntime>,
): { server: ReturnType<typeof Bun.serve>; stopMetrics: () => void } => {
  const app = createApp(context, runtime);
  const server = Bun.serve({
    port: context.config.port,
    hostname: context.config.host,
    fetch: app.fetch,
    idleTimeout: 120,
  });

  context.logger.info(`Controller listening on ${context.config.host}:${server.port}`);
  logBootSummary(context, server.port ?? context.config.port);
  return { server, stopMetrics: startBackgroundMetrics(context) };
};

const logBootSummary = (context: AppContext, port: number): void => {
  const { config } = context;
  const modelsDirectoryState = getModelsDirectoryState();
  const authMode = config.api_key ? "api-key" : "unauthenticated (no LOCAL_STUDIO_API_KEY)";
  context.logger.info(
    [
      "Boot summary:",
      `listen=${config.host}:${port}`,
      `data_dir=${config.data_dir}`,
      `db_path=${config.db_path}`,
      `models_dir=${config.models_dir} (${modelsDirectoryState === "missing" ? "MISSING" : modelsDirectoryState})`,
      `auth=${authMode}`,
      `gpu_tool=${detectGpuMonitoringTool() ?? "none detected"}`,
    ].join(" "),
  );
};

const runtime = createControllerRuntime();
const program = Effect.scoped(
  Effect.gen(function* () {
    const context = yield* AppContextService;
    yield* Effect.acquireRelease(
      Effect.sync(() => start(context, runtime)),
      ({ server, stopMetrics }) =>
        Effect.gen(function* () {
          yield* Effect.sync(stopMetrics);
          yield* Effect.sync(() => server.stop());
          yield* Effect.tryPromise({
            try: () => context.speechService.shutdown(),
            catch: (error) => error,
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                context.logger.error("Speech service failed to stop", { error: String(error) });
              }),
            ),
          );
        }),
    );
    return yield* Effect.never;
  }),
);
const fiber = runtime.runFork(program);
let shuttingDown = false;

fiber.addObserver((exit) => {
  if (shuttingDown || Exit.isSuccess(exit)) return;
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
