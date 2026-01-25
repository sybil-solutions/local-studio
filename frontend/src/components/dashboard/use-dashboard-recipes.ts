import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import type { ProcessInfo, RecipeWithStatus } from "@/lib/types";

export function useDashboardRecipes(currentProcess: ProcessInfo | null) {
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [currentRecipe, setCurrentRecipe] = useState<RecipeWithStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api.getRecipes();
      const list = data.recipes || [];
      setRecipes(list);
      if (currentProcess) {
        const running = list.find((r: RecipeWithStatus) => r.status === "running") || null;
        setCurrentRecipe(running);
        if (running) {
          const logData = await api.getLogs(running.id, 50).catch(() => ({ logs: [] }));
          setLogs(logData.logs || []);
        }
      } else {
        setCurrentRecipe(null);
        setLogs([]);
      }
    } catch (e) {
      console.error("Failed to load recipes:", e);
    } finally {
      setLoading(false);
    }
  }, [currentProcess]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { recipes, currentRecipe, logs, loading, reload };
}
