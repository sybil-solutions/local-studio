// CRITICAL
import { execSync } from "node:child_process";
import { createAppContext } from "./app-context";
import type { Logger } from "./core/logger";
import { createApp } from "./http/app";
import { startMetricsCollector } from "./modules/system/metrics-collector/metrics-collector";

/**
 * Check if nvidia-smi is accessible (important for GPU monitoring).
 * Snap-installed bun has sandbox restrictions that block nvidia-smi.
 * @param logger - Logger for emitting warnings.
 */
const checkNvidiaSmi = (logger: Logger): void => {
  try {
    execSync("nvidia-smi --query-gpu=name --format=csv,noheader,nounits", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
    });
  } catch {
    const isSnapBun = process.execPath.includes("/snap/");
    logger.warn("╔════════════════════════════════════════════════════════════════╗");
    logger.warn("║  WARNING: nvidia-smi is not accessible                         ║");
    logger.warn("║  GPU monitoring will not work.                                 ║");
    if (isSnapBun) {
      logger.warn("║                                                                ║");
      logger.warn("║  You are using snap-installed bun which has sandbox            ║");
      logger.warn("║  restrictions. Use native bun instead:                         ║");
      logger.warn("║                                                                ║");
      logger.warn("║    curl -fsSL https://bun.sh/install | bash                    ║");
      logger.warn("║    ~/.bun/bin/bun run controller/src/main.ts                   ║");
      logger.warn("║                                                                ║");
      logger.warn("║  Or use the start script: ./start.sh                           ║");
    }
    logger.warn("╚════════════════════════════════════════════════════════════════╝");
  }
};

const context = createAppContext();
checkNvidiaSmi(context.logger);
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
