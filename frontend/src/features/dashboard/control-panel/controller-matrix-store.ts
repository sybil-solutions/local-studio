"use client";

import { useSyncExternalStore } from "react";
import { Effect, Fiber, Schedule } from "effect";
import { createApiClient } from "@/lib/api/create-api-client";
import {
  BACKEND_URL_CHANGED_EVENT,
  clearApiKey,
  getStoredBackendUrl,
  setApiKey,
  setStoredBackendUrl,
} from "@/lib/api/connection";
import {
  CONTROLLERS_CHANGED_EVENT,
  loadSavedControllers,
  normalizeControllerUrl,
  type SavedController,
} from "@/lib/api/controllers";

const POLL_INTERVAL_MS = 5_000;
const POLL_REQUEST = { timeout: 4_000, retries: 0 } as const;
const PRESERVED_FAILURE_POLLS = 3;

export type ControllerSnapshot = SavedController & {
  index: number;
  primary: boolean;
  online: boolean;
  authRequired: boolean;
  running: boolean;
  modelName: string | null;
};

export interface ControllerMatrixSnapshot {
  rows: ControllerSnapshot[];
  activeUrl: string;
  visible: boolean;
}

const hidden: ControllerMatrixSnapshot = { rows: [], activeUrl: "", visible: false };

let controllers: SavedController[] = [];
let snapshot: ControllerMatrixSnapshot = hidden;
const listeners = new Set<() => void>();
let started = false;
let pollFiber: Fiber.Fiber<void, unknown> | null = null;
let pollSeq = 0;
const pollFailures = new Map<string, number>();

function sameUrl(a: string, b: string): boolean {
  return normalizeControllerUrl(a) === normalizeControllerUrl(b);
}

function activeUrlFor(): string {
  return normalizeControllerUrl(getStoredBackendUrl() || controllers[0]?.url || "") ?? "";
}

function row({
  authRequired,
  controller,
  index,
  modelName,
  online,
  running,
}: {
  authRequired: boolean;
  controller: SavedController;
  index: number;
  modelName: string | null;
  online: boolean;
  running: boolean;
}): ControllerSnapshot {
  return { ...controller, index, primary: index === 0, online, authRequired, running, modelName };
}

function pendingRow(controller: SavedController, index: number): ControllerSnapshot {
  return row({
    authRequired: false,
    controller,
    index,
    modelName: null,
    online: false,
    running: false,
  });
}

export function controllerSnapshotAfterFailure({
  authRequired,
  controller,
  failureStreak,
  index,
  previous,
}: {
  authRequired: boolean;
  controller: SavedController;
  failureStreak: number;
  index: number;
  previous?: ControllerSnapshot;
}): ControllerSnapshot {
  const preserveOnline =
    !authRequired && Boolean(previous?.online) && failureStreak <= PRESERVED_FAILURE_POLLS;
  return row({
    authRequired,
    controller,
    index,
    modelName: previous?.modelName ?? null,
    online: preserveOnline,
    running: preserveOnline && Boolean(previous?.running),
  });
}

function loadControllers(): SavedController[] {
  const saved = loadSavedControllers();
  const byUrl = new Map<string, SavedController>();
  const activeUrl = normalizeControllerUrl(getStoredBackendUrl());
  for (const controller of saved) {
    const url = normalizeControllerUrl(controller.url);
    if (!url) continue;
    byUrl.set(url, { ...controller, url });
  }
  if (activeUrl && !byUrl.has(activeUrl)) byUrl.set(activeUrl, { url: activeUrl });
  if (byUrl.size === 0) {
    const primary = normalizeControllerUrl(getStoredBackendUrl() || "http://127.0.0.1:8080");
    if (primary) byUrl.set(primary, { url: primary });
  }
  return [...byUrl.values()];
}

function rowsEqual(a: ControllerSnapshot[], b: ControllerSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      row.url === other.url &&
      row.online === other.online &&
      row.authRequired === other.authRequired &&
      row.running === other.running &&
      row.modelName === other.modelName &&
      row.primary === other.primary &&
      row.index === other.index
    );
  });
}

function emit(rows: ControllerSnapshot[]): void {
  const next = { rows, activeUrl: activeUrlFor(), visible: controllers.length > 1 };
  // The poll rebuilds rows every 5s; skip notifying when nothing observable
  // changed so every consumer isn't re-rendered on each idle tick.
  if (
    next.activeUrl === snapshot.activeUrl &&
    next.visible === snapshot.visible &&
    rowsEqual(next.rows, snapshot.rows)
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

function reload(): void {
  controllers = loadControllers();
  const kept = snapshot.rows.filter((r) => controllers.some((c) => sameUrl(c.url, r.url)));
  emit(kept.length ? kept : controllers.map(pendingRow));
  void pollOnce();
}

async function pollOnce(): Promise<void> {
  if (controllers.length === 0) return;
  const seq = ++pollSeq;
  const rows = await Promise.all(controllers.map(pollController));
  if (seq !== pollSeq) return;
  emit(rows);
}

async function pollController(
  controller: SavedController,
  index: number,
): Promise<ControllerSnapshot> {
  const api = createApiClient({
    baseUrl: "/api/proxy",
    useProxy: true,
    backendUrlOverride: controller.url,
    apiKeyOverride: controller.apiKey,
  });
  try {
    const status = await api.getStatus(POLL_REQUEST);
    pollFailures.delete(controller.url);
    return row({
      authRequired: false,
      controller,
      index,
      modelName: modelNameFor(status.process),
      online: true,
      running: status.running,
    });
  } catch (error) {
    const auth = isAuthRequiredError(error);
    const failures = auth
      ? PRESERVED_FAILURE_POLLS + 1
      : (pollFailures.get(controller.url) ?? 0) + 1;
    pollFailures.set(controller.url, failures);
    return controllerSnapshotAfterFailure({
      authRequired: auth,
      controller,
      failureStreak: failures,
      index,
      previous: snapshot.rows.find((candidate) => sameUrl(candidate.url, controller.url)),
    });
  }
}

function modelNameFor(
  process: { served_model_name?: string | null; model_path?: string | null } | null,
): string | null {
  const served = process?.served_model_name?.trim();
  if (served) return served;
  const path = process?.model_path?.trim();
  if (!path) return null;
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

function isAuthRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  queueMicrotask(reload);
  window.addEventListener("storage", reload);
  window.addEventListener(BACKEND_URL_CHANGED_EVENT, reload);
  window.addEventListener(CONTROLLERS_CHANGED_EVENT, reload);
  pollFiber = Effect.runFork(
    Effect.sync(() => void pollOnce()).pipe(Effect.repeat(Schedule.spaced(POLL_INTERVAL_MS))),
  ) as Fiber.Fiber<void, unknown>;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function useControllerMatrixStore(): ControllerMatrixSnapshot {
  start();
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

export function activateController(controller: ControllerSnapshot): void {
  // Clear when the target has no key — runtimeApiKey is a process-global, so a
  // leftover key from the previous controller would otherwise be sent to this
  // controller's (different) host.
  if (controller.apiKey) setApiKey(controller.apiKey);
  else clearApiKey();
  setStoredBackendUrl(controller.url);
  reload();
  void fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backendUrl: controller.url, apiKey: controller.apiKey || "" }),
  });
}
