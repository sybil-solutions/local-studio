import type { ProcessInfo, RecipeWithStatus } from "@/lib/types";

interface DashboardHeaderStatusProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
}

export function DashboardHeaderStatus({ currentProcess, currentRecipe }: DashboardHeaderStatusProps) {
  const modelName = currentRecipe?.name || currentProcess?.model_path?.split("/").pop();

  if (!currentProcess) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-(--muted)/40"></div>
          <h1 className="text-xl sm:text-2xl font-light tracking-tight text-(--muted-foreground)/60">
            No model running
          </h1>
        </div>
        <p className="text-[10px] text-(--muted-foreground)/40 pl-5">Select a recipe to launch</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="w-2 h-2 rounded-full bg-(--success)"></div>
          <div className="absolute inset-0 w-2 h-2 rounded-full bg-(--success) animate-ping opacity-60"></div>
        </div>
        <h1 className="text-xl sm:text-2xl font-light tracking-tight text-(--foreground)">{modelName}</h1>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-(--muted-foreground)/60 pl-5">
        <span className="font-medium">{currentProcess.backend}</span>
        <span className="opacity-40">·</span>
        <span className="tabular-nums">pid {currentProcess.pid}</span>
      </div>
    </div>
  );
}
