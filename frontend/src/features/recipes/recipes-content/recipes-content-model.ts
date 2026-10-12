"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import api from "@/lib/api/client";
import type { ModelDownload, ModelInfo, RecipeWithStatus, RuntimeTarget } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { normalizeRecipeForEditor } from "@/features/recipes/normalize-recipe";
import { prepareRecipeForSave } from "@/features/recipes/prepare-recipe";
import { DEFAULT_RECIPE } from "./default-recipe";
import type { RecipesTableProps } from "./types";
import { useRecipesDerived } from "./use-recipes-derived";
import { isRecipeActive } from "./launch-reconciliation";

export type RecipesContentTab = "picks" | "get" | "serves" | "downloads";

const requestedTab = (value: string | null): RecipesContentTab =>
  value === "get" || value === "serves" || value === "downloads" ? value : "picks";

export function useRecipesContentModel() {
  const searchParams = useSearchParams();
  const urlTab = requestedTab(searchParams.get("tab"));
  const newRecipeRequested = searchParams.get("new") === "1";
  const newRecipeHandled = useRef(false);
  const observedUrlTab = useRef(urlTab);
  const [tab, setTab] = useState<RecipesContentTab>(urlTab);
  const cachedRecipes = readPageCache<RecipeWithStatus[]>("recipes:list");
  const [loading, setLoading] = useState(cachedRecipes === null);
  const [refreshing, setRefreshing] = useState(false);
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>(() => cachedRecipes ?? []);
  const [filter, setFilter] = useState("");
  const [pinnedRecipes, setPinnedRecipes] = useState<Set<string>>(new Set());
  const [recipeMenuOpen, setRecipeMenuOpen] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [runningRecipeId, setRunningRecipeId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalRecipe, setModalRecipe] = useState<RecipeEditor | null>(null);
  const [saving, setSaving] = useState(false);

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>(
    () => readPageCache<ModelInfo[]>("recipes:models") ?? [],
  );
  const [runtimeTargets, setRuntimeTargets] = useState<RuntimeTarget[]>([]);

  const { launchProgress } = useRealtimeStatusStore();

  useMountSubscription(() => {
    try {
      const saved = localStorage.getItem("local-studio-pinned-recipes");
      if (saved) setPinnedRecipes(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

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

  const loadRecipes = useCallback(async (): Promise<RecipeWithStatus[]> => {
    try {
      const [recipesData, modelsData, runtimeData] = await Promise.all([
        api.getRecipes().catch(() => ({ recipes: [] as RecipeWithStatus[] })),
        api.getModels().catch(() => ({ models: [] as ModelInfo[] })),
        api.getRuntimeTargets().catch(() => ({ targets: [] as RuntimeTarget[] })),
      ]);
      const recipesList = recipesData.recipes || [];
      writePageCache("recipes:list", recipesList);
      writePageCache("recipes:models", modelsData.models || []);
      setRecipes(recipesList);
      const running = recipesList.find((r) => r.status === "running")?.id || null;
      setRunningRecipeId(running);
      setAvailableModels(modelsData.models || []);
      setRuntimeTargets(runtimeData.targets || []);
      return recipesList;
    } catch (e) {
      console.error("Failed to load recipes:", e);
      return [];
    }
  }, []);

  useMountSubscription(() => {
    void (async () => {
      try {
        await loadRecipes();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadRecipes]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRecipes();
    setRefreshing(false);
  }, [loadRecipes]);

  const handleNewRecipe = useCallback(() => {
    setModalRecipe(normalizeRecipeForEditor({ ...DEFAULT_RECIPE }));
    setModalOpen(true);
  }, []);

  useMountSubscription(() => {
    const tabChanged = observedUrlTab.current !== urlTab;
    observedUrlTab.current = urlTab;
    if (!newRecipeRequested) {
      newRecipeHandled.current = false;
      setTab(urlTab);
      return;
    }
    if (newRecipeHandled.current) {
      if (tabChanged) setTab(urlTab);
      return;
    }
    newRecipeHandled.current = true;
    setTab("serves");
    handleNewRecipe();
  }, [handleNewRecipe, newRecipeRequested, urlTab]);

  const handleCreateServeFromDownload = useCallback((download: ModelDownload) => {
    const modelName = download.model_id.split("/").filter(Boolean).at(-1) ?? download.model_id;
    setModalRecipe(
      normalizeRecipeForEditor({
        ...DEFAULT_RECIPE,
        name: modelName,
        model_path: download.target_dir,
        served_model_name: modelName,
      }),
    );
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
        const slug = recipeToSave.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const id = slug || `recipe-${Date.now()}`;
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
        await api.launchRecipe(recipeId);
        await loadRecipes();
      } catch (e) {
        const reconciled = await loadRecipes();
        if (!isRecipeActive(reconciled, recipeId)) {
          alert("Failed to launch: " + (e as Error).message);
        }
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

  const table = useMemo<RecipesTableProps>(
    () => ({
      recipes: derived.sortedRecipes,
      pinnedRecipes,
      recipeMenuOpen,
      launching,
      runningRecipeId,
      onTogglePin: togglePin,
      onToggleMenu: handleToggleRecipeMenu,
      onLaunch: handleLaunchRecipe,
      onStop: handleEvictModel,
      onEdit: handleEditRecipe,
      onRequestDelete: handleRequestDelete,
    }),
    [
      derived.sortedRecipes,
      pinnedRecipes,
      recipeMenuOpen,
      launching,
      runningRecipeId,
      togglePin,
      handleToggleRecipeMenu,
      handleLaunchRecipe,
      handleEvictModel,
      handleEditRecipe,
      handleRequestDelete,
    ],
  );

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
    runtimeTargets,
    launchProgress,
    derived: {
      sortedRecipes: derived.sortedRecipes,
      runningRecipe: derived.runningRecipe,
      deleteRecipe: derived.deleteRecipe,
    },
    table,
    actions: {
      handleRefresh,
      handleNewRecipe,
      handleCreateServeFromDownload,
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
