import type { Config } from "../config/env";
import type { Logger } from "../core/logger";
import type { EventManager } from "../modules/system/event-manager";
import type { LaunchState } from "../modules/engines/layers/launch-state";
import type { ControllerMetrics, MetricsRegistry } from "../modules/system/metrics";
import type { ProcessManager } from "../modules/engines/layers/process-manager";
import type { EngineCoordinator } from "../modules/engines/layers/engine-coordinator";
import type { DownloadManager } from "../modules/engines/layers/download-manager";
import type { DownloadStore } from "../modules/engines/layers/download-store";
import type { LifetimeMetricsStore, PeakMetricsStore } from "../modules/system/metrics-store";
import type { RecipeStore } from "../modules/models/recipes/recipe-store";
import type { JobStore } from "../stores/job-store";
import type { JobType } from "../modules/jobs/types";

/**
 * Minimal interface for the job manager as seen through the app context.
 * The concrete JobManager class satisfies this interface structurally.
 */
export interface IJobManager {
  createJob(type: JobType, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  getJob(id: string): Record<string, unknown> | null;
  listJobs(limit?: number): Record<string, unknown>[];
}

/**
 * Application-wide dependency container.
 */
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
  jobManager: IJobManager;
  stores: {
    recipeStore: RecipeStore;
    downloadStore: DownloadStore;
    peakMetricsStore: PeakMetricsStore;
    lifetimeMetricsStore: LifetimeMetricsStore;
    jobStore: JobStore;
  };
}
