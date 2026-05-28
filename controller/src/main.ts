import { createAppContext } from "./app-context";
import { createApp } from "./http/app";
import { startMetricsCollector } from "./modules/system/metrics-collector/metrics-collector";

const metricsDisabled = (): boolean => {
  const raw = process.env["VLLM_STUDIO_DISABLE_METRICS"]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const context = createAppContext();
const app = createApp(context);
let server: ReturnType<typeof Bun.serve> | null = null;
let stopMetrics: (() => void) | null = null;

const startBackgroundMetrics = (): (() => void) => {
  if (metricsDisabled()) {
    context.logger.warn("Metrics collector disabled by VLLM_STUDIO_DISABLE_METRICS");
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
  stopMetrics = startBackgroundMetrics();
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
