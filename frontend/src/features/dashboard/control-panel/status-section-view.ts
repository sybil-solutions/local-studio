import type { GPU, Metrics, ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { toGBFromMB } from "@/lib/formatters";

export type MetricSampleInput = {
  key: string;
  generation: number;
  generationPeak: number;
  prefill: number;
  prefillPeak: number;
  active: boolean;
};

/**
 * One cell of the metric strip.
 *
 * Every number on the strip is this shape — there is no second-class cell that
 * shows a bare figure with no unit and no sub-line. A reader scanning down the
 * strip should be able to answer "what is this, in what units, and how does it
 * compare" for all of them, or the cell should not be on the strip at all.
 *
 * `fill` (0–1) opts a cell into the hairline meter: only meaningful for values
 * that are a share of a stated cap, which is why VRAM and KV cache carry one
 * and throughput does not.
 */
export type MetricColumnView = {
  label: string;
  value: string | null;
  unit: string;
  detail?: string;
  detailTitle?: string;
  fill?: number;
};

/**
 * A labelled cluster of two cells. The strip reads as three questions —
 * how fast is it, how loaded is it, how full is it — and the group caption
 * names the question so the reader does not have to reconstruct it from six
 * unrelated-looking columns.
 */
export type MetricGroupView = {
  label: string;
  metrics: MetricColumnView[];
};

/**
 * Session peaks only. The strip used to fall back through best-session and
 * all-time figures when the session peak was missing — which silently mixed
 * numbers from different runs into one "max" and made the peaks impossible to
 * trust. A peak the current session did not produce is not shown.
 */
const SESSION_PEAK_FIELDS = {
  generation: [
    "session_peak_generation_tps",
    "session_peak_generation_throughput",
    "session_peak_generation",
  ],
  prefill: ["session_peak_prefill_tps", "session_peak_prompt_throughput", "session_peak_prefill"],
  ttft: ["session_peak_best_ttft_ms", "session_peak_ttft_ms"],
} as const satisfies Record<string, readonly (keyof Metrics)[]>;

type PeakKind = keyof typeof SESSION_PEAK_FIELDS;

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
    displayPlatformKind: platformKind ?? null,
    displayPort: inferencePort || currentProcess?.port || undefined,
    isRunning,
    metricGroups: metricGroupViews(metrics, perf),
    modelName: resolveModelName(currentProcess, currentRecipe),
    pid: currentProcess?.pid,
    sampleInput: {
      key: resolveModelSampleKey(currentProcess, currentRecipe),
      generation: perf.genTps ?? 0,
      generationPeak: sessionPeak(metrics, "generation") ?? perf.genTps ?? 0,
      prefill: perf.prefillTps ?? 0,
      prefillPeak: sessionPeak(metrics, "prefill") ?? perf.prefillTps ?? 0,
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
    pending: metrics?.pending_requests ?? 0,
    kvCache: asPercent(metrics?.kv_cache_usage),
    kvCachePeak: asPercent(metrics?.session_peak_kv_cache_usage),
    totalMemUsed: firstPositive(gpuTotals.memUsed, metrics?.vram_used_gb),
    vramCapacity: firstPositive(gpuTotals.memCapacity, metrics?.vram_capacity_gb),
  };
}

function resolveGpuTotals(gpus: GPU[]) {
  return gpus.reduce(
    (totals, gpu) => ({
      memCapacity: totals.memCapacity + gpuMemoryTotal(gpu),
      memUsed: totals.memUsed + gpuMemoryUsed(gpu),
    }),
    { memCapacity: 0, memUsed: 0 },
  );
}

type Perf = ReturnType<typeof resolvePerformanceMetrics>;

/**
 * Three labelled clusters: speed, load, memory.
 *
 * Decode and prefill are *aggregate* engine throughput — under concurrency
 * they rise with batch size while each caller's stream slows down. The decode
 * sub-line therefore switches to a per-request figure whenever more than one
 * request is running, because "70 tok/s" means something different at one
 * request than at eight and the strip should say which one it is showing.
 */
function metricGroupViews(metrics: Metrics | null, perf: Perf): MetricGroupView[] {
  const vramShare = share(perf.totalMemUsed, perf.vramCapacity);
  return [
    {
      label: "Throughput",
      metrics: [
        {
          label: "Decode",
          value: metricValue(perf.genTps, 1),
          unit: "tok/s",
          ...decodeDetail(metrics, perf),
        },
        {
          label: "Prefill",
          value: metricValue(perf.prefillTps, 1),
          unit: "tok/s",
          ...sessionPeakDetail(metrics, "prefill", "max", 1, ""),
        },
      ],
    },
    {
      label: "Load",
      metrics: [
        {
          label: "Requests",
          value: String(perf.sessions),
          unit: "live",
          detail: requestsDetail(perf),
          detailTitle:
            "Requests the engine is decoding right now, the session peak, and any admitted but unscheduled requests",
        },
        {
          label: "TTFT avg",
          value: metricValue(perf.ttftMs, 0),
          unit: "ms",
          ...sessionPeakDetail(metrics, "ttft", "best", 0, " ms"),
        },
      ],
    },
    {
      label: "Memory",
      metrics: [
        {
          label: "VRAM",
          value: positiveMetricValue(perf.totalMemUsed, 0),
          unit: "GB",
          detail: capDetail(vramShare, perf.vramCapacity, "GB"),
          detailTitle: "GPU memory in use across every visible device",
          fill: vramShare ?? undefined,
        },
        {
          label: "KV cache",
          value: perf.kvCache != null ? perf.kvCache.toFixed(0) : null,
          unit: "%",
          detail: perf.kvCachePeak != null ? `peak ${perf.kvCachePeak.toFixed(0)}%` : "peak —",
          detailTitle: "Share of paged KV blocks allocated; sustained highs precede preemption",
          fill: perf.kvCache != null ? clamp01(perf.kvCache / 100) : undefined,
        },
      ],
    },
  ];
}

/**
 * At one request the interesting comparison is the session max; at several it
 * is what each caller is actually getting.
 */
function decodeDetail(
  metrics: Metrics | null,
  perf: Perf,
): { detail?: string; detailTitle?: string } {
  if (perf.sessions > 1 && perf.genTps != null) {
    const perReq = perf.genTps / perf.sessions;
    return {
      detail: `~${perReq.toFixed(1)}/req × ${perf.sessions}`,
      detailTitle: `Aggregate across ${perf.sessions} concurrent requests — each stream is decoding at roughly ${perReq.toFixed(1)} tok/s`,
    };
  }
  return sessionPeakDetail(metrics, "generation", "max", 1, "");
}

function requestsDetail(perf: Perf): string {
  const peak = perf.peakReq > 0 ? `peak ${perf.peakReq}` : "peak —";
  return perf.pending > 0 ? `${peak} · ${perf.pending} queued` : peak;
}

function capDetail(
  shareValue: number | null,
  cap: number | null,
  unit: string,
): string | undefined {
  if (shareValue === null || cap === null) return undefined;
  return `${Math.round(shareValue * 100)}% of ${cap.toFixed(0)} ${unit}`;
}

function share(value: number | null, total: number | null): number | null {
  if (value === null || total === null || total <= 0) return null;
  return clamp01(value / total);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** vLLM reports a 0–1 ratio, llama.cpp a percentage. Normalise to percent. */
function asPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value <= 1 ? value * 100 : Math.min(100, value);
}

function readField(metrics: Metrics | null, field: keyof Metrics): number | null {
  const value = metrics?.[field];
  return typeof value === "number" ? value : null;
}

function sessionPeak(metrics: Metrics | null, kind: PeakKind): number | null {
  return firstPositive(...SESSION_PEAK_FIELDS[kind].map((f) => readField(metrics, f)));
}

function sessionPeakDetail(
  metrics: Metrics | null,
  kind: PeakKind,
  label: string,
  digits: number,
  suffix: string,
): { detail?: string; detailTitle?: string } {
  const text = positiveMetricValue(sessionPeak(metrics, kind), digits);
  if (!text) return {};
  return {
    detail: `${label} ${text}${suffix}`,
    detailTitle: `current session ${label}: ${text}${suffix}`,
  };
}

function metricValue(value: number | null, digits: number): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value.toFixed(digits)
    : (0).toFixed(digits);
}

function positiveMetricValue(value: number | null, digits: number): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value.toFixed(digits)
    : null;
}

function gpuMemoryUsed(gpu: GPU): number {
  return toGBFromMB(gpu.memory_used_mb);
}

function gpuMemoryTotal(gpu: GPU): number {
  return toGBFromMB(gpu.memory_total_mb);
}

function firstPositive(...values: Array<number | null | undefined>): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}
