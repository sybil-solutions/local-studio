"use client";

import { useState } from "react";
import type { GPU, Metrics, ProcessInfo, RuntimePlatformKind } from "@/lib/types";
import { toGBFromMB } from "@/lib/formatters";

interface GpuSectionProps {
  metrics: Metrics | null;
  gpus: GPU[];
  currentProcess: ProcessInfo | null;
  platformKind: RuntimePlatformKind | null;
}

export function GpuSection({ gpus, platformKind }: GpuSectionProps) {
  const sortedGpus = [...gpus].sort((a, b) => gpuMemoryTotal(b) - gpuMemoryTotal(a));
  const hasGpus = sortedGpus.length > 0;
  const [expanded, setExpanded] = useState(true);
  const names = new Set(sortedGpus.map((gpu) => gpu.name).filter(Boolean));
  const gpuModelLabel = names.size === 1 ? [...names][0].replace(/^NVIDIA\s+/, "") : null;

  const totalUsed = sortedGpus.reduce((s, g) => s + gpuMemoryUsed(g), 0);
  const totalCap = sortedGpus.reduce((s, g) => s + gpuMemoryTotal(g), 0);
  const totalPower = sortedGpus.reduce((s, g) => s + (g.power_draw || 0), 0);
  const totalPowerLimit = sortedGpus.reduce((s, g) => s + (g.power_limit || 0), 0);
  const utils = sortedGpus
    .filter((gpu) => gpu.utilization_available !== false)
    .map((g) => g.utilization_pct);
  const avgUtil = utils.length > 0 ? utils.reduce((s, v) => s + v, 0) / utils.length : 0;
  const temps = sortedGpus.map((g) => g.temp_c).filter((t) => t > 0);
  const maxTemp = temps.length > 0 ? Math.max(...temps) : 0;
  const memPct = totalCap > 0 ? clamp((totalUsed / totalCap) * 100, 0, 100) : 0;

  if (!hasGpus) {
    const metal = platformKind === "metal";
    return (
      <section className="mt-4 border-t border-(--separator) px-2 pt-3 pb-4">
        <div className="flex w-full items-center gap-4 text-left">
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="text-[length:var(--fs-sm)] font-medium text-(--hl2)">
              {metal ? "Metal GPU" : "GPUs"}
            </span>
            <span className="font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)/65">
              {metal ? "available" : "0"}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="h-[3px] min-w-[5rem] flex-1 max-w-[18rem] overflow-hidden rounded-[var(--rad-2xs)] bg-(--dim)/15" />
            <span className="font-mono text-[length:var(--fs-sm)] tabular-nums text-(--fg)/85">
              —
            </span>
          </div>
          <div className="hidden items-baseline gap-5 font-mono text-[length:var(--fs-sm)] tabular-nums sm:flex">
            <Aggregate label="util" value="—" />
            <Aggregate label="temp" value="—" />
            <Aggregate label="pwr" value="—" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4 border-t border-(--separator) px-2 pt-3 pb-5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-center gap-4 text-left"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-[length:var(--fs-sm)] font-medium text-(--hl2)">GPUs</span>
          <span className="shrink-0 font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)/65">
            {sortedGpus.length}
          </span>
          {gpuModelLabel ? (
            <span className="hidden max-w-[14rem] truncate text-[length:var(--fs-xs)] text-(--dim)/60 md:inline">
              {gpuModelLabel}
            </span>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="h-[3px] min-w-[5rem] flex-1 max-w-[18rem] overflow-hidden rounded-[var(--rad-2xs)] bg-(--dim)/15">
            <div
              className="h-full rounded-[var(--rad-2xs)] bg-(--fg)/55 transition-[width] duration-300"
              style={{ width: `${memPct}%` }}
            />
          </div>
          <span className="font-mono text-[length:var(--fs-sm)] tabular-nums text-(--fg)/85">
            {sortedGpus.some((gpu) => gpu.memory_usage_available !== false)
              ? totalUsed.toFixed(1)
              : "—"}
            <span className="text-(--dim)/65">
              /{totalCap.toFixed(0)}G{sortedGpus.some((gpu) => gpu.memory_shared) ? " unified" : ""}
            </span>
          </span>
        </div>

        <div className="hidden items-baseline gap-5 font-mono text-[length:var(--fs-sm)] tabular-nums sm:flex">
          <Aggregate label="util" value={utils.length > 0 ? `${Math.round(avgUtil)}%` : "—"} />
          <Aggregate label="temp" value={maxTemp > 0 ? `${Math.round(maxTemp)}°` : "—"} />
          <Aggregate
            label="pwr"
            value={
              sortedGpus.some((gpu) => gpu.power_available !== false)
                ? `${Math.round(totalPower)}${
                    totalPowerLimit > 0 ? `/${Math.round(totalPowerLimit)}` : ""
                  }W`
                : "—"
            }
          />
        </div>

        <span
          aria-hidden
          className={`ml-1 font-mono text-[length:var(--fs-xs)] text-(--dim)/55 transition-transform group-hover:text-(--dim) ${
            expanded ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
      </button>

      {expanded ? (
        <div className="mt-3 space-y-1">
          {sortedGpus.map((gpu) => (
            <GpuRow key={gpu.id ?? gpu.index} gpu={gpu} showName={names.size > 1} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Aggregate({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[length:var(--fs-2xs)] text-(--dim)/55">{label}</span>
      <span className="text-(--fg)/85">{value}</span>
    </span>
  );
}

function GpuRow({ gpu, showName }: { gpu: GPU; showName: boolean }) {
  const memUsed = gpuMemoryUsed(gpu);
  const memTotal = gpuMemoryTotal(gpu);
  const temp = gpu.temp_c;
  const util = gpu.utilization_pct;
  const power = gpu.power_draw || 0;
  const powerLimit = gpu.power_limit || 0;
  const label = gpu.id ?? gpu.index ?? "gpu";
  const memPct = memTotal > 0 ? clamp((memUsed / memTotal) * 100, 0, 100) : 0;

  return (
    <div className="flex items-center gap-3 py-0.5 font-mono text-[length:var(--fs-sm)] tabular-nums">
      <span className="w-8 shrink-0 text-(--fg)/85" title={gpu.name}>
        G{label}
      </span>
      {showName ? (
        <span className="hidden w-32 shrink-0 truncate text-(--dim)/70 md:inline" title={gpu.name}>
          {gpu.name.replace(/^NVIDIA\s+/, "")}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="h-[2px] flex-1 overflow-hidden rounded-[var(--rad-2xs)] bg-(--dim)/15">
          <div className="h-full bg-(--fg)/45" style={{ width: `${memPct}%` }} />
        </div>
        <span className="text-(--fg)/80">
          {gpu.memory_usage_available === false ? "—" : memUsed.toFixed(1)}
          <span className="text-(--dim)/55">/{memTotal.toFixed(0)}G</span>
        </span>
      </div>
      <span className="w-9 shrink-0 text-right text-(--dim)">
        {gpu.utilization_available === false ? "—" : `${Math.round(util)}%`}
      </span>
      <span className="w-7 shrink-0 text-right text-(--dim)">
        {gpu.temperature_available === false || temp <= 0 ? "—" : `${Math.round(temp)}°`}
      </span>
      <span className="w-14 shrink-0 text-right text-(--dim)">
        {gpu.power_available !== false && power > 0
          ? `${Math.round(power)}${powerLimit > 0 ? `/${Math.round(powerLimit)}` : ""}W`
          : "—"}
      </span>
    </div>
  );
}

function gpuMemoryUsed(gpu: GPU): number {
  return toGBFromMB(gpu.memory_used_mb);
}

function gpuMemoryTotal(gpu: GPU): number {
  return toGBFromMB(gpu.memory_total_mb);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
