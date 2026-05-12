// CRITICAL
import type {
  GPU,
  LaunchProgressData,
  Metrics,
  ProcessInfo,
  RuntimePlatformKind,
} from "@/lib/types";
import type { LeaseInfo, RuntimeSummaryData, ServiceEntry, StatusData } from "./types";

function areProcessInfosEqual(a: ProcessInfo | null, b: ProcessInfo | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.pid === b.pid &&
    a.backend === b.backend &&
    a.model_path === b.model_path &&
    a.port === b.port &&
    (a.served_model_name ?? null) === (b.served_model_name ?? null)
  );
}

export function areStatusEqual(a: StatusData | null, b: StatusData | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.running === b.running &&
    a.inference_port === b.inference_port &&
    areProcessInfosEqual(a.process, b.process)
  );
}

const GPU_STABLE_KEYS = [
  "index",
  "name",
  "memory_total",
  "memory_used",
  "memory_free",
  "utilization",
] as const satisfies ReadonlyArray<keyof GPU>;

const GPU_NULLABLE_KEYS = [
  "temperature",
  "power_draw",
  "power_limit",
] as const satisfies ReadonlyArray<keyof GPU>;

function areGpuEntriesEqual(left: GPU, right: GPU): boolean {
  return (
    GPU_STABLE_KEYS.every((key) => left[key] === right[key]) &&
    GPU_NULLABLE_KEYS.every((key) => (left[key] ?? null) === (right[key] ?? null))
  );
}

export function areGpusEqual(a: GPU[], b: GPU[]) {
  if (a === b) return true;
  return a.length === b.length && a.every((left, index) => areGpuEntriesEqual(left, b[index]!));
}

export function arePlatformKindsEqual(
  a: RuntimePlatformKind | null,
  b: RuntimePlatformKind | null,
) {
  return a === b;
}

export function areMetricsEqual(a: Metrics | null, b: Metrics | null) {
  if (a === b) return true;
  if (!a || !b) return false;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!(key in b)) return false;
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }

  return true;
}

export function areLaunchProgressEqual(a: LaunchProgressData | null, b: LaunchProgressData | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.recipe_id === b.recipe_id &&
    a.stage === b.stage &&
    a.message === b.message &&
    (a.progress ?? null) === (b.progress ?? null)
  );
}

export function areRuntimeSummariesEqual(
  a: RuntimeSummaryData | null,
  b: RuntimeSummaryData | null,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.platform.kind !== b.platform.kind) return false;
  if (a.gpu_monitoring.available !== b.gpu_monitoring.available) return false;
  if (a.gpu_monitoring.tool !== b.gpu_monitoring.tool) return false;
  for (const key of ["vllm", "sglang", "llamacpp"] as const) {
    if (a.backends[key].installed !== b.backends[key].installed) return false;
    if (a.backends[key].version !== b.backends[key].version) return false;
  }
  return true;
}

export function areServicesEqual(a: ServiceEntry[], b: ServiceEntry[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const l = a[i]!;
    const r = b[i]!;
    if (l.id !== r.id || l.kind !== r.kind || l.status !== r.status) return false;
  }
  return true;
}

export function areLeasesEqual(a: LeaseInfo | null, b: LeaseInfo | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.holder === b.holder;
}
