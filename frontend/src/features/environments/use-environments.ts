"use client";

import { useCallback, useState } from "react";
import api from "@/lib/api/client";
import type { EnvironmentEngineId, EnvironmentWithStatus, RecipeWithStatus } from "@/lib/types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const ENGINE_OPTIONS: Array<{ value: EnvironmentEngineId; label: string }> = [
  { value: "vllm", label: "vLLM" },
  { value: "sglang", label: "SGLang" },
  { value: "llamacpp", label: "llama.cpp" },
];

export interface EnvironmentFormState {
  name: string;
  recipeId: string;
  engineId: EnvironmentEngineId;
  version: string;
  variant: string;
}

const emptyForm = (): EnvironmentFormState => ({
  name: "",
  recipeId: "",
  engineId: "vllm",
  version: "",
  variant: "",
});

export function useEnvironments() {
  const [environments, setEnvironments] = useState<EnvironmentWithStatus[]>([]);
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<EnvironmentFormState>(emptyForm());
  const [creating, setCreating] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [environmentsData, recipesData] = await Promise.all([
        api.getEnvironments(),
        api.getRecipes(),
      ]);
      setEnvironments(environmentsData.environments);
      setRecipes(recipesData.recipes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useMountSubscription(() => {
    void (async () => {
      try {
        await loadAll();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAll]);

  const handleCreate = useCallback(async () => {
    if (!form.name.trim() || !form.recipeId || !form.version.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.createEnvironment({
        id: `env-${Date.now().toString(36)}`,
        name: form.name.trim(),
        recipeId: form.recipeId,
        engineId: form.engineId,
        version: form.version.trim(),
        ...(form.variant.trim() ? { variant: form.variant.trim() } : {}),
      });
      setForm(emptyForm());
      await loadAll();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setCreating(false);
    }
  }, [form, loadAll]);

  const handleDelete = useCallback(
    async (id: string) => {
      setPendingActionId(id);
      try {
        await api.deleteEnvironment(id);
        await loadAll();
      } finally {
        setPendingActionId(null);
      }
    },
    [loadAll],
  );

  const handleStart = useCallback(
    async (id: string) => {
      setPendingActionId(id);
      setError(null);
      try {
        const result = await api.startEnvironment(id);
        if (!result.started) setError(result.message);
        await loadAll();
      } finally {
        setPendingActionId(null);
      }
    },
    [loadAll],
  );

  const handlePullImage = useCallback(
    async (id: string, image: string) => {
      setPendingActionId(id);
      setError(null);
      try {
        const pull = await api.pullEngineImage(image);
        if (pull.status === "failed") {
          setError(pull.error ?? `Failed to pull ${image}`);
          return;
        }
        let settled = pull.status === "done";
        while (!settled) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const infos = await api.getEngineImages();
          const current = infos
            .flatMap((info) => info.pulls)
            .find((entry) => entry.image === image);
          if (!current || current.status !== "pulling") {
            settled = true;
            if (current?.status === "failed") {
              setError(current.error ?? `Failed to pull ${image}`);
            }
          }
        }
        await loadAll();
      } catch (pullError) {
        setError(pullError instanceof Error ? pullError.message : String(pullError));
      } finally {
        setPendingActionId(null);
      }
    },
    [loadAll],
  );

  const handleStop = useCallback(
    async (id: string) => {
      setPendingActionId(id);
      try {
        await api.stopEnvironment(id);
        await loadAll();
      } finally {
        setPendingActionId(null);
      }
    },
    [loadAll],
  );

  return {
    environments,
    recipes,
    loading,
    error,
    form,
    setForm,
    creating,
    pendingActionId,
    engineOptions: ENGINE_OPTIONS,
    loadAll,
    handleCreate,
    handleDelete,
    handleStart,
    handleStop,
    handlePullImage,
  };
}
