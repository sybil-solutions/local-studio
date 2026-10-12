export const positiveOrUndefined = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export interface SessionPeaks {
  prompt_throughput: number;
  generation_throughput: number;
  ttft_ms: number;
  kv_cache_usage: number;
  running_requests: number;
  power_watts: number;
  vram_used_gb: number;
}

export const emptyPeaks = (): SessionPeaks => ({
  prompt_throughput: 0,
  generation_throughput: 0,
  ttft_ms: 0,
  kv_cache_usage: 0,
  running_requests: 0,
  power_watts: 0,
  vram_used_gb: 0,
});

export const bumpPeak = (peaks: SessionPeaks, key: keyof SessionPeaks, value: number): void => {
  if (Number.isFinite(value) && value > peaks[key]) peaks[key] = value;
};

export const bumpBestLower = (
  peaks: SessionPeaks,
  key: keyof SessionPeaks,
  value: number,
): void => {
  if (!Number.isFinite(value) || value <= 0) return;
  if (peaks[key] === 0 || value < peaks[key]) peaks[key] = value;
};

/**
 * Return the first finite Prometheus metric value for a list of compatible metric names.
 * @param metrics - Scraped Prometheus metrics keyed by metric name.
 * @param names - Candidate metric names in priority order.
 * @returns First finite metric value, or zero when none exists.
 */
export const firstMetric = (metrics: Record<string, number>, names: string[]): number => {
  for (const name of names) {
    const value = metrics[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
};
