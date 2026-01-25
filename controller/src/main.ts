import { execSync } from "node:child_process";
import { createAppContext } from "./app-context";
import { createApp } from "./http/app";
import { startMetricsCollector } from "./metrics-collector";

/**
 * Check if nvidia-smi is accessible (important for GPU monitoring).
 * Snap-installed bun has sandbox restrictions that block nvidia-smi.
 */
const checkNvidiaSmi = (): void => {
  try {
    execSync("nvidia-smi --query-gpu=name --format=csv,noheader,nounits", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
    });
  } catch {
    const isSnapBun = process.execPath.includes("/snap/");
    console.warn("╔════════════════════════════════════════════════════════════════╗");
    console.warn("║  WARNING: nvidia-smi is not accessible                         ║");
    console.warn("║  GPU monitoring will not work.                                 ║");
    if (isSnapBun) {
      console.warn("║                                                                ║");
      console.warn("║  You are using snap-installed bun which has sandbox            ║");
      console.warn("║  restrictions. Use native bun instead:                         ║");
      console.warn("║                                                                ║");
      console.warn("║    curl -fsSL https://bun.sh/install | bash                    ║");
      console.warn("║    ~/.bun/bin/bun run controller/src/main.ts                   ║");
      console.warn("║                                                                ║");
      console.warn("║  Or use the start script: ./start.sh                           ║");
    }
    console.warn("╚════════════════════════════════════════════════════════════════╝");
  }
};

checkNvidiaSmi();

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
