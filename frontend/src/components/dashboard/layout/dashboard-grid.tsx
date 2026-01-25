import type { Metrics, RecipeWithStatus } from "@/lib/types";
import { DashboardSidebar } from "../sidebar/dashboard-sidebar";
import { GpuStatusSection } from "../gpu/gpu-status-section";
import { QuickLaunchSection } from "../quick-launch/quick-launch-section";
import { RecentLogsSection } from "../recent-logs-section";

interface DashboardGridProps {
  recipes: RecipeWithStatus[];
  logs: string[];
  launching: boolean;
  metrics: Metrics | null;
  onLaunch: (recipeId: string) => Promise<void>;
  onNewRecipe: () => void;
  onViewAll: () => void;
}

export function DashboardGrid({
  recipes,
  logs,
  launching,
  metrics,
  onLaunch,
  onNewRecipe,
  onViewAll,
}: DashboardGridProps) {
  return (
    <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
      <div className="lg:col-span-2 space-y-8">
        <GpuStatusSection />
        <RecentLogsSection logs={logs} />
      </div>
      <div className="space-y-8">
        <QuickLaunchSection
          recipes={recipes}
          launching={launching}
          onLaunch={onLaunch}
          onNewRecipe={onNewRecipe}
          onViewAll={onViewAll}
        />
        <DashboardSidebar metrics={metrics} />
      </div>
    </div>
  );
}
