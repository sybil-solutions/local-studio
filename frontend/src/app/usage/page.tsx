// CRITICAL
"use client";

import { RefreshButton, PageState } from "@/components/shared";
import { DailyUsageChart } from "./_components/daily-usage-chart";
import { ModelPerformanceTable } from "./_components/model-performance-table";
import { PerformanceDetails } from "./_components/performance-details";
import { SecondaryMetrics } from "./_components/secondary-metrics";
import { OverviewMetrics } from "./_components/overview-metrics";
import { useUsage } from "./hooks/use-usage";
import { BarChart3 } from "lucide-react";

export default function UsagePage() {
  const {
    stats,
    peakMetrics,
    loading,
    error,
    expandedRows,
    sortField,
    sortDirection,
    loadStats,
    dailyByModel,
    modelsForChart,
    sortedModels,
    handleSort,
    toggleRow,
  } = useUsage();

  const pageStateRender = PageState({
    loading,
    data: stats,
    hasData: Boolean(stats),
    error,
    onLoad: loadStats,
  });
  if (pageStateRender) return <div className="min-h-full bg-[#1b1b1b]">{pageStateRender}</div>;

  if (!stats) return null;

  return (
    <div className="min-h-full bg-[#1b1b1b] text-[#f0ebe3] overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-[#9a9088]" />
            <h1 className="text-lg font-medium">Usage Analytics</h1>
          </div>
          <RefreshButton onRefresh={loadStats} loading={loading} />
        </div>

        {/* Overview Metrics */}
        {OverviewMetrics(stats)}

        {/* Daily Usage Chart */}
        {DailyUsageChart(stats, dailyByModel, modelsForChart)}

        {/* Model Performance Table */}
        {ModelPerformanceTable(
          sortedModels,
          peakMetrics,
          expandedRows,
          sortField,
          sortDirection,
          handleSort,
          toggleRow,
        )}

        {/* Performance Details & Secondary Metrics */}
        <div className="grid lg:grid-cols-2 gap-6">
          {PerformanceDetails(stats)}
          {SecondaryMetrics(stats)}
        </div>
      </div>
    </div>
  );
}
