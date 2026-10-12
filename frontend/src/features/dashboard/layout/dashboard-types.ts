import type {
  GPU,
  LaunchProgress,
  Metrics,
  ProcessInfo,
  RecipeWithStatus,
  RuntimePlatformKind,
} from "@/lib/types";
import type { LeaseInfo, RuntimeSummaryData, ServiceEntry } from "@/hooks/realtime-status-types";

export interface DashboardLayoutProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  metrics: Metrics | null;
  /** Metrics were received but do not match the running process. */
  metricsDetached?: boolean;
  gpus: GPU[];
  recipes: RecipeWithStatus[];
  logs: string[];
  launching: boolean;
  lifecycleStatus: "idle" | "starting" | "ready" | "error";
  lifecycleError: string | null;
  benchmarking: boolean;
  benchmarkResult: number | null;
  launchProgress: LaunchProgress | null;
  platformKind: RuntimePlatformKind | null;
  runtimeSummary?: RuntimeSummaryData | null;
  services?: ServiceEntry[];
  lease?: LeaseInfo | null;
  isConnected: boolean;
  isStatusLoading: boolean;
  inferencePort?: number;
  onNavigateLogs: () => void;
  onBenchmark: () => void;
  onLaunch: (recipeId: string) => Promise<void>;
  onNewRecipe: () => void;
  onViewAll: () => void;
}
