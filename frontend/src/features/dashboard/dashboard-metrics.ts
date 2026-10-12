import type { Metrics, ProcessInfo } from "@/lib/types";

function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1) || clean;
}

function norm(value: string | null | undefined): string | null {
  const next = value?.trim().toLowerCase();
  return next ? next : null;
}

function identitySet(values: Array<string | null | undefined>): Set<string> {
  const ids = values
    .flatMap((value) => [value, basename(value)])
    .map(norm)
    .filter((value): value is string => Boolean(value));
  return new Set(ids);
}

export function processMetricIds(process: ProcessInfo | null): Set<string> {
  if (!process) return new Set();
  return identitySet([process.served_model_name, process.model_path]);
}

function metricIds(metrics: Metrics): Set<string> {
  return identitySet([metrics.model_id, metrics.served_model_name, metrics.model_path]);
}

function hasRuntimeCounters(metrics: Metrics): boolean {
  return [
    metrics.avg_ttft_ms,
    metrics.generation_throughput,
    metrics.prompt_throughput,
    metrics.generation_tokens_total,
    metrics.prompt_tokens_total,
    metrics.total_tokens,
    metrics.tokens_total,
    metrics.running_requests,
  ].some((value) => typeof value === "number" && value > 0);
}

function idsOverlap(metricsIds: Set<string>, processIds: Set<string>): boolean {
  for (const metricId of metricsIds) {
    for (const processId of processIds) {
      if (
        metricId === processId ||
        (metricId.length >= 6 && processId.includes(metricId)) ||
        (processId.length >= 6 && metricId.includes(processId))
      ) {
        return true;
      }
    }
  }
  return false;
}

export function metricsWithProcessIdentity(
  metrics: Metrics | null,
  process: ProcessInfo | null,
): Metrics | null {
  if (!metrics || !process) return metrics;
  if (metricIds(metrics).size > 0) return metrics;
  return {
    ...metrics,
    model_id: process.served_model_name ?? basename(process.model_path),
    model_path: process.model_path,
    served_model_name: process.served_model_name ?? null,
  };
}

export function metricsBelongToProcess(
  metrics: Metrics | null,
  process: ProcessInfo | null,
): boolean {
  if (!metrics) return false;
  if (!process) return false;
  const ids = processMetricIds(process);
  if (ids.size === 0) return false;
  const idsFromMetrics = metricIds(metrics);
  if (idsFromMetrics.size === 0) return hasRuntimeCounters(metrics);
  return idsOverlap(idsFromMetrics, ids);
}

export function scopedMetrics(
  metrics: Metrics | null,
  process: ProcessInfo | null,
): Metrics | null {
  return metricsBelongToProcess(metrics, process) ? metrics : null;
}
