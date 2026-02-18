// CRITICAL
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AppContext } from "./types/context";
import { createConfig } from "./config/env";
import { createEventManager } from "./modules/monitoring/event-manager";
import { createLaunchState } from "./modules/lifecycle/launch-state";
import { createMetrics } from "./modules/monitoring/metrics";
import { createProcessManager } from "./modules/lifecycle/process-manager";
import { DownloadManager } from "./modules/downloads/manager";
import { createLogger, resolveLogLevel } from "./core/logger";
import { primaryLogPathFor } from "./core/log-files";
import { ChatStore } from "./modules/chat/store";
import { DownloadStore } from "./modules/downloads/store";
import { PeakMetricsStore, LifetimeMetricsStore } from "./modules/monitoring/metrics-store";
import { McpStore } from "./modules/mcp/store";
import { RecipeStore } from "./modules/lifecycle/recipe-store";
import { ChatRunManager } from "./modules/chat/agent/run-manager";
import { JobStore } from "./stores/job-store";
import { JobManager } from "./modules/jobs/job-manager";
import { DistributedStore } from "./stores/distributed-store";
import { DistributedClusterManager } from "./modules/distributed/cluster-manager";

/**
 * Create the application dependency container.
 * @returns AppContext instance.
 */
export const createAppContext = (): AppContext => {
  const config = createConfig();

  mkdirSync(config.data_dir, { recursive: true });
  const dbPath = resolve(config.db_path);

  const recipeStore = new RecipeStore(dbPath);
  const chatStore = new ChatStore(resolve(config.data_dir, "chats.db"));
  const downloadStore = new DownloadStore(dbPath);
  const peakMetricsStore = new PeakMetricsStore(dbPath);
  const lifetimeMetricsStore = new LifetimeMetricsStore(dbPath);
  const mcpStore = new McpStore(dbPath);
  const jobStore = new JobStore(dbPath);
  const distributedStore = new DistributedStore(dbPath);
  const eventManager = createEventManager();
  const logger = createLogger(resolveLogLevel("info"), {
    filePath: primaryLogPathFor(config.data_dir, "controller"),
    onLine: (line) => eventManager.publishLogLine("controller", line),
  });
  const launchState = createLaunchState();
  const { registry: metricsRegistry, metrics } = createMetrics();
  const processManager = createProcessManager(config, logger, eventManager);
  const downloadManager = new DownloadManager(config, downloadStore, eventManager, logger);

  lifetimeMetricsStore.ensureFirstStarted();

  const baseContext = {
    config,
    logger,
    eventManager,
    launchState,
    metrics,
    metricsRegistry,
    processManager,
    downloadManager,
    stores: {
      recipeStore,
      chatStore,
      downloadStore,
      peakMetricsStore,
      lifetimeMetricsStore,
      mcpStore,
      jobStore,
      distributedStore,
    },
  } as Omit<AppContext, "runManager" | "jobManager" | "distributedManager">;

  const runManager = new ChatRunManager(baseContext as AppContext);
  const jobManager = new JobManager(baseContext as AppContext, jobStore);
  const distributedManager = new DistributedClusterManager(baseContext as AppContext, distributedStore);

  return {
    ...baseContext,
    runManager,
    jobManager,
    distributedManager,
  };
};
