import type { PeakMetrics } from "@/lib/types";

export interface ModelData {
  model: string;
  requests: number;
  total_tokens: number;
  success_rate: number;
  avg_latency_ms: number | null;
  avg_ttft_ms: number | null;
  tokens_per_sec: number | null;
  prefill_tps: number | null;
  generation_tps: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  avg_tokens: number;
  p50_latency_ms: number | null;
}

export type SpeedDisplay =
  | { kind: "empty" }
  | { kind: "rows"; muted: boolean; rows: string[] }
  | { kind: "single"; text: string };

/**
 * Resolve the short model label shown in usage tables.
 * @param modelId - Provider/model identifier.
 * @returns The last model path segment.
 */
export function modelDisplayName(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}

/**
 * Resolve the speed cell content with current metrics preferred over peak fallbacks.
 * @param model - Aggregated usage row.
 * @param peak - Peak metrics for the row, if available.
 * @returns Display state for the speed cell.
 */
export function resolveSpeedDisplay(model: ModelData, peak: PeakMetrics | undefined): SpeedDisplay {
  if (model.prefill_tps || model.generation_tps) {
    return {
      kind: "rows",
      muted: false,
      rows: [
        model.prefill_tps ? `${model.prefill_tps.toFixed(0)} prefill` : null,
        model.generation_tps ? `${model.generation_tps.toFixed(0)} gen` : null,
      ].filter((row): row is string => Boolean(row)),
    };
  }
  if (model.tokens_per_sec) {
    return { kind: "single", text: `${model.tokens_per_sec.toFixed(0)} tok/s` };
  }
  if (peak?.generation_tps || peak?.prefill_tps) {
    return {
      kind: "rows",
      muted: true,
      rows: [
        peak.prefill_tps ? `peak ${peak.prefill_tps.toFixed(0)} prefill` : null,
        peak.generation_tps ? `peak ${peak.generation_tps.toFixed(0)} gen` : null,
      ].filter((row): row is string => Boolean(row)),
    };
  }
  return { kind: "empty" };
}
