// CRITICAL
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AppContext } from "./types/context";
import { createConfig } from "./config/env";
import { createEventManager } from "./modules/system/event-manager";
import { createLaunchState } from "./modules/engines/layers/launch-state";
import { createMetrics } from "./modules/system/metrics";
import { createProcessManager } from "./modules/engines/layers/process-manager";
import { DownloadManager } from "./modules/engines/layers/download-manager";
import { createEngineCoordinator } from "./modules/engines/layers/engine-coordinator";
import { createLogger, resolveLogLevel } from "./core/logger";
import { primaryLogPathFor } from "./core/log-files";
import { DownloadStore } from "./modules/engines/layers/download-store";
import { PeakMetricsStore, LifetimeMetricsStore } from "./modules/system/metrics-store";
import { RecipeStore } from "./modules/models/recipes/recipe-store";
import { JobStore } from "./stores/job-store";
import { JobManager } from "./modules/jobs/job-manager";

/**
 * Create the application dependency container.
 * @returns AppContext instance.
 */
export const createAppContext = (): AppContext => {
  const config = createConfig();

  mkdirSync(config.data_dir, { recursive: true });
  const dbPath = resolve(config.db_path);

  const recipeStore = new RecipeStore(dbPath);
  const downloadStore = new DownloadStore(dbPath);
  const peakMetricsStore = new PeakMetricsStore(dbPath);
  const lifetimeMetricsStore = new LifetimeMetricsStore(dbPath);
  const jobStore = new JobStore(dbPath);
  const eventManager = createEventManager();
  const logger = createLogger(resolveLogLevel("info"), {
    filePath: primaryLogPathFor(config.data_dir, "controller"),
    onLine: (line) => eventManager.publishLogLine("controller", line),
  });
  const launchState = createLaunchState();
  const { registry: metricsRegistry, metrics } = createMetrics();
  const processManager = createProcessManager(config, logger, eventManager);
  const downloadManager = new DownloadManager(config, downloadStore, eventManager, logger);

  const engineService = createEngineCoordinator({
    config,
    logger,
    eventManager,
    processManager,
    recipeStore,
    downloadManager,
    abortRunsForModel: () => 0,
  });

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
    engineService,
    stores: {
      recipeStore,
      downloadStore,
      peakMetricsStore,
      lifetimeMetricsStore,
      jobStore,
    },
  } as Omit<AppContext, "jobManager">;

  const jobManager = new JobManager(baseContext as AppContext, jobStore);

  return {
    ...baseContext,
    jobManager,
  };
};
