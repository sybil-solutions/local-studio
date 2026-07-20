"use client";

import type { ReactNode } from "react";
import { Moon, Square, Sun } from "@/ui/icon-registry";
import { useShallow } from "zustand/react/shallow";
import { ModelStopConfirm } from "@/features/dashboard/model-stop-confirm";
import { useModelLifecycle } from "@/features/dashboard/use-model-lifecycle";
import type { ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { useAppStore } from "@/store";
import { ModelsDropdown } from "./status-section-models-dropdown";
import type { CompactMetricView, MetricColumnView } from "./status-section-view";

export function StatusHeader({
  backend,
  benchmarking,
  benchmarkResult,
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
  benchmarkResult: number | null;
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
    // Stacks on phone widths: the five header actions would otherwise crush
    // the status line and model name into overlapping slivers.
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
        benchmarkResult={benchmarkResult}
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
    <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-sm)]">
      <StatusDot running={isRunning} loading={isStatusLoading} />
      <span className="inline-block w-[5.75rem] font-medium text-(--dim)">
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
  benchmarkResult,
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
  benchmarkResult: number | null;
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
    <div className="flex flex-wrap items-center gap-1.5">
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
        label={benchmarkButtonLabel(benchmarking, benchmarkResult)}
        onClick={onBenchmark}
        disabled={benchmarking || !isRunning}
      />
    </div>
  );
}

export function benchmarkButtonLabel(benchmarking: boolean, result: number | null): string {
  if (benchmarking) return "Benchmarking…";
  return result === null ? "Bench" : `Bench · ${result.toFixed(1)} tok/s`;
}

function HeaderThemeToggle() {
  const { themeId, setThemeId } = useAppStore(
    useShallow((s) => ({ themeId: s.themeId, setThemeId: s.setThemeId })),
  );
  const isDark =
    themeId === "zai-dark" ||
    themeId === "zai-sky" ||
    themeId === "zai-violet" ||
    themeId === "zai-emerald" ||
    themeId === "zai-rose";
  const Icon = isDark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setThemeId(isDark ? "zai-light" : "zai-dark")}
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
    <dl className="mt-5 grid w-full grid-cols-2 gap-x-8 gap-y-4 border-b border-(--separator) pb-5 sm:grid-cols-3 lg:grid-cols-6">
      {metricColumns.map((metric) => (
        <MetricCell
          key={metric.label}
          label={metric.label}
          value={metric.value ?? "0"}
          unit={metric.value ? metric.unit : undefined}
          detail={metric.detail ?? undefined}
          detailTitle={metric.detailTitle ?? undefined}
        />
      ))}
      {compactMetrics.map((metric) => (
        <MetricCell key={metric.label} label={metric.label} value={metric.value ?? "—"} />
      ))}
    </dl>
  );
}

function MetricCell({
  label,
  value,
  unit,
  detail,
  detailTitle,
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  detailTitle?: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden">
      <dt className="truncate text-[length:var(--fs-xs)] text-(--dim)">{label}</dt>
      <dd className="mt-1 flex min-w-0 items-baseline gap-1 text-[length:var(--fs-2xl)] font-semibold leading-none tabular-nums text-(--fg)">
        <span className="truncate" title={value}>
          {value}
        </span>
        {unit ? (
          <span className="shrink-0 text-[length:var(--fs-xs)] text-(--dim)">{unit}</span>
        ) : null}
      </dd>
      {detail ? (
        <dd
          className="mt-1 min-w-0 truncate text-[length:var(--fs-xs)] tabular-nums text-(--dim)/75"
          title={detailTitle}
        >
          {detail}
        </dd>
      ) : null}
    </div>
  );
}

function StatusDot({ running, loading }: { running: boolean; loading?: boolean }) {
  return (
    <span
      className={`inline-flex h-1.5 w-1.5 shrink-0 ${loading ? "animate-pulse bg-(--dim)" : running ? "bg-(--fg)" : "bg-(--dim)/55"}`}
    />
  );
}

function Tag({ tone, children }: { tone?: "err"; children: ReactNode }) {
  const cls = tone === "err" ? "border-(--err)/60 text-(--err)" : "border-(--border) text-(--dim)";
  return (
    <span
      className={`rounded-full border px-2 py-[1px] text-[length:var(--fs-2xs)] font-medium ${cls}`}
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
      className="h-7 rounded-full bg-(--fg)/5 px-3 text-[length:var(--fs-sm)] text-(--fg)/85 transition-colors hover:bg-(--fg)/10 hover:text-(--fg) disabled:cursor-not-allowed disabled:opacity-30"
    >
      {label}
    </button>
  );
}
