// CRITICAL
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import type { ModelRecommendation, Recipe, StudioDiagnostics, StudioSettings, VllmUpgradeResult } from "@/lib/types";
import { useDownloads } from "@/hooks/use-downloads";

const normalizeId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export function useSetup() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [modelsDir, setModelsDir] = useState("");
  const [diagnostics, setDiagnostics] = useState<StudioDiagnostics | null>(null);
  const [recommendations, setRecommendations] = useState<ModelRecommendation[]>([]);
  const [maxVram, setMaxVram] = useState(0);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [manualModelId, setManualModelId] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeResult, setUpgradeResult] = useState<VllmUpgradeResult | null>(null);

  const downloadsState = useDownloads(2000);

  const activeDownload = useMemo(() => {
    if (!selectedModel) return null;
    return downloadsState.downloads.find((download) => download.model_id === selectedModel) ?? null;
  }, [downloadsState.downloads, selectedModel]);

  const loadSetupData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [settingsRes, diagnosticsRes, recommendationsRes] = await Promise.all([
        api.getStudioSettings(),
        api.getStudioDiagnostics(),
        api.getModelRecommendations(),
      ]);
      setSettings(settingsRes);
      setModelsDir(settingsRes.effective.models_dir);
      setDiagnostics(diagnosticsRes);
      setRecommendations(recommendationsRes.recommendations || []);
      setMaxVram(recommendationsRes.max_vram_gb ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load setup data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSetupData();
  }, [loadSetupData]);

  const saveSettings = useCallback(async () => {
    if (!modelsDir.trim()) {
      setError("Models directory is required.");
      return;
    }
    setSavingSettings(true);
    try {
      const result = await api.updateStudioSettings(modelsDir.trim());
      setSettings(result);
      setModelsDir(result.effective.models_dir);
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setSavingSettings(false);
    }
  }, [modelsDir]);

  const upgradeRuntime = useCallback(async () => {
    setUpgrading(true);
    setUpgradeResult(null);
    try {
      const result = await api.upgradeVllmRuntime({ preferBundled: true });
      setUpgradeResult(result);
      const refreshed = await api.getStudioDiagnostics();
      setDiagnostics(refreshed);
    } catch (err) {
      setUpgradeResult({
        success: false,
        version: null,
        output: null,
        error: err instanceof Error ? err.message : "Upgrade failed",
        used_wheel: null,
        used_command: null,
      });
    } finally {
      setUpgrading(false);
    }
  }, []);

  const beginDownload = useCallback(
    async (modelId: string) => {
      if (!modelId) return;
      setSelectedModel(modelId);
      try {
        await downloadsState.startDownload({ model_id: modelId });
        setStep(3);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start download");
      }
    },
    [downloadsState, setError],
  );

  const submitManualModel = useCallback(async () => {
    const trimmed = manualModelId.trim();
    if (!trimmed) return;
    await beginDownload(trimmed);
  }, [manualModelId, beginDownload]);

  const createRecipeAndFinish = useCallback(async () => {
    if (!activeDownload || activeDownload.status !== "completed") {
      return;
    }
    const recipeBase = normalizeId(activeDownload.model_id.split("/").pop() ?? activeDownload.model_id);
    const existing = await api.getRecipes().catch(() => ({ recipes: [] }));
    const existingIds = new Set(existing.recipes.map((recipe) => recipe.id));
    let recipeId = recipeBase || `model-${Date.now()}`;
    let suffix = 1;
    while (existingIds.has(recipeId)) {
      recipeId = `${recipeBase}-${suffix}`;
      suffix += 1;
    }
    const recipe: Recipe = {
      id: recipeId,
      name: activeDownload.model_id,
      model_path: activeDownload.target_dir,
      backend: "vllm",
      served_model_name: activeDownload.model_id,
      trust_remote_code: true,
      max_model_len: 32768,
      gpu_memory_utilization: 0.9,
      tensor_parallel_size: 1,
      pipeline_parallel_size: 1,
      max_num_seqs: 256,
      kv_cache_dtype: "auto",
      extra_args: {},
    };
    await api.createRecipe(recipe);
    localStorage.setItem("vllm-studio-setup-complete", "true");
    router.push("/chat?new=1");
  }, [activeDownload, router]);

  const skipSetup = useCallback(() => {
    localStorage.setItem("vllm-studio-setup-complete", "true");
    router.push("/");
  }, [router]);

  return {
    step,
    setStep,
    loading,
    error,
    settings,
    modelsDir,
    setModelsDir,
    diagnostics,
    recommendations,
    maxVram,
    selectedModel,
    manualModelId,
    setManualModelId,
    savingSettings,
    upgrading,
    upgradeResult,
    downloads: downloadsState.downloads,
    activeDownload,
    pauseDownload: downloadsState.pauseDownload,
    resumeDownload: downloadsState.resumeDownload,
    cancelDownload: downloadsState.cancelDownload,
    saveSettings,
    upgradeRuntime,
    beginDownload,
    submitManualModel,
    createRecipeAndFinish,
    skipSetup,
  };
}
