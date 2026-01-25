import type { ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { DashboardHeaderActions } from "./dashboard-header-actions";
import { DashboardHeaderStatus } from "./dashboard-header-status";

interface DashboardHeaderProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  onNavigateChat: () => void;
  onNavigateLogs: () => void;
  onBenchmark: () => void;
  benchmarking: boolean;
  onStop: () => void;
}

export function DashboardHeader(props: DashboardHeaderProps) {
  return (
    <header className="mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <DashboardHeaderStatus
          currentProcess={props.currentProcess}
          currentRecipe={props.currentRecipe}
        />
        {props.currentProcess && (
          <DashboardHeaderActions
            onNavigateChat={props.onNavigateChat}
            onNavigateLogs={props.onNavigateLogs}
            onBenchmark={props.onBenchmark}
            benchmarking={props.benchmarking}
            onStop={props.onStop}
          />
        )}
      </div>
    </header>
  );
}
