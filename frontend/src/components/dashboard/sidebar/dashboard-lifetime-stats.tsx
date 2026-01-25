import type { Metrics } from "@/lib/types";
import { DashboardStatRow } from "./dashboard-stat-row";
import { formatUptime } from "./dashboard-stats-utils";

interface DashboardLifetimeStatsProps {
  metrics: Metrics | null;
}

export function DashboardLifetimeStats({ metrics }: DashboardLifetimeStatsProps) {
  if (
    !metrics?.lifetime_prompt_tokens &&
    !metrics?.lifetime_completion_tokens &&
    !metrics?.lifetime_requests &&
    !metrics?.lifetime_energy_kwh &&
    !metrics?.lifetime_uptime_hours
  ) {
    return null;
  }

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-(--muted-foreground)/50 mb-3 font-medium">Lifetime</h2>
      <div className="space-y-1.5">
        {metrics?.lifetime_energy_kwh !== undefined && metrics.lifetime_energy_kwh > 0 && (
          <DashboardStatRow label="Energy" value={`${metrics.lifetime_energy_kwh.toFixed(2)} kWh`} />
        )}
        {metrics?.lifetime_uptime_hours !== undefined && metrics.lifetime_uptime_hours > 0 && (
          <DashboardStatRow label="Uptime" value={formatUptime(metrics.lifetime_uptime_hours)} />
        )}
      </div>
    </section>
  );
}
