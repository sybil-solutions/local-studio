"use client";

import type { ReactNode } from "react";
import { Square } from "@/ui/icon-registry";
import { ModelStopConfirm } from "@/features/dashboard/model-stop-confirm";
import { useModelLifecycle } from "@/features/dashboard/use-model-lifecycle";
import type { ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { cx } from "@/ui/utils";
import { ModelsDropdown } from "./status-section-models-dropdown";
import type { MetricColumnView, MetricGroupView } from "./status-section-view";

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
  lifecycleError,
  metricsDetached,
  modelName,
  onBenchmark,
  onLaunch,
  onNavigateLogs,
  onNewRecipe,
  onViewAll,
  pid,
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
  lifecycleError?: string | null;
  metricsDetached: boolean;
  modelName: string;
  onBenchmark: () => void;
  onLaunch?: (recipeId: string) => Promise<void>;
  onNavigateLogs: () => void;
  onNewRecipe?: () => void;
  onViewAll?: () => void;
  pid?: number;
  recipes?: RecipeWithStatus[];
}) {
  return (
    // Stacks on phone widths: the header actions would otherwise crush the
    // status line and model name into overlapping slivers.
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <StatusLine
          backend={backend}
          displayPlatformKind={displayPlatformKind}
          displayPort={displayPort}
          isConnected={isConnected}
          isRunning={isRunning}
          isStatusLoading={isStatusLoading}
          metricsDetached={metricsDetached}
          pid={pid}
        />
        <h1
          className="mt-1.5 truncate text-[length:var(--fs-2xl)] font-semibold leading-tight tracking-[-0.01em] text-(--fg) sm:text-[length:var(--fs-3xl)]"
          title={modelName || ""}
        >
          {modelName}
        </h1>
        {lifecycleError ? (
          <p className="mt-1 text-[length:var(--fs-sm)] text-(--err)" role="alert">
            {lifecycleError}
          </p>
        ) : null}
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
  metricsDetached,
  pid,
}: {
  backend?: ProcessInfo["backend"];
  displayPlatformKind: RuntimePlatformKind | null;
  displayPort?: number;
  isConnected: boolean;
  isRunning: boolean;
  isStatusLoading: boolean;
  metricsDetached: boolean;
  pid?: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-sm)]">
      <RunStateDot running={isRunning} loading={isStatusLoading} />
      <span className="inline-block w-[5.75rem] font-medium text-(--dim)">
        {isRunning ? "Active" : "Standby"}
      </span>
      {!isConnected && !isStatusLoading ? <Tag tone="err">offline</Tag> : null}
      {/* A process with no matching metrics used to render as a wall of zeroes,
          which reads as "idle" rather than "we cannot attribute these numbers".
          Naming the state is the whole fix. */}
      {metricsDetached ? (
        <Tag title="The controller is reporting metrics that do not match the running process, so the strip below is not attributed to this model.">
          metrics detached
        </Tag>
      ) : null}
      {backend ? <Tag>{backend}</Tag> : null}
      {displayPlatformKind ? <Tag>{displayPlatformKind}</Tag> : null}
      <span className="font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)/70">
        {displayPort ? `:${displayPort}` : null}
        {displayPort && pid ? " · " : null}
        {pid ? `pid ${pid}` : null}
      </span>
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
    // One grammar: every action here is an h-7 pill. The row used to mix h-8
    // ghost buttons with h-7 pills, which made Stop and Logs read as controls
    // from two different apps sitting next to each other.
    <div className="flex flex-wrap items-center gap-1.5">
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
          className="inline-flex h-7 items-center gap-1.5 rounded-full bg-(--err)/10 px-3 text-[length:var(--fs-sm)] text-(--err) transition-colors hover:bg-(--err)/15 disabled:cursor-not-allowed disabled:opacity-40"
          title="Stop model"
        >
          <Square className="h-3 w-3" fill="currentColor" />
          {stopping ? "Stopping" : "Stop"}
        </button>
      )}
    />
  );
}

/**
 * The metric strip: three captioned clusters of live numbers.
 *
 * There used to be a second band of lifetime counters under this. Those
 * numbers (uptime hours, total tokens, energy per Mtok) never changed a
 * decision on this page and drifted across engine restarts, so the strip is
 * now only what the engine is doing this second, organised as the three
 * questions an operator actually asks: how fast, how loaded, how full.
 */
export function StatusMetricStrip({
  groups,
  detached,
}: {
  groups: MetricGroupView[];
  detached?: boolean;
}) {
  return (
    <div
      className={cx(
        "mt-4 grid grid-cols-1 gap-x-8 gap-y-4 border-b border-(--separator) pb-4 sm:grid-cols-3 sm:mt-5 sm:pb-5",
        detached ? "opacity-45" : "",
      )}
    >
      {groups.map((group, index) => (
        <div
          key={group.label}
          className={cx(
            "min-w-0",
            index > 0 ? "sm:border-l sm:border-(--separator)/55 sm:pl-8" : "",
          )}
        >
          <div className="mb-2 text-[length:var(--fs-2xs)] font-medium uppercase tracking-[0.08em] text-(--dim)/60">
            {group.label}
          </div>
          <dl className="grid grid-cols-2 gap-x-4">
            {group.metrics.map((metric) => (
              <MetricCell key={metric.label} metric={metric} />
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function MetricCell({ metric }: { metric: MetricColumnView }) {
  const { label, value, unit, detail, detailTitle, fill } = metric;
  return (
    <div className="min-w-0 overflow-hidden">
      <dt className="truncate text-[length:var(--fs-xs)] text-(--dim)">{label}</dt>
      <dd className="mt-1 flex min-w-0 items-baseline gap-1 font-semibold leading-none tabular-nums text-(--fg) text-[length:var(--fs-lg)] sm:text-[length:var(--fs-2xl)]">
        <span className="truncate" title={value ?? undefined}>
          {value ?? "—"}
        </span>
        {value && unit ? (
          <span className="shrink-0 text-[length:var(--fs-xs)] font-normal text-(--dim)">
            {unit}
          </span>
        ) : null}
      </dd>
      {/* The same 3px rule GpuSection draws, so a share of a cap looks the same
          wherever the page states one. */}
      {typeof fill === "number" ? (
        <dd className="mt-1.5 h-[3px] w-full overflow-hidden rounded-[var(--rad-2xs)] bg-(--separator)">
          <div
            className="h-full rounded-[var(--rad-2xs)] bg-(--fg)/45 transition-[width] duration-300"
            style={{ width: `${Math.round(fill * 100)}%` }}
          />
        </dd>
      ) : null}
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

/**
 * The dashboard's run-state dot.
 *
 * Deliberately not `ui/status`'s `StatusDot`: this strip is a dense instrument
 * sheet, so the mark is a 6px square with no radius rather than the rounded
 * pill dot the rest of the app uses. The distinct name keeps the two from
 * reading as the same component.
 */
function RunStateDot({ running, loading }: { running: boolean; loading?: boolean }) {
  return (
    <span
      className={`inline-flex h-1.5 w-1.5 shrink-0 ${loading ? "animate-pulse bg-(--dim)" : running ? "bg-(--fg)" : "bg-(--dim)/55"}`}
    />
  );
}

function Tag({ tone, title, children }: { tone?: "err"; title?: string; children: ReactNode }) {
  const cls = tone === "err" ? "border-(--err)/60 text-(--err)" : "border-(--border) text-(--dim)";
  return (
    <span
      title={title}
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
