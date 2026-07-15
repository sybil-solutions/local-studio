"use client";

import { useState } from "react";
import { AppPage, Card, PageContainer, PageState, RefreshButton, SegmentedControl } from "@/ui";
import { TokenActivityHeatmap } from "@/features/usage/token-activity-heatmap";
import { useUsage, type UsageSource } from "@/features/usage/use-usage";
import { UsageSkeleton } from "@/features/usage/usage-skeleton";
import { formatNumber } from "@/lib/formatters";
import type { UsageStats } from "@/lib/types";

const SOURCES = [
  { id: "provider", label: "Lifetime" },
  { id: "pi-sessions", label: "Agent sessions" },
] satisfies Array<{ id: UsageSource; label: string }>;

const sourceDescription = (source: UsageSource): string =>
  source === "pi-sessions"
    ? "Coding-agent session records · cached context included"
    : "Every request recorded by this controller";

const sourceTitle = (source: UsageSource): string =>
  source === "pi-sessions" ? "Agent-session tokens" : "Lifetime tokens";

const activeDays = (stats: UsageStats): number =>
  stats.daily.filter((day) => day.total_tokens > 0).length;

const peakDay = (stats: UsageStats): number =>
  stats.daily.reduce((peak, day) => Math.max(peak, day.total_tokens), 0);

const tokenParts = (stats: UsageStats): Array<{ label: string; value: number }> => {
  const parts = [
    { label: "Fresh input", value: stats.totals.prompt_tokens },
    { label: "Cache read", value: stats.cache.hit_tokens },
    { label: "Cache write", value: stats.cache.miss_tokens },
    { label: "Output", value: stats.totals.completion_tokens },
  ];
  return parts.filter((part) => part.value > 0);
};

export default function UsagePage() {
  const [source, setSource] = useState<UsageSource>("provider");
  const { stats, loading, error, loadStats } = useUsage(source);

  if (loading && !stats) return <UsageSkeleton />;

  const pageState = PageState({
    loading,
    data: stats,
    hasData: Boolean(stats),
    error,
    onLoad: loadStats,
  });
  if (pageState) return <AppPage>{pageState}</AppPage>;
  if (!stats) return null;

  return (
    <AppPage>
      <PageContainer width="sm" className="pt-5 sm:pt-7">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-[length:var(--fs-lg)] font-medium text-(--ui-fg)">Usage</h1>
          <div className="flex items-center gap-2">
            <SegmentedControl items={SOURCES} value={source} onChange={setSource} size="sm" />
            <RefreshButton onRefresh={loadStats} loading={loading} className="h-7 w-7" />
          </div>
        </header>

        <section className="pt-14 text-center sm:pt-20">
          <p className="text-[length:var(--fs-sm)] font-medium text-(--ui-muted)">
            {sourceTitle(source)}
          </p>
          <div className="mt-2 text-[clamp(2.75rem,7vw,4.75rem)] font-medium leading-none tracking-[-0.055em] tabular-nums text-(--ui-fg)">
            {formatNumber(stats.totals.total_tokens)}
          </div>
          <p className="mt-3 text-[length:var(--fs-sm)] text-(--ui-muted)">
            {sourceDescription(source)}
          </p>
        </section>

        <Card
          bordered={false}
          padding="sm"
          className="mx-auto mt-10 max-w-[55rem] bg-(--ui-surface) sm:mt-12"
        >
          <dl className="grid grid-cols-2 divide-x divide-(--ui-border) sm:grid-cols-4">
            <ProfileStat label="Requests" value={formatNumber(stats.totals.total_requests)} />
            <ProfileStat label="Sessions" value={formatNumber(stats.totals.unique_sessions)} />
            <ProfileStat label="Active days" value={formatNumber(activeDays(stats))} />
            <ProfileStat label="Peak day" value={formatNumber(peakDay(stats))} />
          </dl>
        </Card>

        <section className="mx-auto mt-12 max-w-[55rem] rounded-[var(--rad-xl)] bg-(--ui-surface)/60 p-4 sm:mt-16 sm:p-5">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
              Token activity
            </h2>
            <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">Past year</span>
          </div>
          <TokenActivityHeatmap daily={stats.daily} />
        </section>

        <section className="mx-auto mt-5 grid max-w-[55rem] gap-3 sm:grid-cols-2">
          <div className="rounded-[var(--rad-xl)] bg-(--ui-surface)/60 p-5">
            <TokenMix stats={stats} />
          </div>
          <div className="rounded-[var(--rad-xl)] bg-(--ui-surface)/60 p-5">
            <ModelUsage stats={stats} />
          </div>
        </section>
      </PageContainer>
    </AppPage>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5 text-center first:border-l-0 sm:px-5">
      <dd className="text-[length:var(--fs-lg)] font-medium tabular-nums text-(--ui-fg)">
        {value}
      </dd>
      <dt className="mt-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">{label}</dt>
    </div>
  );
}

function TokenMix({ stats }: { stats: UsageStats }) {
  const total = stats.totals.total_tokens;
  return (
    <div>
      <h2 className="mb-4 text-[length:var(--fs-md)] font-medium text-(--ui-fg)">Token mix</h2>
      <div className="space-y-3">
        {tokenParts(stats).map((part) => (
          <div key={part.label} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1">
            <span className="text-[length:var(--fs-sm)] text-(--ui-muted)">{part.label}</span>
            <span className="text-[length:var(--fs-sm)] tabular-nums text-(--ui-fg)">
              {formatNumber(part.value)}
            </span>
            <div className="col-span-2 h-1 overflow-hidden rounded-full bg-(--ui-surface-2)">
              <div
                className="h-full rounded-full bg-[color:var(--color-blue-500)]/65"
                style={{ width: `${total > 0 ? Math.max(1, (part.value / total) * 100) : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelUsage({ stats }: { stats: UsageStats }) {
  const models = stats.by_model.slice(0, 5);
  const largest = models[0]?.total_tokens ?? 0;
  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">Most used models</h2>
        <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">
          {stats.by_model.length} models
        </span>
      </div>
      <div className="space-y-3">
        {models.map((model) => (
          <div
            key={model.model}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1"
          >
            <span
              className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)"
              title={model.model}
            >
              {model.model.split("/").pop()}
            </span>
            <span className="text-[length:var(--fs-sm)] tabular-nums text-(--ui-fg)">
              {formatNumber(model.total_tokens)}
            </span>
            <div className="col-span-2 h-1 overflow-hidden rounded-full bg-(--ui-surface-2)">
              <div
                className="h-full rounded-full bg-[color:var(--color-blue-500)]/45"
                style={{ width: `${largest > 0 ? (model.total_tokens / largest) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
