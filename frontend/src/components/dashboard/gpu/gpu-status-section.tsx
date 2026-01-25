import { useRealtimeStatus } from "@/hooks/use-realtime-status";
import { toGB } from "@/lib/formatters";
import { GpuStatusEmpty } from "./gpu-status-empty";
import { GpuStatusRow } from "./gpu-status-row";
import { GpuStatusSummary } from "./gpu-status-summary";

export function GpuStatusSection() {
  const { gpus: realtimeGpus } = useRealtimeStatus();
  const gpus = realtimeGpus.length > 0 ? realtimeGpus : [];

  if (gpus.length === 0) return <GpuStatusEmpty />;

  const totalPower = gpus.reduce((sum, g) => sum + (g.power_draw || 0), 0);
  const totalMem = gpus.reduce((sum, g) => sum + toGB(g.memory_used_mb ?? g.memory_used ?? 0), 0);
  const totalMemMax = gpus.reduce((sum, g) => sum + toGB(g.memory_total_mb ?? g.memory_total ?? 0), 0);
  const avgUtil = Math.round(gpus.reduce((sum, g) => sum + (g.utilization_pct ?? g.utilization ?? 0), 0) / gpus.length);
  const avgTemp = Math.round(gpus.reduce((sum, g) => sum + (g.temp_c ?? g.temperature ?? 0), 0) / gpus.length);

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-(--muted-foreground)/50 mb-3 font-medium">GPU Status</h2>
      <div className="space-y-1">
        {gpus.map((gpu) => (
          <GpuStatusRow key={gpu.id ?? gpu.index} gpu={gpu} />
        ))}
      </div>
      {gpus.length > 1 && (
        <GpuStatusSummary
          avgUtil={avgUtil}
          avgTemp={avgTemp}
          totalMem={totalMem}
          totalMemMax={totalMemMax}
          totalPower={totalPower}
        />
      )}
    </section>
  );
}
