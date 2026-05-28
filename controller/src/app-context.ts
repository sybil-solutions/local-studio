import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AppContext } from "./types/context";
import { createConfig } from "./config/env";
import { createEventManager } from "./modules/system/event-manager";
import { createLaunchState } from "./modules/engines/process/launch-state";
import { createMetrics } from "./modules/system/metrics";
import { createProcessManager } from "./modules/engines/process/process-manager";
import { DownloadManager } from "./modules/engines/downloads/download-manager";
import { createEngineCoordinator } from "./modules/engines/engine-coordinator";
import { createLogger, resolveLogLevel } from "./core/logger";
import { primaryLogPathFor } from "./core/log-files";
import { DownloadStore } from "./modules/engines/downloads/download-store";
import { PeakMetricsStore, LifetimeMetricsStore } from "./modules/system/metrics-store";
import { RecipeStore } from "./modules/models/recipes/recipe-store";
import { InferenceRequestStore } from "./stores/inference-request-store";
import { ControllerSettingsStore } from "./stores/controller-settings-store";
import { ControllerRequestStore } from "./stores/controller-request-store";

export const createAppContext = (): AppContext => {
  const config = createConfig();

  mkdirSync(config.data_dir, { recursive: true });
  const dbPath = resolve(config.db_path);

  const recipeStore = new RecipeStore(dbPath);
  const downloadStore = new DownloadStore(dbPath);
  const peakMetricsStore = new PeakMetricsStore(dbPath);
  const lifetimeMetricsStore = new LifetimeMetricsStore(dbPath);
  const inferenceRequestStore = new InferenceRequestStore(dbPath);
  const controllerSettingsStore = new ControllerSettingsStore(dbPath);
  const controllerRequestStore = new ControllerRequestStore(dbPath);
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
      inferenceRequestStore,
      controllerSettingsStore,
      controllerRequestStore,
    },
  } satisfies AppContext;

  return baseContext;
};
