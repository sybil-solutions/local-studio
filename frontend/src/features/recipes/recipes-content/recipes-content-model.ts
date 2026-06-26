"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import api from "@/lib/api/client";
import type { ModelInfo, RecipeWithStatus } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { useRealtimeStatus } from "@/hooks/use-realtime-status";
import { delay } from "@/lib/async";
import { normalizeRecipeForEditor } from "@/features/recipes/normalize-recipe";
import { prepareRecipeForSave } from "@/features/recipes/prepare-recipe";
import { DEFAULT_RECIPE } from "./default-recipe";
import { useRecipesDerived } from "./use-recipes-derived";

export type RecipesContentTab = "recipes" | "explore" | "downloads";

export function useRecipesContentModel() {
  const [tab, setTab] = useState<RecipesContentTab>("recipes");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [filter, setFilter] = useState("");
  const [pinnedRecipes, setPinnedRecipes] = useState<Set<string>>(new Set());
  const [recipeMenuOpen, setRecipeMenuOpen] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [runningRecipeId, setRunningRecipeId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalRecipe, setModalRecipe] = useState<RecipeEditor | null>(null);
  const [saving, setSaving] = useState(false);

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);

  const { launchProgress } = useRealtimeStatus();

  const subscribePinnedRecipes = useCallback((_notify: () => void) => {
    try {
      const saved = localStorage.getItem("local-studio-pinned-recipes");
      if (saved) setPinnedRecipes(new Set(JSON.parse(saved)));
    } catch {}
    return () => {};
  }, []);

  useSyncExternalStore(
    subscribePinnedRecipes,
    getRecipesContentModelSnapshot,
    getRecipesContentModelSnapshot,
  );

  const togglePin = useCallback((recipeId: string) => {
    setPinnedRecipes((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) {
        next.delete(recipeId);
      } else {
        next.add(recipeId);
      }
      localStorage.setItem("local-studio-pinned-recipes", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const loadRecipes = useCallback(async () => {
    try {
      const [recipesData, modelsData] = await Promise.all([
        api.getRecipes().catch(() => ({ recipes: [] as RecipeWithStatus[] })),
        api.getModels().catch(() => ({ models: [] as ModelInfo[] })),
      ]);
      const recipesList = recipesData.recipes || [];
      setRecipes(recipesList);
      const running = recipesList.find((r) => r.status === "running")?.id || null;
      setRunningRecipeId(running);
      setAvailableModels(modelsData.models || []);
    } catch (e) {
      console.error("Failed to load recipes:", e);
    }
  }, []);

  const subscribeRecipes = useCallback(
    (_notify: () => void) => {
      void (async () => {
        try {
          await loadRecipes();
        } finally {
          setLoading(false);
        }
      })();
      return () => {};
    },
    [loadRecipes],
  );

  useSyncExternalStore(
    subscribeRecipes,
    getRecipesContentModelSnapshot,
    getRecipesContentModelSnapshot,
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRecipes();
    setRefreshing(false);
  }, [loadRecipes]);

  const handleNewRecipe = useCallback(() => {
    setModalRecipe(normalizeRecipeForEditor({ ...DEFAULT_RECIPE }));
    setModalOpen(true);
  }, []);

  const handleEditRecipe = useCallback((recipe: RecipeWithStatus) => {
    setModalRecipe(normalizeRecipeForEditor(recipe));
    setModalOpen(true);
    setRecipeMenuOpen(null);
  }, []);

  const handleSaveRecipe = useCallback(async () => {
    if (!modalRecipe) return;

    const recipeToSave = prepareRecipeForSave(modalRecipe);

    setSaving(true);
    try {
      if (recipeToSave.id) {
        await api.updateRecipe(recipeToSave.id, recipeToSave);
      } else {
        const id = recipeToSave.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        await api.createRecipe({ ...recipeToSave, id });
      }
      await loadRecipes();
      setModalOpen(false);
      setModalRecipe(null);
    } catch (e) {
      alert("Failed to save recipe: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [loadRecipes, modalRecipe]);

  const handleDeleteRecipe = useCallback(
    async (recipeId: string) => {
      try {
        await api.deleteRecipe(recipeId);
        await loadRecipes();
        setDeleteConfirm(null);
        setRecipeMenuOpen(null);
      } catch (e) {
        alert("Failed to delete: " + (e as Error).message);
      }
    },
    [loadRecipes],
  );

  const handleLaunchRecipe = useCallback(
    async (recipeId: string) => {
      setLaunching(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          await fetch(`/api/proxy/launch/${recipeId}`, {
            method: "POST",
            signal: controller.signal,
          });
        } catch {
          // Timeout/abort is fine - launch continues on the controller.
        } finally {
          clearTimeout(timeoutId);
        }

        await delay(1000);
        await loadRecipes();
      } catch (e) {
        alert("Failed to launch: " + (e as Error).message);
      } finally {
        setLaunching(false);
      }
    },
    [loadRecipes],
  );

  const handleEvictModel = useCallback(async () => {
    try {
      await api.evict();
      await loadRecipes();
    } catch (e) {
      alert("Failed to evict: " + (e as Error).message);
    }
  }, [loadRecipes]);

  const handleToggleRecipeMenu = useCallback((recipeId: string) => {
    setRecipeMenuOpen((current) => (current === recipeId ? null : recipeId));
  }, []);

  const handleRequestDelete = useCallback((recipeId: string) => {
    setDeleteConfirm(recipeId);
    setRecipeMenuOpen(null);
  }, []);

  const closeRecipeModal = useCallback(() => {
    setModalOpen(false);
    setModalRecipe(null);
  }, []);

  const derived = useRecipesDerived({
    recipes,
    filter,
    pinnedRecipes,
    runningRecipeId,
    deleteConfirm,
  });

  return {
    tab,
    setTab,
    loading,
    refreshing,
    recipes,
    filter,
    setFilter,
    togglePin,
    pinnedRecipes,
    recipeMenuOpen,
    deleteConfirm,
    setDeleteConfirm,
    runningRecipeId,
    launching,
    modalOpen,
    modalRecipe,
    setModalRecipe,
    saving,
    availableModels,
    modelServedNames: derived.modelServedNames,
    launchProgress,
    derived: {
      sortedRecipes: derived.sortedRecipes,
      runningRecipe: derived.runningRecipe,
      deleteRecipe: derived.deleteRecipe,
    },
    actions: {
      handleRefresh,
      handleNewRecipe,
      handleEditRecipe,
      handleSaveRecipe,
      handleDeleteRecipe,
      handleLaunchRecipe,
      handleEvictModel,
      handleToggleRecipeMenu,
      handleRequestDelete,
      closeRecipeModal,
    },
  };
}

const getRecipesContentModelSnapshot = (): number => 0;
