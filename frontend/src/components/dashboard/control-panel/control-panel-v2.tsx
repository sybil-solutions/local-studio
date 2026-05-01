// CRITICAL
"use client";

import type { DashboardLayoutProps } from "../layout/dashboard-types";
import { StatusSection } from "./status-section";
import { GpuSection } from "./gpu-section";
import { LogSection } from "./log-section";

export function ControlPanel(props: DashboardLayoutProps) {
  const { currentProcess, currentRecipe, metrics, gpus, recipes, logs } = props;

  return (
    <div className="mx-auto w-full space-y-4">
      {/* Status — header bar with inline Models dropdown */}
      <StatusSection
        currentProcess={currentProcess}
        currentRecipe={currentRecipe}
        metrics={metrics}
        gpus={gpus}
        isConnected={props.isConnected}
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

      {/* GPU — always rendered so loading/offline/standby states do not shift the page. */}
      <GpuSection metrics={metrics} gpus={gpus} currentProcess={currentProcess} logs={logs} />

      {/* Logs */}
      <LogSection logs={logs} />
    </div>
  );
}
