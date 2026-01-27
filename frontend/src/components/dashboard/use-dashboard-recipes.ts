// CRITICAL
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

      // Find running recipe if any
      const running = currentProcess
        ? list.find((r: RecipeWithStatus) => r.status === "running") || null
        : null;
      setCurrentRecipe(running);

      // Always load logs from the most recent log session
      // Note: Log session IDs don't always match recipe IDs, so we use the sessions API
      try {
        const sessions = await api.getLogSessions();
        if (sessions.sessions?.length > 0) {
          // If there's a running process, try to find its log session first
          // Otherwise just use the most recent session
          let targetSession = sessions.sessions[0];
          
          if (running) {
            // Look for a session that matches the running recipe
            const matchingSession = sessions.sessions.find(
              (s) => s.status === "running" || s.recipe_id === running.id
            );
            if (matchingSession) {
              targetSession = matchingSession;
            }
          }
          
          const logData = await api.getLogs(targetSession.id, 50).catch(() => ({ logs: [] }));
          setLogs(logData.logs || []);
        } else {
          setLogs([]);
        }
      } catch {
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
