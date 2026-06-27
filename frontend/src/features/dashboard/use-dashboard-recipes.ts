import { useCallback, useState, useSyncExternalStore } from "react";
import api from "@/lib/api/client";
import type { ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { effectInterval } from "@/lib/effect-timers";

function processKey(process: ProcessInfo | null): string {
  if (!process) return "";
  return [
    process.pid,
    process.backend,
    process.served_model_name ?? "",
    process.model_path ?? "",
  ].join("|");
}

let lastRecipe: RecipeWithStatus | null = null;
let lastRecipeProcessKey = "";

export function useDashboardRecipes(currentProcess: ProcessInfo | null) {
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [currentRecipe, setCurrentRecipe] = useState<RecipeWithStatus | null>(() =>
    lastRecipe && lastRecipeProcessKey === processKey(currentProcess) ? lastRecipe : null,
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const selectTargetLogSession = useCallback(
    (
      sessions: Array<{
        id: string;
        recipe_id?: string;
        status: string;
        backend?: string;
        model_path?: string;
        model?: string;
        started_at?: string;
        created_at?: string;
      }>,
      runningRecipe: RecipeWithStatus | null,
    ) => {
      if (sessions.length === 0) return null;

      // Sort newest-first so we always prefer the most recently started session.
      const ts = (s: { started_at?: string; created_at?: string }) =>
        Date.parse(s.started_at || s.created_at || "") || 0;
      const sorted = [...sessions].sort((a, b) => ts(b) - ts(a));
      const running = sorted.filter((s) => s.status === "running");

      if (currentProcess) {
        const matches = (session: (typeof sorted)[number]) => {
          if (session.model_path && currentProcess.model_path) {
            return session.model_path === currentProcess.model_path;
          }
          if (session.model && currentProcess.served_model_name) {
            return session.model === currentProcess.served_model_name;
          }
          return session.backend === currentProcess.backend;
        };
        const byProcess = running.find(matches) || sorted.find(matches);
        if (byProcess) return byProcess;

        const servedModel = currentProcess.served_model_name?.toLowerCase();
        if (servedModel) {
          const byName = sorted.find((session) =>
            (session.id ?? "").toLowerCase().includes(servedModel),
          );
          if (byName) return byName;
        }
      }

      if (runningRecipe) {
        const byRecipe =
          running.find((s) => s.recipe_id === runningRecipe.id) ||
          sorted.find((s) => s.recipe_id === runningRecipe.id);
        if (byRecipe) return byRecipe;
      }

      // Fall back to newest running, then newest of any status.
      return running[0] || sorted[0];
    },
    [currentProcess],
  );

  const refreshLogs = useCallback(
    async (runningRecipe: RecipeWithStatus | null, limit = 220) => {
      try {
        const sessions = await api.getLogSessions();
        const list = sessions.sessions || [];
        if (list.length === 0) {
          setLogs([]);
          return;
        }
        const targetSession = selectTargetLogSession(list, runningRecipe);
        if (!targetSession) {
          setLogs([]);
          return;
        }
        const logData = await api.getLogs(targetSession.id, limit).catch(() => ({ logs: [] }));
        setLogs(logData.logs || []);
      } catch {
        setLogs([]);
      }
    },
    [selectTargetLogSession],
  );

  const reload = useCallback(async () => {
    try {
      const data = await api.getRecipes();
      const list = data.recipes || [];
      setRecipes(list);

      const running = currentProcess
        ? list.find((r: RecipeWithStatus) => r.status === "running") || null
        : null;
      const resolved = running ?? (currentProcess ? currentRecipe : null);
      setCurrentRecipe(resolved);
      const key = processKey(currentProcess);
      lastRecipe = resolved && key ? resolved : null;
      lastRecipeProcessKey = resolved && key ? key : "";
      await refreshLogs(resolved);
    } catch (e) {
      console.error("Failed to load recipes:", e);
    } finally {
      setLoading(false);
    }
  }, [currentProcess, currentRecipe, refreshLogs]);

  const subscribeRecipeReload = useCallback(
    (_notify: () => void) => {
      void reload();
      return () => {};
    },
    [reload],
  );

  const subscribeRecipeEvents = useCallback(
    (_notify: () => void) => {
      const handler = () => {
        void reload();
      };
      window.addEventListener("vllm:recipe-event", handler as EventListener);
      return () => {
        window.removeEventListener("vllm:recipe-event", handler as EventListener);
      };
    },
    [reload],
  );

  const subscribeRecipeLogPolling = useCallback(
    (_notify: () => void) => {
      if (!currentProcess) return () => {};
      let cancelled = false;
      const poll = async () => {
        if (cancelled) return;
        await refreshLogs(currentRecipe);
      };
      void poll();
      const timer = effectInterval(() => void poll(), 4000);
      return () => {
        cancelled = true;
        timer.cancel();
      };
    },
    [currentProcess, currentRecipe, refreshLogs],
  );

  useSyncExternalStore(
    subscribeRecipeReload,
    getDashboardRecipesSnapshot,
    getDashboardRecipesSnapshot,
  );
  useSyncExternalStore(
    subscribeRecipeEvents,
    getDashboardRecipesSnapshot,
    getDashboardRecipesSnapshot,
  );
  useSyncExternalStore(
    subscribeRecipeLogPolling,
    getDashboardRecipesSnapshot,
    getDashboardRecipesSnapshot,
  );

  return { recipes, currentRecipe, logs, loading, reload };
}

const getDashboardRecipesSnapshot = (): number => 0;
