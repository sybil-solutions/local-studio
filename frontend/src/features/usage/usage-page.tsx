"use client";

import { useRef, useState, type ReactNode } from "react";
import { AppPage, Button, ErrorBox, PageContainer, RefreshButton, Tabs } from "@/ui";
import { Activity, AlertTriangle, Server, Sparkles, Upload } from "@/ui/icon-registry";
import { formatNumber } from "@/lib/formatters";
import type { UsageStats } from "@/lib/types";
import {
  ProfileAvatar,
  profileImageFromFile,
  useLocalProfile,
} from "@/features/shell/local-profile";
import { useUsage } from "./use-usage";
import { UsageSkeleton } from "./usage-skeleton";
import { UsageModelsTab } from "./usage-models-tab";
import { UsageActivityTab } from "./usage-activity-tab";
import { UsageControllerTab } from "./usage-controller-tab";
import { UsageErrorsTab } from "./usage-errors-tab";
import { TokenActivityHeatmap } from "./token-activity-heatmap";

type UsageTab = "models" | "activity" | "routes" | "errors";

const USAGE_TABS: Array<{ id: UsageTab; label: string; icon: ReactNode }> = [
  { id: "models", label: "Models", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: "activity", label: "Activity", icon: <Activity className="h-3.5 w-3.5" /> },
  { id: "routes", label: "Controller", icon: <Server className="h-3.5 w-3.5" /> },
  { id: "errors", label: "Errors", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
];

const TAB_HEADINGS: Record<UsageTab, { title: string; description: string }> = {
  models: {
    title: "By model",
    description:
      "What each model was asked to do and how fast it did it — prefill, decode, time to first token, and the tail of the latency distribution.",
  },
  activity: {
    title: "Activity",
    description:
      "When the traffic arrives: hour of day, day by day, and the busiest days this machine has handled.",
  },
  routes: {
    title: "Controller",
    description:
      "The process in front of the models — every route it has served, the status codes it returned, and how reliable the agent's tools are.",
  },
  errors: {
    title: "Errors",
    description:
      "Failed requests and failed tool calls, newest first, with the message the controller actually recorded.",
  },
};

const activeDays = (stats: UsageStats): number =>
  stats.daily.filter((day) => day.total_tokens > 0).length;

const currentStreak = (stats: UsageStats): number => {
  const active = new Set(stats.daily.filter((day) => day.total_tokens > 0).map((day) => day.date));
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!active.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (active.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
};

const milliseconds = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value)} ms`;

/**
 * Usage: the profile summary it always had, with the four tabs underneath.
 *
 * The tabs earn their place — they surface throughput, the controller block and
 * the hour-of-day pattern that the page used to fetch and drop — but the page
 * still opens the way it did: who this machine is, one headline number, and the
 * six-cell grid. Those six are true of the whole retention window, so they sit
 * above the tab strip rather than inside any one tab.
 */
/** The whole page, or — `embedded` — the same content as a settings section:
 *  no page chrome and no profile header (Settings has a Profile section). */
export default function UsagePage({ embedded = false }: { embedded?: boolean }) {
  const { stats, loading, error, loadStats } = useUsage();
  const [tab, setTab] = useState<UsageTab>("models");
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

  if (error && !stats) {
    const retry = (
      <div className="mx-auto flex max-w-md flex-col items-start gap-3 py-16">
        <ErrorBox>{error}</ErrorBox>
        <Button variant="secondary" onClick={loadStats}>
          Retry
        </Button>
      </div>
    );
    return embedded ? retry : <AppPage>{retry}</AppPage>;
  }
  if (!stats) return null;

  const heading = TAB_HEADINGS[tab];

  const body = (
    <>
      {!embedded ? (
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
              {/* Duplicated by the phone topbar; kept for desktop and for
                  screen readers, where it is the page's only heading. */}
              <h1 className="sr-only text-[length:var(--fs-sm)] text-(--ui-muted) md:not-sr-only">
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
          <RefreshButton onRefresh={loadStats} loading={loading} className="h-7 w-7" />
        </header>
      ) : null}

      <section className={embedded ? "" : "mt-8"}>
        <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">Proxied tokens</p>
        <div className="mt-1 text-[length:var(--fs-display)] font-medium leading-none tracking-[-0.03em] tabular-nums text-(--ui-fg)">
          {formatNumber(stats.totals.total_tokens)}
        </div>
        <p className="mt-2 text-[length:var(--fs-sm)] text-(--ui-muted)">
          Requests proxied through this controller
        </p>
      </section>

      {/* gap-px over a border-coloured ground, rather than divide-x: a divided
            grid draws a stray left edge on the first cell of every wrapped row,
            so the rule only looked right at the one breakpoint where all six
            cells fit on a single line. This way the hairlines are exact at 2, 3
            and 6 columns, and the rounded corners clip cleanly. */}
      <StatGrid>
        <Stat label="Requests" value={formatNumber(stats.totals.total_requests)} />
        <Stat label="Sessions" value={formatNumber(stats.totals.unique_sessions)} />
        <Stat label="Active days" value={formatNumber(activeDays(stats))} />
        <Stat label="Active streak" value={`${currentStreak(stats)} days`} />
        <Stat label="Success rate" value={`${Math.round(stats.totals.success_rate)}%`} />
        <Stat label="P95 latency" value={milliseconds(stats.latency.p95_ms)} />
      </StatGrid>

      {/* The year at a glance, above the tabs rather than inside one: it is
            true of the whole window like the grid above it, and it is the thing
            people come to this page to look at. */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">Past year</h2>
          <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">tokens per day</span>
        </div>
        <div className="mt-3">
          <TokenActivityHeatmap daily={stats.daily} />
        </div>
      </section>

      <div className="mt-8 border-b border-(--ui-separator)">
        <Tabs items={USAGE_TABS} activeTab={tab} onSelectTab={setTab} className="-mb-px" />
      </div>

      <section className="mt-8">
        <h2 className="text-[length:var(--fs-2xl)] font-medium tracking-[-0.015em] text-(--ui-fg)">
          {heading.title}
        </h2>
        <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{heading.description}</p>

        <div className="mt-6">
          {tab === "models" ? (
            <UsageModelsTab stats={stats} />
          ) : tab === "activity" ? (
            <UsageActivityTab stats={stats} />
          ) : tab === "routes" ? (
            <UsageControllerTab stats={stats} />
          ) : (
            <UsageErrorsTab stats={stats} />
          )}
        </div>
      </section>
    </>
  );

  if (embedded) return <div>{body}</div>;
  return (
    <AppPage>
      <PageContainer width="sm" className="pt-5 sm:pt-7">
        {body}
      </PageContainer>
    </AppPage>
  );
}

function StatGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--rad-xl)] bg-(--ui-border) sm:grid-cols-3 lg:grid-cols-6">
      {children}
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-(--ui-surface) px-3 py-2.5 sm:px-4">
      {/* truncate, because "Active streak" and a five-digit millisecond value
          both have to survive a six-column row on a narrow window. */}
      <dd className="truncate text-[length:var(--fs-lg)] font-medium tabular-nums text-(--ui-fg)">
        {value}
      </dd>
      <dt className="mt-0.5 truncate text-[length:var(--fs-sm)] text-(--ui-muted)">{label}</dt>
    </div>
  );
}
