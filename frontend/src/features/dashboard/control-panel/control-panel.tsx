"use client";

import { useState } from "react";
import type { DashboardLayoutProps } from "../layout/dashboard-types";
import { StatusSection } from "./status-section";
import { GpuSection } from "./gpu-section";
import { RuntimeStrip } from "./runtime-strip";
import { useApiUrlCensored } from "@/ui/api-url-censor";
import {
  activateController,
  useControllerMatrixStore,
  type ControllerSnapshot,
} from "./controller-matrix-store";

const DOT_BY_STATE: Record<string, string> = {
  auth: "bg-(--hl3)",
  running: "bg-(--hl2)",
  idle: "bg-(--dim)",
  offline: "bg-(--err)",
};

export function ControlPanel(props: DashboardLayoutProps) {
  const { currentProcess, currentRecipe, metrics, gpus, recipes } = props;

  return (
    <div className="mx-auto w-full max-w-[86rem] px-1 pt-2">
      <ControllerMatrix />
      <StatusSection
        currentProcess={currentProcess}
        currentRecipe={currentRecipe}
        metrics={metrics}
        metricsDetached={props.metricsDetached}
        gpus={gpus}
        isConnected={props.isConnected}
        isStatusLoading={props.isStatusLoading}
        platformKind={props.platformKind}
        inferencePort={props.inferencePort}
        onNavigateLogs={props.onNavigateLogs}
        onBenchmark={props.onBenchmark}
        benchmarking={props.benchmarking}
        benchmarkResult={props.benchmarkResult}
        recipes={recipes}
        lifecycleStatus={props.lifecycleStatus}
        lifecycleError={props.lifecycleError}
        onLaunch={props.onLaunch}
        onNewRecipe={props.onNewRecipe}
        onViewAll={props.onViewAll}
      />
      <GpuSection
        metrics={metrics}
        gpus={gpus}
        currentProcess={currentProcess}
        platformKind={props.platformKind}
      />
      <RuntimeStrip
        runtimeSummary={props.runtimeSummary}
        services={props.services}
        lease={props.lease}
      />
      <ActivityStrip {...props} />
    </div>
  );
}

function ControllerMatrix() {
  const { rows, activeUrl, visible } = useControllerMatrixStore();
  if (!visible) return null;
  return (
    <section className="mb-3 border-b border-(--separator) pb-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[length:var(--fs-sm)] font-medium text-(--hl2)">controllers live</div>
        <div className="text-[length:var(--fs-xs)] text-(--dim)/70">
          {rows.filter((row) => row.online).length}/{rows.length} online
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((controller) => (
          <ControllerTab
            key={controller.url}
            controller={controller}
            active={controller.url === activeUrl}
            onActivate={() => activateController(controller)}
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
  const censorUrls = useApiUrlCensored();
  const fallback = controller.primary ? "primary" : `controller ${controller.index + 1}`;
  const label = controller.name?.trim() || fallback;
  const state = controller.authRequired
    ? "auth"
    : controller.online
      ? controller.running
        ? "running"
        : "idle"
      : "offline";
  return (
    <button
      type="button"
      onClick={onActivate}
      title={censorUrls ? "Controller URL censored" : controller.url}
      className={`group inline-flex h-7 min-w-0 max-w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-2 text-left text-[length:var(--fs-sm)] transition ${
        active
          ? "border-(--accent)/60 bg-(--accent)/10 text-(--fg)"
          : "border-(--border)/55 bg-(--surface)/40 text-(--dim) hover:border-(--border) hover:text-(--fg)"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_BY_STATE[state]}`} aria-hidden />
      <span className="max-w-[10rem] truncate font-medium text-(--fg)">{label}</span>
      {controller.modelName ? (
        <span className="max-w-[14rem] truncate text-(--dim)">{controller.modelName}</span>
      ) : null}
      <span className="text-[length:var(--fs-sm)] text-(--hl2)">{state}</span>
    </button>
  );
}

function ActivityStrip({ logs, onNavigateLogs }: DashboardLayoutProps) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const tail = logs.slice(-400);
  const matched = needle ? tail.filter((line) => line.toLowerCase().includes(needle)) : tail;
  const shown = matched.slice(-120);

  return (
    <section className="border-t border-(--separator) px-2 pt-4 pb-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[length:var(--fs-sm)] font-medium text-(--hl2)">Controller logs</div>
        <div className="flex items-center gap-2">
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter"
            aria-label="Filter controller logs"
            className="h-7 w-32 rounded-full bg-(--fg)/5 px-3 font-mono text-[length:var(--fs-xs)] text-(--fg) placeholder:text-(--dim)/60 focus:outline-none focus:ring-1 focus:ring-(--accent)/40 sm:w-44"
          />
          <span className="text-[length:var(--fs-xs)] tabular-nums text-(--dim)/70">
            {needle ? `${matched.length} of ${tail.length}` : `${shown.length} lines`}
          </span>
          <button
            type="button"
            onClick={onNavigateLogs}
            className="h-7 rounded-full px-2 text-[length:var(--fs-xs)] text-(--link) hover:bg-(--fg)/5"
          >
            Open
          </button>
        </div>
      </div>
      {/* Fixed, not min/max: a log tail that resizes as lines arrive walks the
          page under the reader's cursor. 16rem rather than 34 — this was half
          the page height for the least dense content on it. */}
      <div className="h-[16rem] overflow-y-auto overscroll-contain border border-(--border)/45 bg-(--surface)/40 p-3 font-mono text-[length:var(--fs-xs)] leading-5 text-(--dim)/80">
        {shown.length > 0 ? (
          shown.map((line, index) => <LogLine key={`${index}-${line}`} line={line} />)
        ) : (
          <div>{needle ? "No lines match this filter" : "0 log lines"}</div>
        )}
      </div>
    </section>
  );
}

/**
 * A crash and a heartbeat used to render identically. Severity is the only
 * thing a tail of 120 undifferentiated lines can usefully carry, so it is the
 * only thing coloured here.
 */
function LogLine({ line }: { line: string }) {
  const text = trimLogLine(line);
  const severity = /\b(error|fatal|traceback)\b/i.test(text)
    ? "text-(--err)"
    : /\bwarn(ing)?\b/i.test(text)
      ? "text-(--warn)"
      : "";
  return <div className={`truncate ${severity}`}>{text}</div>;
}

function trimLogLine(line: string): string {
  return line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 180);
}
