import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AppContext } from "./types/context";
import { createConfig } from "./config/env";
import { createEventManager } from "./services/event-manager";
import { createLaunchState } from "./services/launch-state";
import { createMetrics } from "./services/metrics";
import { createProcessManager } from "./services/process-manager";
import { createLogger, resolveLogLevel } from "./core/logger";
import { ChatStore } from "./stores/chat-store";
import { PeakMetricsStore, LifetimeMetricsStore } from "./stores/metrics-store";
import { McpStore } from "./stores/mcp-store";
import { RecipeStore } from "./stores/recipe-store";

/**
 * Create the application dependency container.
 * @returns AppContext instance.
 */
export const createAppContext = (): AppContext => {
  const config = createConfig();
  const logger = createLogger(resolveLogLevel("info"));

  mkdirSync(config.data_dir, { recursive: true });
  const dbPath = resolve(config.db_path);

  const recipeStore = new RecipeStore(dbPath);
  const chatStore = new ChatStore(resolve(config.data_dir, "chats.db"));
  const peakMetricsStore = new PeakMetricsStore(dbPath);
  const lifetimeMetricsStore = new LifetimeMetricsStore(dbPath);
  const mcpStore = new McpStore(dbPath);
  const eventManager = createEventManager();
  const launchState = createLaunchState();
  const { registry: metricsRegistry, metrics } = createMetrics();
  const processManager = createProcessManager(config, logger);

  lifetimeMetricsStore.ensureFirstStarted();

  return {
    config,
    logger,
    eventManager,
    launchState,
    metrics,
    metricsRegistry,
    processManager,
    stores: {
      recipeStore,
      chatStore,
      peakMetricsStore,
      lifetimeMetricsStore,
      mcpStore,
    },
  };
};
