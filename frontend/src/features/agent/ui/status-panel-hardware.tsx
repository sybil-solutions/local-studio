"use client";

// Live host telemetry on the agent's Status tab.
//
// The controller already streams a full per-GPU sample every 5s over SSE, and
// the realtime store already owns it — this reads that store rather than
// opening a second source of truth. Two rules it inherits from the dashboard's
// GPU table, both of which matter more here because the sheet is small:
//
//   * an unreportable reading prints "—", never 0. Apple Silicon cannot report
//     used-VRAM, temperature or power, and Intel never reports utilisation;
//     drawing those as zeroes would invent a cold, idle GPU.
//   * the store deliberately keeps the last sample through a disconnect, so a
//     disconnected controller would otherwise show yesterday's temperature as
//     if it were current. The group header says "stale" when that happens.

import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import type { GPU } from "@/lib/types";
import {
  StatusGroup,
  StatusLine,
  fractionTone,
  temperatureTone,
  type MeterTone,
} from "@/features/agent/ui/status-panel-parts";

const gpuLabel = (gpu: GPU, index: number): string =>
  (gpu.name || `GPU ${index}`).replace(/^NVIDIA\s+/i, "").replace(/\s+GPU$/i, "");

function memoryRow(gpu: GPU): { value: string; fraction?: number; tone: MeterTone } {
  const total = gpu.memory_total_mb ?? 0;
  const used = gpu.memory_used_mb ?? 0;
  if (gpu.memory_usage_available === false || total <= 0) {
    // Total-only platforms (Apple unified memory) still have a real capacity
    // worth showing; what they cannot say is how much of it is in use.
    return { value: total > 0 ? `— / ${(total / 1024).toFixed(0)} GB` : "—", tone: "dim" };
  }
  const fraction = used / total;
  return {
    value: `${(used / 1024).toFixed(1)} / ${(total / 1024).toFixed(0)} GB`,
    fraction,
    tone: fractionTone(fraction),
  };
}

/** One compact block per accelerator: VRAM with a meter, then util/temp/power
 *  folded onto a single line so a 4-GPU box stays readable in a narrow panel. */
function GpuBlock({ gpu, index }: { gpu: GPU; index: number }) {
  const memory = memoryRow(gpu);
  const utilReadable = gpu.utilization_available !== false;
  const tempReadable = gpu.temperature_available !== false && (gpu.temp_c ?? 0) > 0;
  const powerReadable = gpu.power_available !== false && (gpu.power_draw ?? 0) > 0;
  const parts = [
    utilReadable ? `${Math.round(gpu.utilization_pct ?? 0)}% util` : "— util",
    tempReadable ? `${Math.round(gpu.temp_c)}°C` : "—°C",
    powerReadable ? `${Math.round(gpu.power_draw ?? 0)} W` : "— W",
  ];
  return (
    <>
      <StatusLine
        label={gpuLabel(gpu, index)}
        value={memory.value}
        title={`${gpu.name || `GPU ${index}`} — VRAM`}
        tone={memory.tone}
        {...(memory.fraction === undefined ? {} : { fraction: memory.fraction })}
      />
      <StatusLine
        label=""
        value={parts.join(" · ")}
        title="utilisation · temperature · power draw"
        tone={tempReadable ? temperatureTone(gpu.temp_c) : "dim"}
      />
    </>
  );
}

export function StatusHardwareSection() {
  const realtime = useRealtimeStatusStore();
  const gpus = realtime.gpus ?? [];
  if (gpus.length === 0) return null;

  const pooledTotal = gpus.reduce((sum, gpu) => sum + (gpu.memory_total_mb ?? 0), 0);
  const reportsUse = gpus.some((gpu) => gpu.memory_usage_available !== false);
  const pooledUsed = gpus.reduce(
    (sum, gpu) => sum + (gpu.memory_usage_available === false ? 0 : (gpu.memory_used_mb ?? 0)),
    0,
  );
  const hottest = gpus.reduce(
    (max, gpu) =>
      gpu.temperature_available === false ? max : Math.max(max, gpu.temp_c ?? 0),
    0,
  );

  return (
    <StatusGroup
      title="Hardware"
      count={gpus.length}
      right={
        realtime.connected ? (
          hottest > 0 ? (
            <span
              className="font-mono text-[length:var(--fs-xs)] text-(--fg)/30"
              title="hottest GPU in the pool"
            >
              {Math.round(hottest)}°C
            </span>
          ) : null
        ) : (
          <span
            className="font-mono text-[length:var(--fs-xs)] text-(--warn)"
            title="The controller is unreachable — these are the last values it reported, not current ones."
          >
            stale
          </span>
        )
      }
    >
      {gpus.length > 1 && pooledTotal > 0 ? (
        <StatusLine
          label="Pool"
          value={
            reportsUse
              ? `${(pooledUsed / 1024).toFixed(1)} / ${(pooledTotal / 1024).toFixed(0)} GB`
              : `${(pooledTotal / 1024).toFixed(0)} GB`
          }
          title="VRAM across every accelerator"
          tone={reportsUse ? fractionTone(pooledUsed / pooledTotal) : "dim"}
          {...(reportsUse ? { fraction: pooledUsed / pooledTotal } : {})}
        />
      ) : null}
      {gpus.map((gpu, index) => (
        <GpuBlock key={gpu.uuid || gpu.pci_bus_id || `${gpu.index}-${index}`} gpu={gpu} index={index} />
      ))}
    </StatusGroup>
  );
}
