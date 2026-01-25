import { c } from '../ansi';
import type { AppState } from '../types';

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function renderStatus(state: AppState): string {
  const lines: string[] = [];
  const st = state.status;

  lines.push(c.bold('═══ Model Status ═══'));
  lines.push('');

  const statusColors: Record<string, (s: string) => string> = {
    running: c.green,
    launching: c.yellow,
    error: c.red,
    idle: c.dim,
  };
  const colorFn = statusColors[st.status] || c.dim;

  lines.push(`  Status:    ${colorFn(st.status.toUpperCase())}`);

  if (st.model) {
    lines.push(`  Model:     ${c.cyan(st.model)}`);
  }
  if (st.recipe_id) {
    lines.push(`  Recipe ID: ${c.dim(st.recipe_id)}`);
  }
  if (st.uptime !== undefined) {
    lines.push(`  Uptime:    ${formatUptime(st.uptime)}`);
  }
  if (st.error) {
    lines.push('');
    lines.push(c.red(`  Error: ${st.error}`));
  }

  if (st.status === 'idle') {
    lines.push('');
    lines.push(c.dim('  No model currently loaded.'));
    lines.push(c.dim('  Go to Recipes [2] to launch a model.'));
  }

  return lines.join('\n');
}
