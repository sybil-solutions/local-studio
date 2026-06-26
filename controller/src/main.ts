import { createAppContext, getModelsDirectoryState } from "./app-context";
import { createApp } from "./http/app";
import { detectGpuMonitoringTool } from "./modules/system/platform/gpu";
import { startMetricsCollector } from "./modules/system/metrics-collector";

const metricsDisabled = (): boolean => {
  const raw = process.env["LOCAL_STUDIO_DISABLE_METRICS"]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const context = createAppContext();
const app = createApp(context);
let server: ReturnType<typeof Bun.serve> | null = null;
let stopMetrics: (() => void) | null = null;

const startBackgroundMetrics = (): (() => void) => {
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

const start = (): void => {
  server = Bun.serve({
    port: context.config.port,
    hostname: context.config.host,
    fetch: app.fetch,
    idleTimeout: 120,
  });

  context.logger.info(`Controller listening on ${context.config.host}:${server.port}`);
  logBootSummary(server.port ?? context.config.port);
  stopMetrics = startBackgroundMetrics();
};

const logBootSummary = (port: number): void => {
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
    ].join(" ")
  );
};

const shutdown = (): void => {
  stopMetrics?.();
  stopMetrics = null;
  if (typeof server?.stop === "function") {
    server.stop();
  }
  server = null;
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
