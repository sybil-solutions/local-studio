// CRITICAL
"use client";

import type { DashboardLayoutProps } from "../layout/dashboard-types";
import { StatusLine } from "./status-line";
import { GpuList } from "./gpu-list";
import { RecipeList } from "./recipe-list";
import { LogStream } from "./log-stream";
import { MetricBar } from "./metric-bar";
import { RuntimesPanel } from "./runtimes-panel";

export function ControlPanel(props: DashboardLayoutProps) {
  const { currentProcess, currentRecipe, metrics, gpus, recipes, logs } = props;

  return (
    <div className="space-y-8">
      {/* Status Line - Clean header */}
      <StatusLine
        currentProcess={currentProcess}
        currentRecipe={currentRecipe}
        isConnected={props.isConnected}
        metrics={metrics}
        gpus={gpus}
        platformKind={props.platformKind}
        inferencePort={props.inferencePort}
        onNavigateChat={props.onNavigateChat}
        onNavigateLogs={props.onNavigateLogs}
        onBenchmark={props.onBenchmark}
        benchmarking={props.benchmarking}
        onStop={props.onStop}
      />

      {/* Metric Bar - Horizontal strip */}
      {currentProcess && (
        <MetricBar metrics={metrics} gpus={gpus} />
      )}

      {/* Two Column Layout */}
      <div className="grid lg:grid-cols-2 gap-8 min-w-0">
        {/* Left - GPU List */}
        <div className="min-w-0">
          <GpuList gpus={gpus} />
        </div>

        {/* Right - Recipes + Runtimes */}
        <div className="min-w-0 space-y-8">
          <RecipeList
            recipes={recipes}
            launching={props.launching}
            onLaunch={props.onLaunch}
            onNewRecipe={props.onNewRecipe}
            onViewAll={props.onViewAll}
            currentRecipeId={currentRecipe?.id}
          />
          <RuntimesPanel
            runtimeSummary={props.runtimeSummary}
            services={props.services}
            lease={props.lease}
          />
        </div>
      </div>

      {/* Bottom - Logs */}
      <LogStream logs={logs} />
    </div>
  );
}
