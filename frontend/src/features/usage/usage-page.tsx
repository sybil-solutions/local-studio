"use client";

import { useRef, useState } from "react";
import { AppPage, Card, PageContainer, PageState, RefreshButton, SegmentedControl } from "@/ui";
import { TokenActivityHeatmap, type ActivityPeriod } from "@/features/usage/token-activity-heatmap";
import { useUsage } from "@/features/usage/use-usage";
import { UsageSkeleton } from "@/features/usage/usage-skeleton";
import { formatNumber } from "@/lib/formatters";
import type { UsageStats } from "@/lib/types";
import { Upload } from "@/ui/icon-registry";
import {
  ProfileAvatar,
  profileImageFromFile,
  useLocalProfile,
} from "@/features/shell/local-profile";

const ACTIVITY_PERIODS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
] satisfies Array<{ id: ActivityPeriod; label: string }>;

const activeDays = (stats: UsageStats): number =>
  stats.daily.filter((day) => day.total_tokens > 0).length;

const currentStreak = (stats: UsageStats): number => {
  const activeDays = new Set(
    stats.daily.filter((day) => day.total_tokens > 0).map((day) => day.date),
  );
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!activeDays.has(cursor.toISOString().slice(0, 10)))
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (activeDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
};

const percentage = (value: number | null): string =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${Math.round(value)}%`;

const milliseconds = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value)} ms`;

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
  const { stats, loading, error, loadStats } = useUsage();
  const [period, setPeriod] = useState<ActivityPeriod>("daily");
  const [profile, updateProfile] = useLocalProfile();
  const [imageError, setImageError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const updateImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      updateProfile({ imageUrl: await profileImageFromFile(file) });
      setImageError("");
    } catch (nextError) {
      setImageError(nextError instanceof Error ? nextError.message : "Image failed to load");
    }
  };

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
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="group relative shrink-0 rounded-full"
              title="Update profile image"
              aria-label="Update profile image"
            >
              <ProfileAvatar profile={profile} size={38} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Upload className="h-4 w-4 text-white" />
              </span>
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void updateImage(event.currentTarget.files?.[0])}
            />
            <div className="min-w-0">
              <h1 className="text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.12em] text-(--ui-muted)">
                Usage
              </h1>
              <input
                value={profile.name}
                onChange={(event) => updateProfile({ name: event.target.value })}
                onBlur={() => {
                  if (!profile.name.trim()) updateProfile({ name: "Studio" });
                }}
                aria-label="Profile display name"
                className="mt-0.5 block h-7 max-w-56 bg-transparent text-[length:var(--fs-lg)] font-medium text-(--ui-fg) outline-none placeholder:text-(--ui-muted)"
                placeholder="Studio"
              />
              {imageError ? (
                <p className="mt-1 text-[length:var(--fs-xs)] text-(--err)">{imageError}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton onRefresh={loadStats} loading={loading} className="h-7 w-7" />
          </div>
        </header>

        <section className="pt-14 text-center sm:pt-20">
          <p className="text-[length:var(--fs-sm)] font-medium text-(--ui-muted)">Proxied tokens</p>
          <div className="mt-2 text-[clamp(2.75rem,7vw,4.75rem)] font-medium leading-none tracking-[-0.055em] tabular-nums text-(--ui-fg)">
            {formatNumber(stats.totals.total_tokens)}
          </div>
          <p className="mt-3 text-[length:var(--fs-sm)] text-(--ui-muted)">
            Requests proxied through this controller
          </p>
        </section>

        <Card
          bordered={false}
          padding="sm"
          className="mx-auto mt-10 max-w-[55rem] bg-(--ui-surface) sm:mt-12"
        >
          <dl className="grid grid-cols-2 divide-x divide-y divide-(--ui-border) sm:grid-cols-3 lg:grid-cols-6">
            <ProfileStat label="Requests" value={formatNumber(stats.totals.total_requests)} />
            <ProfileStat label="Sessions" value={formatNumber(stats.totals.unique_sessions)} />
            <ProfileStat label="Active days" value={formatNumber(activeDays(stats))} />
            <ProfileStat label="Active streak" value={`${currentStreak(stats)} days`} />
            <ProfileStat label="Success rate" value={`${Math.round(stats.totals.success_rate)}%`} />
            <ProfileStat label="P95 latency" value={milliseconds(stats.latency.p95_ms)} />
          </dl>
        </Card>

        <section className="mx-auto mt-12 max-w-[55rem] rounded-[var(--rad-xl)] bg-(--ui-surface)/60 p-4 sm:mt-16 sm:p-5">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
              Token activity
            </h2>
            <div className="flex items-center gap-3">
              <span className="hidden text-[length:var(--fs-xs)] text-(--ui-muted) sm:inline">
                {period === "daily" ? "Past year" : "Past 53 weeks"}
              </span>
              <SegmentedControl
                items={ACTIVITY_PERIODS}
                value={period}
                onChange={setPeriod}
                size="sm"
              />
            </div>
          </div>
          <TokenActivityHeatmap key={period} daily={stats.daily} period={period} />
        </section>

        <section className="mx-auto mt-5 grid max-w-[55rem] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-[var(--rad-xl)] bg-(--ui-surface)/60 p-5">
            <TokenMix stats={stats} />
          </div>
          <div className="rounded-[var(--rad-xl)] bg-(--ui-surface)/60 p-5">
            <ModelUsage stats={stats} />
          </div>
          <div className="rounded-[var(--rad-xl)] bg-(--ui-surface)/60 p-5">
            <ProxyPace stats={stats} />
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

function ProxyPace({ stats }: { stats: UsageStats }) {
  const metrics = [
    { label: "Last hour", value: formatNumber(stats.recent_activity.last_hour_requests) },
    { label: "Last 24 hours", value: formatNumber(stats.recent_activity.last_24h_requests) },
    { label: "24h change", value: percentage(stats.recent_activity.change_24h_pct) },
    { label: "Week over week", value: percentage(stats.week_over_week.change_pct.tokens) },
    { label: "Cache hit rate", value: `${Math.round(stats.cache.hit_rate)}%` },
    { label: "Average TTFT", value: milliseconds(stats.ttft.avg_ms) },
  ];
  return (
    <div>
      <h2 className="mb-4 text-[length:var(--fs-md)] font-medium text-(--ui-fg)">Proxy pace</h2>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dd className="text-[length:var(--fs-md)] font-medium tabular-nums text-(--ui-fg)">
              {metric.value}
            </dd>
            <dt className="mt-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">{metric.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}
