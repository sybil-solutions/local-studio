"use client";

import type { ReactNode } from "react";
import { Info, Moon, Square, Sun } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ModelStopConfirm } from "@/ui/model-stop-confirm";
import { useModelLifecycle } from "@/hooks/use-model-lifecycle";
import type { ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { useAppStore } from "@/store";
import { ModelsDropdown } from "./status-section-models-dropdown";
import type { CompactMetricView, MetricColumnView, RuntimeMetricView } from "./status-section-view";

export function StatusHeader({
  backend,
  benchmarking,
  currentRecipeId,
  displayPlatformKind,
  displayPort,
  isConnected,
  isRunning,
  isStatusLoading,
  lifecycleStatus,
  modelName,
  onBenchmark,
  onLaunch,
  onNavigateLogs,
  onNewRecipe,
  onViewAll,
  recipes,
}: {
  backend?: ProcessInfo["backend"];
  benchmarking: boolean;
  currentRecipeId?: string;
  displayPlatformKind: RuntimePlatformKind | null;
  displayPort?: number;
  isConnected: boolean;
  isRunning: boolean;
  isStatusLoading: boolean;
  lifecycleStatus: "idle" | "starting" | "ready" | "error";
  modelName: string;
  onBenchmark: () => void;
  onLaunch?: (recipeId: string) => Promise<void>;
  onNavigateLogs: () => void;
  onNewRecipe?: () => void;
  onViewAll?: () => void;
  recipes?: RecipeWithStatus[];
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <StatusLine
          backend={backend}
          displayPlatformKind={displayPlatformKind}
          displayPort={displayPort}
          isConnected={isConnected}
          isRunning={isRunning}
          isStatusLoading={isStatusLoading}
        />
        <h1
          className="mt-1.5 truncate text-[length:var(--fs-3xl)] font-semibold leading-tight tracking-[-0.01em] text-(--fg)"
          title={modelName || ""}
        >
          {modelName}
        </h1>
      </div>
      <StatusHeaderActions
        benchmarking={benchmarking}
        currentRecipeId={currentRecipeId}
        isRunning={isRunning}
        lifecycleStatus={lifecycleStatus}
        onBenchmark={onBenchmark}
        onLaunch={onLaunch}
        onNavigateLogs={onNavigateLogs}
        onNewRecipe={onNewRecipe}
        onViewAll={onViewAll}
        recipes={recipes}
      />
    </div>
  );
}

function StatusLine({
  backend,
  displayPlatformKind,
  displayPort,
  isConnected,
  isRunning,
  isStatusLoading,
}: {
  backend?: ProcessInfo["backend"];
  displayPlatformKind: RuntimePlatformKind | null;
  displayPort?: number;
  isConnected: boolean;
  isRunning: boolean;
  isStatusLoading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-sm)] tracking-[0.04em]">
      <StatusDot running={isRunning} loading={isStatusLoading} />
      <span className="inline-block w-[5.75rem] font-medium uppercase tracking-[0.14em] text-(--dim)">
        {isRunning ? "Active" : "Standby"}
      </span>
      {!isConnected && !isStatusLoading ? <Tag tone="err">offline</Tag> : null}
      {backend ? <Tag>{backend}</Tag> : null}
      {displayPlatformKind ? <Tag>{displayPlatformKind}</Tag> : null}
      {displayPort ? (
        <span className="font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)/70">
          :{displayPort}
        </span>
      ) : null}
    </div>
  );
}

function StatusHeaderActions({
  benchmarking,
  currentRecipeId,
  isRunning,
  lifecycleStatus,
  onBenchmark,
  onLaunch,
  onNavigateLogs,
  onNewRecipe,
  onViewAll,
  recipes,
}: {
  benchmarking: boolean;
  currentRecipeId?: string;
  isRunning: boolean;
  lifecycleStatus: "idle" | "starting" | "ready" | "error";
  onBenchmark: () => void;
  onLaunch?: (recipeId: string) => Promise<void>;
  onNavigateLogs: () => void;
  onNewRecipe?: () => void;
  onViewAll?: () => void;
  recipes?: RecipeWithStatus[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <HeaderThemeToggle />
      <HeaderStopButton running={isRunning} />
      {recipes && onLaunch ? (
        <ModelsDropdown
          currentRecipeId={currentRecipeId}
          lifecycleStatus={lifecycleStatus}
          onLaunch={onLaunch}
          onNewRecipe={onNewRecipe}
          onViewAll={onViewAll}
          recipes={recipes}
        />
      ) : null}
      <ActionBtn label="Logs" onClick={onNavigateLogs} />
      <ActionBtn
        label={isRunning && benchmarking ? "Run" : "Bench"}
        onClick={onBenchmark}
        disabled={benchmarking || !isRunning}
      />
    </div>
  );
}

function HeaderThemeToggle() {
  const { themeId, setThemeId } = useAppStore(
    useShallow((s) => ({ themeId: s.themeId, setThemeId: s.setThemeId })),
  );
  const isDark = themeId === "omlx-dark";
  const Icon = isDark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setThemeId(isDark ? "omlx-light" : "omlx-dark")}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
      title={isDark ? "Light mode" : "Dark mode"}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}

function HeaderStopButton({ running }: { running: boolean }) {
  const { stop } = useModelLifecycle();
  if (!running) return null;
  return (
    <ModelStopConfirm
      onStop={stop}
      trigger={({ open, stopping }) => (
        <button
          type="button"
          onClick={open}
          disabled={stopping}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-(--err) hover:bg-(--err)/10 disabled:opacity-40"
          title="Stop model"
        >
          <Square className="h-3.5 w-3.5" fill="currentColor" />
          {stopping ? "Stopping" : "Stop"}
        </button>
      )}
    />
  );
}

export function StatusMetricStrip({
  compactMetrics,
  metricColumns,
}: {
  compactMetrics: CompactMetricView[];
  metricColumns: MetricColumnView[];
}) {
  return (
    <dl className="status-metric-strip mt-5 grid w-full grid-cols-[minmax(0,1.05fr)_minmax(0,0.92fr)_minmax(0,1.18fr)_minmax(0,0.58fr)_minmax(0,0.88fr)_minmax(0,0.88fr)] border-b border-(--border)/40 pb-5">
      {metricColumns.map((metric) => (
        <MetricColumn key={metric.label} {...metric} />
      ))}
      {compactMetrics.map((metric) => (
        <CompactMetric key={metric.label} {...metric} />
      ))}
    </dl>
  );
}

export function RuntimeMetricGrid({ metrics }: { metrics: RuntimeMetricView[] }) {
  return (
    <dl className="mt-3 grid gap-2 font-mono text-[length:var(--fs-xs)] text-(--dim) sm:grid-cols-4">
      {metrics.map((metric) => (
        <RuntimeMetric key={metric.label} {...metric} />
      ))}
    </dl>
  );
}

function RuntimeMetric({ label, title, value }: RuntimeMetricView) {
  return (
    <div
      className="flex min-w-0 items-baseline justify-between gap-2 border-t border-(--border)/25 pt-1"
      title={title}
    >
      <dt className="truncate uppercase tracking-[0.12em]">{label}</dt>
      <dd
        className="truncate text-(--fg)"
        aria-label={title ? `${label}: ${value}. ${title}` : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

function MetricColumn({ label, value, unit, detail, detailTitle }: MetricColumnView) {
  const displayValue = value ?? "0";

  return (
    <div className="min-w-0 overflow-hidden border-r border-(--border)/40 pr-2 pl-3 first:pl-0 sm:pr-4 sm:pl-5 last:border-r-0 [container-type:inline-size]">
      <div className="truncate text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.18em] text-(--dim)">
        {label}
      </div>
      <div className="mt-2 flex min-w-0 items-baseline gap-1.5 font-mono tabular-nums">
        <span
          className={`min-w-0 shrink overflow-hidden leading-none text-(--fg) ${metricValueSizeClass(displayValue)}`}
          title={displayValue}
        >
          {displayValue}
        </span>
        {value ? (
          <span className="shrink-0 text-[length:var(--fs-sm)] text-(--dim)">{unit}</span>
        ) : null}
      </div>
      {detail ? (
        <div className="mt-1 flex min-w-0 items-center gap-1 font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)">
          <span className="truncate">{detail}</span>
          {detailTitle ? (
            <Info
              className="h-3 w-3 shrink-0 text-(--dim)/70 hover:text-(--fg)"
              aria-label={detailTitle}
            >
              <title>{detailTitle}</title>
            </Info>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CompactMetric({ label, value }: CompactMetricView) {
  const displayValue = value ?? "0";

  return (
    <div className="min-w-0 overflow-hidden border-r border-(--border)/40 pr-1.5 pl-2 font-mono tabular-nums first:pl-0 sm:pr-3 sm:pl-4 last:border-r-0 [container-type:inline-size]">
      <div className="truncate text-[length:var(--fs-2xs)] uppercase tracking-[0.1em] text-(--dim)">
        {label}
      </div>
      <div
        className={`mt-3 overflow-hidden whitespace-nowrap leading-none text-(--fg)/90 ${compactMetricSizeClass(displayValue)}`}
        title={displayValue}
      >
        {displayValue}
      </div>
    </div>
  );
}

function metricValueSizeClass(value: string): string {
  if (value.length >= 8) return "text-[clamp(0.72rem,12cqw,1.2rem)]";
  if (value.length >= 7) return "text-[clamp(0.78rem,14cqw,1.35rem)]";
  if (value.length >= 6) return "text-[clamp(0.84rem,15cqw,1.55rem)]";
  return "text-[clamp(0.9rem,17cqw,1.875rem)]";
}

function compactMetricSizeClass(value: string): string {
  if (value.length >= 12) return "text-[clamp(0.48rem,6cqw,0.68rem)]";
  if (value.length >= 9) return "text-[clamp(0.5rem,7cqw,0.72rem)]";
  return "text-[clamp(0.62rem,10cqw,0.95rem)]";
}

function StatusDot({ running, loading }: { running: boolean; loading?: boolean }) {
  return (
    <span
      className={`inline-flex h-1.5 w-1.5 shrink-0 ${loading ? "animate-pulse bg-(--dim)" : running ? "bg-(--fg)" : "bg-(--dim)/55"}`}
    />
  );
}

function Tag({ tone, children }: { tone?: "err"; children: ReactNode }) {
  const cls =
    tone === "err" ? "border-(--err)/60 text-(--err)" : "border-(--border)/70 text-(--dim)";
  return (
    <span
      className={`border px-1.5 py-[1px] font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.14em] ${cls}`}
    >
      {children}
    </span>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="h-7 rounded-[var(--rad-2xs)] border border-(--border)/70 px-2.5 font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--dim) transition-colors hover:border-(--border) hover:bg-(--fg)/5 hover:text-(--fg) disabled:cursor-not-allowed disabled:opacity-30"
    >
      {label}
    </button>
  );
}
