/**
 * Formatting utilities for display purposes
 */

/**
 * Safely convert a value to a valid number, returning default if invalid
 */
function safeNumber(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined) return defaultValue;
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num) || num < 0) return defaultValue;
  return num;
}

/**
 * Convert a memory value to GB for display.
 * Auto-detects the input unit based on magnitude since the backend
 * may send bytes, KiB, or MiB depending on the field / version.
 * GPU VRAM is typically 4–192 GB, so:
 *   > 1 billion  → bytes  (÷ 1024³)
 *   > 1 million  → KiB    (÷ 1024²)
 *   > 10,000     → MiB    (÷ 1024)
 *   ≤ 10,000     → already GB
 */
function toGB(value: number | null | undefined): number {
  const safe = safeNumber(value, 0);
  if (safe === 0) return 0;
  if (safe > 1_000_000_000) return Math.round((safe / (1024 * 1024 * 1024)) * 10) / 10;
  if (safe > 1_000_000) return Math.round((safe / (1024 * 1024)) * 10) / 10;
  if (safe > 10_000) return Math.round((safe / 1024) * 10) / 10;
  return Math.round(safe * 10) / 10;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return Math.round(ms) + "ms";
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatHour(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}${period}`;
}

export { toGB, formatNumber, formatDuration, formatDate, formatHour };
