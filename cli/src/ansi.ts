export const ESC = '\x1b[';
export const clear = () => process.stdout.write(`${ESC}2J${ESC}H`);
export const hideCursor = () => process.stdout.write(`${ESC}?25l`);
export const showCursor = () => process.stdout.write(`${ESC}?25h`);
export const moveTo = (row: number, col: number) => `${ESC}${row};${col}H`;

export const colors = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  bgBlue: `${ESC}44m`,
};

export const c = {
  red: (s: string) => `${colors.red}${s}${colors.reset}`,
  green: (s: string) => `${colors.green}${s}${colors.reset}`,
  yellow: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  blue: (s: string) => `${colors.blue}${s}${colors.reset}`,
  cyan: (s: string) => `${colors.cyan}${s}${colors.reset}`,
  bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
};

export function pad(s: string, len: number, align: 'l' | 'r' = 'l'): string {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, len - visible.length);
  return align === 'l' ? s + ' '.repeat(padding) : ' '.repeat(padding) + s;
}

export function table(headers: string[], rows: string[][], widths: number[]): string {
  const sep = widths.map(w => '─'.repeat(w + 2)).join('┼');
  const line = (cells: string[]) =>
    '│ ' + cells.map((c, i) => pad(c, widths[i])).join(' │ ') + ' │';

  return [
    '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐',
    line(headers.map(h => c.bold(h))),
    '├' + sep + '┤',
    ...rows.map(r => line(r)),
    '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘',
  ].join('\n');
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return bytes + ' B';
}

export function formatNumber(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}
