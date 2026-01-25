import { c } from '../ansi';
import type { AppState } from '../types';

export function renderRecipes(state: AppState): string {
  const lines: string[] = [];

  lines.push(c.bold('═══ Recipes ═══'));
  if (state.recipes.length === 0) {
    lines.push(c.dim('  No recipes found'));
    lines.push('');
    lines.push(c.dim('  Create recipes in the web UI at http://localhost:3000'));
    return lines.join('\n');
  }

  const { running, launching, model } = state.status;

  state.recipes.forEach((recipe, i) => {
    const isSelected = i === state.selectedIndex;
    const isActive = model && recipe.name.includes(model);

    let prefix = '  ';
    if (isSelected) prefix = c.cyan('▶ ');

    let status = '';
    if (isActive) {
      status = launching ? c.yellow(' [LAUNCHING]') : c.green(' [RUNNING]');
    }

    const name = isSelected ? c.bold(recipe.name) : recipe.name;
    const backend = c.dim(`[${recipe.backend}]`);
    const tp = recipe.tensor_parallel_size
      ? c.dim(` TP=${recipe.tensor_parallel_size}`)
      : '';

    lines.push(`${prefix}${name} ${backend}${tp}${status}`);
    lines.push(`    ${c.dim(recipe.model_path)}`);
  });

  lines.push('');
  if (running) {
    lines.push(c.dim('  Press [e] to evict running model'));
  } else {
    lines.push(c.dim('  Press [Enter] to launch selected recipe'));
  }

  return lines.join('\n');
}
