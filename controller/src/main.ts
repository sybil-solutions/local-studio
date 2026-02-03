// CRITICAL
import { execSync, spawnSync } from "node:child_process";
import { createAppContext } from "./app-context";
import { createApp } from "./http/app";
import { startMetricsCollector } from "./metrics-collector";
import { detectGpuType } from "./services/gpu";
import { createThrobber } from "./services/shell-ui";

/**
 * Check GPU monitoring tools are accessible.
 * Supports nvidia-smi for NVIDIA GPUs and rocm-smi for AMD GPUs.
 * Snap-installed bun has sandbox restrictions that block these tools.
 */
const checkGpuMonitoring = (): string => {
  const gpuType = detectGpuType();
  const isSnapBun = process.execPath.includes("/snap/");

  if (gpuType === "nvidia") {
    let gpuList = "";
    try {
      const output = execSync("nvidia-smi --query-gpu=name --format=csv,noheader,nounits", {
        encoding: "utf-8",
        timeout: 5000,
        stdio: "pipe",
      }).trim();
      if (output) {
        gpuList = ` (${output.split("\n").join(", ")})`;
      }
    } catch {
      gpuList = "";
    }
    return `[GPU] NVIDIA GPU detected - nvidia-smi monitoring available${gpuList}`;
  }

  if (gpuType === "amd") {
    let gpuList = "";
    let isIdle = false;
    try {
      const result = spawnSync("rocm-smi", ["--showproductname", "--csv"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.stderr?.includes("low-power state")) {
        isIdle = true;
      }
      const output = result.stdout?.toString().trim() ?? "";
      const names = output.split("\n").slice(1).map((line) => line.split(",")[1]?.trim() ?? "").filter(Boolean);
      if (names.length > 0) {
        gpuList = ` (${names.join(", ")})`;
      }
    } catch {
      gpuList = "";
    }
    const idleNote = isIdle ? " (idling)" : "";
    return `[GPU] AMD GPU detected - rocm-smi monitoring available${gpuList}${idleNote}`;
  }

  // No GPU detected
  console.warn("╔════════════════════════════════════════════════════════════════╗");
  console.warn("║  WARNING: No GPU monitoring tools accessible                    ║");
  console.warn("║  GPU monitoring will not work.                                  ║");
  console.warn("║                                                                ║");
  console.warn("║  vLLM Studio supports:                                          ║");
  console.warn("║  - nvidia-smi for NVIDIA GPUs                                   ║");
  console.warn("║  - rocm-smi for AMD GPUs                                        ║");
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
  return "[GPU] No GPU monitoring tools accessible";
};

const throbber = createThrobber();
throbber.update("Checking GPU status");
const gpuMessage = checkGpuMonitoring();

const context = createAppContext();
const app = createApp(context);
const stopMetrics = startMetricsCollector(context);

/**
 * Start the Bun server.
 * @returns Promise that resolves when started.
 */
const run = async (): Promise<void> => {
  throbber.update("Starting controller");
  const server = Bun.serve({
    port: context.config.port,
    hostname: context.config.host,
    fetch: app.fetch,
    idleTimeout: 120,
  });

  throbber.stop(`${gpuMessage} | Controller listening on ${context.config.host}:${server.port}`);
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
