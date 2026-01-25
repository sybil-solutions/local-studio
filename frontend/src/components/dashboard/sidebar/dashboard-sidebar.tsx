import type { Metrics } from "@/lib/types";
import { DashboardCostAnalytics } from "./dashboard-cost-analytics";
import { DashboardLifetimeStats } from "./dashboard-lifetime-stats";
import { DashboardSessionStats } from "./dashboard-session-stats";

interface DashboardSidebarProps {
  metrics: Metrics | null;
}

export function DashboardSidebar({ metrics }: DashboardSidebarProps) {
  return (
    <div className="space-y-6">
      <DashboardSessionStats metrics={metrics} />
      <DashboardLifetimeStats metrics={metrics} />
      <DashboardCostAnalytics metrics={metrics} />
    </div>
  );
}
