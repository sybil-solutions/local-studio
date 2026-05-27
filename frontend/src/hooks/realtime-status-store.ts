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
import { BACKEND_URL_CHANGED_EVENT } from "@/lib/backend-url";
import type {
  LeaseInfo,
  RealtimeStatusSnapshot,
  RuntimeSummaryData,
  ServiceEntry,
} from "./realtime-status-store/types";
import {
  areGpusEqual,
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
    sglang: backends?.sglang ?? unavailableBackend(),
    llamacpp: backends?.llamacpp ?? unavailableBackend(),
    ...(backends?.mlx ? { mlx: backends.mlx } : {}),
    ...(backends?.exllamav3 ? { exllamav3: backends.exllamav3 } : {}),
  };
}

const initialSnapshot: RealtimeStatusSnapshot = {
  status: null,
  statusLoading: true,
  gpus: [],
  metrics: null,
  launchProgress: null,
  platformKind: null,
  runtimeSummary: null,
  services: [],
  lease: null,
  lastEventAt: 0,
};

let snapshot: RealtimeStatusSnapshot = initialSnapshot;
const listeners = new Set<() => void>();
let started = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let clearLaunchTimer: ReturnType<typeof setTimeout> | null = null;

function processKey(process: ProcessInfo | null | undefined): string {
  if (!process) return "";
  return [
    process.pid,
    process.backend,
    process.port,
    process.served_model_name ?? "",
    process.model_path ?? "",
  ].join("|");
}

function emitIfChanged(next: RealtimeStatusSnapshot) {
  const changed =
    !areStatusEqual(snapshot.status, next.status) ||
    snapshot.statusLoading !== next.statusLoading ||
    !areGpusEqual(snapshot.gpus, next.gpus) ||
    !areMetricsEqual(snapshot.metrics, next.metrics) ||
    !areLaunchProgressEqual(snapshot.launchProgress, next.launchProgress) ||
    !arePlatformKindsEqual(snapshot.platformKind, next.platformKind) ||
    !areRuntimeSummariesEqual(snapshot.runtimeSummary, next.runtimeSummary) ||
    !areServicesEqual(snapshot.services, next.services) ||
    !areLeasesEqual(snapshot.lease, next.lease);

  snapshot = changed ? next : { ...snapshot, lastEventAt: next.lastEventAt };
  if (!changed) return;

  for (const l of listeners) l();
}

function isActiveLaunchStage(stage: LaunchProgressData["stage"] | null | undefined): boolean {
  return (
    stage === "preempting" || stage === "evicting" || stage === "launching" || stage === "waiting"
  );
}

function reconcileLaunchProgress(
  progress: LaunchProgressData | null,
  status: { process: ProcessInfo | null; launching: string | null } | null,
): LaunchProgressData | null {
  if (!progress || !isActiveLaunchStage(progress.stage)) return progress;
  if (!status) return progress;
  if (status.process || status.launching) return progress;
  return null;
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
  if (!snapshot.statusLoading) {
    emitIfChanged({
      ...snapshot,
      statusLoading: true,
      lastEventAt: Date.now(),
    });
  }

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
  const previousProcessKey = processKey(snapshot.status?.process);
  const nextProcessKey = processKey(status?.process);
  const polledMetrics =
    metricsResult.status === "fulfilled" && metricsResult.value
      ? (metricsResult.value as Metrics)
      : previousProcessKey === nextProcessKey
        ? snapshot.metrics
        : null;

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
      status: { running, process, inference_port, launching: status.launching ?? null },
      statusLoading: false,
      gpus,
      metrics: polledMetrics,
      launchProgress: reconcileLaunchProgress(snapshot.launchProgress, {
        process: process ?? null,
        launching: status.launching ?? null,
      }),
      platformKind: compatibility?.platform?.kind ?? snapshot.platformKind,
      runtimeSummary,
      services: snapshot.services,
      lease: snapshot.lease,
      lastEventAt: Date.now(),
    });
    return;
  }

  emitIfChanged({
    ...snapshot,
    statusLoading: false,
    lastEventAt: Date.now(),
  });
}

function resetForControllerSwitch() {
  emitIfChanged({
    ...initialSnapshot,
    lastEventAt: Date.now(),
  });
  void fetchStatusNow();
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
      const launching =
        typeof data["launching"] === "string" && data["launching"] ? data["launching"] : null;
      const previousProcessKey = processKey(snapshot.status?.process);
      const nextProcessKey = processKey(process);
      emitIfChanged({
        ...snapshot,
        status: { running, process, inference_port, launching },
        statusLoading: false,
        metrics: previousProcessKey === nextProcessKey ? snapshot.metrics : null,
        launchProgress: reconcileLaunchProgress(snapshot.launchProgress, { process, launching }),
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
      emitIfChanged({
        ...snapshot,
        metrics: data as Metrics,
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
        statusLoading: snapshot.statusLoading,
        gpus: snapshot.gpus,
        metrics: snapshot.metrics,
        launchProgress: snapshot.launchProgress,
        platformKind: nextKind,
        runtimeSummary: nextSummary,
        services: nextServices,
        lease: nextLease,
        lastEventAt: now,
      });
    }
  };

  window.addEventListener("vllm:controller-event", onControllerEvent as EventListener);
  window.addEventListener(BACKEND_URL_CHANGED_EVENT, resetForControllerSwitch);

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
