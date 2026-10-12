"use client";

import { useCallback, useMemo, useState } from "react";
import api from "@/lib/api/client";
import type { ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { isActiveLaunchStage } from "@/hooks/realtime-status-types";

type ModelLifecycleStatus = "idle" | "starting" | "ready" | "error";

interface ModelLifecycle {
  activeRecipeId: string | null;
  status: ModelLifecycleStatus;
  error: string | null;
  start: (recipeId: string) => Promise<void>;
  stop: () => Promise<void>;
}

const matchesProcess = (recipe: RecipeWithStatus, process: ProcessInfo): boolean => {
  if (recipe.model_path && process.model_path && recipe.model_path === process.model_path)
    return true;
  if (recipe.served_model_name && process.served_model_name) {
    return recipe.served_model_name === process.served_model_name;
  }
  return recipe.id === process.served_model_name;
};

export function useModelLifecycle(recipes: RecipeWithStatus[] = []): ModelLifecycle {
  const realtime = useRealtimeStatusStore();
  const [error, setError] = useState<string | null>(null);

  const activeRecipeId = useMemo(() => {
    const process = realtime.status?.process;
    if (!process) return null;
    return recipes.find((recipe) => matchesProcess(recipe, process))?.id ?? null;
  }, [realtime.status?.process, recipes]);

  const status = useMemo<ModelLifecycleStatus>(() => {
    const stage = realtime.launchProgress?.stage;
    if (realtime.status?.process) return "ready";
    if (isActiveLaunchStage(stage)) {
      return realtime.status?.launching ? "starting" : "idle";
    }
    if (stage === "error") return "error";
    return "idle";
  }, [realtime.launchProgress?.stage, realtime.status?.launching, realtime.status?.process]);

  const visibleError = status === "error" ? (realtime.launchProgress?.message ?? error) : error;

  const start = useCallback(async (recipeId: string) => {
    setError(null);
    try {
      await api.launch(recipeId);
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
    }
  }, []);

  const stop = useCallback(async () => {
    setError(null);
    try {
      await api.evict();
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
