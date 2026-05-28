#!/usr/bin/env bun
import { hideCursor, showCursor } from "./ansi";
import { setupInput } from "./input";
import { render } from "./render";
import * as api from "./api";
import type { AppState, View } from "./types";

// Route to headless mode if CLI args provided
if (process.argv.length > 2) {
  const { runHeadless } = await import("./headless");
  await runHeadless();
  process.exit(process.exitCode ?? 0);
}

const state: AppState = {
  view: "dashboard",
  selectedIndex: 0,
  gpus: [],
  recipes: [],
  status: { running: false, launching: false },
  config: null,
  lifetime: { total_tokens: 0, total_requests: 0, total_energy_kwh: 0 },
  error: null,
};

async function refresh(): Promise<void> {
  const results = await Promise.allSettled([
    api.fetchGPUs(),
    api.fetchRecipes(),
    api.fetchStatus(),
    api.fetchConfig(),
    api.fetchLifetimeMetrics(),
  ] as const);

  const errors: string[] = [];
  if (results[0].status === "fulfilled") state.gpus = results[0].value;
  else
    errors.push(
      results[0].reason instanceof Error ? results[0].reason.message : "Failed to fetch GPUs"
    );

  if (results[1].status === "fulfilled") state.recipes = results[1].value;
  else
    errors.push(
      results[1].reason instanceof Error ? results[1].reason.message : "Failed to fetch recipes"
    );

  if (results[2].status === "fulfilled") state.status = results[2].value;
  else
    errors.push(
      results[2].reason instanceof Error ? results[2].reason.message : "Failed to fetch status"
    );

  if (results[3].status === "fulfilled") state.config = results[3].value;
  else
    errors.push(
      results[3].reason instanceof Error ? results[3].reason.message : "Failed to fetch config"
    );

  if (results[4].status === "fulfilled") state.lifetime = results[4].value;
  else
    errors.push(
      results[4].reason instanceof Error
        ? results[4].reason.message
        : "Failed to fetch lifetime metrics"
    );

  const hasRecipes = state.recipes.length > 0;
  if (!hasRecipes) state.selectedIndex = 0;
  else state.selectedIndex = Math.min(state.selectedIndex, state.recipes.length - 1);

  state.error = errors.length > 0 ? errors[0] : null;
  render(state);
}

const VIEWS: View[] = ["dashboard", "recipes", "status", "config"];
let cleanupInput: () => void = (): void => {
  /* no-op */
};
const refreshTimer = setInterval(() => {
  void refresh();
}, 2000);

if (typeof refreshTimer.unref === "function") {
  refreshTimer.unref();
}

function cleanup(): void {
  clearInterval(refreshTimer);
  cleanupInput?.();
  showCursor();
  process.exit(0);
}

function handleKey(key: string): void {
  if (key === "q" || key === "ctrl-c") return cleanup();
  if (key === "r") return void refresh();
  if (key >= "1" && key <= "4") {
    state.view = VIEWS[parseInt(key, 10) - 1];
    state.selectedIndex = 0;
  }
  if (key === "up") state.selectedIndex = Math.max(0, state.selectedIndex - 1);
  if (key === "down") {
    const maxIndex = Math.max(0, state.recipes.length - 1);
    state.selectedIndex = Math.min(maxIndex, state.selectedIndex + 1);
  }
  if (key === "enter" && state.view === "recipes" && state.recipes[state.selectedIndex]) {
    api
      .launchRecipe(state.recipes[state.selectedIndex].id)
      .then((ok) => {
        if (!ok) state.error = "Launch request did not succeed";
      })
      .catch((error: unknown) => {
        state.error = error instanceof Error ? error.message : "Failed to launch recipe";
      })
      .finally(() => {
        void refresh();
      });
  }
  if (key === "e" && state.status.running) {
    api
      .evictModel()
      .then((ok) => {
        if (!ok) state.error = "Evict request did not succeed";
      })
      .catch((error: unknown) => {
        state.error = error instanceof Error ? error.message : "Failed to evict model";
      })
      .finally(() => {
        void refresh();
      });
  }
  render(state);
}

hideCursor();
cleanupInput = setupInput(handleKey);
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
await refresh();
