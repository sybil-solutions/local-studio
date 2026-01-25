import type { DashboardLayoutProps } from "./dashboard-types";
import { DashboardConnectionBanner } from "./dashboard-connection-banner";
import { DashboardGrid } from "./dashboard-grid";
import { DashboardTop } from "./dashboard-top";
import { LaunchToast } from "../launch-toast";

export function DashboardLayout(props: DashboardLayoutProps) {
  const { currentProcess, metrics, gpus, recipes, logs, launching, launchProgress } = props;

  return (
    <div className="min-h-full bg-background text-foreground">
      <DashboardConnectionBanner
        isConnected={props.isConnected}
        reconnectAttempts={props.reconnectAttempts}
      />
      <div className="max-w-6xl mx-auto px-6 sm:px-8 py-6 sm:py-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <DashboardTop
          currentProcess={props.currentProcess}
          currentRecipe={props.currentRecipe}
          metrics={props.metrics}
          gpus={gpus}
          recipesCount={recipes.length}
          launchStage={launchProgress?.stage}
          isConnected={props.isConnected}
          reconnectAttempts={props.reconnectAttempts}
          inferencePort={props.inferencePort}
          onNavigateChat={props.onNavigateChat}
          onNavigateLogs={props.onNavigateLogs}
          onBenchmark={props.onBenchmark}
          benchmarking={props.benchmarking}
          onStop={props.onStop}
        />
        <DashboardGrid
          recipes={recipes}
          logs={logs}
          launching={launching}
          metrics={metrics}
          onLaunch={props.onLaunch}
          onNewRecipe={props.onNewRecipe}
          onViewAll={props.onViewAll}
        />
      </div>
      <LaunchToast launching={launching} launchProgress={launchProgress} />
    </div>
  );
}
