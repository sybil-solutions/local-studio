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
  const metrics = scopedMetrics(
    metricsWithProcessIdentity(realtime.metrics, currentProcess),
    currentProcess,
  );
  const gpus = realtime.gpus.length > 0 ? realtime.gpus : [];
  const recipesState = useDashboardRecipes(currentProcess);
  const lifecycle = useModelLifecycle(recipesState.recipes);
  const actions = useDashboardActions();

  const navigate = (path: string) => () => router.push(path);

  return {
    currentProcess,
    currentRecipe: recipesState.currentRecipe,
    metrics,
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
    launching: lifecycle.status === "starting",
    lifecycleStatus: lifecycle.status,
    onLaunch: lifecycle.start,
    onBenchmark: actions.onBenchmark,
    onNavigateLogs: navigate("/logs"),
    onNewRecipe: navigate("/recipes?new=1"),
    onViewAll: navigate("/recipes"),
  };
}
