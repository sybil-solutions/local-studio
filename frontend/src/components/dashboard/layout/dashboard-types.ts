import type { GPU, Metrics, ProcessInfo, RecipeWithStatus } from "@/lib/types";

type LaunchStage = "preempting" | "evicting" | "launching" | "waiting" | "ready" | "cancelled" | "error";

type LaunchProgress = {
  stage: LaunchStage;
  message?: string;
  progress?: number;
} | null;

export interface DashboardLayoutProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  metrics: Metrics | null;
  gpus: GPU[];
  recipes: RecipeWithStatus[];
  logs: string[];
  launching: boolean;
  benchmarking: boolean;
  launchProgress: LaunchProgress;
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
