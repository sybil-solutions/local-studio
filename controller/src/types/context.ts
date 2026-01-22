import type { Config } from "../config/env";
import type { Logger } from "../core/logger";
import type { EventManager } from "../services/event-manager";
import type { LaunchState } from "../services/launch-state";
import type { ControllerMetrics, MetricsRegistry } from "../services/metrics";
import type { ProcessManager } from "../services/process-manager";
import type { ChatStore } from "../stores/chat-store";
import type { LifetimeMetricsStore, PeakMetricsStore } from "../stores/metrics-store";
import type { McpStore } from "../stores/mcp-store";
import type { RecipeStore } from "../stores/recipe-store";

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
  stores: {
    recipeStore: RecipeStore;
    chatStore: ChatStore;
    peakMetricsStore: PeakMetricsStore;
    lifetimeMetricsStore: LifetimeMetricsStore;
    mcpStore: McpStore;
  };
}
