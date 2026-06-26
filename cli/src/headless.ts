import * as api from "./api";

type CommandHandler = () => Promise<void>;

const printJson = (value: unknown, pretty = false): void => {
  console.log(JSON.stringify(value, null, pretty ? 2 : undefined));
};

const showJson =
  (load: () => Promise<unknown>): CommandHandler =>
  async () => {
    printJson(await load(), true);
  };

const exitJson = (value: unknown, ok: boolean): never => {
  printJson(value);
  process.exit(ok ? 0 : 1);
};

const COMMANDS: Record<string, CommandHandler> = {
  status: showJson(api.fetchStatus),
  gpus: showJson(api.fetchGPUs),
  recipes: showJson(api.fetchRecipes),
  config: showJson(api.fetchConfig),
  metrics: showJson(api.fetchLifetimeMetrics),
  evict: async () => {
    const ok = await api.evictModel();
    exitJson({ success: ok }, ok);
  },
  launch: async () => {
    const id = process.argv[3];
    if (!id) {
      console.error("Usage: local-studio launch <recipe-id>");
      process.exit(1);
    }
    const ok = await api.launchRecipe(id);
    exitJson({ success: ok, recipe_id: id }, ok);
  },
  help: async () => {
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
  },
};

export async function runHeadless(): Promise<void> {
  try {
    const cmd = process.argv[2] || "help";
    const handler = COMMANDS[cmd];
    if (!handler) {
      throw new Error(`Unknown command: ${cmd}\nRun 'local-studio help' for usage.`);
    }

    await handler();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
