// CRITICAL
"use client";

import type { GPU, Metrics, ProcessInfo } from "@/lib/types";
import { toGB, toGBFromMB } from "@/lib/formatters";

interface GpuSectionProps {
  metrics: Metrics | null;
  gpus: GPU[];
  currentProcess: ProcessInfo | null;
  logs?: string[];
}

export function GpuSection({ gpus }: GpuSectionProps) {
  const sortedGpus = [...gpus].sort((a, b) => gpuMemoryTotal(b) - gpuMemoryTotal(a));
  const totalUsed = sortedGpus.reduce((s, g) => s + gpuMemoryUsed(g), 0);
  const totalCap = sortedGpus.reduce((s, g) => s + gpuMemoryTotal(g), 0);
  const hasGpus = sortedGpus.length > 0;

  return (
    <div className="border border-(--border) bg-(--surface)">
      <div className="flex items-center justify-between border-b border-(--border) px-3 py-2.5">
        <div>
          <div className="text-sm font-semibold leading-5 text-(--fg)">GPU telemetry</div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.11em] text-(--dim)">
            {hasGpus ? `${sortedGpus.length} devices` : "waiting for devices"}
          </div>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-(--dim)">
          {hasGpus ? `${totalUsed.toFixed(1)} / ${totalCap.toFixed(0)} G` : "— / — G"}
        </span>
      </div>

      {/* Single horizontal telemetry grid: usage, VRAM, temp, and power share one row per GPU. */}
      <div className="overflow-x-auto">
        <div className="min-w-[48rem]">
          <div className="grid grid-cols-[minmax(10rem,1.15fr)_repeat(4,minmax(8rem,1fr))] border-b border-(--border) px-3 py-2">
            {["GPU", "Usage", "VRAM", "Temp", "Power"].map((label) => (
              <div
                key={label}
                className="text-[10px] font-medium uppercase tracking-[0.11em] text-(--dim)"
              >
                {label}
              </div>
            ))}
          </div>

          {hasGpus
            ? sortedGpus.map((gpu) => <GpuTelemetryRow key={gpu.id ?? gpu.index} gpu={gpu} />)
            : Array.from({ length: 5 }, (_, index) => <GpuSkeletonRow key={index} index={index} />)}
        </div>
      </div>
    </div>
  );
}

function GpuTelemetryRow({ gpu }: { gpu: GPU }) {
  const memUsed = gpuMemoryUsed(gpu);
  const memTotal = gpuMemoryTotal(gpu);
  const temp = gpu.temp_c ?? gpu.temperature ?? 0;
  const util = gpu.utilization_pct ?? gpu.utilization ?? 0;
  const power = gpu.power_draw || 0;
  const powerLimit = gpu.power_limit || 0;
  const label = gpu.id ?? gpu.index ?? "gpu";

  return (
    <div className="grid grid-cols-[minmax(10rem,1.15fr)_repeat(4,minmax(8rem,1fr))] items-center border-b border-(--border)/55 px-3 py-2.5 last:border-b-0">
      <div className="min-w-0 pr-3" title={gpu.name}>
        <div className="font-mono text-[11px] font-semibold tabular-nums text-(--fg)">G{label}</div>
        <div className="mt-0.5 truncate text-[11px] text-(--dim)">{gpu.name}</div>
      </div>
      <MetricBar value={util} max={100} valueLabel={`${Math.round(util)}%`} />
      <MetricBar
        value={memUsed}
        max={memTotal}
        valueLabel={`${memUsed.toFixed(1)}/${memTotal.toFixed(0)}G`}
      />
      <MetricBar value={temp} max={90} valueLabel={temp > 0 ? `${Math.round(temp)}°` : "—"} />
      <MetricBar
        value={power}
        max={powerLimit}
        valueLabel={
          power > 0
            ? `${Math.round(power)}${powerLimit > 0 ? `/${Math.round(powerLimit)}` : ""}W`
            : "—"
        }
      />
    </div>
  );
}

function MetricBar({ value, max, valueLabel }: { value: number; max: number; valueLabel: string }) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;

  return (
    <div className="min-w-0 pr-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
        <span className="font-medium text-(--fg)">{valueLabel}</span>
        <span className="text-(--dim)">{pct > 0 ? `${Math.round(pct)}%` : "—"}</span>
      </div>
      <div className="h-2 bg-(--dim)/15">
        <div className="h-full bg-(--fg)/65" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function GpuSkeletonRow({ index }: { index: number }) {
  return (
    <div className="grid grid-cols-[minmax(10rem,1.15fr)_repeat(4,minmax(8rem,1fr))] items-center border-b border-(--border)/55 px-3 py-2.5 last:border-b-0">
      <div className="min-w-0 pr-3">
        <div className="font-mono text-[11px] tabular-nums text-(--dim)">G{index}</div>
        <div className="mt-0.5 truncate text-[11px] text-(--dim)/70">waiting for GPU data</div>
      </div>
      <EmptyMetricBar />
      <EmptyMetricBar />
      <EmptyMetricBar />
      <EmptyMetricBar />
    </div>
  );
}

function EmptyMetricBar() {
  return (
    <div className="min-w-0 pr-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums text-(--dim)">
        <span>—</span>
        <span>—</span>
      </div>
      <div className="h-2 bg-(--dim)/15" />
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
