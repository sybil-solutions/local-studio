import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Context, Layer } from "effect";
import { createConfig, type Config } from "./config/env";
import { EventManager } from "./modules/system/event-manager";
import { createLaunchState, type LaunchState } from "./modules/engines/process/launch-state";
import {
  createLaunchFailureBudget,
  type LaunchFailureBudget,
} from "./modules/engines/process/launch-failure-budget";
import {
  createProcessManager,
  type ProcessManager,
} from "./modules/engines/process/process-manager";
import { DownloadManager } from "./modules/engines/downloads/download-manager";
import { EngineCoordinator } from "./modules/engines/engine-coordinator";
import { createLogger, resolveLogLevel, type Logger } from "./core/logger";
import { primaryLogPathFor } from "./core/log-files";
import { DownloadStore } from "./modules/engines/downloads/download-store";
import { PeakMetricsStore, LifetimeMetricsStore } from "./modules/system/metrics-store";
import { RecipeStore } from "./modules/models/recipes/recipe-store";
import { InferenceRequestStore } from "./stores/inference-request-store";
import { ControllerSettingsStore } from "./stores/controller-settings-store";
import { ControllerRequestStore } from "./stores/controller-request-store";
import { RigStore } from "./stores/rig-store";
import {
  createGpuLeaseRegistry,
  perUserGpuLeaseLockDirectory,
  type GpuLeaseRegistry,
} from "./modules/system/gpu-leases";
import { getGpuInfo } from "./modules/system/platform/gpu";
import { SpeechService } from "./modules/speech/service";

export interface AppContext {
  config: Config;
  logger: Logger;
  eventManager: EventManager;
  launchState: LaunchState;
  launchFailureBudget: LaunchFailureBudget;
  processManager: ProcessManager;
  downloadManager: DownloadManager;
  engineService: EngineCoordinator;
  gpuLeaseRegistry: GpuLeaseRegistry;
  speechService: SpeechService;
  stores: {
    recipeStore: RecipeStore;
    downloadStore: DownloadStore;
    peakMetricsStore: PeakMetricsStore;
    lifetimeMetricsStore: LifetimeMetricsStore;
    inferenceRequestStore: InferenceRequestStore;
    controllerSettingsStore: ControllerSettingsStore;
    controllerRequestStore: ControllerRequestStore;
    rigStore: RigStore;
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
  const rigStore = new RigStore(dbPath);
  const eventManager = new EventManager();
  const logger = createLogger(resolveLogLevel("info"), {
    filePath: primaryLogPathFor(config.data_dir, "controller"),
    onLine: (line) => eventManager.publishLogLine("controller", line),
  });
  modelsDirectoryState = ensureModelsDirectory(config.models_dir);
  if (modelsDirectoryState === "missing") {
    logger.warn(
      `Models directory ${config.models_dir} does not exist and could not be created; set LOCAL_STUDIO_MODELS_DIR to a writable path`,
    );
  }

  const launchState = createLaunchState();
  const launchFailureBudget = createLaunchFailureBudget();
  const processManager = createProcessManager(config, logger, eventManager);
  const downloadManager = new DownloadManager(config, downloadStore, eventManager, logger);
  const gpuLeaseRegistry = createGpuLeaseRegistry({
    lockDirectory: perUserGpuLeaseLockDirectory(),
  });

  const engineService = new EngineCoordinator({
    config,
    eventManager,
    processManager,
    recipeStore,
    launchFailureBudget,
    gpuLeaseRegistry,
    gpuInfo: getGpuInfo,
  });
  const speechService = new SpeechService({
    dataDirectory: config.data_dir,
    databasePath: dbPath,
    engine: engineService,
    gpuLeaseRegistry,
    gpuInfo: getGpuInfo,
  });

  lifetimeMetricsStore.ensureFirstStarted();

  const baseContext = {
    config,
    logger,
    eventManager,
    launchState,
    launchFailureBudget,
    processManager,
    downloadManager,
    engineService,
    gpuLeaseRegistry,
    speechService,
    stores: {
      recipeStore,
      downloadStore,
      peakMetricsStore,
      lifetimeMetricsStore,
      inferenceRequestStore,
      controllerSettingsStore,
      controllerRequestStore,
      rigStore,
    },
  } satisfies AppContext;

  return baseContext;
};

export class AppContextService extends Context.Service<AppContextService, AppContext>()(
  "local-studio/AppContext",
) {}

export const AppContextLive = Layer.sync(AppContextService, createAppContext);
