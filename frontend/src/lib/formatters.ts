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

function formatNumber(value: number | null | undefined): string {
  const n = safeNumber(value, 0);
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

/**
 * Format bytes into a human-readable string (B, KB, MB, GB, TB).
 */
function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * A duration, in the unit a reader can hold in their head.
 *
 * Sub-second latencies are read as integers ("412 ms"); anything longer stops
 * being a number you compare digit-by-digit and becomes a magnitude ("1.24 s").
 * Null is "—", never 0 — a metric the controller did not report is not a fast
 * one.
 */
function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

/**
 * Token counts at table density: lowercase suffixes, one decimal, no padding.
 *
 * Distinct from formatNumber's "1.2K / 3.40M" on purpose — a column of token
 * counts is scanned, not read, and the shorter glyphs keep the column narrow
 * enough to sit beside six other numeric columns.
 */
function formatCompactTokens(value: number | null | undefined): string {
  const n = safeNumber(value, 0);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}b`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

const RELATIVE_UNITS: Array<[seconds: number, label: string]> = [
  [31_536_000, "y"],
  [2_592_000, "mo"],
  [604_800, "w"],
  [86_400, "d"],
  [3600, "h"],
  [60, "min"],
];

/**
 * "3 min ago" with a non-breaking space, so a timestamp never wraps onto two
 * lines inside a table cell and doubles the row height.
 */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 45) return "just now";
  for (const [size, label] of RELATIVE_UNITS) {
    if (seconds >= size) return `${Math.floor(seconds / size)} ${label} ago`;
  }
  return `${seconds} s ago`;
}

export {
  toGB,
  toGBFromMB,
  formatNumber,
  formatBytes,
  formatMs,
  formatCompactTokens,
  formatRelativeTime,
};
