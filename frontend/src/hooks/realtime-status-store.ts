"use client";

// THE single owner of controller-level status: reachability, running process,
// GPUs, metrics, launch progress, runtime summary. Fed by the controller SSE
// (vllm:controller-event, dispatched by use-controller-events) with a 5s
// poll+backoff fallback. Views derive from the snapshot via
// realtime-status-types.ts — nothing else may poll getStatus or listen to
// controller events for status.

import { useSyncExternalStore } from "react";
import { Effect, Result } from "effect";
import { effectInterval, effectTimeout, type EffectTimer } from "@/lib/effect-timers";
import type {
  GPU,
  LaunchProgressData,
  Metrics,
  ProcessInfo,
  RuntimeBackendInfo,
} from "@/lib/types";

import api from "@/lib/api/client";
import { BACKEND_URL_CHANGED_EVENT, getStoredBackendUrl } from "@/lib/api/connection";
import { normalizeGpuAliases } from "@/lib/api/system";
import {
  areGpusEqual,
  areLaunchProgressEqual,
  areLeasesEqual,
  areMetricsEqual,
  arePlatformKindsEqual,
  areRuntimeSummariesEqual,
  areServicesEqual,
  areStatusEqual,
} from "./realtime-status-equality";
import {
  isActiveLaunchStage,
  type LeaseInfo,
  type RealtimeStatusSnapshot,
  type RuntimeSummaryData,
  type ServiceEntry,
} from "./realtime-status-types";

const FAST_STATUS_REQUEST = { timeout: 5_000, retries: 0 } as const;
const FAST_COMPAT_REQUEST = { timeout: 5_000, retries: 0 } as const;
const FAST_GPU_REQUEST = { timeout: 5_000, retries: 0 } as const;

type ControllerEventDetail = { type?: string; data?: Record<string, unknown> };
type PolledStatus = Awaited<ReturnType<typeof api.getStatus>>;
type PolledCompatibility = Awaited<ReturnType<typeof api.getCompatibility>>;
type PollResults = {
  compatibility: PolledCompatibility | null;
  gpus: GPU[];
  metrics: Metrics | null;
  status: PolledStatus | null;
  statusConnected: boolean;
};

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
  };
}

const initialSnapshot: RealtimeStatusSnapshot = {
  status: null,
  statusLoading: true,
  connected: false,
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
const snapshotsByController = new Map<string, RealtimeStatusSnapshot>();
const listeners = new Set<() => void>();
let started = false;
let clearLaunchTimer: EffectTimer | null = null;
let pollFailureStreak = 0;
let pollBackoffUntil = 0;
let activeControllerKey = currentControllerKey();
let statusRequestSeq = 0;

const POLL_BASE_INTERVAL_MS = 5_000;
const POLL_MAX_BACKOFF_MS = 30_000;

function notePollOutcome(connected: boolean) {
  if (connected) {
    pollFailureStreak = 0;
    pollBackoffUntil = 0;
    return;
  }
  pollFailureStreak = Math.min(pollFailureStreak + 1, 6);
  const backoff = Math.min(
    POLL_MAX_BACKOFF_MS,
    POLL_BASE_INTERVAL_MS * 2 ** (pollFailureStreak - 1),
  );
  pollBackoffUntil = Date.now() + backoff;
}

function currentControllerKey(): string {
  if (typeof window === "undefined") return "server";
  return getStoredBackendUrl() || "default";
}

function cacheActiveSnapshot(): void {
  snapshotsByController.set(activeControllerKey, snapshot);
}

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
    snapshot.connected !== next.connected ||
    !areGpusEqual(snapshot.gpus, next.gpus) ||
    !areMetricsEqual(snapshot.metrics, next.metrics) ||
    !areLaunchProgressEqual(snapshot.launchProgress, next.launchProgress) ||
    !arePlatformKindsEqual(snapshot.platformKind, next.platformKind) ||
    !areRuntimeSummariesEqual(snapshot.runtimeSummary, next.runtimeSummary) ||
    !areServicesEqual(snapshot.services, next.services) ||
    !areLeasesEqual(snapshot.lease, next.lease);

  snapshot = changed ? next : { ...snapshot, lastEventAt: next.lastEventAt };
  cacheActiveSnapshot();
  if (!changed) return;

  for (const l of listeners) l();
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
  clearLaunchTimer?.cancel();
  clearLaunchTimer = null;
  if (stage === "ready" || stage === "error" || stage === "cancelled") {
    clearLaunchTimer = effectTimeout(() => {
      emitIfChanged({
        ...snapshot,
        launchProgress: null,
        lastEventAt: Date.now(),
      });
    }, 5000);
  }
}

function emitStatusLoading() {
  if (snapshot.statusLoading) return;
  emitIfChanged({
    ...snapshot,
    statusLoading: true,
    lastEventAt: Date.now(),
  });
}

const requestEffect = <T>(load: () => Promise<T>): Effect.Effect<T, unknown> =>
  Effect.tryPromise({ try: load, catch: (error) => error });

function fetchPollResultsEffect(): Effect.Effect<PollResults> {
  return Effect.gen(function* () {
    const [statusResult, compatibilityResult, gpuResult, metricsResult] = yield* Effect.all([
      Effect.result(requestEffect(() => api.getStatus(FAST_STATUS_REQUEST))),
      Effect.result(requestEffect(() => api.getCompatibility(FAST_COMPAT_REQUEST))),
      Effect.result(requestEffect(() => api.getGPUs(FAST_GPU_REQUEST))),
      Effect.result(
        requestEffect(() => api.getMetrics()).pipe(Effect.catch(() => Effect.succeed(null))),
      ),
    ] as const);
    const status = Result.isSuccess(statusResult) ? statusResult.success : null;
    return {
      compatibility: Result.isSuccess(compatibilityResult) ? compatibilityResult.success : null,
      gpus: Result.isSuccess(gpuResult) ? (gpuResult.success.gpus ?? snapshot.gpus) : snapshot.gpus,
      metrics: pollMetrics(metricsResult, status),
      status,
      statusConnected: Result.isSuccess(statusResult),
    };
  });
}

function pollMetrics(
  result: Result.Result<Metrics | null, unknown>,
  status: PolledStatus | null,
): Metrics | null {
  if (Result.isSuccess(result) && result.success) return result.success;
  return processKey(snapshot.status?.process) === processKey(status?.process)
    ? snapshot.metrics
    : null;
}

function fallbackRuntimeVendor(
  kind: RuntimeSummaryData["platform"]["kind"] | null | undefined,
): RuntimeSummaryData["platform"]["vendor"] {
  if (kind === "cuda") return "nvidia";
  if (kind === "rocm") return "amd";
  if (kind === "metal") return "apple";
  return null;
}

function runtimeSummaryFromCompatibility(
  current: RuntimeSummaryData | null,
  compatibility: PolledCompatibility | null,
): RuntimeSummaryData | null {
  if (current || !compatibility) return current;
  const kind = compatibility.platform.kind;
  return {
    platform: { kind, vendor: fallbackRuntimeVendor(kind) },
    gpu_monitoring: compatibility.gpu_monitoring,
    backends: normalizeRuntimeBackends(compatibility.backends),
  };
}

function emitNoPolledStatus() {
  // Keep a warm cache through transient navigation/SSE handoff failures. The
  // next poll failure marks the controller offline, but a single missed fast
  // request should not blank the status page or flash "offline".
  const hasCachedStatus = Boolean(
    snapshot.status || snapshot.runtimeSummary || snapshot.gpus.length,
  );
  emitIfChanged({
    ...snapshot,
    statusLoading: false,
    connected: hasCachedStatus && pollFailureStreak <= 3 ? snapshot.connected : false,
    lastEventAt: Date.now(),
  });
}

function emitPolledStatus({ compatibility, gpus, metrics, status }: PollResults) {
  if (!status) return emitNoPolledStatus();
  const { running, process, inference_port } = status;
  const launching = status.launching ?? null;
  emitIfChanged({
    status: { running, process, inference_port, launching },
    statusLoading: false,
    connected: true,
    gpus,
    metrics,
    launchProgress: reconcileLaunchProgress(snapshot.launchProgress, {
      process: process ?? null,
      launching,
    }),
    platformKind: compatibility?.platform?.kind ?? snapshot.platformKind,
    runtimeSummary: runtimeSummaryFromCompatibility(snapshot.runtimeSummary, compatibility),
    services: snapshot.services,
    lease: snapshot.lease,
    lastEventAt: Date.now(),
  });
}

function statusFromEventData(
  data: Record<string, unknown>,
): NonNullable<RealtimeStatusSnapshot["status"]> {
  const process = (data["process"] ?? null) as ProcessInfo | null;
  return {
    running: Boolean(data["running"] ?? process),
    process,
    inference_port: Number(data["inference_port"] ?? 8000),
    launching:
      typeof data["launching"] === "string" && data["launching"] ? data["launching"] : null,
  };
}

function metricsForEventProcess(process: ProcessInfo | null): Metrics | null {
  return processKey(snapshot.status?.process) === processKey(process) ? snapshot.metrics : null;
}

function handleStatusEvent(data: Record<string, unknown>, now: number) {
  // A live status event means the selected backend is reachable; clear any
  // poll backoff so a recovered connection resumes fast polling.
  notePollOutcome(true);
  const status = statusFromEventData(data);
  emitIfChanged({
    ...snapshot,
    status,
    statusLoading: false,
    connected: true,
    metrics: metricsForEventProcess(status.process),
    launchProgress: reconcileLaunchProgress(snapshot.launchProgress, {
      process: status.process,
      launching: status.launching,
    }),
    lastEventAt: now,
  });
}

function handleGpuEvent(data: Record<string, unknown>, now: number) {
  emitIfChanged({
    ...snapshot,
    gpus: normalizeGpuAliases(data["gpus"]),
    lastEventAt: now,
  });
}

function handleMetricsEvent(data: Record<string, unknown>, now: number) {
  emitIfChanged({
    ...snapshot,
    metrics: data as Metrics,
    lastEventAt: now,
  });
}

function handleLaunchProgressEvent(data: Record<string, unknown>, now: number) {
  const progress = data as unknown as LaunchProgressData;
  scheduleLaunchClear(progress.stage);
  emitIfChanged({
    ...snapshot,
    // A live launch event proves the controller is reachable even before the
    // first successful status poll.
    connected: true,
    launchProgress: progress,
    lastEventAt: now,
  });
}

type RuntimeSummaryEventPlatform = { kind?: string; vendor?: string | null };
const RUNTIME_PLATFORM_KINDS = new Set<RuntimeSummaryData["platform"]["kind"]>([
  "cuda",
  "rocm",
  "metal",
  "unknown",
]);
const RUNTIME_PLATFORM_VENDORS = new Set<Exclude<RuntimeSummaryData["platform"]["vendor"], null>>([
  "nvidia",
  "amd",
  "apple",
]);

function handleRuntimeSummaryEvent(data: Record<string, unknown>, now: number) {
  const platform = data["platform"] as RuntimeSummaryEventPlatform | undefined;
  const nextKind =
    platform?.kind &&
    RUNTIME_PLATFORM_KINDS.has(platform.kind as RuntimeSummaryData["platform"]["kind"])
      ? (platform.kind as RuntimeSummaryData["platform"]["kind"])
      : snapshot.platformKind;
  const nextVendor =
    platform?.vendor &&
    RUNTIME_PLATFORM_VENDORS.has(
      platform.vendor as Exclude<RuntimeSummaryData["platform"]["vendor"], null>,
    )
      ? (platform.vendor as Exclude<RuntimeSummaryData["platform"]["vendor"], null>)
      : fallbackRuntimeVendor(nextKind);
  const gpuMon = data["gpu_monitoring"] as RuntimeSummaryData["gpu_monitoring"] | undefined;
  const backends = data["backends"] as Partial<RuntimeSummaryData["backends"]> | undefined;
  const rawServices = data["services"] as ServiceEntry[] | undefined;
  const rawLease = data["lease"] as LeaseInfo | undefined;

  emitIfChanged({
    status: snapshot.status,
    statusLoading: snapshot.statusLoading,
    connected: snapshot.connected,
    gpus: snapshot.gpus,
    metrics: snapshot.metrics,
    launchProgress: snapshot.launchProgress,
    platformKind: nextKind,
    runtimeSummary:
      platform && gpuMon && backends
        ? {
            platform: { kind: nextKind ?? "unknown", vendor: nextVendor },
            gpu_monitoring: gpuMon,
            backends: normalizeRuntimeBackends(backends),
          }
        : snapshot.runtimeSummary,
    services: Array.isArray(rawServices) ? rawServices : snapshot.services,
    lease: rawLease ?? snapshot.lease,
    lastEventAt: now,
  });
}

const controllerEventHandlers: Record<
  string,
  (data: Record<string, unknown>, now: number) => void
> = {
  status: handleStatusEvent,
  gpu: handleGpuEvent,
  metrics: handleMetricsEvent,
  launch_progress: handleLaunchProgressEvent,
  runtime_summary: handleRuntimeSummaryEvent,
};

function handleControllerEvent(detail: ControllerEventDetail | undefined) {
  controllerEventHandlers[detail?.type ?? ""]?.(detail?.data ?? {}, Date.now());
}

function fetchStatusNow(controllerKey = activeControllerKey): Promise<void> {
  return Effect.runPromise(fetchStatusNowEffect(controllerKey));
}

function fetchStatusNowEffect(controllerKey = activeControllerKey): Effect.Effect<void> {
  return Effect.gen(function* () {
    const requestSeq = ++statusRequestSeq;
    if (controllerKey !== activeControllerKey) return;
    emitStatusLoading();
    const results = yield* fetchPollResultsEffect();
    if (controllerKey !== activeControllerKey || requestSeq !== statusRequestSeq) return;
    notePollOutcome(results.statusConnected);
    emitPolledStatus(results);
  });
}

function resetForControllerSwitch() {
  cacheActiveSnapshot();
  activeControllerKey = currentControllerKey();
  statusRequestSeq += 1;
  pollFailureStreak = 0;
  pollBackoffUntil = 0;
  const cached = snapshotsByController.get(activeControllerKey);
  emitIfChanged({
    ...(cached ?? initialSnapshot),
    statusLoading: true,
    lastEventAt: Date.now(),
  });
  void fetchStatusNow(activeControllerKey);
}

function start() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  const onControllerEvent = (event: Event) => {
    handleControllerEvent((event as CustomEvent<ControllerEventDetail>).detail);
  };

  window.addEventListener("vllm:controller-event", onControllerEvent as EventListener);
  window.addEventListener(BACKEND_URL_CHANGED_EVENT, resetForControllerSwitch);

  // Initial fetch + polling fallback in case SSE is blocked. The poll body
  // checks the SSE freshness window and backoff gate before firing.
  void fetchStatusNow();
  effectInterval(() => {
    const now = Date.now();
    if (now - snapshot.lastEventAt < 10_000) return;
    if (now < pollBackoffUntil) return;
    void fetchStatusNow();
  }, POLL_BASE_INTERVAL_MS);

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
