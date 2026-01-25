import type { RecipeWithStatus } from "@/lib/types";

interface QuickLaunchRowProps {
  recipe: RecipeWithStatus;
  launching: boolean;
  onClick: (id: string) => void;
}

export function QuickLaunchRow({ recipe, launching, onClick }: QuickLaunchRowProps) {
  const disabled = launching || recipe.status === "running";
  const isRunning = recipe.status === "running";

  return (
    <div
      onClick={() => !disabled && onClick(recipe.id)}
      className={`group py-2 cursor-pointer transition-colors ${
        isRunning ? "cursor-default" : "hover:bg-(--muted)/5"
      } ${disabled && !isRunning ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isRunning ? "bg-(--success)" : "bg-(--muted)/30"}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-(--foreground)/80 truncate">{recipe.name}</div>
          <div className="text-[10px] text-(--muted-foreground)/40">
            TP{recipe.tp || recipe.tensor_parallel_size} · {recipe.backend || "vllm"}
          </div>
        </div>
      </div>
    </div>
  );
}
