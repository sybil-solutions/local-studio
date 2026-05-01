// CRITICAL
"use client";

import type { UsageStats } from "@/lib/types";
import { formatNumber } from "@/lib/formatters";

function SummaryCell({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.11em] text-(--dim)">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold leading-none tabular-nums text-(--fg)">
        {value}
      </div>
      {detail && <div className="mt-1 font-mono text-[10px] text-(--dim)">{detail}</div>}
    </div>
  );
}

export function OverviewMetrics(stats: UsageStats) {
  const totals = stats.totals;
  const recent = stats.recent_activity;
  const cache = stats.cache;
  const tpr = stats.tokens_per_request;
  const successRate = Number(totals.success_rate ?? 0);
  const cacheRate = Number(cache.hit_rate ?? 0);

  return (
    <section className="mb-5 border border-(--border) bg-(--surface)">
      <div className="border-b border-(--border) px-3 py-2 sm:px-4">
        <div className="text-sm font-semibold leading-5 text-(--fg)">Usage summary</div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.11em] text-(--dim)">
          Chat database aggregate · compact view
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-(--border) sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
        <SummaryCell
          label="Tokens"
          value={formatNumber(totals.total_tokens)}
          detail={`${formatNumber(totals.prompt_tokens)} in · ${formatNumber(totals.completion_tokens)} out`}
        />
        <SummaryCell
          label="Requests"
          value={formatNumber(totals.total_requests)}
          detail={`${formatNumber(recent.last_24h_requests)} last 24h`}
        />
        <SummaryCell
          label="Sessions"
          value={formatNumber(totals.unique_sessions)}
          detail={`${formatNumber(totals.unique_users)} users`}
        />
        <SummaryCell label="Success" value={`${successRate.toFixed(1)}%`} detail="chat turns" />
        <SummaryCell
          label="Avg tokens"
          value={formatNumber(tpr.avg)}
          detail={`${formatNumber(tpr.avg_prompt)} in · ${formatNumber(tpr.avg_completion)} out`}
        />
        <SummaryCell
          label="Cache"
          value={`${cacheRate.toFixed(1)}%`}
          detail={`${formatNumber(cache.hits)} hits · ${formatNumber(cache.misses)} misses`}
        />
      </div>
    </section>
  );
}
