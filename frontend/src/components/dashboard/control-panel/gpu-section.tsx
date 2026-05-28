"use client";

import { useState } from "react";
import type { GPU, Metrics, ProcessInfo } from "@/lib/types";
import { toGB, toGBFromMB } from "@/lib/formatters";

interface GpuSectionProps {
  metrics: Metrics | null;
  gpus: GPU[];
  currentProcess: ProcessInfo | null;
}

export function GpuSection({ gpus }: GpuSectionProps) {
  const sortedGpus = [...gpus].sort((a, b) => gpuMemoryTotal(b) - gpuMemoryTotal(a));
  const hasGpus = sortedGpus.length > 0;
  const [expanded, setExpanded] = useState(true);

  // Aggregates — one summary row beats N×4 individual bars.
  const totalUsed = sortedGpus.reduce((s, g) => s + gpuMemoryUsed(g), 0);
  const totalCap = sortedGpus.reduce((s, g) => s + gpuMemoryTotal(g), 0);
  const totalPower = sortedGpus.reduce((s, g) => s + (g.power_draw || 0), 0);
  const totalPowerLimit = sortedGpus.reduce((s, g) => s + (g.power_limit || 0), 0);
  const utils = sortedGpus.map((g) => g.utilization_pct ?? g.utilization ?? 0);
  const avgUtil = utils.length > 0 ? utils.reduce((s, v) => s + v, 0) / utils.length : 0;
  const temps = sortedGpus.map((g) => g.temp_c ?? g.temperature ?? 0).filter((t) => t > 0);
  const maxTemp = temps.length > 0 ? Math.max(...temps) : 0;
  const memPct = totalCap > 0 ? clamp((totalUsed / totalCap) * 100, 0, 100) : 0;

  if (!hasGpus) {
    return (
      <section className="mt-4 border-t border-(--border)/40 px-2 pt-3 pb-4">
        <div className="flex w-full items-center gap-4 text-left">
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-(--dim)">
              GPUs
            </span>
            <span className="font-mono text-[10px] tabular-nums text-(--dim)/65">0</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="h-[3px] min-w-[5rem] flex-1 max-w-[18rem] overflow-hidden rounded-[2px] bg-(--dim)/15" />
            <span className="font-mono text-[11.5px] tabular-nums text-(--fg)/85">
              0.0<span className="text-(--dim)/65">/0G</span>
            </span>
          </div>
          <div className="hidden items-baseline gap-5 font-mono text-[11px] tabular-nums sm:flex">
            <Aggregate label="util" value="0%" />
            <Aggregate label="temp" value="0°" />
            <Aggregate label="pwr" value="0/0W" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4 border-t border-(--border)/40 px-2 pt-3 pb-5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-center gap-4 text-left"
        aria-expanded={expanded}
      >
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-(--dim)">
            GPUs
          </span>
          <span className="font-mono text-[10px] tabular-nums text-(--dim)/65">
            {sortedGpus.length}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="h-[3px] min-w-[5rem] flex-1 max-w-[18rem] overflow-hidden rounded-[2px] bg-(--dim)/15">
            <div
              className="h-full rounded-[2px] bg-(--fg)/55 transition-[width] duration-300"
              style={{ width: `${memPct}%` }}
            />
          </div>
          <span className="font-mono text-[11.5px] tabular-nums text-(--fg)/85">
            {totalUsed.toFixed(1)}
            <span className="text-(--dim)/65">/{totalCap.toFixed(0)}G</span>
          </span>
        </div>

        <div className="hidden items-baseline gap-5 font-mono text-[11px] tabular-nums sm:flex">
          <Aggregate label="util" value={`${Math.round(avgUtil)}%`} />
          <Aggregate label="temp" value={maxTemp > 0 ? `${Math.round(maxTemp)}°` : "—"} />
          <Aggregate
            label="pwr"
            value={`${Math.round(totalPower)}${
              totalPowerLimit > 0 ? `/${Math.round(totalPowerLimit)}` : ""
            }W`}
          />
        </div>

        <span
          aria-hidden
          className={`ml-1 font-mono text-[10px] text-(--dim)/55 transition-transform group-hover:text-(--dim) ${
            expanded ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
      </button>

      {expanded ? (
        <div className="mt-3 space-y-1">
          {sortedGpus.map((gpu) => (
            <GpuRow key={gpu.id ?? gpu.index} gpu={gpu} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Aggregate({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9px] uppercase tracking-[0.14em] text-(--dim)/55">{label}</span>
      <span className="text-(--fg)/85">{value}</span>
    </span>
  );
}

function GpuRow({ gpu }: { gpu: GPU }) {
  const memUsed = gpuMemoryUsed(gpu);
  const memTotal = gpuMemoryTotal(gpu);
  const temp = gpu.temp_c ?? gpu.temperature ?? 0;
  const util = gpu.utilization_pct ?? gpu.utilization ?? 0;
  const power = gpu.power_draw || 0;
  const powerLimit = gpu.power_limit || 0;
  const label = gpu.id ?? gpu.index ?? "gpu";
  const memPct = memTotal > 0 ? clamp((memUsed / memTotal) * 100, 0, 100) : 0;

  return (
    <div className="flex items-center gap-3 py-0.5 font-mono text-[11px] tabular-nums">
      <span className="w-8 shrink-0 text-(--fg)/85">G{label}</span>
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-(--dim)/75" title={gpu.name}>
        {gpu.name}
      </span>
      <div className="flex w-[8rem] shrink-0 items-center gap-2">
        <div className="h-[2px] flex-1 overflow-hidden rounded-[1px] bg-(--dim)/15">
          <div className="h-full bg-(--fg)/45" style={{ width: `${memPct}%` }} />
        </div>
        <span className="text-(--fg)/80">
          {memUsed.toFixed(1)}
          <span className="text-(--dim)/55">/{memTotal.toFixed(0)}G</span>
        </span>
      </div>
      <span className="w-9 shrink-0 text-right text-(--dim)">{Math.round(util)}%</span>
      <span className="w-7 shrink-0 text-right text-(--dim)">
        {temp > 0 ? `${Math.round(temp)}°` : "—"}
      </span>
      <span className="w-14 shrink-0 text-right text-(--dim)">
        {power > 0
          ? `${Math.round(power)}${powerLimit > 0 ? `/${Math.round(powerLimit)}` : ""}W`
          : "—"}
      </span>
    </div>
  );
}

function gpuMemoryUsed(gpu: GPU): number {
  if (gpu.memory_used_mb != null) return toGBFromMB(gpu.memory_used_mb);
  return toGB(gpu.memory_used ?? 0);
}

function gpuMemoryTotal(gpu: GPU): number {
  if (gpu.memory_total_mb != null) return toGBFromMB(gpu.memory_total_mb);
  return toGB(gpu.memory_total ?? 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
