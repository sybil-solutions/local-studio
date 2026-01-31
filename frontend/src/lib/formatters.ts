// CRITICAL
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
 *
 * The GPU API returns values in bytes. Other APIs may return MiB.
 * We detect based on magnitude:
 *   > 1 million → bytes (even 1MB = 1M bytes, smallest realistic GPU memory query)
 *   > 1,000     → MiB (1000 MiB = ~1GB, smallest realistic GPU)
 *   ≤ 1,000     → already GB
 */
function toGB(value: number | null | undefined): number {
  const safe = safeNumber(value, 0);
  if (safe === 0) return 0;
  // 1 million+ is definitely bytes (API returns bytes for GPU memory)
  if (safe > 1_000_000) return Math.round((safe / (1024 * 1024 * 1024)) * 100) / 100;
  // 1000-1M range is MiB (no GPU has less than 1GB)
  if (safe > 1_000) return Math.round((safe / 1024) * 100) / 100;
  // Small values assumed to already be in GB
  return Math.round(safe * 100) / 100;
}

function toGBFromMB(value: number | null | undefined): number {
  const safe = safeNumber(value, 0);
  if (safe === 0) return 0;
  return Math.round((safe / 1024) * 100) / 100;
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

export { toGB, toGBFromMB, formatNumber, formatDuration, formatDate, formatHour };
