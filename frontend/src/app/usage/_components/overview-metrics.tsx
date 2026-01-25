// CRITICAL
"use client";

import type { UsageStats } from "@/lib/types";
import { formatNumber } from "@/lib/formatters";
import { SectionHeader, ChangeIndicator } from "@/components/shared";

export function OverviewMetrics(stats: UsageStats) {
  return (
    <section className="mb-6 pb-5 border-b border-(--border)/40">
      {SectionHeader("Overview")}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-6">
        <div>
          <div className="text-xs text-(--muted-foreground) mb-1">Total Tokens</div>
          <div className="text-lg font-medium tabular-nums">
            {formatNumber(stats.totals.total_tokens)}
          </div>
        </div>
        <div>
          <div className="text-xs text-(--muted-foreground) mb-1">Requests</div>
          <div className="text-lg font-medium tabular-nums">
            {formatNumber(stats.totals.total_requests)}
          </div>
          <div className="text-[10px] text-(--muted-foreground) mt-0.5">
            {formatNumber(stats.recent_activity.last_24h_requests)} last 24h
          </div>
        </div>
        <div>
          <div className="text-xs text-(--muted-foreground) mb-1">Success Rate</div>
          <div
            className={`text-lg font-medium tabular-nums ${
              stats.totals.success_rate >= 95
                ? "text-(--success)"
                : stats.totals.success_rate >= 90
                  ? "text-(--warning)"
                  : "text-(--error)"
            }`}
          >
            {stats.totals.success_rate.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-(--muted-foreground) mb-1">Sessions</div>
          <div className="text-lg font-medium tabular-nums">
            {formatNumber(stats.totals.unique_sessions)}
          </div>
          <div className="text-[10px] text-(--muted-foreground) mt-0.5">
            {formatNumber(stats.totals.unique_users)} users
          </div>
        </div>
        <div>
          <div className="text-xs text-(--muted-foreground) mb-1">This Week</div>
          <div className="text-lg font-medium tabular-nums">
            {formatNumber(stats.week_over_week.this_week.requests)}
          </div>
          <div className="mt-0.5">{ChangeIndicator({ value: stats.week_over_week.change_pct.requests })}</div>
        </div>
        <div>
          <div className="text-xs text-(--muted-foreground) mb-1">Cache Hit Rate</div>
          <div className="text-lg font-medium tabular-nums">{stats.cache.hit_rate.toFixed(1)}%</div>
          <div className="text-[10px] text-(--muted-foreground) mt-0.5">
            {formatNumber(stats.cache.hits)} hits
          </div>
        </div>
      </div>
    </section>
  );
}
