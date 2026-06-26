import type { GPU, Metrics, ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { toGB, toGBFromMB } from "@/lib/formatters";

export type MetricSampleInput = {
  key: string;
  generation: number;
  generationPeak: number;
  prefill: number;
  prefillPeak: number;
  ttft: number;
  ttftPeak: number;
  requests: number;
  requestPeak: number;
  active: boolean;
};

export type MetricColumnView = {
  label: string;
  value: string | null;
  unit: string;
  detail?: string;
  detailTitle?: string;
};

export type CompactMetricView = {
  label: string;
  value: string | null;
};

export type RuntimeMetricView = {
  label: string;
  title?: string;
  value: string;
};

type StatusSectionViewInput = {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  gpus: GPU[];
  inferencePort?: number;
  metrics: Metrics | null;
  platformKind?: RuntimePlatformKind | null;
};

export function resolveStatusSectionView({
  currentProcess,
  currentRecipe,
  gpus,
  inferencePort,
  metrics,
  platformKind,
}: StatusSectionViewInput) {
  const isRunning = Boolean(currentProcess);
  const perf = resolvePerformanceMetrics(metrics, gpus);
  return {
    backend: currentProcess?.backend,
    compactMetrics: compactMetricViews(perf),
    displayPlatformKind: platformKind ?? null,
    displayPort: inferencePort || currentProcess?.port || undefined,
    isRunning,
    metricColumns: metricColumnViews(metrics, perf),
    modelName: resolveModelName(currentProcess, currentRecipe),
    runtimeMetrics: runtimeMetricViews(metrics),
    sampleInput: {
      key: resolveModelSampleKey(currentProcess, currentRecipe),
      generation: perf.genTps ?? 0,
      generationPeak: generationPeak(metrics) ?? perf.genTps ?? 0,
      prefill: perf.prefillTps ?? 0,
      prefillPeak: prefillPeak(metrics) ?? perf.prefillTps ?? 0,
      ttft: perf.ttftMs ?? 0,
      ttftPeak: ttftPeak(metrics) ?? perf.ttftMs ?? 0,
      requests: perf.sessions,
      requestPeak: perf.peakReq || perf.sessions,
      active: isRunning,
    },
  };
}

function resolveModelName(
  currentProcess: ProcessInfo | null,
  currentRecipe: RecipeWithStatus | null,
): string {
  return (
    currentRecipe?.name ||
    currentProcess?.served_model_name ||
    currentProcess?.model_path?.split("/").pop() ||
    "No model loaded"
  );
}

function resolveModelSampleKey(
  currentProcess: ProcessInfo | null,
  currentRecipe: RecipeWithStatus | null,
): string {
  return (
    currentProcess?.served_model_name || currentProcess?.model_path || currentRecipe?.id || "idle"
  );
}

function resolvePerformanceMetrics(metrics: Metrics | null, gpus: GPU[]) {
  const gpuTotals = resolveGpuTotals(gpus);
  return {
    genTps: firstPositive(metrics?.generation_throughput, metrics?.session_avg_generation),
    prefillTps: firstPositive(metrics?.prompt_throughput, metrics?.session_avg_prefill),
    ttftMs: firstPositive(metrics?.avg_ttft_ms),
    sessions: metrics?.running_requests ?? 0,
    peakReq: metrics?.session_peak_running_requests ?? 0,
    totalMemUsed: firstPositive(gpuTotals.memUsed, metrics?.vram_used_gb),
    vramCapacity: firstPositive(gpuTotals.memCapacity, metrics?.vram_capacity_gb),
    totalPower: firstPositive(gpuTotals.power, metrics?.current_power_watts),
    powerLimit: firstPositive(gpuTotals.powerLimit, metrics?.power_limit_watts),
  };
}

function resolveGpuTotals(gpus: GPU[]) {
  return gpus.reduce(
    (totals, gpu) => ({
      memCapacity: totals.memCapacity + gpuMemoryTotal(gpu),
      memUsed: totals.memUsed + gpuMemoryUsed(gpu),
      power: totals.power + (gpu.power_draw || 0),
      powerLimit: totals.powerLimit + (gpu.power_limit || 0),
    }),
    { memCapacity: 0, memUsed: 0, power: 0, powerLimit: 0 },
  );
}

function metricColumnViews(
  metrics: Metrics | null,
  perf: ReturnType<typeof resolvePerformanceMetrics>,
): MetricColumnView[] {
  return [
    {
      label: "Decode",
      value: metricValue(perf.genTps, 1),
      unit: "tok/s",
      ...generationMaxDetail(metrics),
    },
    {
      label: "TTFT",
      value: metricValue(perf.ttftMs, 0),
      unit: "ms",
      ...ttftMaxDetail(metrics),
    },
    {
      label: "Prefill",
      value: metricValue(perf.prefillTps, 1),
      unit: "t/s",
      ...prefillMaxDetail(metrics),
    },
  ];
}

function compactMetricViews(
  perf: ReturnType<typeof resolvePerformanceMetrics>,
): CompactMetricView[] {
  return [
    { label: "Req", value: `${perf.sessions}/${perf.peakReq || perf.sessions}` },
    { label: "VRAM", value: ratioMetric(perf.totalMemUsed, perf.vramCapacity, "G", 1) },
    { label: "Power", value: ratioMetric(perf.totalPower, perf.powerLimit, "W") },
  ];
}

function runtimeMetricViews(metrics: Metrics | null): RuntimeMetricView[] {
  return [
    {
      label: "app tokens",
      title: "Total tokens recorded by the Local Studio request log for this model.",
      value: tokenTotalMetric(metrics),
    },
    {
      label: "engine prompt",
      title: "Prompt/prefill token counter reported by the running inference engine.",
      value: tokenMetric(metrics?.prompt_tokens_total),
    },
    {
      label: "engine decode",
      title: "Decode/completion token counter reported by the running inference engine.",
      value: tokenMetric(metrics?.generation_tokens_total),
    },
    {
      label: "avg latency",
      title: "Average request latency recorded by the Local Studio request log.",
      value: durationMetric(metrics?.latency_avg),
    },
  ];
}

function generationMaxDetail(metrics: Metrics | null) {
  return speedMaxDetail({
    session: currentSessionGenerationPeak(metrics),
    bestSession: bestSessionGenerationPeak(metrics),
    all: allTimeGenerationPeak(metrics),
    digits: 1,
  });
}

function prefillMaxDetail(metrics: Metrics | null) {
  return speedMaxDetail({
    session: currentSessionPrefillPeak(metrics),
    bestSession: bestSessionPrefillPeak(metrics),
    all: allTimePrefillPeak(metrics),
    digits: 1,
  });
}

function ttftMaxDetail(metrics: Metrics | null) {
  return speedMaxDetail({
    session: currentSessionTtftPeak(metrics),
    bestSession: bestSessionTtftPeak(metrics),
    all: allTimeTtftPeak(metrics),
    digits: 0,
    suffix: " ms",
    label: "best",
  });
}

function generationPeak(metrics: Metrics | null): number | null {
  return firstPositive(
    currentSessionGenerationPeak(metrics),
    bestSessionGenerationPeak(metrics),
    allTimeGenerationPeak(metrics),
  );
}

function prefillPeak(metrics: Metrics | null): number | null {
  return firstPositive(
    currentSessionPrefillPeak(metrics),
    bestSessionPrefillPeak(metrics),
    allTimePrefillPeak(metrics),
  );
}

function ttftPeak(metrics: Metrics | null): number | null {
  return firstPositive(
    currentSessionTtftPeak(metrics),
    bestSessionTtftPeak(metrics),
    allTimeTtftPeak(metrics),
  );
}

function currentSessionGenerationPeak(metrics: Metrics | null): number | null {
  return firstPositive(
    metrics?.session_peak_generation_tps,
    metrics?.session_peak_generation_throughput,
    metrics?.session_peak_generation,
  );
}

function bestSessionGenerationPeak(metrics: Metrics | null): number | null {
  return firstPositive(metrics?.best_session_generation_tps, metrics?.session_peak_generation_tps);
}

function allTimeGenerationPeak(metrics: Metrics | null): number | null {
  return firstPositive(metrics?.peak_generation_tps);
}

function currentSessionPrefillPeak(metrics: Metrics | null): number | null {
  return firstPositive(
    metrics?.session_peak_prefill_tps,
    metrics?.session_peak_prompt_throughput,
    metrics?.session_peak_prefill,
  );
}

function bestSessionPrefillPeak(metrics: Metrics | null): number | null {
  return firstPositive(metrics?.best_session_prefill_tps, metrics?.session_peak_prefill_tps);
}

function allTimePrefillPeak(metrics: Metrics | null): number | null {
  return firstPositive(metrics?.peak_prefill_tps);
}

function currentSessionTtftPeak(metrics: Metrics | null): number | null {
  return firstPositive(metrics?.session_peak_best_ttft_ms, metrics?.session_peak_ttft_ms);
}

function bestSessionTtftPeak(metrics: Metrics | null): number | null {
  return firstPositive(metrics?.best_session_ttft_ms, metrics?.session_peak_best_ttft_ms);
}

function allTimeTtftPeak(metrics: Metrics | null): number | null {
  return firstPositive(metrics?.peak_ttft_ms);
}

function metricValue(value: number | null, digits: number): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value.toFixed(digits)
    : (0).toFixed(digits);
}

function ratioMetric(
  value: number | null,
  total: number | null,
  unit: string,
  valueDigits = 0,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return null;
  return `${value.toFixed(valueDigits)}/${total.toFixed(0)}${unit}`;
}

function speedMaxDetail({
  session,
  bestSession,
  all,
  digits,
  suffix = "",
  label = "max",
}: {
  session: number | null;
  bestSession: number | null;
  all: number | null;
  digits: number;
  suffix?: string;
  label?: string;
}): { detail?: string; detailTitle?: string } {
  const sessionText = positiveMetricValue(session, digits);
  const bestSessionText = positiveMetricValue(bestSession, digits);
  const allText = positiveMetricValue(all, digits);
  const rows = [
    sessionText ? `current session ${label}: ${sessionText}${suffix}` : null,
    bestSessionText ? `best session ${label}: ${bestSessionText}${suffix}` : null,
    allText ? `all-time ${label}: ${allText}${suffix}` : null,
  ].filter((row): row is string => Boolean(row));
  const fallbackText = sessionText ?? bestSessionText ?? allText;
  return {
    detail: fallbackText ? `${label} ${fallbackText}${suffix}` : undefined,
    detailTitle: rows.length ? rows.join(" | ") : undefined,
  };
}

function positiveMetricValue(value: number | null, digits: number): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value.toFixed(digits)
    : null;
}

function tokenMetric(...values: Array<number | undefined>): string {
  const value = values.find(
    (item) => typeof item === "number" && Number.isFinite(item) && item >= 0,
  );
  return typeof value === "number" ? Math.round(value).toLocaleString() : "0";
}

function tokenTotalMetric(metrics: Metrics | null): string {
  const explicit = tokenMetric(metrics?.total_tokens, metrics?.tokens_total);
  if (explicit !== "0") return explicit;
  if (
    typeof metrics?.prompt_tokens_total === "number" &&
    typeof metrics.generation_tokens_total === "number"
  ) {
    return tokenMetric(metrics.prompt_tokens_total + metrics.generation_tokens_total);
  }
  return explicit;
}

function durationMetric(value: number | undefined): string {
  if (!value || value <= 0) return "0ms";
  return value > 1000 ? `${(value / 1000).toFixed(2)}s` : `${value.toFixed(0)}ms`;
}

function gpuMemoryUsed(gpu: GPU): number {
  if (gpu.memory_used_mb != null) return toGBFromMB(gpu.memory_used_mb);
  return toGB(gpu.memory_used ?? 0);
}

function gpuMemoryTotal(gpu: GPU): number {
  if (gpu.memory_total_mb != null) return toGBFromMB(gpu.memory_total_mb);
  return toGB(gpu.memory_total ?? 0);
}

function firstPositive(...values: Array<number | null | undefined>): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}
