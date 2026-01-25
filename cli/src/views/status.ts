import { c } from '../ansi';
import type { AppState } from '../types';

export function renderStatus(state: AppState): string {
  const lines: string[] = [];
  const st = state.status;

  lines.push(c.bold('═══ Model Status ═══'));
  lines.push('');

  const statusText = st.launching ? 'LAUNCHING' : st.running ? 'RUNNING' : 'IDLE';
  const colorFn = st.launching ? c.yellow : st.running ? c.green : c.dim;

  lines.push(`  Status:  ${colorFn(statusText)}`);

  if (st.model) lines.push(`  Model:   ${c.cyan(st.model)}`);
  if (st.backend) lines.push(`  Backend: ${c.dim(st.backend)}`);
  if (st.pid) lines.push(`  PID:     ${c.dim(st.pid.toString())}`);
  if (st.port) lines.push(`  Port:    ${c.dim(st.port.toString())}`);

  if (st.error) {
    lines.push('');
    lines.push(c.red(`  Error: ${st.error}`));
  }

  if (!st.running && !st.launching) {
    lines.push('');
    lines.push(c.dim('  No model currently loaded.'));
    lines.push(c.dim('  Go to Recipes [2] to launch one.'));
  }

  return lines.join('\n');
}
