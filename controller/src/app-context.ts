import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createConfig, type Config } from "./config/env";
import { createEventManager, type EventManager } from "./modules/system/event-manager";
import { createLaunchState, type LaunchState } from "./modules/engines/process/launch-state";
import {
  createLaunchFailureBudget,
  type LaunchFailureBudget,
} from "./modules/engines/process/launch-failure-budget";
import { createMetrics, type ControllerMetrics, type MetricsRegistry } from "./modules/system/metrics";
import { createProcessManager, type ProcessManager } from "./modules/engines/process/process-manager";
import { DownloadManager } from "./modules/engines/downloads/download-manager";
import { createEngineCoordinator, type EngineCoordinator } from "./modules/engines/engine-coordinator";
import { createLogger, resolveLogLevel, type Logger } from "./core/logger";
import { primaryLogPathFor } from "./core/log-files";
import { DownloadStore } from "./modules/engines/downloads/download-store";
import { PeakMetricsStore, LifetimeMetricsStore } from "./modules/system/metrics-store";
import { RecipeStore } from "./modules/models/recipes/recipe-store";
import { InferenceRequestStore } from "./stores/inference-request-store";
import { ControllerSettingsStore } from "./stores/controller-settings-store";
import { ControllerRequestStore } from "./stores/controller-request-store";

export interface AppContext {
  config: Config;
  logger: Logger;
  eventManager: EventManager;
  launchState: LaunchState;
  launchFailureBudget: LaunchFailureBudget;
  metrics: ControllerMetrics;
  metricsRegistry: MetricsRegistry;
  processManager: ProcessManager;
  downloadManager: DownloadManager;
  engineService: EngineCoordinator;
  stores: {
    recipeStore: RecipeStore;
    downloadStore: DownloadStore;
    peakMetricsStore: PeakMetricsStore;
    lifetimeMetricsStore: LifetimeMetricsStore;
    inferenceRequestStore: InferenceRequestStore;
    controllerSettingsStore: ControllerSettingsStore;
    controllerRequestStore: ControllerRequestStore;
  };
}

export type ModelsDirectoryState = "exists" | "created" | "missing";

let modelsDirectoryState: ModelsDirectoryState = "missing";

export const getModelsDirectoryState = (): ModelsDirectoryState => modelsDirectoryState;

const ensureModelsDirectory = (modelsDirectory: string): ModelsDirectoryState => {
  if (existsSync(modelsDirectory)) return "exists";
  try {
    mkdirSync(modelsDirectory, { recursive: true });
    return "created";
  } catch {
    // Read-only or unwritable locations (e.g. the /models default on macOS) must not block boot.
    return "missing";
  }
};

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
  modelsDirectoryState = ensureModelsDirectory(config.models_dir);
  if (modelsDirectoryState === "missing") {
    logger.warn(
      `Models directory ${config.models_dir} does not exist and could not be created; set LOCAL_STUDIO_MODELS_DIR to a writable path`
    );
  }

  const launchState = createLaunchState();
  const launchFailureBudget = createLaunchFailureBudget();
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
    launchFailureBudget,
  });

  lifetimeMetricsStore.ensureFirstStarted();

  const baseContext = {
    config,
    logger,
    eventManager,
    launchState,
    launchFailureBudget,
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
