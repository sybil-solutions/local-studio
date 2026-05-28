"use client";

import { useState } from "react";
import { PageState } from "@/components/ui-kit/page-state";
import { RefreshButton } from "@/components/ui-kit/refresh-button";
import { DailyUsageChart } from "./_components/daily-usage-chart";
import { ModelPerformanceTable } from "./_components/model-performance-table";
import { PerformanceDetails } from "./_components/performance-details";
import { SecondaryMetrics } from "./_components/secondary-metrics";
import { useUsage, type UsageSource } from "./hooks/use-usage";
import { formatNumber } from "@/lib/formatters";
import { normalizeUsageStats } from "./lib/normalize-usage-stats";

const TABS: Array<{ id: UsageSource; label: string; sublabel: string }> = [
  { id: "provider", label: "Provider", sublabel: "this controller" },
  { id: "pi-sessions", label: "Pi sessions", sublabel: "coding-agent JSONL" },
];

export default function UsagePage() {
  const [tab, setTab] = useState<UsageSource>("provider");
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
  } = useUsage(tab);

  const pageStateRender = PageState({
    loading,
    data: stats,
    hasData: Boolean(stats),
    error,
    onLoad: loadStats,
  });
  if (pageStateRender) return <div className="min-h-full bg-(--bg)">{pageStateRender}</div>;

  if (!stats) return null;

  const safeStats = normalizeUsageStats(stats);
  const totals = safeStats.totals;
  const recent = safeStats.recent_activity;
  const cache = safeStats.cache;
  const tpr = safeStats.tokens_per_request;
  const successRate = Number(totals.success_rate ?? 0);
  const cacheRate = Number(cache.hit_rate ?? 0);

  return (
    <div className="min-h-full overflow-y-auto bg-(--bg) text-(--fg)">
      <div className="mx-auto w-full max-w-[86rem] px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 2xl:px-10">
        <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-(--border)/35 pb-2">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.16em] text-(--dim)">
            source
          </span>
          {TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={`h-7 rounded-md px-2 text-[11px] transition-colors ${
                  active
                    ? "bg-(--active) text-(--fg)"
                    : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                }`}
                title={entry.sublabel}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <section className="px-2 pt-2 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] tracking-[0.04em]">
                <span className="font-medium uppercase tracking-[0.14em] text-(--dim)">Usage</span>
                <span className="font-mono text-[10px] tabular-nums text-(--dim)/70">
                  {tab === "provider" ? "controller" : "pi sessions"}
                </span>
              </div>
              <h1 className="mt-1.5 truncate text-[22px] font-semibold leading-tight tracking-[-0.01em] text-(--fg)">
                {formatNumber(totals.total_tokens)} tokens
              </h1>
              <div className="mt-1 font-mono text-[11px] text-(--dim)">
                {formatNumber(totals.total_requests)} requests ·{" "}
                {formatNumber(totals.unique_sessions)} sessions ·{" "}
                {formatNumber(totals.unique_users)} users
              </div>
            </div>
            <RefreshButton
              onRefresh={loadStats}
              loading={loading}
              className="h-8 rounded-md border-0 bg-(--surface) px-3 text-[12px] text-(--dim) hover:bg-(--surface-2) hover:text-(--fg)"
            />
          </div>

          <dl className="mt-5 grid w-full grid-cols-2 border-b border-(--border)/40 pb-5 sm:grid-cols-3 lg:grid-cols-6">
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
            <HeaderStat label="success" value={`${successRate.toFixed(1)}%`} detail="chat turns" />
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
            <HeaderStat
              label="cache"
              value={`${cacheRate.toFixed(1)}%`}
              detail={`${formatNumber(cache.hits)} hits · ${formatNumber(cache.misses)} misses`}
            />
          </dl>
        </section>

        {DailyUsageChart(safeStats, dailyByModel, modelsForChart)}

        <ModelPerformanceTable
          expandedRows={expandedRows}
          handleSort={handleSort}
          peakMetrics={peakMetrics}
          sortDirection={sortDirection}
          sortField={sortField}
          sortedModels={sortedModels}
          toggleRow={toggleRow}
        />

        <div className="grid gap-x-6 lg:grid-cols-2">
          {PerformanceDetails(safeStats)}
          {SecondaryMetrics(safeStats)}
        </div>
      </div>
    </div>
  );
}

function HeaderStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 overflow-hidden border-r border-(--border)/40 pr-2 pl-3 first:pl-0 last:border-r-0 sm:pr-4 sm:pl-5">
      <dt className="truncate font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 font-mono text-[18px] leading-none tabular-nums text-(--fg)">
        {value}
      </dd>
      {detail ? (
        <dd className="mt-1 truncate font-mono text-[10.5px] text-(--dim)">{detail}</dd>
      ) : null}
    </div>
  );
}
