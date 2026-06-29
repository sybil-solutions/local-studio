import * as api from "./api";
import { Effect } from "effect";

type CommandHandler = Effect.Effect<void, unknown>;

const printJson = (value: unknown, pretty = false): void => {
  console.log(JSON.stringify(value, null, pretty ? 2 : undefined));
};

const showJson =
  (load: Effect.Effect<unknown, unknown>): CommandHandler =>
  load.pipe(Effect.andThen((value) => Effect.sync(() => printJson(value, true))));

const exitJson = (value: unknown, ok: boolean): never => {
  printJson(value);
  process.exit(ok ? 0 : 1);
};

const COMMANDS: Record<string, CommandHandler> = {
  status: showJson(api.fetchStatusEffect),
  gpus: showJson(api.fetchGPUsEffect),
  recipes: showJson(api.fetchRecipesEffect),
  config: showJson(api.fetchConfigEffect),
  metrics: showJson(api.fetchLifetimeMetricsEffect),
  evict: Effect.gen(function* () {
    const ok = yield* api.evictModelEffect;
    exitJson({ success: ok }, ok);
  }),
  launch: Effect.gen(function* () {
    const id = process.argv[3];
    if (!id) {
      console.error("Usage: local-studio launch <recipe-id>");
      process.exit(1);
    }
    const ok = yield* api.launchRecipeEffect(id);
    exitJson({ success: ok, recipe_id: id }, ok);
  }),
  help: Effect.sync(() => {
    console.log(`local-studio - Model lifecycle management CLI

Commands:
  status    Show current model status
  gpus      List GPUs with memory/utilization
  recipes   List available model recipes
  config    Show system configuration
  metrics   Show lifetime metrics
  launch    Launch recipe: local-studio launch <id>
  evict     Stop running model
  help      Show this help

Environment:
  LOCAL_STUDIO_URL  Controller URL (default: http://localhost:8080)

Notes:
  - Headless commands emit JSON on stdout when successful.
  - Non-zero exit code indicates command failure.

Run without arguments for interactive TUI mode.`);
  }),
};

export function runHeadless(): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const cmd = process.argv[2] || "help";
      const handler = COMMANDS[cmd];
      if (!handler) {
        return yield* Effect.fail(
          new Error(`Unknown command: ${cmd}\nRun 'local-studio help' for usage.`),
        );
      }

      yield* handler;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(message);
          process.exit(1);
        }),
      ),
    ),
  );
}
