import { c } from '../ansi';
import type { AppState } from '../types';

export function renderConfig(state: AppState): string {
  const lines: string[] = [];

  lines.push(c.bold('═══ System Configuration ═══'));
  lines.push('');

  if (!state.config) {
    lines.push(c.dim('  Unable to fetch configuration.'));
    lines.push(c.dim('  Controller may be unreachable.'));
    return lines.join('\n');
  }

  const cfg = state.config;

  lines.push(c.bold('  Ports'));
  lines.push(`    Controller: ${c.cyan(cfg.controller_port.toString())}`);
  lines.push(`    Inference:  ${c.cyan(cfg.inference_port.toString())}`);
  lines.push('');

  lines.push(c.bold('  Directories'));
  lines.push(`    Models: ${c.cyan(cfg.models_dir)}`);
  lines.push(`    Data:   ${c.cyan(cfg.data_dir)}`);
  lines.push('');

  lines.push(c.bold('  Environment'));
  lines.push(`    VLLM_STUDIO_URL: ${c.dim(process.env.VLLM_STUDIO_URL || 'http://localhost:8080')}`);

  return lines.join('\n');
}
