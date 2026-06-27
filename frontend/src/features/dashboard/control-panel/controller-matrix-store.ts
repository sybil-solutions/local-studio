"use client";

import { useSyncExternalStore } from "react";
import { Effect, Fiber, Schedule } from "effect";
import { createApiClient } from "@/lib/api/create-api-client";
import {
  BACKEND_URL_CHANGED_EVENT,
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

export type ControllerSnapshot = SavedController & {
  index: number;
  primary: boolean;
  online: boolean;
  authRequired: boolean;
  running: boolean;
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

function sameUrl(a: string, b: string): boolean {
  return normalizeControllerUrl(a) === normalizeControllerUrl(b);
}

function activeUrlFor(): string {
  return normalizeControllerUrl(getStoredBackendUrl() || controllers[0]?.url || "") ?? "";
}

function row(
  controller: SavedController,
  index: number,
  online: boolean,
  authRequired: boolean,
  running: boolean,
): ControllerSnapshot {
  return { ...controller, index, primary: index === 0, online, authRequired, running };
}

function pendingRow(controller: SavedController, index: number): ControllerSnapshot {
  return row(controller, index, false, false, false);
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

function emit(rows: ControllerSnapshot[]): void {
  snapshot = { rows, activeUrl: activeUrlFor(), visible: controllers.length > 1 };
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
    return row(controller, index, true, false, status.running);
  } catch (error) {
    const auth = isAuthRequiredError(error);
    return row(controller, index, false, auth, false);
  }
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
  if (controller.apiKey) setApiKey(controller.apiKey);
  setStoredBackendUrl(controller.url);
  reload();
  void fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backendUrl: controller.url, apiKey: controller.apiKey || "" }),
  });
}
