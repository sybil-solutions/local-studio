"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Info, Moon, Square, Sun } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ModelStopConfirm } from "@/components/model-stop-confirm";
import { useModelLifecycle } from "@/hooks/use-model-lifecycle";
import type { GPU, Metrics, ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { toGB, toGBFromMB } from "@/lib/formatters";
import { useAppStore } from "@/store";

interface StatusSectionProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  metrics: Metrics | null;
  gpus: GPU[];
  isConnected: boolean;
  isStatusLoading: boolean;
  platformKind?: RuntimePlatformKind | null;
  inferencePort?: number;
  onNavigateLogs: () => void;
  onBenchmark: () => void;
  benchmarking: boolean;
  recipes?: RecipeWithStatus[];
  lifecycleStatus?: "idle" | "starting" | "ready" | "error";
  onLaunch?: (recipeId: string) => Promise<void>;
  onNewRecipe?: () => void;
  onViewAll?: () => void;
}

export function StatusSection({
  currentProcess,
  currentRecipe,
  metrics,
  gpus,
  isConnected,
  isStatusLoading,
  platformKind,
  inferencePort,
  onNavigateLogs,
  onBenchmark,
  benchmarking,
  recipes,
  lifecycleStatus,
  onLaunch,
  onNewRecipe,
  onViewAll,
}: StatusSectionProps) {
  const modelName =
    currentRecipe?.name ||
    currentProcess?.served_model_name ||
    currentProcess?.model_path?.split("/").pop() ||
    "No model loaded";
  const modelSampleKey =
    currentProcess?.served_model_name || currentProcess?.model_path || currentRecipe?.id || "idle";
  const isRunning = !!currentProcess;
  const backend = currentProcess?.backend;
  const displayPlatformKind = platformKind ?? null;
  const displayPort = inferencePort || currentProcess?.port || undefined;

  const fallbackTotalPower = gpus.reduce((sum, g) => sum + (g.power_draw || 0), 0);
  const fallbackTotalMemUsed = gpus.reduce((sum, g) => {
    if (g.memory_used_mb != null) return sum + toGBFromMB(g.memory_used_mb);
    return sum + toGB(g.memory_used ?? 0);
  }, 0);
  const fallbackMemCapacity = gpus.reduce((sum, g) => {
    if (g.memory_total_mb != null) return sum + toGBFromMB(g.memory_total_mb);
    return sum + toGB(g.memory_total ?? 0);
  }, 0);
  const fallbackPowerLimit = gpus.reduce((sum, g) => sum + (g.power_limit || 0), 0);

  const totalPower = firstPositive(metrics?.current_power_watts, fallbackTotalPower);
  const totalMemUsed = firstPositive(metrics?.vram_used_gb, fallbackTotalMemUsed);
  const vramCapacity = firstPositive(metrics?.vram_capacity_gb, fallbackMemCapacity);
  const powerLimit = firstPositive(metrics?.power_limit_watts, fallbackPowerLimit);

  const peakGenTps = firstPositive(
    metrics?.session_peak_generation_tps,
    metrics?.session_peak_generation_throughput,
    metrics?.session_peak_generation,
  );
  const allPeakGenTps = firstPositive(metrics?.peak_generation_tps);
  const bestSessionGenTps = firstPositive(
    metrics?.best_session_generation_tps,
    metrics?.session_peak_generation_tps,
  );
  const peakPrefillTps = firstPositive(
    metrics?.session_peak_prefill_tps,
    metrics?.session_peak_prompt_throughput,
    metrics?.session_peak_prefill,
  );
  const allPeakPrefillTps = firstPositive(metrics?.peak_prefill_tps);
  const bestSessionPrefillTps = firstPositive(
    metrics?.best_session_prefill_tps,
    metrics?.session_peak_prefill_tps,
  );
  const peakTtftMs = firstPositive(
    metrics?.session_peak_best_ttft_ms,
    metrics?.session_peak_ttft_ms,
  );
  const allPeakTtftMs = firstPositive(metrics?.peak_ttft_ms);
  const bestSessionTtftMs = firstPositive(
    metrics?.best_session_ttft_ms,
    metrics?.session_peak_best_ttft_ms,
  );
  const genTps = firstPositive(metrics?.generation_throughput, metrics?.session_avg_generation);
  const prefillTps = firstPositive(metrics?.prompt_throughput, metrics?.session_avg_prefill);
  const ttftMs = firstPositive(metrics?.avg_ttft_ms);
  const sessions = metrics?.running_requests ?? 0;
  const peakReq = metrics?.session_peak_running_requests ?? 0;
  const samples = useMetricSamples({
    key: modelSampleKey,
    generation: genTps ?? 0,
    prefill: prefillTps ?? 0,
    ttft: ttftMs ?? 0,
    requests: sessions,
    active: isRunning,
  });

  const decodeMax = speedMaxDetail({
    session: peakGenTps,
    bestSession: bestSessionGenTps,
    all: allPeakGenTps,
    digits: 1,
  });
  const prefillMax = speedMaxDetail({
    session: peakPrefillTps,
    bestSession: bestSessionPrefillTps,
    all: allPeakPrefillTps,
    digits: 1,
  });
  const ttftMax = speedMaxDetail({
    session: peakTtftMs,
    bestSession: bestSessionTtftMs,
    all: allPeakTtftMs,
    digits: 0,
    suffix: " ms",
    label: "best",
  });
  const headerActions = (
    <div className="flex items-center gap-1.5">
      <HeaderThemeToggle />
      <HeaderStopButton running={isRunning} />
      {recipes && onLaunch && (
        <ModelsDropdown
          recipes={recipes}
          currentRecipeId={currentRecipe?.id}
          lifecycleStatus={lifecycleStatus ?? "idle"}
          onLaunch={onLaunch}
          onNewRecipe={onNewRecipe}
          onViewAll={onViewAll}
        />
      )}
      <ActionBtn label="Logs" onClick={onNavigateLogs} />
      {isRunning ? (
        <ActionBtn
          label={benchmarking ? "Run" : "Bench"}
          onClick={onBenchmark}
          disabled={benchmarking}
        />
      ) : (
        <ActionBtn label="Bench" onClick={onBenchmark} disabled />
      )}
    </div>
  );

  const statusLine = (
    <div className="flex flex-wrap items-center gap-2 text-[11px] tracking-[0.04em]">
      <StatusDot running={isRunning} loading={isStatusLoading} />
      <span className="inline-block w-[5.75rem] font-medium uppercase tracking-[0.14em] text-(--dim)">
        {isRunning ? "Active" : "Standby"}
      </span>
      {!isConnected && !isStatusLoading ? <Tag tone="err">offline</Tag> : null}
      {backend && <Tag>{backend}</Tag>}
      {displayPlatformKind && <Tag>{displayPlatformKind}</Tag>}
      {displayPort && (
        <span className="font-mono text-[10px] tabular-nums text-(--dim)/70">:{displayPort}</span>
      )}
    </div>
  );

  return (
    <section className="px-2 pt-2 pb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {statusLine}
          <h1
            className="mt-1.5 truncate text-[22px] font-semibold leading-tight tracking-[-0.01em] text-(--fg)"
            title={modelName || ""}
          >
            {modelName}
          </h1>
        </div>
        {headerActions}
      </div>

      <dl className="status-metric-strip mt-5 grid w-full grid-cols-[minmax(0,1.05fr)_minmax(0,0.92fr)_minmax(0,1.18fr)_minmax(0,0.58fr)_minmax(0,0.88fr)_minmax(0,0.88fr)] border-b border-(--border)/40 pb-5">
        <MetricColumn
          label="Decode"
          value={metricValue(genTps, 1)}
          unit="tok/s"
          detail={decodeMax.short}
          detailTitle={decodeMax.title}
        />
        <MetricColumn
          label="TTFT"
          value={metricValue(ttftMs, 0)}
          unit="ms"
          detail={ttftMax.short}
          detailTitle={ttftMax.title}
        />
        <MetricColumn
          label="Prefill"
          value={metricValue(prefillTps, 1)}
          unit="t/s"
          detail={prefillMax.short}
          detailTitle={prefillMax.title}
        />
        <CompactMetric label="Req" value={`${sessions}/${peakReq || sessions}`} />
        <CompactMetric label="VRAM" value={ratioMetric(totalMemUsed, vramCapacity, "G", 1)} />
        <CompactMetric label="Power" value={ratioMetric(totalPower, powerLimit, "W")} />
      </dl>

      <dl className="mt-3 grid gap-2 font-mono text-[10.5px] text-(--dim) sm:grid-cols-4">
        <RuntimeMetric label="total tokens" value={tokenTotalMetric(metrics)} />
        <RuntimeMetric label="prompt tokens" value={tokenMetric(metrics?.prompt_tokens_total)} />
        <RuntimeMetric
          label="completion tokens"
          value={tokenMetric(metrics?.generation_tokens_total)}
        />
        <RuntimeMetric label="duration" value={durationMetric(metrics?.latency_avg)} />
      </dl>

      <MetricTrends samples={samples} />
    </section>
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

export function metricValue(value: number | null, digits: number): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value.toFixed(digits)
    : (0).toFixed(digits);
}

export function ratioMetric(
  value: number | null,
  total: number | null,
  unit: string,
  valueDigits = 0,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return null;
  return `${value.toFixed(valueDigits)}/${total.toFixed(0)}${unit}`;
}

function speedMaxDetail({
  session,
  bestSession,
  all,
  digits,
  suffix = "",
  label = "max",
}: {
  session: number | null;
  bestSession: number | null;
  all: number | null;
  digits: number;
  suffix?: string;
  label?: string;
}): { short?: string; title?: string } {
  const sessionText = metricValue(session, digits);
  const bestSessionText = metricValue(bestSession, digits);
  const allText = metricValue(all, digits);
  const short = sessionText ? `${label} ${sessionText}${suffix}` : undefined;
  const rows = [
    sessionText ? `current session ${label}: ${sessionText}${suffix}` : null,
    bestSessionText ? `best session ${label}: ${bestSessionText}${suffix}` : null,
    allText ? `all-time ${label}: ${allText}${suffix}` : null,
  ].filter((row): row is string => Boolean(row));
  return { short, title: rows.length ? rows.join(" | ") : undefined };
}

function tokenMetric(...values: Array<number | undefined>): string {
  const value = values.find(
    (item) => typeof item === "number" && Number.isFinite(item) && item >= 0,
  );
  return typeof value === "number" ? Math.round(value).toLocaleString() : "0";
}

function tokenTotalMetric(metrics: Metrics | null): string {
  const explicit = tokenMetric(metrics?.total_tokens, metrics?.tokens_total);
  if (explicit !== "0") return explicit;
  if (
    typeof metrics?.prompt_tokens_total === "number" &&
    typeof metrics.generation_tokens_total === "number"
  ) {
    return tokenMetric(metrics.prompt_tokens_total + metrics.generation_tokens_total);
  }
  return explicit;
}

function durationMetric(value: number | undefined): string {
  if (!value || value <= 0) return "0ms";
  return value > 1000 ? `${(value / 1000).toFixed(2)}s` : `${value.toFixed(0)}ms`;
}

function RuntimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 border-t border-(--border)/25 pt-1">
      <dt className="truncate uppercase tracking-[0.12em]">{label}</dt>
      <dd className="truncate text-(--fg)">{value}</dd>
    </div>
  );
}

type MetricSample = {
  at: number;
  generation: number;
  prefill: number;
  ttft: number;
  requests: number;
};

function useMetricSamples({
  key,
  generation,
  prefill,
  ttft,
  requests,
  active,
}: {
  key: string;
  generation: number;
  prefill: number;
  ttft: number;
  requests: number;
  active: boolean;
}) {
  const samplesRef = useRef<MetricSample[]>([]);
  const sampleKeyRef = useRef<string | null>(null);

  if (sampleKeyRef.current !== key) {
    sampleKeyRef.current = key;
    samplesRef.current = [];
  }
  if (!active) return zeroSamples();

  const next: MetricSample = {
    at: Date.now(),
    generation: finitePositive(generation),
    prefill: finitePositive(prefill),
    ttft: finitePositive(ttft),
    requests: finitePositive(requests),
  };
  const current = samplesRef.current;
  const previous = current[current.length - 1];
  if (
    !previous ||
    previous.generation !== next.generation ||
    previous.prefill !== next.prefill ||
    previous.ttft !== next.ttft ||
    previous.requests !== next.requests
  ) {
    samplesRef.current = [...current, next].slice(-56);
  }

  return samplesRef.current.length > 0 ? samplesRef.current : zeroSamples();
}

function MetricTrends({ samples }: { samples: MetricSample[] }) {
  return (
    <div className="mt-6 border-t border-(--border)/40 pt-3">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <TrendPanel
          label="Throughput (tok/s)"
          meta="Last 30 minutes"
          lines={[
            { values: samples.map((sample) => sample.prefill), className: "text-(--fg)/80" },
            { values: samples.map((sample) => sample.generation), className: "text-(--dim)/35" },
          ]}
        />
        <TrendPanel
          label="TTFT (ms) & requests"
          meta="Last 30 minutes"
          lines={[
            { values: samples.map((sample) => sample.ttft), className: "text-(--fg)/80" },
            { values: samples.map((sample) => sample.requests), className: "text-(--dim)/35" },
          ]}
        />
      </div>
    </div>
  );
}

function TrendPanel({
  label,
  meta,
  lines,
}: {
  label: string;
  meta: string;
  lines: Array<{ values: number[]; className: string }>;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--dim)/75">
          {label}
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-(--dim)/45">
          {meta}
        </span>
      </div>
      <div className="h-28">
        <Sparkline lines={lines} />
      </div>
    </div>
  );
}

function Sparkline({ lines }: { lines: Array<{ values: number[]; className: string }> }) {
  const paths = useMemo(() => {
    const all = lines.flatMap((line) => line.values).filter((value) => Number.isFinite(value));
    const max = Math.max(1, ...all);
    return lines.map((line) => ({ ...line, points: toPolyline(line.values, max) }));
  }, [lines]);

  return (
    <svg
      className="h-full w-full overflow-visible text-(--border)"
      viewBox="0 0 320 96"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d="M0 16H320 M0 48H320 M0 80H320"
        stroke="currentColor"
        strokeOpacity="0.42"
        strokeWidth="0.6"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M0 95.5H320"
        stroke="currentColor"
        strokeOpacity="0.75"
        strokeWidth="0.7"
        vectorEffect="non-scaling-stroke"
      />
      {paths.map((line, index) => (
        <polyline
          key={index}
          points={line.points}
          fill="none"
          className={line.className}
          stroke="currentColor"
          strokeWidth={index === 0 ? 1.6 : 1.1}
          strokeLinecap="square"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function toPolyline(values: number[], max: number): string {
  const padded = values.length >= 2 ? values : [0, ...values];
  const width = 320;
  const height = 92;
  const last = Math.max(1, padded.length - 1);
  return padded
    .map((value, index) => {
      const x = (index / last) * width;
      const y = 94 - (Math.max(0, value) / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function zeroSamples(): MetricSample[] {
  return Array.from({ length: 34 }, (_, index) => ({
    at: Date.now() - (34 - index) * 52_000,
    generation: 0,
    prefill: 0,
    ttft: 0,
    requests: 0,
  }));
}

function MetricColumn({
  label,
  value,
  unit,
  detail,
  detailTitle,
}: {
  label: string;
  value: string | null;
  unit: string;
  detail?: string;
  detailTitle?: string;
}) {
  const displayValue = value ?? "0";

  return (
    <div className="min-w-0 overflow-hidden border-r border-(--border)/40 pr-2 pl-3 first:pl-0 sm:pr-4 sm:pl-5 last:border-r-0 [container-type:inline-size]">
      <div className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-(--dim)">
        {label}
      </div>
      <div className="mt-2 flex min-w-0 items-baseline gap-1.5 font-mono tabular-nums">
        <span
          className={`min-w-0 shrink overflow-hidden leading-none text-(--fg) ${metricValueSizeClass(displayValue)}`}
          title={displayValue}
        >
          {displayValue}
        </span>
        {value ? <span className="shrink-0 text-[11px] text-(--dim)">{unit}</span> : null}
      </div>
      {detail ? (
        <div className="mt-1 flex min-w-0 items-center gap-1 font-mono text-[10.5px] tabular-nums text-(--dim)">
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

function CompactMetric({ label, value }: { label: string; value: string | null }) {
  const displayValue = value ?? "0";

  return (
    <div className="min-w-0 overflow-hidden border-r border-(--border)/40 pr-1.5 pl-2 font-mono tabular-nums first:pl-0 sm:pr-3 sm:pl-4 last:border-r-0 [container-type:inline-size]">
      <div className="truncate text-[9px] uppercase tracking-[0.1em] text-(--dim)">{label}</div>
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

function HeroStat({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string | null;
  unit: string;
  detail?: string;
}) {
  const idle = value == null;
  return (
    <div className="min-w-0 border-t border-(--border)/40 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-(--dim)">
          {label}
        </span>
        {detail ? (
          <span className="font-mono text-[10.5px] tabular-nums text-(--dim)">{detail}</span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className={`font-mono text-[34px] font-medium leading-none tabular-nums ${idle ? "text-(--dim)/60" : "text-(--fg)"}`}
        >
          {idle ? "0" : value}
        </span>
        {!idle ? <span className="font-mono text-[11px] text-(--dim)">{unit}</span> : null}
      </div>
    </div>
  );
}

function Pair({ value, unit }: { value: string | null; unit: string }) {
  if (value == null) {
    return <span className="text-(--dim)/55">0</span>;
  }
  return (
    <>
      <span className="text-(--fg)/85">{value}</span>
      {unit ? <span className="text-(--dim)/65">{unit}</span> : null}
    </>
  );
}

function Inline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-(--dim)/70">
        {label}
      </span>
      <span className="inline-flex items-baseline gap-1">{children}</span>
    </span>
  );
}

function StatusDot({ running, loading }: { running: boolean; loading?: boolean }) {
  return (
    <span
      className={`inline-flex h-1.5 w-1.5 shrink-0 ${loading ? "animate-pulse bg-(--dim)" : running ? "bg-(--fg)" : "bg-(--dim)/55"}`}
    />
  );
}

function Tag({ tone, children }: { tone?: "err"; children: React.ReactNode }) {
  const cls =
    tone === "err" ? "border-(--err)/60 text-(--err)" : "border-(--border)/70 text-(--dim)";
  return (
    <span
      className={`border px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.14em] ${cls}`}
    >
      {children}
    </span>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`h-7 rounded-[3px] border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${danger ? "border-(--err)/40 text-(--err) hover:bg-(--err)/10" : "border-(--border)/70 text-(--dim) hover:border-(--border) hover:bg-(--fg)/5 hover:text-(--fg)"}`}
    >
      {label}
    </button>
  );
}

export function firstPositive(...values: Array<number | null | undefined>): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/* Inline Models dropdown — auto-closes on outside click and selection. */
function ModelsDropdown({
  recipes,
  currentRecipeId,
  lifecycleStatus,
  onLaunch,
  onNewRecipe,
  onViewAll,
}: {
  recipes: RecipeWithStatus[];
  currentRecipeId?: string;
  lifecycleStatus: "idle" | "starting" | "ready" | "error";
  onLaunch: (id: string) => Promise<void>;
  onNewRecipe?: () => void;
  onViewAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  const subscribeOutsideClick = useCallback(
    (_notify: () => void) => {
      if (!open) return () => {};
      const handler = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    },
    [open],
  );

  useSyncExternalStore(subscribeOutsideClick, getModelsDropdownSnapshot, getModelsDropdownSnapshot);

  const q = filter.toLowerCase();
  const filtered = q
    ? recipes.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
    : recipes;
  const visible = filtered.slice(0, q ? 8 : 6);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-7 rounded-[3px] border border-(--border)/70 px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-(--fg) hover:border-(--border) hover:bg-(--fg)/5"
      >
        Models ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[22rem] rounded-[4px] border border-(--border) bg-(--surface) shadow-lg">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-(--border)">
            <input
              autoFocus
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search models…"
              className="min-w-0 bg-transparent px-2.5 py-1.5 font-mono text-xs text-(--fg) placeholder:text-(--dim)/60 focus:outline-none"
            />
            {onNewRecipe && (
              <button
                onClick={() => {
                  setOpen(false);
                  onNewRecipe();
                }}
                className="border-l border-(--border) px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-(--dim) hover:bg-(--fg)/5 hover:text-(--fg)"
              >
                + new
              </button>
            )}
          </div>
          <div className="max-h-[18rem] overflow-auto">
            {visible.length === 0 && (
              <div className="px-2.5 py-2 font-mono text-[10.5px] text-(--dim)">
                No models found.
              </div>
            )}
            {visible.map((r) => {
              const row = { isCurrent: r.id === currentRecipeId };
              const running = r.status === "running";
              const disabled = lifecycleStatus === "starting" || row.isCurrent;
              return (
                <button
                  key={r.id}
                  disabled={disabled}
                  onClick={async () => {
                    setOpen(false);
                    await onLaunch(r.id);
                  }}
                  className={`flex w-full items-center gap-2 border-b border-(--border)/60 px-2.5 py-1.5 text-left last:border-b-0 ${row.isCurrent ? "bg-(--fg)/8" : "hover:bg-(--fg)/5"} ${disabled && !row.isCurrent ? "cursor-not-allowed opacity-30" : ""}`}
                >
                  <span
                    className={`h-3 w-0.5 shrink-0 ${row.isCurrent ? "bg-(--fg)" : running ? "bg-(--fg)/60" : "bg-(--dim)/40"}`}
                  />
                  <span className="flex-1 truncate font-mono text-xs text-(--fg)" title={r.name}>
                    {r.name}
                  </span>
                  {running && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-(--dim)">
                    tp{r.tp || r.tensor_parallel_size}
                  </span>
                </button>
              );
            })}
          </div>
          {onViewAll && filtered.length > visible.length && (
            <button
              onClick={() => {
                setOpen(false);
                onViewAll();
              }}
              className="block w-full border-t border-(--border) px-2.5 py-1.5 text-left font-mono text-[10px] text-(--dim) hover:bg-(--fg)/5 hover:text-(--fg)"
            >
              {filter
                ? `${filtered.length - visible.length} more →`
                : `View all ${recipes.length} →`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const getModelsDropdownSnapshot = (): number => 0;
