import { c, table, formatBytes, formatNumber } from '../ansi';
import type { AppState } from '../types';

function gpuColor(util: number): (s: string) => string {
  if (util >= 80) return c.red;
  if (util >= 50) return c.yellow;
  return c.green;
}

export function renderDashboard(state: AppState): string {
  const lines: string[] = [];

  lines.push(c.bold('═══ GPUs ═══'));
  if (state.gpus.length === 0) {
    lines.push(c.dim('  No GPUs detected'));
  } else {
    const headers = ['ID', 'Name', 'VRAM', 'Util', 'Temp', 'Power'];
    const widths = [2, 18, 15, 5, 5, 6];
    const rows = state.gpus.map(gpu => {
      const vram = `${formatBytes(gpu.memory_used)}/${formatBytes(gpu.memory_total)}`;
      const util = gpuColor(gpu.utilization)(`${gpu.utilization}%`);
      const temp = gpu.temperature >= 80
        ? c.red(`${gpu.temperature}°C`)
        : `${gpu.temperature}°C`;
      return [
        gpu.index.toString(),
        gpu.name.slice(0, 20),
        vram,
        util,
        temp,
        `${Math.round(gpu.power_draw)}W`,
      ];
    });
    lines.push(table(headers, rows, widths));
  }

  lines.push('');
  lines.push(c.bold('═══ Lifetime Metrics ═══'));
  const { total_tokens, total_requests, total_energy_kwh } = state.lifetime;
  lines.push(
    `  Tokens: ${c.cyan(formatNumber(total_tokens))}  ` +
    `Requests: ${c.cyan(formatNumber(total_requests))}  ` +
    `Energy: ${c.cyan(total_energy_kwh.toFixed(2) + ' kWh')}`
  );

  lines.push('');
  const st = state.status;
  const statusText = st.launching ? 'launching' : st.running ? 'running' : 'idle';
  const statusColor = st.launching ? c.yellow : st.running ? c.green : c.dim;
  lines.push(`  Status: ${statusColor(statusText)}` +
    (st.model ? ` (${c.cyan(st.model)})` : ''));

  return lines.join('\n');
}
