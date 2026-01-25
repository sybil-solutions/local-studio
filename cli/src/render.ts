import { clear, c, colors } from './ansi';
import type { AppState, View } from './types';
import { renderDashboard } from './views/dashboard';
import { renderRecipes } from './views/recipes';
import { renderStatus } from './views/status';
import { renderConfig } from './views/config';

const VERSION = '0.1.0';

function header(current: View): string {
  const tabs = [
    ['1', 'Dashboard', 'dashboard'],
    ['2', 'Recipes', 'recipes'],
    ['3', 'Status', 'status'],
    ['4', 'Config', 'config'],
  ] as const;

  const tabStr = tabs
    .map(([k, label, v]) =>
      v === current
        ? `${colors.bgBlue}${colors.white}[${k}]${label}${colors.reset}`
        : c.dim(`[${k}]${label}`)
    )
    .join(' ');

  return `${c.bold('vLLM Studio CLI')} ${c.dim(`v${VERSION}`)}  ${tabStr}`;
}

function footer(): string {
  return c.dim('[↑↓]Navigate [Enter]Select [e]Evict [r]Refresh [q]Quit');
}

const VIEWS: Record<View, (state: AppState) => string> = {
  dashboard: renderDashboard,
  recipes: renderRecipes,
  status: renderStatus,
  config: renderConfig,
};

export function render(state: AppState): void {
  const lines: string[] = [
    header(state.view),
    '─'.repeat(60),
    VIEWS[state.view](state),
    '',
    state.error ? c.red(`Error: ${state.error}`) : '',
    footer(),
  ];

  clear();
  console.log(lines.filter(Boolean).join('\n'));
}
