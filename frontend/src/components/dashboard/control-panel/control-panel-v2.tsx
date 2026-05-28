"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { DashboardLayoutProps } from "../layout/dashboard-types";
import { StatusSection } from "./status-section";
import { GpuSection } from "./gpu-section";
import { createApiClient } from "@/lib/api/create-api-client";
import { setApiKey } from "@/lib/api-key";
import {
  BACKEND_URL_CHANGED_EVENT,
  getStoredBackendUrl,
  setStoredBackendUrl,
} from "@/lib/backend-url";
import {
  CONTROLLERS_CHANGED_EVENT,
  loadSavedControllers,
  normalizeControllerUrl,
  type SavedController,
} from "@/lib/controllers";
import type { GPU, ProcessInfo } from "@/lib/types";

const CONTROLLER_POLL_REQUEST = { timeout: 4_000, retries: 0 } as const;

type ControllerSnapshot = SavedController & {
  index: number;
  primary: boolean;
  online: boolean;
  authRequired: boolean;
  running: boolean;
  process: ProcessInfo | null;
  gpus: GPU[];
  inferencePort?: number;
  error?: string;
};

export function ControlPanel(props: DashboardLayoutProps) {
  const { currentProcess, currentRecipe, metrics, gpus, recipes } = props;

  // One continuous operator sheet. No outer card; section rhythm, hairlines,
  // compact telemetry, and quiet graph density do the work.
  return (
    <div className="mx-auto w-full max-w-[86rem] px-1 pt-2">
      <ControllerMatrix />
      <StatusSection
        currentProcess={currentProcess}
        currentRecipe={currentRecipe}
        metrics={metrics}
        gpus={gpus}
        isConnected={props.isConnected}
        isStatusLoading={props.isStatusLoading}
        platformKind={props.platformKind}
        inferencePort={props.inferencePort}
        onNavigateLogs={props.onNavigateLogs}
        onBenchmark={props.onBenchmark}
        benchmarking={props.benchmarking}
        recipes={recipes}
        lifecycleStatus={props.lifecycleStatus}
        onLaunch={props.onLaunch}
        onNewRecipe={props.onNewRecipe}
        onViewAll={props.onViewAll}
      />
      <GpuSection metrics={metrics} gpus={gpus} currentProcess={currentProcess} />
      <ActivityStrip {...props} />
    </div>
  );
}

function ControllerMatrix() {
  const [controllers, setControllers] = useState<SavedController[]>([]);
  const [snapshots, setSnapshots] = useState<ControllerSnapshot[]>([]);

  const subscribeControllers = useCallback((_notify: () => void) => {
    const load = () => {
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
      const next = [...byUrl.values()];
      setSnapshots((current) =>
        current.filter((snapshot) => byUrl.has(normalizeControllerUrl(snapshot.url))),
      );
      setControllers(next);
    };
    load();
    window.addEventListener("storage", load);
    window.addEventListener(BACKEND_URL_CHANGED_EVENT, load);
    window.addEventListener(CONTROLLERS_CHANGED_EVENT, load);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener(BACKEND_URL_CHANGED_EVENT, load);
      window.removeEventListener(CONTROLLERS_CHANGED_EVENT, load);
    };
  }, []);

  const subscribeControllerPolling = useCallback(
    (_notify: () => void) => {
      if (controllers.length === 0) return () => {};
      let cancelled = false;
      const poll = async () => {
        const next = await Promise.all(
          controllers.map((controller, index) => pollController(controller, index)),
        );
        if (!cancelled) setSnapshots(next);
      };
      void poll();
      const interval = window.setInterval(() => void poll(), 5_000);
      return () => {
        cancelled = true;
        window.clearInterval(interval);
      };
    },
    [controllers],
  );

  useSyncExternalStore(
    subscribeControllers,
    getControllerMatrixSnapshot,
    getControllerMatrixSnapshot,
  );
  useSyncExternalStore(
    subscribeControllerPolling,
    getControllerMatrixSnapshot,
    getControllerMatrixSnapshot,
  );

  if (controllers.length <= 1) return null;
  const rows = snapshots.length ? snapshots : controllers.map(pendingController);
  const activeUrl = normalizeControllerUrl(getStoredBackendUrl() || rows[0]?.url || "");
  return (
    <section className="mb-3 border-b border-(--border)/35 pb-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          controllers live
        </div>
        <div className="text-[10.5px] text-(--dim)/70">
          {rows.filter((row) => row.online).length}/{rows.length} online
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((controller) => (
          <ControllerTab
            key={controller.url}
            controller={controller}
            active={normalizeControllerUrl(controller.url) === activeUrl}
            onActivate={() => {
              if (controller.apiKey) setApiKey(controller.apiKey);
              setStoredBackendUrl(controller.url);
              void fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  backendUrl: controller.url,
                  apiKey: controller.apiKey || "",
                }),
              }).finally(() => window.dispatchEvent(new Event("storage")));
            }}
          />
        ))}
      </div>
    </section>
  );
}

function ControllerTab({
  controller,
  active,
  onActivate,
}: {
  controller: ControllerSnapshot;
  active: boolean;
  onActivate: () => void;
}) {
  const fallback = controller.primary ? "primary" : `controller ${controller.index + 1}`;
  const label = controller.name?.trim() || fallback;
  const state = controller.authRequired
    ? "auth"
    : controller.online
      ? controller.running
        ? "running"
        : "idle"
      : "offline";
  const model =
    controller.process?.served_model_name || controller.process?.model_path || "no model";
  const dotClass = controller.online
    ? controller.running
      ? "bg-(--hl2)"
      : "bg-(--dim)"
    : controller.authRequired
      ? "bg-(--hl3)"
      : "bg-(--err)";
  return (
    <button
      type="button"
      onClick={onActivate}
      title={controller.url}
      className={`group inline-flex h-7 min-w-0 max-w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-2 text-left text-[11px] transition ${
        active
          ? "border-(--accent)/60 bg-(--accent)/10 text-(--fg)"
          : "border-(--border)/55 bg-(--surface)/40 text-(--dim) hover:border-(--border) hover:text-(--fg)"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <span className="max-w-[10rem] truncate font-medium text-(--fg)">{label}</span>
      <span className="font-mono text-[9.5px] uppercase tracking-wide text-(--dim)">{state}</span>
      <span className="font-mono text-[9.5px] text-(--dim)">{controller.gpus.length}× gpu</span>
      <span className="max-w-[14rem] truncate text-[10px] text-(--dim)" title={model}>
        {controller.online ? model : controller.error || "unreachable"}
      </span>
    </button>
  );
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
    const [statusResult, gpuResult] = await Promise.allSettled([
      api.getStatus(CONTROLLER_POLL_REQUEST),
      api.getGPUs(CONTROLLER_POLL_REQUEST),
    ]);
    if (statusResult.status === "rejected") throw statusResult.reason;
    return {
      ...controller,
      index,
      primary: index === 0,
      online: true,
      authRequired: false,
      running: statusResult.value.running,
      process: statusResult.value.process,
      inferencePort: statusResult.value.inference_port,
      gpus: gpuResult.status === "fulfilled" ? gpuResult.value.gpus : [],
    };
  } catch (error) {
    return {
      ...controller,
      index,
      primary: index === 0,
      online: false,
      authRequired: isAuthRequiredError(error),
      running: false,
      process: null,
      gpus: [],
      error: isAuthRequiredError(error)
        ? "auth required"
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

function pendingController(controller: SavedController, index: number): ControllerSnapshot {
  return {
    ...controller,
    index,
    primary: index === 0,
    online: false,
    authRequired: false,
    running: false,
    process: null,
    gpus: [],
  };
}

function isAuthRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

function ActivityStrip({ logs }: DashboardLayoutProps) {
  const tail = logs.length > 0 ? logs.slice(-120) : [];

  return (
    <section className="border-t border-(--border)/40 px-2 pt-4 pb-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          Controller logs
        </div>
        <div className="text-[10.5px] text-(--dim)/70">{tail.length} lines</div>
      </div>
      <div className="max-h-[34rem] min-h-[18rem] overflow-y-auto border border-(--border)/45 bg-(--surface)/40 p-3 font-mono text-[10.5px] leading-5 text-(--dim)/80">
        {tail.length > 0 ? (
          tail.map((line, index) => (
            <div key={`${index}-${line}`} className="truncate">
              {trimLogLine(line)}
            </div>
          ))
        ) : (
          <div>0 log lines</div>
        )}
      </div>
    </section>
  );
}

function trimLogLine(line: string): string {
  return line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 180);
}

const getControllerMatrixSnapshot = (): number => 0;
