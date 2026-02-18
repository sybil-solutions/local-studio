import type {
  GPU,
  LaunchProgress,
  Metrics,
  ProcessInfo,
  RecipeWithStatus,
  RuntimePlatformKind,
} from "@/lib/types";
import type { LeaseInfo, RuntimeSummaryData, ServiceEntry } from "@/hooks/realtime-status-store/types";

export interface DashboardLayoutProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  metrics: Metrics | null;
  gpus: GPU[];
  recipes: RecipeWithStatus[];
  logs: string[];
  launching: boolean;
  benchmarking: boolean;
  launchProgress: LaunchProgress | null;
  platformKind: RuntimePlatformKind | null;
  runtimeSummary?: RuntimeSummaryData | null;
  services?: ServiceEntry[];
  lease?: LeaseInfo | null;
  isConnected: boolean;
  reconnectAttempts: number;
  inferencePort?: number;
  onNavigateChat: () => void;
  onNavigateLogs: () => void;
  onBenchmark: () => void;
  onStop: () => void;
  onLaunch: (recipeId: string) => Promise<void>;
  onNewRecipe: () => void;
  onViewAll: () => void;
}
