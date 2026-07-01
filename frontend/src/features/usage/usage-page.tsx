"use client";

import { useState } from "react";
import {
  AppPage,
  PageState,
  RefreshButton,
  SegmentedControl,
  Select,
  Tabs,
  type SegmentedItem,
} from "@/ui";
import { DailyUsageChart, type UsagePeriod } from "@/features/usage/daily-usage-chart";
import { ModelPerformanceTable } from "@/features/usage/model-performance-table";
import { SecondaryMetrics } from "@/features/usage/secondary-metrics";
import { useUsage, type UsageSource } from "@/features/usage/use-usage";
import { formatNumber } from "@/lib/formatters";
import { normalizeUsageStats } from "@/features/usage/normalize-usage-stats";

const TABS: Array<{ id: UsageSource; label: string; sublabel: string }> = [
  { id: "provider", label: "Provider", sublabel: "this controller" },
  { id: "pi-sessions", label: "Pi sessions", sublabel: "coding-agent JSONL" },
];

const PERIOD_ITEMS: Array<SegmentedItem<UsagePeriod>> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

const modelDisplayName = (modelId: string): string => modelId.split("/").pop() ?? modelId;

export default function UsagePage() {
  const [tab, setTab] = useState<UsageSource>("provider");
  const [period, setPeriod] = useState<UsagePeriod>("day");
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
    modelColorIndex,
    modelOptions,
    filteredDaily,
    selectedModel,
    setSelectedModel,
    sortedModels,
    handleSort,
    toggleRow,
  } = useUsage(tab);

  const pageStateRender = PageState({
    loading,
    data: stats,
    hasData: Boolean(stats),
    error,
    onLoad: loadStats,
  });
  if (pageStateRender) return <AppPage>{pageStateRender}</AppPage>;
  if (!stats) return null;

  const safeStats = normalizeUsageStats(stats);
  const totals = safeStats.totals;
  const recent = safeStats.recent_activity;
  const tpr = safeStats.tokens_per_request;
  const chartStats = { ...safeStats, daily: filteredDaily };

  const handleTabChange = (next: UsageSource) => {
    setTab(next);
    setSelectedModel("all");
  };

  return (
    <AppPage>
      <div className="mx-auto w-full max-w-[86rem] px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 2xl:px-10">
        <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-(--border)/35 pb-2">
          <span className="mr-1 font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--dim)">
            source
          </span>
          <Tabs
            variant="pill"
            items={TABS}
            activeTab={tab}
            onSelectTab={handleTabChange}
            className="[&_button]:h-7 [&_button]:px-2 [&_button]:py-0 [&_button]:text-[length:var(--fs-sm)]"
          />
        </div>

        <section className="px-2 pt-2 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-sm)] tracking-[0.04em]">
                <span className="font-medium uppercase tracking-[0.14em] text-(--dim)">
                  All-time usage
                </span>
                <span className="font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)/70">
                  {tab === "provider" ? "controller" : "pi sessions"}
                </span>
              </div>
              <h1 className="mt-1.5 truncate text-[length:var(--fs-3xl)] font-semibold leading-tight tracking-[-0.01em] text-(--fg)">
                {formatNumber(totals.total_tokens)} tokens
              </h1>
              <div className="mt-1 font-mono text-[length:var(--fs-sm)] text-(--dim)">
                {formatNumber(totals.total_requests)} requests ·{" "}
                {formatNumber(totals.unique_sessions)} sessions ·{" "}
                {formatNumber(totals.unique_users)} users
              </div>
            </div>
            <RefreshButton
              onRefresh={loadStats}
              loading={loading}
              className="h-8 rounded-md border-0 bg-(--surface) px-3 text-[length:var(--fs-md)] text-(--dim) hover:bg-(--surface-2) hover:text-(--fg)"
            />
          </div>

          <dl className="mt-5 grid w-full grid-cols-2 border-b border-(--border)/40 pb-5 lg:grid-cols-4">
            <HeaderStat
              label="prompt"
              value={formatNumber(totals.prompt_tokens)}
              detail="input tokens"
            />
            <HeaderStat
              label="completion"
              value={formatNumber(totals.completion_tokens)}
              detail="output tokens"
            />
            <HeaderStat
              label="24h req"
              value={formatNumber(recent.last_24h_requests)}
              detail={`${formatNumber(recent.last_hour_requests)} last hour`}
            />
            <HeaderStat
              label="avg tokens"
              value={formatNumber(tpr.avg)}
              detail={`${formatNumber(tpr.avg_prompt)} in · ${formatNumber(tpr.avg_completion)} out`}
            />
          </dl>
        </section>

        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.18em] text-(--dim)/75">
              model
            </span>
            <div className="w-[14rem] max-w-[60vw]">
              <Select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                options={[
                  { value: "all", label: "All models" },
                  ...modelOptions.map((model) => ({
                    value: model,
                    label: modelDisplayName(model),
                  })),
                ]}
              />
            </div>
          </div>
          <SegmentedControl items={PERIOD_ITEMS} value={period} onChange={setPeriod} size="sm" />
        </div>

        <DailyUsageChart
          stats={chartStats}
          dailyByModel={dailyByModel}
          modelsForChart={modelsForChart}
          modelColorIndex={modelColorIndex}
          period={period}
        />

        <ModelPerformanceTable
          expandedRows={expandedRows}
          handleSort={handleSort}
          modelColorIndex={modelColorIndex}
          peakMetrics={peakMetrics}
          sortDirection={sortDirection}
          sortField={sortField}
          sortedModels={sortedModels}
          toggleRow={toggleRow}
        />

        {SecondaryMetrics(safeStats)}
      </div>
    </AppPage>
  );
}

function HeaderStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 overflow-hidden border-r border-(--border)/40 pr-2 pl-3 first:pl-0 last:border-r-0 sm:pr-4 sm:pl-5">
      <dt className="truncate font-mono text-[length:var(--fs-2xs)] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 font-mono text-[length:var(--fs-2xl)] leading-none tabular-nums text-(--fg)">
        {value}
      </dd>
      {detail ? (
        <dd className="mt-1 truncate font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {detail}
        </dd>
      ) : null}
    </div>
  );
}
