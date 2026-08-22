import type { GpuInfo } from "../models/types";
import type { UsageAggregate } from "../../stores/inference-request-store";

export type GpuRollup = ReturnType<typeof rollupGpus>;

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

/**
 * GPU totals shared by the metrics collector and the current-metrics route.
 * @param gpus - Snapshot of every GPU the platform layer reported.
 * @returns Power draw, VRAM use, VRAM capacity and power limit summed across the pool.
 */
export const rollupGpus = (
  gpus: readonly GpuInfo[],
): { powerWatts: number; vramUsedGb: number; vramCapacityGb: number; powerLimitWatts: number } => ({
  powerWatts: gpus.reduce((sum, gpu) => sum + gpu.power_draw, 0),
  vramUsedGb: gpus.reduce((sum, gpu) => sum + gpu.memory_used_mb / 1024, 0),
  vramCapacityGb: gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb / 1024, 0),
  powerLimitWatts: gpus.reduce((sum, gpu) => sum + gpu.power_limit, 0),
});

/** The lifetime counters every metrics snapshot carries. */
export const lifetimeFields = (
  lifetime: Record<string, number>,
  currentPowerWatts: number,
): Record<string, number> => ({
  lifetime_prompt_tokens: lifetime["prompt_tokens_total"] ?? 0,
  lifetime_completion_tokens: lifetime["completion_tokens_total"] ?? 0,
  lifetime_requests: lifetime["requests_total"] ?? 0,
  lifetime_energy_kwh: (lifetime["energy_wh"] ?? 0) / 1000,
  lifetime_uptime_hours: (lifetime["uptime_seconds"] ?? 0) / 3600,
  current_power_watts: currentPowerWatts,
});

/** The rounded GPU pool fields every metrics snapshot carries. */
export const gpuFields = (gpus: GpuRollup): Record<string, number> => ({
  vram_used_gb: Math.round(gpus.vramUsedGb * 10) / 10,
  vram_capacity_gb: Math.round(gpus.vramCapacityGb * 10) / 10,
  power_limit_watts: Math.round(gpus.powerLimitWatts),
});

/** Token and request totals, preferring live engine counters over stored usage. */
export const tokenTotalFields = (
  usageTotals: UsageAggregate["totals"] | undefined,
  promptTokensTotal: number,
  generationTokensTotal: number,
): Record<string, number | undefined> => ({
  prompt_tokens_total:
    positiveOrUndefined(promptTokensTotal) ?? positiveOrUndefined(usageTotals?.prompt_tokens),
  generation_tokens_total:
    positiveOrUndefined(generationTokensTotal) ??
    positiveOrUndefined(usageTotals?.completion_tokens),
  total_tokens: positiveOrUndefined(usageTotals?.total_tokens),
  total_requests: positiveOrUndefined(usageTotals?.total_requests),
});

/** All-time and best-session peaks recorded for a model. */
export const peakFields = (
  peakData: Record<string, unknown> | null,
  bestSessionPeakData: Record<string, unknown> | null,
): Record<string, unknown> => ({
  best_session_peak_id: bestSessionPeakData?.["session_id"] ?? null,
  best_session_prefill_tps: bestSessionPeakData?.["peak_prefill_tps"] ?? null,
  best_session_generation_tps: bestSessionPeakData?.["peak_generation_tps"] ?? null,
  best_session_ttft_ms: bestSessionPeakData?.["best_ttft_ms"] ?? null,
  peak_prefill_tps: peakData?.["prefill_tps"] ?? null,
  peak_generation_tps: peakData?.["generation_tps"] ?? null,
  peak_ttft_ms: peakData?.["ttft_ms"] ?? null,
});
