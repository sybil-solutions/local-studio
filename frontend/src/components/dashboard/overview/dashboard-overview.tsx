import type { GPU, ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { OverviewCard } from "./overview-card";

interface DashboardOverviewProps {
  isConnected: boolean;
  reconnectAttempts: number;
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  recipesCount: number;
  gpus: GPU[];
  inferencePort?: number;
  launchStage?: string;
}

export function DashboardOverview({
  isConnected,
  reconnectAttempts,
  currentProcess,
  currentRecipe,
  recipesCount,
  gpus,
  inferencePort,
  launchStage,
}: DashboardOverviewProps) {
  const modelLabel = currentRecipe?.name || currentProcess?.model_path?.split("/").pop();

  return (
    <section className="mb-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewCard
          label="Connection"
          value={isConnected ? "Live" : "Offline"}
          sub={isConnected ? "SSE streaming" : `Retry ${reconnectAttempts}`}
          tone={isConnected ? "success" : "muted"}
        />
        <OverviewCard
          label="Active Model"
          value={modelLabel || "Idle"}
          sub={currentProcess ? `${currentProcess.backend} · pid ${currentProcess.pid}` : "No process"}
          tone={currentProcess ? "accent" : "muted"}
        />
        <OverviewCard label="Recipes" value={recipesCount} sub="Available to launch" />
        <OverviewCard
          label="GPU / Port"
          value={`${gpus.length} GPU`}
          sub={inferencePort ? `Port ${inferencePort}` : "Port --"}
        />
      </div>
      {launchStage && launchStage !== "ready" && (
        <div className="mt-4 text-[10px] uppercase tracking-widest text-(--muted-foreground)/40">
          Launching: {launchStage}
        </div>
      )}
    </section>
  );
}
