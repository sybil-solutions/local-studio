"use client";

import { useSyncExternalStore } from "react";
import api from "@/lib/api";
import { BACKEND_URL_CHANGED_EVENT } from "@/lib/backend-url";
import type { LaunchStage } from "@/lib/types";

const FAST_STATUS_REQUEST = { timeout: 5_000, retries: 0 } as const;

export type SidebarStatusSnapshot = {
  online: boolean;
  inferenceOnline: boolean;
  model: string | null;
  activityLine: string;
};

type InternalState = SidebarStatusSnapshot & {
  launchActive: boolean;
  launchMessage: string | null;
  lastUpdateAt: number;
};

const initialState: InternalState = {
  online: false,
  inferenceOnline: false,
  model: null,
  activityLine: "Offline",
  launchActive: false,
  launchMessage: null,
  lastUpdateAt: 0,
};

let state: InternalState = initialState;
const listeners = new Set<() => void>();
let started = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;

function emitIfChanged(next: InternalState) {
  if (
    next.online === state.online &&
    next.inferenceOnline === state.inferenceOnline &&
    next.model === state.model &&
    next.activityLine === state.activityLine &&
    next.launchActive === state.launchActive &&
    next.launchMessage === state.launchMessage
  ) {
    state = { ...state, lastUpdateAt: next.lastUpdateAt };
    return;
  }
  state = next;
  for (const l of listeners) l();
}

function recomputeActivityLine(s: InternalState): string {
  if (s.launchActive && s.launchMessage) return s.launchMessage;
  if (s.inferenceOnline) return s.model || "Ready";
  if (s.online) return "No model";
  return "Offline";
}

function computeModelName(process: unknown): string | null {
  if (!process || typeof process !== "object") return null;
  const p = process as Record<string, unknown>;
  const served = p["served_model_name"];
  if (typeof served === "string" && served.trim()) return served.trim();
  const modelPath = p["model_path"];
  if (typeof modelPath === "string" && modelPath.trim())
    return modelPath.split("/").pop() ?? modelPath;
  return null;
}

function updateFromStatusPayload(payload: Record<string, unknown>) {
  const process = payload["process"] ?? null;
  const running = Boolean(payload["running"] ?? process);
  const model = computeModelName(process);

  const launching =
    typeof payload["launching"] === "string" && payload["launching"] ? payload["launching"] : null;
  const nextBase: InternalState = {
    ...state,
    online: true,
    inferenceOnline: running,
    model: model ?? state.model,
    launchActive: running || launching ? state.launchActive : false,
    launchMessage: running || launching ? state.launchMessage : null,
    lastUpdateAt: Date.now(),
  };
  const next: InternalState = { ...nextBase, activityLine: recomputeActivityLine(nextBase) };
  emitIfChanged(next);
}

function updateFromLaunchProgressPayload(payload: Record<string, unknown>) {
  const stage = payload["stage"] as LaunchStage | undefined;
  const message = typeof payload["message"] === "string" ? payload["message"] : null;
  const active =
    stage === "preempting" || stage === "evicting" || stage === "launching" || stage === "waiting";

  const nextBase: InternalState = {
    ...state,
    online: true,
    launchActive: active,
    launchMessage: active ? (message ?? state.launchMessage) : null,
    lastUpdateAt: Date.now(),
  };
  const next: InternalState = { ...nextBase, activityLine: recomputeActivityLine(nextBase) };
  emitIfChanged(next);
}

async function fetchNow() {
  const statusResult = await Promise.allSettled([api.getStatus(FAST_STATUS_REQUEST)]);
  const status = statusResult[0].status === "fulfilled" ? statusResult[0].value : null;

  if (!status) {
    const nextBase: InternalState = {
      ...state,
      online: false,
      inferenceOnline: false,
      model: null,
      launchActive: false,
      launchMessage: null,
      lastUpdateAt: Date.now(),
    };
    const next: InternalState = { ...nextBase, activityLine: recomputeActivityLine(nextBase) };
    emitIfChanged(next);
    return;
  }

  const inferenceOnline = Boolean(status?.running || status?.process);
  const model = computeModelName(status?.process ?? null);
  const launching = Boolean(status?.launching);

  const nextBase: InternalState = {
    ...state,
    online: true,
    inferenceOnline,
    model: model ?? state.model,
    launchActive: inferenceOnline || launching ? state.launchActive : false,
    launchMessage: inferenceOnline || launching ? state.launchMessage : null,
    lastUpdateAt: Date.now(),
  };
  const next: InternalState = { ...nextBase, activityLine: recomputeActivityLine(nextBase) };
  emitIfChanged(next);
}

function resetForControllerSwitch() {
  emitIfChanged({ ...initialState, lastUpdateAt: Date.now() });
  void fetchNow();
}

function start() {
  if (started) return;
  started = true;
  if (typeof window === "undefined") return;

  const onControllerEvent = (event: Event) => {
    const custom = event as CustomEvent<{ type?: string; data?: Record<string, unknown> }>;
    const type = custom.detail?.type;
    const payload = custom.detail?.data ?? {};
    if (type === "status") updateFromStatusPayload(payload);
    if (type === "launch_progress") updateFromLaunchProgressPayload(payload);
  };

  window.addEventListener("vllm:controller-event", onControllerEvent as EventListener);
  window.addEventListener(BACKEND_URL_CHANGED_EVENT, resetForControllerSwitch);

  // Polling fallback for initial state and missed events (low frequency).
  void fetchNow();
  pollInterval = setInterval(fetchNow, 10_000);

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      void fetchNow();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) void fetchNow();
  };
  window.addEventListener("pageshow", onPageShow);

  // Note: we intentionally don't tear these down; the app has a single root lifetime.
}

export function useSidebarStatus(): SidebarStatusSnapshot {
  const snap = useSyncExternalStore(
    (onStoreChange) => {
      start();
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => state,
    () => initialState,
  );

  return snap;
}
