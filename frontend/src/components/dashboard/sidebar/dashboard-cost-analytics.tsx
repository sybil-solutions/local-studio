import type { Metrics } from "@/lib/types";
import { ELECTRICITY_PRICE_PLN } from "./dashboard-stats-utils";

interface DashboardCostAnalyticsProps {
  metrics: Metrics | null;
}

export function DashboardCostAnalytics({ metrics }: DashboardCostAnalyticsProps) {
  if (!metrics?.lifetime_energy_kwh && !metrics?.current_power_watts) return null;

  const totalCost = metrics?.lifetime_energy_kwh
    ? (metrics.lifetime_energy_kwh * ELECTRICITY_PRICE_PLN).toFixed(2)
    : null;

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-(--muted-foreground)/50 mb-3 font-medium">Cost</h2>
      <div className="space-y-3">
        {totalCost && (
          <div>
            <div className="text-lg font-light text-(--success)/80 tabular-nums">{totalCost} PLN</div>
          </div>
        )}
        {metrics?.current_power_watts && (
          <div className="text-xs text-(--muted-foreground)/50 tabular-nums">
            {Math.round(metrics.current_power_watts)}W draw
          </div>
        )}
      </div>
    </section>
  );
}
