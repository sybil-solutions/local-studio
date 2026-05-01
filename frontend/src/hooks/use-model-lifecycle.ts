// CRITICAL
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import type { ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { useRealtimeStatus } from "./use-realtime-status";

type ModelLifecycleStatus = "idle" | "starting" | "ready" | "error";

interface ModelLifecycle {
  activeRecipeId: string | null;
  status: ModelLifecycleStatus;
  error: string | null;
  start: (recipeId: string) => Promise<void>;
  stop: () => Promise<void>;
}

const STARTING_STAGES = new Set(["preempting", "evicting", "launching", "waiting"]);

const matchesProcess = (recipe: RecipeWithStatus, process: ProcessInfo): boolean => {
  if (recipe.model_path && process.model_path && recipe.model_path === process.model_path)
    return true;
  if (recipe.served_model_name && process.served_model_name) {
    return recipe.served_model_name === process.served_model_name;
  }
  return recipe.id === process.served_model_name;
};

export function useModelLifecycle(): ModelLifecycle {
  const realtime = useRealtimeStatus();
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getRecipes()
      .then((data) => {
        if (!cancelled) setRecipes(data.recipes || []);
      })
      .catch(() => {
        if (!cancelled) setRecipes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeRecipeId = useMemo(() => {
    const process = realtime.status?.process;
    if (!process) return null;
    return recipes.find((recipe) => matchesProcess(recipe, process))?.id ?? null;
  }, [realtime.status?.process, recipes]);

  const status = useMemo<ModelLifecycleStatus>(() => {
    const stage = realtime.launchProgress?.stage;
    if (stage && STARTING_STAGES.has(stage)) return "starting";
    if (stage === "error") return "error";
    if (realtime.status?.process) return "ready";
    return "idle";
  }, [realtime.launchProgress?.stage, realtime.status?.process]);

  const visibleError = status === "error" ? (realtime.launchProgress?.message ?? error) : error;

  const start = useCallback(async (recipeId: string) => {
    setError(null);
    try {
      await api.launch(recipeId, true);
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
    }
  }, []);

  const stop = useCallback(async () => {
    setError(null);
    try {
      await api.evict(true);
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      throw new Error(message);
    }
  }, []);

  return {
    activeRecipeId,
    status,
    error: visibleError,
    start,
    stop,
  };
}
