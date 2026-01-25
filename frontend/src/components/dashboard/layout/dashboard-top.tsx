import type { GPU, Metrics, ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { DashboardHeader } from "../header/dashboard-header";
import { DashboardMetrics } from "../metrics/dashboard-metrics";
import { DashboardOverview } from "../overview/dashboard-overview";

interface DashboardTopProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  metrics: Metrics | null;
  gpus: GPU[];
  recipesCount: number;
  launchStage?: string;
  isConnected: boolean;
  reconnectAttempts: number;
  inferencePort?: number;
  onNavigateChat: () => void;
  onNavigateLogs: () => void;
  onBenchmark: () => void;
  benchmarking: boolean;
  onStop: () => void;
}

export function DashboardTop(props: DashboardTopProps) {
  const { currentProcess, currentRecipe, metrics, gpus } = props;

  return (
    <>
      <DashboardHeader
        currentProcess={currentProcess}
        currentRecipe={currentRecipe}
        onNavigateChat={props.onNavigateChat}
        onNavigateLogs={props.onNavigateLogs}
        onBenchmark={props.onBenchmark}
        benchmarking={props.benchmarking}
        onStop={props.onStop}
      />
      <DashboardOverview
        isConnected={props.isConnected}
        reconnectAttempts={props.reconnectAttempts}
        currentProcess={currentProcess}
        currentRecipe={currentRecipe}
        recipesCount={props.recipesCount}
        gpus={gpus}
        inferencePort={props.inferencePort}
        launchStage={props.launchStage}
      />
      {currentProcess && <DashboardMetrics metrics={metrics} gpus={gpus} />}
    </>
  );
}
