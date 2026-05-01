// CRITICAL
"use client";

import { useEffect, useRef, useState } from "react";
import type { GPU, Metrics, ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { toGB, toGBFromMB } from "@/lib/formatters";

interface StatusSectionProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  metrics: Metrics | null;
  gpus: GPU[];
  isConnected: boolean;
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
  const modelName = currentRecipe?.name || currentProcess?.model_path?.split("/").pop();
  const isRunning = !!currentProcess;
  const backend = currentProcess?.backend;

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

  const totalPower = metrics?.current_power_watts ?? fallbackTotalPower;
  const totalMemUsed = metrics?.vram_used_gb ?? fallbackTotalMemUsed;
  const vramCapacity = metrics?.vram_capacity_gb ?? fallbackMemCapacity;
  const powerLimit = metrics?.power_limit_watts ?? fallbackPowerLimit;

  const genTps = firstPositive(metrics?.session_avg_generation, metrics?.generation_throughput);
  const prefillTps = firstPositive(metrics?.session_avg_prefill, metrics?.prompt_throughput);
  const ttftMs = firstPositive(metrics?.avg_ttft_ms);
  const sessions = metrics?.running_requests ?? 0;
  const peakGenTps = firstPositive(
    metrics?.session_peak_generation_throughput,
    metrics?.session_peak_generation,
    metrics?.peak_generation_tps,
  );
  const peakPrefillTps = firstPositive(
    metrics?.session_peak_prompt_throughput,
    metrics?.session_peak_prefill,
    metrics?.peak_prefill_tps,
  );
  const peakTtftMs = firstPositive(metrics?.session_peak_ttft_ms, metrics?.peak_ttft_ms);
  const peakReq = metrics?.session_peak_running_requests ?? 0;

  return (
    <div className="border border-(--border) bg-(--surface)">
      {/* Stable command header. Text uses sans; figures stay mono. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--border) px-3 py-2.5">
        <div className="flex min-w-[16rem] flex-1 items-center gap-2.5">
          <StatusDot running={isRunning} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.11em] text-(--dim)">
                {isRunning ? "Active" : "Standby"}
              </span>
              {!isConnected && <Tag tone="err">offline</Tag>}
              {backend && <Tag>{backend}</Tag>}
              {platformKind && <Tag>{platformKind}</Tag>}
              {inferencePort && (
                <span className="font-mono text-[10px] tabular-nums text-(--dim)">
                  :{inferencePort}
                </span>
              )}
            </div>
            <div
              className="mt-0.5 truncate text-sm font-semibold leading-5 text-(--fg)"
              title={modelName || ""}
            >
              {modelName || "No model loaded"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
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
          <ActionBtn label="Logs" onClick={onNavigateLogs} disabled={!isRunning} />
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
      </div>

      {/* Flat stat strip — always rendered so standby/loading has the same footprint as active. */}
      <div className="grid grid-cols-3 divide-x divide-(--border) xl:grid-cols-6">
        <Stat
          label="Decode"
          value={isRunning ? genTps.toFixed(1) : "—"}
          unit={isRunning ? "t/s" : ""}
          detail={peakGenTps > 0 ? `max ${peakGenTps.toFixed(1)}` : "max —"}
        />
        <Stat
          label="Prefill"
          value={isRunning ? prefillTps.toFixed(1) : "—"}
          unit={isRunning ? "t/s" : ""}
          detail={peakPrefillTps > 0 ? `max ${peakPrefillTps.toFixed(1)}` : "max —"}
        />
        <Stat
          label="TTFT"
          value={isRunning && ttftMs > 0 ? ttftMs.toFixed(0) : "—"}
          unit={isRunning && ttftMs > 0 ? "ms" : ""}
          detail={peakTtftMs > 0 ? `max ${peakTtftMs.toFixed(0)}ms` : "max —"}
        />
        <Stat
          label="Req"
          value={isRunning ? String(sessions) : "—"}
          unit=""
          detail={peakReq > 0 ? `max ${peakReq}` : "max —"}
        />
        <Stat
          label="VRAM"
          value={totalMemUsed > 0 ? totalMemUsed.toFixed(1) : "—"}
          unit={vramCapacity > 0 ? `/${vramCapacity.toFixed(0)}G` : ""}
        />
        <Stat
          label="Power"
          value={totalPower > 0 ? String(Math.round(totalPower)) : "—"}
          unit={powerLimit > 0 ? `/${Math.round(powerLimit)}W` : ""}
        />
      </div>
    </div>
  );
}

function StatusDot({ running }: { running: boolean }) {
  return <span className={`h-2 w-2 shrink-0 ${running ? "bg-(--fg)" : "bg-(--dim)/55"}`} />;
}

function Tag({ tone, children }: { tone?: "err"; children: React.ReactNode }) {
  const cls = tone === "err" ? "border-(--err) text-(--err)" : "border-(--border) text-(--dim)";
  return (
    <span
      className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${cls}`}
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
      className={`h-7 border px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? "border-(--err)/40 text-(--err) hover:bg-(--err)/10"
          : "border-(--border) text-(--dim) hover:bg-(--fg)/5 hover:text-(--fg)"
      }`}
    >
      {label}
    </button>
  );
}

function Stat({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string;
  unit: string;
  detail?: string;
}) {
  return (
    <div className="px-3 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.11em] text-(--dim)">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold tabular-nums leading-none text-(--fg)">
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-(--dim)">{unit}</span>}
      </div>
      {detail && (
        <div className="mt-1 font-mono text-[10px] tabular-nums text-(--dim)">{detail}</div>
      )}
    </div>
  );
}

function firstPositive(...values: Array<number | null | undefined>): number {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return 0;
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

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const q = filter.toLowerCase();
  const filtered = q
    ? recipes.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
    : recipes;
  const visible = filtered.slice(0, q ? 8 : 6);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-7 border border-(--border) px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-(--fg) hover:bg-(--fg)/5"
      >
        Models ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[22rem] border border-(--border) bg-(--surface) shadow-lg">
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
              <div className="px-3 py-4 font-mono text-xs text-(--dim)">No models</div>
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
                  className={`flex w-full items-center gap-2 border-b border-(--border)/60 px-2.5 py-1.5 text-left last:border-b-0 ${
                    row.isCurrent ? "bg-(--fg)/8" : "hover:bg-(--fg)/5"
                  } ${disabled && !row.isCurrent ? "cursor-not-allowed opacity-30" : ""}`}
                >
                  <span
                    className={`h-3 w-0.5 shrink-0 ${
                      row.isCurrent ? "bg-(--fg)" : running ? "bg-(--fg)/60" : "bg-(--dim)/40"
                    }`}
                  />
                  <span className="flex-1 truncate font-mono text-xs text-(--fg)" title={r.name}>
                    {r.name}
                  </span>
                  {running && <span className="h-1.5 w-1.5 bg-(--fg)" />}
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
