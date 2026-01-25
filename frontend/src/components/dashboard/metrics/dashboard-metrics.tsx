import type { GPU, Metrics } from "@/lib/types";
import { toGB } from "@/lib/formatters";
import { DashboardMetric } from "./dashboard-metric";
import { DashboardTpsMetric } from "./dashboard-tps-metric";

interface DashboardMetricsProps {
  metrics: Metrics | null;
  gpus: GPU[];
}

export function DashboardMetrics({ metrics, gpus }: DashboardMetricsProps) {
  const totalPower = gpus.reduce((sum, g) => sum + (g.power_draw || 0), 0);
  const totalMem = gpus.reduce((sum, g) => sum + toGB(g.memory_used_mb ?? g.memory_used ?? 0), 0);
  const totalMemMax = gpus.reduce((sum, g) => sum + toGB(g.memory_total_mb ?? g.memory_total ?? 0), 0);
  const generationTps = metrics?.session_avg_generation || metrics?.generation_throughput || 0;
  const prefillTps = metrics?.session_avg_prefill || metrics?.prompt_throughput || 0;

  return (
    <section className="mb-8 pb-6 border-b border-(--border)/10">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6 sm:gap-8">
        <DashboardMetric
          label="Requests"
          value={metrics?.running_requests || 0}
          sub={metrics?.pending_requests ? `${metrics.pending_requests} queued` : undefined}
        />
        <DashboardTpsMetric
          label="Generation"
          value={generationTps}
          peak={metrics?.peak_generation_tps || 0}
        />
        <DashboardTpsMetric label="Prefill" value={prefillTps} peak={metrics?.peak_prefill_tps || 0} />
        <DashboardMetric
          label="TTFT"
          value={metrics?.avg_ttft_ms ? Math.round(metrics.avg_ttft_ms) : "--"}
          unit="ms"
          sub={metrics?.peak_ttft_ms ? `best ${Math.round(metrics.peak_ttft_ms)}` : undefined}
        />
        <DashboardMetric
          label="KV Cache"
          value={metrics?.kv_cache_usage != null ? Math.round(metrics.kv_cache_usage * 100) : "--"}
          unit="%"
        />
        <DashboardMetric
          label="Power"
          value={Math.round(totalPower)}
          unit="W"
          sub={`${totalMem.toFixed(0)}/${totalMemMax.toFixed(0)}G`}
        />
      </div>
    </section>
  );
}
