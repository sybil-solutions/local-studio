import { createAppContext, getModelsDirectoryState, type AppContext } from "./app-context";
import { parseBooleanFlag } from "./core/validation";
import { createApp } from "./http/app";
import { detectGpuMonitoringTool } from "./modules/system/platform/gpu";
import { startMetricsCollector } from "./modules/system/metrics-collector";

export interface ControllerLifecycle {
  shutdown: () => Promise<void>;
}

const metricsDisabled = (): boolean =>
  parseBooleanFlag(process.env["LOCAL_STUDIO_DISABLE_METRICS"]);

type MetricsStarter = (context: AppContext) => () => void;

const startBackgroundMetrics = (
  context: AppContext,
  startMetrics: MetricsStarter,
): (() => void) => {
  if (metricsDisabled()) {
    context.logger.warn("Metrics collector disabled by LOCAL_STUDIO_DISABLE_METRICS");
    return () => undefined;
  }
  try {
    return startMetrics(context);
  } catch (error) {
    context.logger.error("Metrics collector failed to start", { error });
    return () => undefined;
  }
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

const stopSpeech = async (context: AppContext): Promise<void> => {
  await context.speechService.shutdown().catch((error) => {
    context.logger.error("Speech service failed to stop", { error });
  });
};

export const startController = async (
  startMetrics: MetricsStarter = startMetricsCollector,
): Promise<ControllerLifecycle> => {
  const context = createAppContext();
  const app = createApp(context);
  let server: ReturnType<typeof Bun.serve> | null = null;
  let stopMetrics: (() => void) | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const stopResources = async (): Promise<void> => {
    stopMetrics?.();
    stopMetrics = null;
    if (typeof server?.stop === "function") server.stop(true);
    server = null;
    await stopSpeech(context);
  };

  try {
    server = Bun.serve({
      port: context.config.port,
      hostname: context.config.host,
      fetch: app.fetch,
      idleTimeout: 120,
    });
    context.logger.info(`Controller listening on ${context.config.host}:${server.port}`);
    logBootSummary(context, server.port ?? context.config.port);
    stopMetrics = startBackgroundMetrics(context, startMetrics);
  } catch (error) {
    await stopResources();
    throw error;
  }

  const shutdown = (): Promise<void> => {
    shutdownPromise ??= stopResources();
    return shutdownPromise;
  };
  const handleSignal = (): void => {
    void shutdown().finally(() => process.exit(0));
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  return {
    shutdown: async (): Promise<void> => {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
      await shutdown();
    },
  };
};
