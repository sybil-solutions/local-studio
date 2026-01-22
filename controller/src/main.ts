import { createAppContext } from "./app-context";
import { createApp } from "./http/app";
import { startMetricsCollector } from "./metrics-collector";

const context = createAppContext();
const app = createApp(context);
const stopMetrics = startMetricsCollector(context);

/**
 * Start the Bun server.
 * @returns Promise that resolves when started.
 */
const run = async (): Promise<void> => {
  const server = Bun.serve({
    port: context.config.port,
    hostname: context.config.host,
    fetch: app.fetch,
    idleTimeout: 120,
  });

  context.logger.info(`Controller listening on ${context.config.host}:${server.port}`);

  const shutdown = (): void => {
    stopMetrics();
    if (typeof server.stop === "function") {
      server.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

void run();
