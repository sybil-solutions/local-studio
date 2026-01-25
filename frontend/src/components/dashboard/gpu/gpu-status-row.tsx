import { toGB } from "@/lib/formatters";
import type { GPU } from "@/lib/types";

interface GpuStatusRowProps {
  gpu: GPU;
}

export function GpuStatusRow({ gpu }: GpuStatusRowProps) {
  const memUsed = toGB(gpu.memory_used_mb ?? gpu.memory_used ?? 0);
  const memTotal = toGB(gpu.memory_total_mb ?? gpu.memory_total ?? 1);
  const memPct = (memUsed / memTotal) * 100;
  const temp = gpu.temp_c ?? gpu.temperature ?? 0;
  const util = gpu.utilization_pct ?? gpu.utilization ?? 0;

  return (
    <div className="py-2 grid grid-cols-5 gap-4 items-center">
      <div className="text-sm text-(--foreground)/70">GPU {gpu.id ?? gpu.index}</div>
      <div className="space-y-1">
        <div className="h-1 bg-(--muted)/10 rounded-full overflow-hidden">
          <div className="h-full bg-(--foreground)/30 rounded-full transition-all duration-500" style={{ width: `${util}%` }} />
        </div>
        <div className="text-[10px] text-(--muted-foreground)/50 tabular-nums">{util}% util</div>
      </div>
      <div className="space-y-1">
        <div className="h-1 bg-(--muted)/10 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              memPct > 90 ? "bg-(--error)/50" : memPct > 70 ? "bg-(--warning)/50" : "bg-(--success)/50"
            }`}
            style={{ width: `${memPct}%` }}
          />
        </div>
        <div className="text-[10px] text-(--muted-foreground)/50 tabular-nums">
          {memUsed.toFixed(1)}/{memTotal.toFixed(0)}G
        </div>
      </div>
      <div>
        <span
          className={`text-[10px] tabular-nums ${
            temp > 80 ? "text-(--error)/70" : temp > 65 ? "text-(--warning)/70" : "text-(--success)/70"
          }`}
        >
          {temp}°C
        </span>
      </div>
      <div className="text-[10px] text-(--muted-foreground)/50 tabular-nums text-right">
        {gpu.power_draw ? `${Math.round(gpu.power_draw)}W` : "--"}
      </div>
    </div>
  );
}
