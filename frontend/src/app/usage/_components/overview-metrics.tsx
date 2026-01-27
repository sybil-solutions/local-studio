// CRITICAL
"use client";

import type { UsageStats } from "@/lib/types";
import { formatNumber } from "@/lib/formatters";
import { ChangeIndicator } from "@/components/shared";
import { Hash, Activity, TrendingUp, Users, Clock, Database } from "lucide-react";

function MetricCard({
  icon: Icon,
  label,
  value,
  subvalue,
  subvalueNode,
  trend,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subvalue?: string;
  subvalueNode?: React.ReactNode;
  trend?: React.ReactNode;
}) {
  return (
    <div className="bg-[#1e1e1e] rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-[#9a9088]">
          <Icon className="h-4 w-4" />
          <span className="text-xs">{label}</span>
        </div>
        {trend && <div className="flex items-center">{trend}</div>}
      </div>
      <div className="mt-3">
        <div className="text-xl font-medium tabular-nums tracking-tight">
          {value}
        </div>
        {(subvalue || subvalueNode) && (
          <div className="mt-1.5 text-xs text-[#9a9088]">
            {subvalueNode || subvalue}
          </div>
        )}
      </div>
    </div>
  );
}

export function OverviewMetrics(stats: UsageStats) {
  return (
    <section className="mb-6 sm:mb-8">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        <MetricCard
          icon={Hash}
          label="Total Tokens"
          value={formatNumber(stats.totals.total_tokens)}
          subvalue={`${formatNumber(stats.totals.prompt_tokens)} prompt · ${formatNumber(stats.totals.completion_tokens)} completion`}
        />
        <MetricCard
          icon={Activity}
          label="Total Requests"
          value={formatNumber(stats.totals.total_requests)}
          subvalueNode={
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#7d9a6a]" />
              {formatNumber(stats.recent_activity.last_24h_requests)} last 24h
            </span>
          }
        />
        <MetricCard
          icon={TrendingUp}
          label="Success Rate"
          value={`${stats.totals.success_rate.toFixed(1)}%`}
          subvalue={stats.totals.success_rate >= 95 ? "Excellent" : stats.totals.success_rate >= 90 ? "Good" : "Needs Attention"}
        />
        <MetricCard
          icon={Users}
          label="Active Sessions"
          value={formatNumber(stats.totals.unique_sessions)}
          subvalue={`${formatNumber(stats.totals.unique_users)} unique users`}
        />
        <MetricCard
          icon={Clock}
          label="This Week"
          value={formatNumber(stats.week_over_week.this_week.requests)}
          trend={<ChangeIndicator value={stats.week_over_week.change_pct.requests} />}
        />
        <MetricCard
          icon={Database}
          label="Cache Hit Rate"
          value={`${stats.cache.hit_rate.toFixed(1)}%`}
          subvalue={`${formatNumber(stats.cache.hits)} hits · ${formatNumber(stats.cache.misses)} misses`}
        />
      </div>
    </section>
  );
}
