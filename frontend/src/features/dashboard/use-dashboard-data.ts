import { useRouter } from "next/navigation";
import { useModelLifecycle } from "@/features/dashboard/use-model-lifecycle";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { metricsWithProcessIdentity, scopedMetrics } from "./dashboard-metrics";
import { useDashboardActions } from "./use-dashboard-actions";
import { useDashboardRecipes } from "./use-dashboard-recipes";

export function useDashboardData() {
  const router = useRouter();
  const realtime = useRealtimeStatusStore();
  const currentProcess = realtime.status?.process || null;
  const identified = metricsWithProcessIdentity(realtime.metrics, currentProcess);
  const metrics = scopedMetrics(identified, currentProcess);
  // Metrics arrived but could not be attributed to the running process. Without
  // surfacing this the strip renders a wall of zeroes and reads as "idle".
  const metricsDetached = Boolean(currentProcess && identified && !metrics);
  const gpus = realtime.gpus.length > 0 ? realtime.gpus : [];
  const recipesState = useDashboardRecipes(currentProcess);
  const lifecycle = useModelLifecycle(recipesState.recipes);
  const actions = useDashboardActions(
    currentProcess?.served_model_name ?? currentProcess?.model_path ?? null,
  );

  const navigate = (path: string) => () => router.push(path);

  return {
    currentProcess,
    currentRecipe: recipesState.currentRecipe,
    metrics,
    metricsDetached,
    gpus,
    recipes: recipesState.recipes,
    logs: recipesState.logs,
    loading: recipesState.loading,
    launchProgress: realtime.launchProgress,
    platformKind: realtime.platformKind,
    runtimeSummary: realtime.runtimeSummary,
    services: realtime.services,
    lease: realtime.lease,
    isConnected: realtime.connected,
    isStatusLoading: realtime.statusLoading,
    inferencePort: realtime.status?.inference_port,
    benchmarking: actions.benchmarking,
    benchmarkResult: actions.benchmarkResult,
    launching: lifecycle.status === "starting",
    lifecycleStatus: lifecycle.status,
    lifecycleError: lifecycle.error,
    onLaunch: lifecycle.start,
    onBenchmark: actions.onBenchmark,
    onNavigateLogs: navigate("/settings#server"),
    onNewRecipe: navigate("/models?new=1&tab=serves"),
    onViewAll: navigate("/models"),
  };
}
