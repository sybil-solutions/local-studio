"use client";

import type { GPU, Metrics } from "@/lib/types";
import { toGB } from "@/lib/formatters";

interface MetricBarProps {
  metrics: Metrics | null;
  gpus: GPU[];
}

export function MetricBar({ metrics, gpus }: MetricBarProps) {
  const genTps = metrics?.session_avg_generation || metrics?.generation_throughput || 0;
  const prefillTps = metrics?.session_avg_prefill || metrics?.prompt_throughput || 0;
  const genPeak = metrics?.peak_generation_tps || 0;
  const prefillPeak = metrics?.peak_prefill_tps || 0;
  const totalPower = gpus.reduce((sum, g) => sum + (g.power_draw || 0), 0);
  const totalMemUsed = gpus.reduce((sum, g) => sum + toGB(g.memory_used_mb ?? g.memory_used ?? 0), 0);
  const totalMemMax = gpus.reduce((sum, g) => sum + toGB(g.memory_total_mb ?? g.memory_total ?? 0), 0);
  const kvCache = metrics?.kv_cache_usage ? Math.round(metrics.kv_cache_usage * 100) : 0;
  const totalCost = metrics?.lifetime_energy_kwh ? (metrics.lifetime_energy_kwh * 0.5).toFixed(2) : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-foreground/5">
      <MetricBox 
        label="generation" 
        value={genTps > 0 ? genTps.toFixed(1) : "--"} 
        unit="tok/s" 
        peak={genPeak > 0 ? genPeak.toFixed(1) : undefined}
      />
      <MetricBox 
        label="prefill" 
        value={prefillTps > 0 ? prefillTps.toFixed(1) : "--"} 
        unit="tok/s" 
        peak={prefillPeak > 0 ? prefillPeak.toFixed(1) : undefined}
      />
      <MetricBox label="memory" value={`${totalMemUsed.toFixed(1)}/${totalMemMax.toFixed(0)}`} unit="GB" />
      <MetricBox label="kv cache" value={kvCache > 0 ? kvCache.toString() : "--"} unit="%" />
      <MetricBox label="power" value={Math.round(totalPower).toString()} unit="W" />
      {totalCost && (
        <MetricBox label="cost" value={totalCost} unit="PLN" accent />
      )}
    </div>
  );
}

function MetricBox({ 
  label, 
  value, 
  unit, 
  peak,
  accent 
}: { 
  label: string; 
  value: string; 
  unit: string;
  peak?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-background p-4">
      <div className="text-[10px] uppercase tracking-widest text-foreground/30 mb-1">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-light tabular-nums ${accent ? "text-(--success)" : ""}`}>
          {value}
        </span>
        <span className="text-xs text-foreground/30">{unit}</span>
      </div>
      {peak && (
        <div className="text-[10px] text-foreground/20 mt-1 font-mono">
          peak {peak}
        </div>
      )}
    </div>
  );
}
