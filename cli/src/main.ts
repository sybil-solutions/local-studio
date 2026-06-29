#!/usr/bin/env bun
import { hideCursor, showCursor } from "./ansi";
import { setupInput } from "./input";
import { render } from "./render";
import * as api from "./api";
import { runHeadless } from "./headless";
import type { AppState, View } from "./types";
import { Effect, Fiber, Result, Schedule } from "effect";

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

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const refreshEffect = Effect.gen(function* () {
  const results = yield* Effect.all([
    Effect.result(api.fetchGPUsEffect),
    Effect.result(api.fetchRecipesEffect),
    Effect.result(api.fetchStatusEffect),
    Effect.result(api.fetchConfigEffect),
    Effect.result(api.fetchLifetimeMetricsEffect),
  ] as const);

  const errors: string[] = [];
  if (Result.isSuccess(results[0])) state.gpus = results[0].success;
  else errors.push(failureMessage(results[0].failure, "Failed to fetch GPUs"));

  if (Result.isSuccess(results[1])) state.recipes = results[1].success;
  else errors.push(failureMessage(results[1].failure, "Failed to fetch recipes"));

  if (Result.isSuccess(results[2])) state.status = results[2].success;
  else errors.push(failureMessage(results[2].failure, "Failed to fetch status"));

  if (Result.isSuccess(results[3])) state.config = results[3].success;
  else errors.push(failureMessage(results[3].failure, "Failed to fetch config"));

  if (Result.isSuccess(results[4])) state.lifetime = results[4].success;
  else errors.push(failureMessage(results[4].failure, "Failed to fetch lifetime metrics"));

  const hasRecipes = state.recipes.length > 0;
  if (!hasRecipes) state.selectedIndex = 0;
  else state.selectedIndex = Math.min(state.selectedIndex, state.recipes.length - 1);

  state.error = errors.length > 0 ? errors[0] : null;
  render(state);
});

function refresh(): Promise<void> {
  return Effect.runPromise(refreshEffect);
}

const VIEWS: View[] = ["dashboard", "recipes", "status", "config"];
let cleanupInput: () => void = (): void => {
  /* no-op */
};
const refreshFiber = Effect.runFork(
  Effect.sync(() => {
    void refresh();
  }).pipe(Effect.repeat(Schedule.spaced(2000))),
);

function cleanup(): void {
  void Effect.runPromise(Fiber.interrupt(refreshFiber));
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
    void Effect.runPromise(
      api.launchRecipeEffect(state.recipes[state.selectedIndex].id).pipe(
        Effect.tap((ok) =>
          Effect.sync(() => {
        if (!ok) state.error = "Launch request did not succeed";
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            state.error = failureMessage(error, "Failed to launch recipe");
          }),
        ),
        Effect.andThen(refreshEffect),
      ),
    );
  }
  if (key === "e" && state.status.running) {
    void Effect.runPromise(
      api.evictModelEffect.pipe(
        Effect.tap((ok) =>
          Effect.sync(() => {
        if (!ok) state.error = "Evict request did not succeed";
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            state.error = failureMessage(error, "Failed to evict model");
          }),
        ),
        Effect.andThen(refreshEffect),
      ),
    );
  }
  render(state);
}

function startTui(): void {
  hideCursor();
  cleanupInput = setupInput(handleKey);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  void refresh();
}

if (process.argv.length > 2) {
  void runHeadless().finally(() => process.exit(process.exitCode ?? 0));
} else {
  startTui();
}
