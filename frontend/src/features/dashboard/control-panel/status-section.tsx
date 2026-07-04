"use client";

import type { GPU, Metrics, ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { StatusHeader, StatusMetricStrip } from "./status-section-parts";
import { MetricTrends, useMetricSamples } from "./status-section-trends";
import { resolveStatusSectionView } from "./status-section-view";

interface StatusSectionProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  metrics: Metrics | null;
  gpus: GPU[];
  isConnected: boolean;
  isStatusLoading: boolean;
  platformKind?: RuntimePlatformKind | null;
  inferencePort?: number;
  onNavigateLogs: () => void;
  onBenchmark: () => void;
  benchmarking: boolean;
  recipes?: RecipeWithStatus[];
  lifecycleStatus?: "idle" | "starting" | "ready" | "error";
  onLaunch?: (recipeId: string) => Promise<void>;
  onNewRecipe?: () => void;
  onViewAll?: () => void;
}

export function StatusSection({
  currentProcess,
  currentRecipe,
  metrics,
  gpus,
  isConnected,
  isStatusLoading,
  platformKind,
  inferencePort,
  onNavigateLogs,
  onBenchmark,
  benchmarking,
  recipes,
  lifecycleStatus = "idle",
  onLaunch,
  onNewRecipe,
  onViewAll,
}: StatusSectionProps) {
  const view = resolveStatusSectionView({
    currentProcess,
    currentRecipe,
    gpus,
    inferencePort,
    metrics,
    platformKind,
  });
  const trendData = useMetricSamples(view.sampleInput);

  return (
    <section className="px-2 pt-2 pb-5">
      <StatusHeader
        backend={view.backend}
        benchmarking={benchmarking}
        currentRecipeId={currentRecipe?.id}
        displayPlatformKind={view.displayPlatformKind}
        displayPort={view.displayPort}
        isConnected={isConnected}
        isRunning={view.isRunning}
        isStatusLoading={isStatusLoading}
        lifecycleStatus={lifecycleStatus}
        modelName={view.modelName}
        onBenchmark={onBenchmark}
        onLaunch={onLaunch}
        onNavigateLogs={onNavigateLogs}
        onNewRecipe={onNewRecipe}
        onViewAll={onViewAll}
        recipes={recipes}
      />
      <StatusMetricStrip compactMetrics={view.compactMetrics} metricColumns={view.metricColumns} />
      <MetricTrends samples={trendData.samples} peaks={trendData.peaks} />
    </section>
  );
}
