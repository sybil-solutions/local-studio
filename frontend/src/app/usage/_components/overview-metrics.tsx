// CRITICAL
"use client";

import type { UsageStats } from "@/lib/types";
import { formatNumber } from "@/lib/formatters";
import { ChangeIndicator } from "@/components/shared";
import { Coins, Activity, TrendingUp, Users, Clock, Database } from "lucide-react";

function MetricCard({
  icon: Icon,
  label,
  value,
  subvalue,
  subvalueNode,
  trend,
  color,
  delay = 0,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subvalue?: string;
  subvalueNode?: React.ReactNode;
  trend?: React.ReactNode;
  color: "purple" | "blue" | "green" | "amber" | "rose" | "cyan";
  delay?: number;
}) {
  const colorStyles = {
    purple: "from-violet-500/20 to-purple-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
    blue: "from-blue-500/20 to-sky-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    green: "from-emerald-500/20 to-green-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    amber: "from-amber-500/20 to-yellow-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    rose: "from-rose-500/20 to-red-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
    cyan: "from-cyan-500/20 to-teal-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  };

  return (
    <div
      className={`group relative overflow-hidden rounded-xl bg-(--card)/60 backdrop-blur-sm border border-(--border)/40 p-5 transition-all duration-300 hover:bg-(--card-hover)/80 hover:shadow-lg hover:shadow-${color}-500/5 hover:-translate-y-0.5`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${colorStyles[color].replace(/border-\w+-\d+\/\d+/, "")}`} />
      <div className="flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${colorStyles[color]} border`}>
          <Icon className="h-5 w-5" />
        </div>
        {trend && <div className="flex items-center">{trend}</div>}
      </div>
      <div className="mt-4">
        <p className="text-sm font-medium text-(--muted-foreground)">{label}</p>
        <p className="text-2xl font-bold text-(--foreground) mt-1 tabular-nums tracking-tight">
          {value}
        </p>
        {(subvalue || subvalueNode) && (
          <div className="mt-2 text-xs text-(--muted-foreground)">
            {subvalueNode || subvalue}
          </div>
        )}
      </div>
    </div>
  );
}

export function OverviewMetrics(stats: UsageStats) {
  return (
    <section className="mb-8">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          icon={Coins}
          label="Total Tokens"
          value={formatNumber(stats.totals.total_tokens)}
          subvalue={`${formatNumber(stats.totals.prompt_tokens)} prompt · ${formatNumber(stats.totals.completion_tokens)} completion`}
          color="purple"
          delay={0}
        />
        <MetricCard
          icon={Activity}
          label="Total Requests"
          value={formatNumber(stats.totals.total_requests)}
          subvalueNode={
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--success) animate-pulse" />
              {formatNumber(stats.recent_activity.last_24h_requests)} in last 24h
            </span>
          }
          color="blue"
          delay={50}
        />
        <MetricCard
          icon={TrendingUp}
          label="Success Rate"
          value={`${stats.totals.success_rate.toFixed(1)}%`}
          subvalue={stats.totals.success_rate >= 95 ? "Excellent" : stats.totals.success_rate >= 90 ? "Good" : "Needs Attention"}
          color={stats.totals.success_rate >= 95 ? "green" : stats.totals.success_rate >= 90 ? "amber" : "rose"}
          delay={100}
        />
        <MetricCard
          icon={Users}
          label="Active Sessions"
          value={formatNumber(stats.totals.unique_sessions)}
          subvalue={`${formatNumber(stats.totals.unique_users)} unique users`}
          color="cyan"
          delay={150}
        />
        <MetricCard
          icon={Clock}
          label="This Week"
          value={formatNumber(stats.week_over_week.this_week.requests)}
          trend={<ChangeIndicator value={stats.week_over_week.change_pct.requests} />}
          color="amber"
          delay={200}
        />
        <MetricCard
          icon={Database}
          label="Cache Hit Rate"
          value={`${stats.cache.hit_rate.toFixed(1)}%`}
          subvalue={`${formatNumber(stats.cache.hits)} hits · ${formatNumber(stats.cache.misses)} misses`}
          color="green"
          delay={250}
        />
      </div>
    </section>
  );
}
