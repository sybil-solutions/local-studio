// CRITICAL
"use client";

import { useRealtimeStatus } from "@/hooks/use-realtime-status";
import { toGB } from "@/lib/formatters";
import type { GPU } from "@/lib/types";

interface GpuListProps {
  gpus: GPU[];
}

export function GpuList({ gpus: staticGpus }: GpuListProps) {
  const { gpus: realtimeGpus } = useRealtimeStatus();
  const gpus = realtimeGpus.length > 0 ? realtimeGpus : staticGpus;

  if (gpus.length === 0) {
    return (
      <div className="border border-foreground/10 p-4">
        <div className="text-xs uppercase tracking-widest text-foreground/40 mb-4">GPU</div>
        <div className="text-sm text-foreground/30">No data</div>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-x-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs uppercase tracking-widest text-foreground/40">GPU</div>
        <div className="text-xs text-foreground/30 font-mono">{gpus.length} units</div>
      </div>

      <div className="border border-foreground/10">
        {/* Header */}
        <div className="grid grid-cols-12 gap-4 p-3 border-b border-foreground/10 bg-foreground/[0.02] text-[10px] uppercase tracking-wider text-foreground/30">
          <div className="col-span-2">Unit</div>
          <div className="col-span-4">Util</div>
          <div className="col-span-3">VRAM</div>
          <div className="col-span-2">Temp</div>
          <div className="col-span-1 text-right">Pwr</div>
        </div>

        {/* Rows */}
        <div>
          {gpus.map((gpu) => (
            <GpuRow key={gpu.id ?? gpu.index} gpu={gpu} />
          ))}
        </div>
      </div>
    </div>
  );
}

function GpuRow({ gpu }: { gpu: GPU }) {
  const memUsed = toGB(gpu.memory_used_mb ?? gpu.memory_used);
  const memTotal = toGB(gpu.memory_total_mb ?? gpu.memory_total);
  // Guard against divide by zero or invalid total
  const memPct = memTotal > 0 ? Math.min((memUsed / memTotal) * 100, 100) : 0;
  const temp = gpu.temp_c ?? gpu.temperature ?? 0;
  const util = gpu.utilization_pct ?? gpu.utilization ?? 0;
  const power = gpu.power_draw || 0;

  const getTempColor = (t: number) => {
    if (t > 80) return "text-(--error)";
    if (t > 65) return "text-(--warning)";
    return "text-(--success)";
  };

  return (
    <div className="grid grid-cols-12 gap-4 p-3 border-b border-foreground/5 last:border-0 items-center text-sm">
      <div className="col-span-2 font-mono">gpu_{gpu.id ?? gpu.index}</div>
      
      <div className="col-span-4 flex items-center gap-3">
        <div className="flex-1 h-1 bg-foreground/10">
          <div 
            className="h-full bg-foreground/40 transition-all duration-500"
            style={{ width: `${util}%` }}
          />
        </div>
        <span className="text-xs font-mono text-foreground/50 w-8 text-right">{util}%</span>
      </div>
      
      <div className="col-span-3 flex items-center gap-3">
        <div className="flex-1 h-1 bg-foreground/10">
          <div 
            className="h-full bg-foreground/30 transition-all duration-500"
            style={{ width: `${memPct}%` }}
          />
        </div>
        <span className="text-xs font-mono text-foreground/50">{memUsed.toFixed(1)}G</span>
      </div>
      
      <div className={`col-span-2 font-mono text-xs ${getTempColor(temp)}`}>
        {temp}c
      </div>
      
      <div className="col-span-1 text-right font-mono text-xs text-foreground/40">
        {power > 0 ? `${Math.round(power)}w` : "--"}
      </div>
    </div>
  );
}
