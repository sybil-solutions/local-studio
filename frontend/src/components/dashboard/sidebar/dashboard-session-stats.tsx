import type { Metrics } from "@/lib/types";
import { DashboardStatRow } from "./dashboard-stat-row";
import { formatNumber } from "./dashboard-stats-utils";

interface DashboardSessionStatsProps {
  metrics: Metrics | null;
}

export function DashboardSessionStats({ metrics }: DashboardSessionStatsProps) {
  if (
    !metrics?.request_success &&
    !metrics?.prompt_tokens_total &&
    !metrics?.generation_tokens_total &&
    !metrics?.running_requests
  ) {
    return null;
  }

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-(--muted-foreground)/50 mb-3 font-medium">Session</h2>
      <div className="space-y-1.5">
        {metrics?.prompt_tokens_total !== undefined && (
          <DashboardStatRow label="Input Tokens" value={formatNumber(metrics.prompt_tokens_total)} />
        )}
        {metrics?.generation_tokens_total !== undefined && (
          <DashboardStatRow label="Output Tokens" value={formatNumber(metrics.generation_tokens_total)} />
        )}
        {metrics?.running_requests !== undefined && metrics.running_requests > 0 && (
          <DashboardStatRow label="Active" value={metrics.running_requests} accent />
        )}
      </div>
    </section>
  );
}
