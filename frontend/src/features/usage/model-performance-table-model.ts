import type { PeakMetrics } from "@/lib/types";

export type SortField =
  | "model"
  | "requests"
  | "tokens"
  | "success"
  | "latency"
  | "ttft"
  | "speed"
  | "cache_hit_rate";
export type SortDirection = "asc" | "desc";

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
  cache_hit_rate: number;
}

export type SpeedDisplay =
  | { kind: "empty" }
  | { kind: "rows"; muted: boolean; rows: string[] }
  | { kind: "single"; text: string };

export function modelDisplayName(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}

const compactRate = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
};

export function resolveSpeedDisplay(model: ModelData, peak: PeakMetrics | undefined): SpeedDisplay {
  if (model.prefill_tps || model.generation_tps) {
    return {
      kind: "rows",
      muted: false,
      rows: [
        model.prefill_tps ? `${compactRate(model.prefill_tps)} prefill/s` : null,
        model.generation_tps ? `${compactRate(model.generation_tps)} gen/s` : null,
      ].filter((row): row is string => Boolean(row)),
    };
  }
  if (model.tokens_per_sec) {
    return { kind: "single", text: `${compactRate(model.tokens_per_sec)} tok/s` };
  }
  if (peak?.generation_tps || peak?.prefill_tps) {
    return {
      kind: "rows",
      muted: true,
      rows: [
        peak.prefill_tps ? `${compactRate(peak.prefill_tps)} prefill/s` : null,
        peak.generation_tps ? `${compactRate(peak.generation_tps)} gen/s` : null,
      ].filter((row): row is string => Boolean(row)),
    };
  }
  return { kind: "empty" };
}
