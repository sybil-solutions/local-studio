// CRITICAL
"use client";

import { useSyncExternalStore } from "react";
import type {
  GPU,
  LaunchProgressData,
  Metrics,
  ProcessInfo,
  RuntimeBackendInfo,
} from "@/lib/types";
import api from "@/lib/api";
import type { RealtimeStatusSnapshot } from "./realtime-status-store/types";
import type {
  JobEntry,
  LeaseInfo,
  RuntimeSummaryData,
  ServiceEntry,
} from "./realtime-status-store/types";
import {
  areGpusEqual,
  areJobsEqual,
  areLaunchProgressEqual,
  areLeasesEqual,
  areMetricsEqual,
  arePlatformKindsEqual,
  areRuntimeSummariesEqual,
  areServicesEqual,
  areStatusEqual,
} from "./realtime-status-store/equality";

const FAST_STATUS_REQUEST = { timeout: 5_000, retries: 0 } as const;
const FAST_COMPAT_REQUEST = { timeout: 5_000, retries: 0 } as const;
const FAST_GPU_REQUEST = { timeout: 5_000, retries: 0 } as const;

const unavailableBackend = (): RuntimeBackendInfo => ({
  installed: false,
  version: null,
});

function normalizeRuntimeBackends(
  backends: Partial<RuntimeSummaryData["backends"]> | null | undefined,
): RuntimeSummaryData["backends"] {
  return {
    vllm: backends?.vllm ?? unavailableBackend(),
    mlx: backends?.mlx ?? unavailableBackend(),
    sglang: backends?.sglang ?? unavailableBackend(),
    llamacpp: backends?.llamacpp ?? unavailableBackend(),
    ...(backends?.exllamav3 ? { exllamav3: backends.exllamav3 } : {}),
  };
}

const initialSnapshot: RealtimeStatusSnapshot = {
  status: null,
  gpus: [],
  metrics: null,
  launchProgress: null,
  platformKind: null,
  runtimeSummary: null,
  services: [],
  lease: null,
  jobs: [],
  lastEventAt: 0,
};

let snapshot: RealtimeStatusSnapshot = initialSnapshot;
const listeners = new Set<() => void>();
let started = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let clearLaunchTimer: ReturnType<typeof setTimeout> | null = null;

function emitIfChanged(next: RealtimeStatusSnapshot) {
  const changed =
    !areStatusEqual(snapshot.status, next.status) ||
    !areGpusEqual(snapshot.gpus, next.gpus) ||
    !areMetricsEqual(snapshot.metrics, next.metrics) ||
    !areLaunchProgressEqual(snapshot.launchProgress, next.launchProgress) ||
    !arePlatformKindsEqual(snapshot.platformKind, next.platformKind) ||
    !areRuntimeSummariesEqual(snapshot.runtimeSummary, next.runtimeSummary) ||
    !areServicesEqual(snapshot.services, next.services) ||
    !areLeasesEqual(snapshot.lease, next.lease) ||
    !areJobsEqual(snapshot.jobs, next.jobs);

  snapshot = changed ? next : { ...snapshot, lastEventAt: next.lastEventAt };
  if (!changed) return;

  for (const l of listeners) l();
}

function scheduleLaunchClear(stage: LaunchProgressData["stage"]) {
  if (clearLaunchTimer) {
    clearTimeout(clearLaunchTimer);
    clearLaunchTimer = null;
  }
  if (stage === "ready" || stage === "error" || stage === "cancelled") {
    clearLaunchTimer = setTimeout(() => {
      emitIfChanged({
        ...snapshot,
        launchProgress: null,
        lastEventAt: Date.now(),
      });
    }, 5000);
  }
}

async function fetchStatusNow() {
  const [statusResult, compatibilityResult, gpuResult, metricsResult] = await Promise.allSettled([
    api.getStatus(FAST_STATUS_REQUEST),
    api.getCompatibility(FAST_COMPAT_REQUEST),
    api.getGPUs(FAST_GPU_REQUEST),
    api.getMetrics().catch(() => null),
  ]);

  const status = statusResult.status === "fulfilled" ? statusResult.value : null;
  const compatibility =
    compatibilityResult.status === "fulfilled" ? compatibilityResult.value : null;
  const gpus =
    gpuResult.status === "fulfilled" ? (gpuResult.value.gpus ?? snapshot.gpus) : snapshot.gpus;
  const polledMetrics =
    metricsResult.status === "fulfilled" && metricsResult.value
      ? (metricsResult.value as Metrics)
      : snapshot.metrics;

  if (status) {
    const { running, process, inference_port } = status;

    // Hydrate runtime summary from /compat fallback
    let runtimeSummary = snapshot.runtimeSummary;
    if (!runtimeSummary && compatibility) {
      const fallbackVendor =
        compatibility.platform.kind === "cuda"
          ? "nvidia"
          : compatibility.platform.kind === "rocm"
            ? "amd"
            : null;
      runtimeSummary = {
        platform: { kind: compatibility.platform.kind, vendor: fallbackVendor },
        gpu_monitoring: compatibility.gpu_monitoring,
        backends: normalizeRuntimeBackends(compatibility.backends),
      };
    }

    emitIfChanged({
      status: { running, process, inference_port },
      gpus,
      metrics: polledMetrics,
      launchProgress: snapshot.launchProgress,
      platformKind: compatibility?.platform?.kind ?? snapshot.platformKind,
      runtimeSummary,
      services: snapshot.services,
      lease: snapshot.lease,
      jobs: snapshot.jobs,
      lastEventAt: Date.now(),
    });
  }
}

function start() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  const onControllerEvent = (event: Event) => {
    const custom = event as CustomEvent<{ type?: string; data?: Record<string, unknown> }>;
    const type = custom.detail?.type;
    const data = custom.detail?.data ?? {};

    const now = Date.now();

    if (type === "status") {
      const running = Boolean(data["running"] ?? data["process"]);
      const process = (data["process"] ?? null) as ProcessInfo | null;
      const inference_port = Number(data["inference_port"] ?? 8000);
      emitIfChanged({
        ...snapshot,
        status: { running, process, inference_port },
        lastEventAt: now,
      });
      return;
    }

    if (type === "gpu") {
      const list = (data["gpus"] ?? []) as GPU[];
      emitIfChanged({
        ...snapshot,
        gpus: Array.isArray(list) ? list : [],
        lastEventAt: now,
      });
      return;
    }

    if (type === "metrics") {
      // Merge with previous so a partial event doesn't blank fields.
      const merged = { ...(snapshot.metrics ?? {}), ...(data as Metrics) } as Metrics;
      emitIfChanged({
        ...snapshot,
        metrics: merged,
        lastEventAt: now,
      });
      return;
    }

    if (type === "launch_progress") {
      const progress = data as unknown as LaunchProgressData;
      scheduleLaunchClear(progress.stage);
      emitIfChanged({
        ...snapshot,
        launchProgress: progress,
        lastEventAt: now,
      });
      return;
    }

    if (type === "runtime_summary") {
      const platform = data["platform"] as { kind?: string; vendor?: string | null } | undefined;
      const nextKind =
        platform?.kind === "cuda" || platform?.kind === "rocm" || platform?.kind === "unknown"
          ? platform.kind
          : snapshot.platformKind;
      const nextVendor =
        platform?.vendor === "nvidia" || platform?.vendor === "amd"
          ? platform.vendor
          : nextKind === "cuda"
            ? "nvidia"
            : nextKind === "rocm"
              ? "amd"
              : null;

      const gpuMon = data["gpu_monitoring"] as RuntimeSummaryData["gpu_monitoring"] | undefined;
      const backends = data["backends"] as Partial<RuntimeSummaryData["backends"]> | undefined;
      const nextSummary: RuntimeSummaryData | null =
        platform && gpuMon && backends
          ? {
              platform: { kind: nextKind ?? "unknown", vendor: nextVendor },
              gpu_monitoring: gpuMon,
              backends: normalizeRuntimeBackends(backends),
            }
          : snapshot.runtimeSummary;

      const rawServices = data["services"] as ServiceEntry[] | undefined;
      const nextServices = Array.isArray(rawServices) ? rawServices : snapshot.services;
      const rawLease = data["lease"] as LeaseInfo | undefined;
      const nextLease = rawLease ?? snapshot.lease;

      emitIfChanged({
        status: snapshot.status,
        gpus: snapshot.gpus,
        metrics: snapshot.metrics,
        launchProgress: snapshot.launchProgress,
        platformKind: nextKind,
        runtimeSummary: nextSummary,
        services: nextServices,
        lease: nextLease,
        jobs: snapshot.jobs,
        lastEventAt: now,
      });
    }

    if (type === "job_updated") {
      const job = data as unknown as JobEntry;
      if (job?.id) {
        const nextJobs = snapshot.jobs.filter((j) => j.id !== job.id);
        nextJobs.unshift(job);
        emitIfChanged({ ...snapshot, jobs: nextJobs.slice(0, 50), lastEventAt: now });
      }
    }
  };

  window.addEventListener("vllm:controller-event", onControllerEvent as EventListener);

  // Initial fetch + polling fallback in case SSE is blocked.
  void fetchStatusNow();
  pollInterval = setInterval(() => {
    if (Date.now() - snapshot.lastEventAt < 10_000) return;
    void fetchStatusNow();
  }, 5000);

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      void fetchStatusNow();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) void fetchStatusNow();
  };
  window.addEventListener("pageshow", onPageShow);
}

export function useRealtimeStatusStore(): RealtimeStatusSnapshot {
  start();
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => snapshot,
    () => initialSnapshot,
  );
}
