import type { Config } from "../config/env";
import type { Logger } from "../core/logger";
import type { EventManager } from "../modules/system/event-manager";
import type { LaunchState } from "../modules/engines/process/launch-state";
import type { ControllerMetrics, MetricsRegistry } from "../modules/system/metrics";
import type { ProcessManager } from "../modules/engines/process/process-manager";
import type { EngineCoordinator } from "../modules/engines/engine-coordinator";
import type { DownloadManager } from "../modules/engines/downloads/download-manager";
import type { DownloadStore } from "../modules/engines/downloads/download-store";
import type { LifetimeMetricsStore, PeakMetricsStore } from "../modules/system/metrics-store";
import type { RecipeStore } from "../modules/models/recipes/recipe-store";
import type { InferenceRequestStore } from "../stores/inference-request-store";
import type { ControllerSettingsStore } from "../stores/controller-settings-store";
import type { ControllerRequestStore } from "../stores/controller-request-store";

export interface AppContext {
  config: Config;
  logger: Logger;
  eventManager: EventManager;
  launchState: LaunchState;
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
