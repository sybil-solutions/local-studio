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

function formatNumber(value: number | null | undefined): string {
  const n = safeNumber(value, 0);
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatDuration(value: number | null | undefined): string {
  const ms = safeNumber(value, 0);
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return Math.round(ms) + "ms";
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
 * Format seconds as mm:ss (e.g. recording/timer display).
 */
function formatDurationMmSs(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export {
  toGB,
  toGBFromMB,
  formatNumber,
  formatDuration,
  formatDate,
  formatBytes,
  formatDurationMmSs,
};
