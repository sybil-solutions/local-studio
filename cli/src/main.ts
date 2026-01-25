import { hideCursor, showCursor } from './ansi';
import { setupInput } from './input';
import { render } from './render';
import * as api from './api';
import type { AppState, View } from './types';

const state: AppState = {
  view: 'dashboard', selectedIndex: 0, gpus: [], recipes: [],
  status: { status: 'idle' }, config: null,
  lifetime: { total_tokens: 0, total_requests: 0, total_energy_kwh: 0 },
  error: null,
};

async function refresh(): Promise<void> {
  state.error = null;
  try {
    const [gpus, recipes, status, config, lifetime] = await Promise.all([
      api.fetchGPUs(), api.fetchRecipes(), api.fetchStatus(),
      api.fetchConfig(), api.fetchLifetimeMetrics(),
    ]);
    Object.assign(state, { gpus, recipes, status, config, lifetime });
  } catch (e) {
    state.error = e instanceof Error ? e.message : 'Unknown error';
  }
  render(state);
}

const VIEWS: View[] = ['dashboard', 'recipes', 'status', 'config'];
let cleanupInput: () => void;

function cleanup(): void {
  cleanupInput?.(); showCursor(); process.exit(0);
}

function handleKey(key: string): void {
  if (key === 'q' || key === 'ctrl-c') return cleanup();
  if (key === 'r') return void refresh();
  if (key >= '1' && key <= '4') {
    state.view = VIEWS[parseInt(key) - 1];
    state.selectedIndex = 0;
  }
  if (key === 'up') state.selectedIndex = Math.max(0, state.selectedIndex - 1);
  if (key === 'down') state.selectedIndex = Math.min(state.recipes.length - 1, state.selectedIndex + 1);
  if (key === 'enter' && state.view === 'recipes' && state.recipes[state.selectedIndex]) {
    api.launchRecipe(state.recipes[state.selectedIndex].id).then(refresh);
  }
  if (key === 'e' && state.status.status === 'running') api.evictModel().then(refresh);
  render(state);
}

async function main(): Promise<void> {
  hideCursor();
  cleanupInput = setupInput(handleKey);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  await refresh();
  setInterval(refresh, 2000);
}

main();
