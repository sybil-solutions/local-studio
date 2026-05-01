// CRITICAL
"use client";

import { RefreshButton, PageState } from "@/ui";
import { DailyUsageChart } from "./_components/daily-usage-chart";
import { ModelPerformanceTable } from "./_components/model-performance-table";
import { PerformanceDetails } from "./_components/performance-details";
import { SecondaryMetrics } from "./_components/secondary-metrics";
import { OverviewMetrics } from "./_components/overview-metrics";
import { useUsage } from "./hooks/use-usage";
import { formatNumber } from "@/lib/formatters";
import { normalizeUsageStats } from "./lib/normalize-usage-stats";
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
  if (pageStateRender) return <div className="min-h-full bg-(--bg)">{pageStateRender}</div>;

  if (!stats) return null;

  // Defensive: ensure every nested field used by child components exists,
  // so a partial backend response doesn't crash the page.
  const safeStats = normalizeUsageStats(stats);

  return (
    <div className="min-h-full overflow-y-auto bg-(--bg) text-(--fg)">
      <div className="mx-auto max-w-[118rem] px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 2xl:px-10">
        <div className="mb-5 border border-(--border) bg-(--surface)">
          <div className="grid gap-px bg-(--border) lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="bg-(--surface) px-4 py-4 sm:px-5">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-(--dim)">
                Usage
              </div>
              <h1 className="mt-2 font-mono text-2xl leading-none tracking-[-0.03em] sm:text-3xl">
                {formatNumber(safeStats.totals.total_tokens)} tokens
              </h1>
              <div className="mt-2 font-mono text-xs text-(--dim)">
                {formatNumber(safeStats.totals.total_requests)} requests /{" "}
                {formatNumber(safeStats.totals.unique_sessions)} sessions
              </div>
            </div>
            <div className="grid grid-cols-2 bg-(--border) lg:min-w-[26rem]">
              <UsageHeaderStat
                label="success"
                value={`${safeStats.totals.success_rate.toFixed(1)}%`}
              />
              <UsageHeaderStat
                label="24h req"
                value={formatNumber(safeStats.recent_activity.last_24h_requests)}
              />
              <UsageHeaderStat
                label="prompt"
                value={formatNumber(safeStats.totals.prompt_tokens)}
              />
              <UsageHeaderStat
                label="completion"
                value={formatNumber(safeStats.totals.completion_tokens)}
              />
            </div>
          </div>
          <div className="flex items-center justify-end border-t border-(--border) bg-(--bg)/55 px-4 py-2">
            <RefreshButton
              onRefresh={loadStats}
              loading={loading}
              className="border border-(--border) bg-(--surface)"
            />
          </div>
        </div>

        {/* Overview Metrics */}
        {OverviewMetrics(safeStats)}

        {/* Daily Usage Chart */}
        {DailyUsageChart(safeStats, dailyByModel, modelsForChart)}

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
          {PerformanceDetails(safeStats)}
          {SecondaryMetrics(safeStats)}
        </div>
      </div>
    </div>
  );
}

function UsageHeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-(--surface) px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-(--dim)">{label}</div>
      <div className="mt-1 font-mono text-base tabular-nums text-(--fg)">{value}</div>
    </div>
  );
}
