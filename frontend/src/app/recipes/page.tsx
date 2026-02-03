// CRITICAL
"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpCircle,
  Brain,
  Calculator,
  ChevronDown,
  Clock,
  Code,
  Cpu,
  Database,
  Eye,
  GitBranch,
  Info,
  Layers,
  MessageSquare,
  MoreVertical,
  Package,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  Sparkles,
  Square,
  Terminal,
  Variable,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import api from "@/lib/api";
import type {
  ModelInfo,
  Recipe,
  RecipeWithStatus,
  VRAMCalculation,
  VllmRuntimeConfig,
  VllmRuntimeInfo,
  VllmUpgradeResult,
} from "@/lib/types";
import { useRealtimeStatus } from "@/hooks/use-realtime-status";
import {
  filterExtraArgsForEditor,
  mergeExtraArgsFromEditor,
  normalizeRecipeForEditor,
  prepareRecipeForSave,
} from "./recipe-utils";
import { LLAMACPP_OPTIONS } from "./llamacpp-options";

type Tab = "recipes" | "tools" | "runtime";

const DEFAULT_RECIPE: Recipe = {
  id: "",
  name: "",
  model_path: "",
  backend: "vllm",
  tp: 1,
  pp: 1,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  port: 8000,
  host: "0.0.0.0",
  gpu_memory_utilization: 0.9,
  max_model_len: 32768,
  max_num_seqs: 256,
  kv_cache_dtype: "auto",
  trust_remote_code: true,
  extra_args: {},
};

const BACKEND_LABELS: Record<string, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  llamacpp: "llama.cpp",
  transformers: "Transformers",
  tabbyapi: "TabbyAPI",
};

const formatBackendLabel = (backend?: string | null): string => {
  if (!backend) return BACKEND_LABELS.vllm;
  return BACKEND_LABELS[backend] ?? backend;
};

function RecipesContent() {
  const [tab, setTab] = useState<Tab>("recipes");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [filter, setFilter] = useState("");
  const [pinnedRecipes, setPinnedRecipes] = useState<Set<string>>(new Set());
  const [recipeMenuOpen, setRecipeMenuOpen] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [runningRecipeId, setRunningRecipeId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRecipe, setModalRecipe] = useState<Recipe | null>(null);
  const [saving, setSaving] = useState(false);

  // VRAM calculator state
  const [vramModel, setVramModel] = useState("");
  const [contextLength, setContextLength] = useState(32768);
  const [tpSize, setTpSize] = useState(8);
  const [kvDtype, setKvDtype] = useState<"auto" | "fp16" | "fp8">("auto");
  const [vramResult, setVramResult] = useState<VRAMCalculation | null>(null);
  const [calculating, setCalculating] = useState(false);

  // Available models for selection
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);

  // vLLM runtime state
  const [runtimeInfo, setRuntimeInfo] = useState<VllmRuntimeInfo | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<VllmRuntimeConfig | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeConfigLoading, setRuntimeConfigLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [upgradeResult, setUpgradeResult] = useState<VllmUpgradeResult | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  const { launchProgress } = useRealtimeStatus();

  // Load pinned recipes from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vllm-studio-pinned-recipes");
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
      localStorage.setItem("vllm-studio-pinned-recipes", JSON.stringify([...next]));
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

      // Store available models for selection dropdown
      setAvailableModels(modelsData.models || []);
    } catch (e) {
      console.error("Failed to load recipes:", e);
    }
  }, []);

  const loadRuntime = useCallback(async () => {
    setRuntimeLoading(true);
    setRuntimeError(null);
    try {
      const info = await api.getVllmRuntime();
      setRuntimeInfo(info);
    } catch (e) {
      setRuntimeError((e as Error).message);
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  const loadRuntimeConfig = useCallback(async () => {
    setRuntimeConfigLoading(true);
    try {
      const config = await api.getVllmRuntimeConfig();
      setRuntimeConfig(config);
    } catch (e) {
      setRuntimeConfig({ config: null, error: (e as Error).message });
    } finally {
      setRuntimeConfigLoading(false);
    }
  }, []);

  const handleUpgradeVllm = async () => {
    setUpgrading(true);
    setUpgradeResult(null);
    try {
      const result = await api.upgradeVllmRuntime(true);
      setUpgradeResult(result);
      await loadRuntime();
      await loadRuntimeConfig();
    } catch (e) {
      setUpgradeResult({
        success: false,
        version: null,
        output: null,
        error: (e as Error).message,
        used_wheel: null,
      });
    } finally {
      setUpgrading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await loadRecipes();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadRecipes]);

  useEffect(() => {
    if (tab === "runtime") {
      loadRuntime();
      loadRuntimeConfig();
    }
  }, [tab, loadRuntime, loadRuntimeConfig]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadRecipes();
    setRefreshing(false);
  };

  const handleNewRecipe = () => {
    setModalRecipe(normalizeRecipeForEditor({ ...DEFAULT_RECIPE }));
    setModalOpen(true);
  };

  const handleEditRecipe = (recipe: RecipeWithStatus) => {
    setModalRecipe(normalizeRecipeForEditor(recipe));
    setModalOpen(true);
    setRecipeMenuOpen(null);
  };

  const handleSaveRecipe = async () => {
    if (!modalRecipe) return;

    const recipeToSave = prepareRecipeForSave(modalRecipe);

    setSaving(true);
    try {
      if (recipeToSave.id) {
        await api.updateRecipe(recipeToSave.id, recipeToSave);
      } else {
        // Generate ID from name
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
  };

  const handleDeleteRecipe = async (recipeId: string) => {
    try {
      await api.deleteRecipe(recipeId);
      await loadRecipes();
      setDeleteConfirm(null);
      setRecipeMenuOpen(null);
    } catch (e) {
      alert("Failed to delete: " + (e as Error).message);
    }
  };

  const handleLaunchRecipe = async (recipeId: string) => {
    setLaunching(true);
    try {
      // Fire and forget - don't block on model loading
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s max wait

      try {
        await fetch(`/api/proxy/launch/${recipeId}`, {
          method: "POST",
          signal: controller.signal,
        });
      } catch {
        // Timeout or abort is fine - launch continues in background
      } finally {
        clearTimeout(timeoutId);
      }

      // Brief wait then refresh to show "starting" status
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await loadRecipes();
    } catch (e) {
      alert("Failed to launch: " + (e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const handleEvictModel = async () => {
    try {
      await api.evictModel();
      await loadRecipes();
    } catch (e) {
      alert("Failed to evict: " + (e as Error).message);
    }
  };

  const calculateVRAM = async () => {
    if (!vramModel.trim()) return;
    setCalculating(true);
    try {
      const result = await api.calculateVRAM({
        model: vramModel,
        context_length: contextLength,
        tp_size: tpSize,
        kv_dtype: kvDtype,
      });
      setVramResult(result);
    } catch (e) {
      alert("Failed to calculate: " + (e as Error).message);
    } finally {
      setCalculating(false);
    }
  };

  // Build a lookup: model_path -> served_model_name (from first recipe that uses it)
  const modelServedNames = useMemo(() => {
    const lookup: Record<string, string> = {};
    for (const r of recipes) {
      if (r.model_path && r.served_model_name && !lookup[r.model_path]) {
        lookup[r.model_path] = r.served_model_name;
      }
    }
    return lookup;
  }, [recipes]);

  // Filter recipes
  const filteredRecipes = recipes.filter(
    (r) =>
      r.name.toLowerCase().includes(filter.toLowerCase()) ||
      r.model_path.toLowerCase().includes(filter.toLowerCase()),
  );

  // Sort: pinned first, then alphabetical
  const sortedRecipes = [...filteredRecipes].sort((a, b) => {
    const aPinned = pinnedRecipes.has(a.id);
    const bPinned = pinnedRecipes.has(b.id);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d] text-[#e8e6e3]">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-[#1f1f1f]"
        style={{
          paddingLeft: "1.5rem",
          paddingRight: "1.5rem",
          paddingTop: "1rem",
          paddingBottom: "1rem",
        }}
      >
        <h1 className="text-xl font-semibold">Recipes</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 hover:bg-[#1f1f1f] rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 border-b border-[#1f1f1f]"
        style={{ paddingLeft: "1.5rem", paddingRight: "1.5rem", paddingTop: "1rem" }}
      >
        <button
          onClick={() => setTab("recipes")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            tab === "recipes"
              ? "text-[#e8e6e3] border-[#d97706]"
              : "text-[#9a9088] border-transparent hover:text-[#e8e6e3]"
          }`}
        >
          Recipes
        </button>
        <button
          onClick={() => setTab("tools")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            tab === "tools"
              ? "text-[#e8e6e3] border-[#d97706]"
              : "text-[#9a9088] border-transparent hover:text-[#e8e6e3]"
          }`}
        >
          <Calculator className="w-4 h-4 inline mr-2" />
          VRAM Calculator
        </button>
        <button
          onClick={() => setTab("runtime")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            tab === "runtime"
              ? "text-[#e8e6e3] border-[#d97706]"
              : "text-[#9a9088] border-transparent hover:text-[#e8e6e3]"
          }`}
        >
          <Package className="w-4 h-4 inline mr-2" />
          vLLM Runtime
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === "recipes" && (
          <div style={{ padding: "1.5rem" }}>
            {/* Toolbar */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9a9088]" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search recipes..."
                  className="w-full pl-10 pr-4 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                />
              </div>
              <button
                onClick={handleNewRecipe}
                className="flex items-center gap-2 px-4 py-2 bg-[#d97706] hover:bg-[#b45309] text-white rounded-lg transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                New Recipe
              </button>
            </div>

            {/* Running status banner */}
            {runningRecipeId && (
              <div className="mb-4 p-4 bg-[#15803d]/10 border border-[#15803d]/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-[#4ade80]">
                      Model Running: {recipes.find((r) => r.id === runningRecipeId)?.name}
                    </div>
                    {launchProgress?.message && (
                      <div className="text-xs text-[#9a9088] mt-1">{launchProgress.message}</div>
                    )}
                  </div>
                  <button
                    onClick={handleEvictModel}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white rounded text-xs font-medium"
                  >
                    <Square className="w-3 h-3" />
                    Stop
                  </button>
                </div>
              </div>
            )}

            {/* Table */}
            {loading ? (
              <div className="text-center py-12 text-[#9a9088]">Loading recipes...</div>
            ) : sortedRecipes.length === 0 ? (
              <div className="text-center py-12 text-[#9a9088]">
                {filter
                  ? "No recipes match your search"
                  : "No recipes yet. Create one to get started."}
              </div>
            ) : (
              <div className="border border-[#363432] rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-[#1b1b1b] border-b border-[#363432]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider w-8"></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider">
                        Model
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider">
                        Backend
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider">
                        TP/PP
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[#9a9088] uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#363432]">
                    {sortedRecipes.map((recipe) => (
                      <tr key={recipe.id} className="hover:bg-[#1b1b1b]/50 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => togglePin(recipe.id)}
                            className="text-[#9a9088] hover:text-[#d97706] transition-colors"
                          >
                            {pinnedRecipes.has(recipe.id) ? (
                              <Pin className="w-4 h-4 fill-current" />
                            ) : (
                              <PinOff className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium text-sm">{recipe.name}</td>
                        <td className="px-4 py-3 text-sm text-[#9a9088] font-mono truncate max-w-xs" title={recipe.model_path}>
                          {recipe.served_model_name || recipe.model_path.split("/").pop()}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="px-2 py-1 bg-[#1b1b1b] border border-[#363432] rounded text-xs">
                            {formatBackendLabel(recipe.backend)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-[#9a9088]">
                          {recipe.tp || recipe.tensor_parallel_size || 1}/
                          {recipe.pp || recipe.pipeline_parallel_size || 1}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                              recipe.status === "running"
                                ? "bg-[#15803d]/20 text-[#4ade80] border border-[#15803d]/30"
                                : recipe.status === "starting"
                                  ? "bg-[#d97706]/20 text-[#fbbf24] border border-[#d97706]/30"
                                  : "bg-[#363432]/20 text-[#9a9088] border border-[#363432]"
                            }`}
                          >
                            {recipe.status || "stopped"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {recipe.status === "running" ? (
                              <button
                                onClick={handleEvictModel}
                                className="p-1.5 hover:bg-[#dc2626]/20 text-[#dc2626] rounded transition-colors"
                                title="Stop"
                              >
                                <Square className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleLaunchRecipe(recipe.id)}
                                disabled={launching || !!runningRecipeId}
                                className="p-1.5 hover:bg-[#15803d]/20 text-[#4ade80] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Launch"
                              >
                                <Play className="w-4 h-4" />
                              </button>
                            )}
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRecipeMenuOpen(
                                    recipeMenuOpen === recipe.id ? null : recipe.id,
                                  );
                                }}
                                className="p-1.5 hover:bg-[#1f1f1f] rounded transition-colors"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                              {recipeMenuOpen === recipe.id && (
                                <div className="absolute right-0 mt-1 w-32 bg-[#1b1b1b] border border-[#363432] rounded-lg shadow-lg z-10">
                                  <button
                                    onClick={() => handleEditRecipe(recipe)}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-[#363432] transition-colors"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => {
                                      setDeleteConfirm(recipe.id);
                                      setRecipeMenuOpen(null);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-[#dc2626] hover:bg-[#363432] transition-colors"
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "tools" && (
          <div style={{ padding: "1.5rem" }} className="max-w-2xl">
            <h2 className="text-lg font-semibold mb-4">VRAM Calculator</h2>
            <div className="space-y-4 bg-[#1b1b1b] border border-[#363432] rounded-lg p-6">
              <div>
                <label className="block text-sm text-[#9a9088] mb-2">Model</label>
                <select
                  value={vramModel}
                  onChange={(e) => setVramModel(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                >
                  <option value="">Select a model...</option>
                  {availableModels.map((model) => {
                    const servedName = modelServedNames[model.path];
                    return (
                      <option key={model.path} value={model.path}>
                        {servedName ? `${servedName} (${model.name})` : model.name}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-[#9a9088] mb-2">Context Length</label>
                  <input
                    type="number"
                    value={contextLength}
                    onChange={(e) => setContextLength(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#9a9088] mb-2">TP Size</label>
                  <input
                    type="number"
                    value={tpSize}
                    onChange={(e) => setTpSize(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#9a9088] mb-2">KV Dtype</label>
                  <select
                    value={kvDtype}
                    onChange={(e) => setKvDtype(e.target.value as "auto" | "fp16" | "fp8")}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  >
                    <option value="auto">Auto</option>
                    <option value="fp16">FP16</option>
                    <option value="fp8">FP8</option>
                  </select>
                </div>
              </div>
              <button
                onClick={calculateVRAM}
                disabled={calculating || !vramModel.trim()}
                className="w-full py-2 bg-[#d97706] hover:bg-[#b45309] text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {calculating ? "Calculating..." : "Calculate VRAM"}
              </button>

              {vramResult && (
                <div className="mt-6 space-y-3 pt-6 border-t border-[#363432]">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9a9088]">Model Size</span>
                    <span className="font-medium">
                      {vramResult.breakdown.model_weights_gb.toFixed(2)} GB
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9a9088]">KV Cache</span>
                    <span className="font-medium">
                      {vramResult.breakdown.kv_cache_gb.toFixed(2)} GB
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9a9088]">Activations</span>
                    <span className="font-medium">
                      {vramResult.breakdown.activations_gb.toFixed(2)} GB
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9a9088]">Per GPU</span>
                    <span className="font-medium">
                      {vramResult.breakdown.per_gpu_gb.toFixed(2)} GB
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold pt-3 border-t border-[#363432]">
                    <span>Total VRAM</span>
                    <span className={vramResult.fits ? "text-[#4ade80]" : "text-[#dc2626]"}>
                      {vramResult.breakdown.total_gb.toFixed(2)} GB
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9a9088]">Utilization</span>
                    <span className="font-medium">
                      {vramResult.utilization_percent.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "runtime" && (
          <div style={{ padding: "1.5rem" }} className="space-y-6 max-w-3xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">vLLM Runtime</h2>
                <p className="text-sm text-[#9a9088]">
                  Manage the bundled vLLM wheel and inspect available CLI configuration.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    loadRuntime();
                    loadRuntimeConfig();
                  }}
                  disabled={runtimeLoading || runtimeConfigLoading}
                  className="flex items-center gap-2 px-3 py-2 bg-[#1b1b1b] hover:bg-[#2a2724] border border-[#363432] rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${runtimeLoading || runtimeConfigLoading ? "animate-spin" : ""}`}
                  />
                  Refresh
                </button>
                <button
                  onClick={handleUpgradeVllm}
                  disabled={upgrading}
                  className="flex items-center gap-2 px-3 py-2 bg-[#d97706] hover:bg-[#b45309] text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  {upgrading ? "Upgrading..." : "Upgrade"}
                </button>
              </div>
            </div>

            {runtimeError && (
              <div className="p-4 bg-[#dc2626]/10 border border-[#dc2626]/30 rounded-lg text-sm text-[#fca5a5]">
                {runtimeError}
              </div>
            )}

            {runtimeLoading && !runtimeInfo ? (
              <div className="text-sm text-[#9a9088]">Loading runtime details...</div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#1b1b1b] border border-[#363432] rounded-lg p-4">
                  <div className="text-xs uppercase tracking-wider text-[#6a6560] font-medium">
                    Installed Version
                  </div>
                  <div className="mt-2 text-lg font-semibold">
                    {runtimeInfo?.version ?? "Not installed"}
                  </div>
                </div>
                <div className="bg-[#1b1b1b] border border-[#363432] rounded-lg p-4">
                  <div className="text-xs uppercase tracking-wider text-[#6a6560] font-medium">
                    Bundled Wheel
                  </div>
                  <div className="mt-2 text-sm text-[#e8e6e3] break-all">
                    {runtimeInfo?.bundled_wheel?.version
                      ? `${runtimeInfo.bundled_wheel.version} (${runtimeInfo.bundled_wheel.path})`
                      : "No bundled wheel found"}
                  </div>
                </div>
                <div className="bg-[#1b1b1b] border border-[#363432] rounded-lg p-4">
                  <div className="text-xs uppercase tracking-wider text-[#6a6560] font-medium">
                    Python Runtime
                  </div>
                  <div className="mt-2 text-sm text-[#e8e6e3] break-all">
                    {runtimeInfo?.python_path ?? "Not detected"}
                  </div>
                </div>
                <div className="bg-[#1b1b1b] border border-[#363432] rounded-lg p-4">
                  <div className="text-xs uppercase tracking-wider text-[#6a6560] font-medium">
                    vLLM Binary
                  </div>
                  <div className="mt-2 text-sm text-[#e8e6e3] break-all">
                    {runtimeInfo?.vllm_bin ?? "Not detected"}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-[#1b1b1b] border border-[#363432] rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">vLLM CLI Config (vllm serve --help)</h3>
                <button
                  onClick={loadRuntimeConfig}
                  disabled={runtimeConfigLoading}
                  className="px-3 py-1.5 bg-[#363432] hover:bg-[#494745] rounded-lg text-xs transition-colors disabled:opacity-50"
                >
                  {runtimeConfigLoading ? "Loading..." : "Refresh"}
                </button>
              </div>
              {runtimeConfig?.error && (
                <div className="text-xs text-[#fca5a5]">{runtimeConfig.error}</div>
              )}
              <pre className="max-h-72 overflow-auto text-xs text-[#e8e6e3] whitespace-pre-wrap">
                {runtimeConfig?.config || "No config available."}
              </pre>
            </div>

            {upgradeResult && (
              <div
                className={`p-4 border rounded-lg text-sm ${
                  upgradeResult.success
                    ? "bg-[#15803d]/10 border-[#15803d]/30 text-[#4ade80]"
                    : "bg-[#dc2626]/10 border-[#dc2626]/30 text-[#fca5a5]"
                }`}
              >
                <div className="font-medium">
                  {upgradeResult.success ? "Upgrade complete" : "Upgrade failed"}
                  {upgradeResult.version ? ` (vLLM ${upgradeResult.version})` : ""}
                </div>
                {upgradeResult.used_wheel && (
                  <div className="text-xs mt-1">Wheel: {upgradeResult.used_wheel}</div>
                )}
                {upgradeResult.error && (
                  <div className="text-xs mt-2 whitespace-pre-wrap text-[#fca5a5]">
                    {upgradeResult.error}
                  </div>
                )}
                {upgradeResult.output && (
                  <pre className="text-xs mt-2 whitespace-pre-wrap text-[#e8e6e3]">
                    {upgradeResult.output}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1b1b1b] border border-[#363432] rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Delete Recipe</h3>
            <p className="text-sm text-[#9a9088] mb-6">
              Are you sure you want to delete &quot;
              {recipes.find((r) => r.id === deleteConfirm)?.name}&quot;?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 bg-[#363432] hover:bg-[#494745] rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteRecipe(deleteConfirm)}
                className="px-4 py-2 bg-[#dc2626] hover:bg-[#b91c1c] text-white rounded-lg text-sm transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Recipe Modal */}
      {modalOpen && modalRecipe && (
        <RecipeModal
          recipe={modalRecipe}
          onClose={() => {
            setModalOpen(false);
            setModalRecipe(null);
          }}
          onSave={handleSaveRecipe}
          onChange={setModalRecipe}
          saving={saving}
          availableModels={availableModels}
          recipes={recipes}
        />
      )}
    </div>
  );
}

const appendExtraArgsToCommand = (
  args: string[],
  extraArgs: Record<string, unknown>,
): string[] => {
  const internalKeys = new Set(["venv_path", "env_vars", "cuda_visible_devices", "description", "tags", "status"]);
  const jsonStringKeys = new Set(["speculative_config", "default_chat_template_kwargs"]);
  const existingFlags = new Set(
    args.flatMap((line) => line.split(" ").filter((part) => part.startsWith("--"))),
  );

  for (const [key, value] of Object.entries(extraArgs)) {
    const normalizedKey = key.replace(/-/g, "_").toLowerCase();
    if (internalKeys.has(normalizedKey)) {
      continue;
    }
    const flag = `--${key.replace(/_/g, "-")}`;
    if (existingFlags.has(flag)) {
      continue;
    }
    if (value === true || value === false) {
      args.push(flag);
      existingFlags.add(flag);
      continue;
    }
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (typeof value === "string" && jsonStringKeys.has(normalizedKey)) {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          args.push(`${flag} '${JSON.stringify(parsed)}'`);
          existingFlags.add(flag);
          continue;
        } catch {
          args.push(`${flag} '${value}'`);
          existingFlags.add(flag);
          continue;
        }
      }
    }

    if (Array.isArray(value) || (value && typeof value === "object")) {
      args.push(`${flag} '${JSON.stringify(value)}'`);
      existingFlags.add(flag);
      continue;
    }
    args.push(`${flag} ${value}`);
    existingFlags.add(flag);
  }
  return args;
};

const appendLlamacppArgsToCommand = (
  args: string[],
  extraArgs: Record<string, unknown>,
): string[] => {
  const internalKeys = new Set(["venv_path", "env_vars", "cuda_visible_devices", "description", "tags", "status"]);

  for (const [key, value] of Object.entries(extraArgs)) {
    const normalizedKey = key.replace(/-/g, "_").toLowerCase();
    if (internalKeys.has(normalizedKey)) {
      continue;
    }
    const flag = `--${key.replace(/_/g, "-")}`;
    if (args.some((entry) => entry.startsWith(flag))) {
      continue;
    }
    if (value === true) {
      args.push(flag);
      continue;
    }
    if (value === false) {
      continue;
    }
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null || entry === "") {
          continue;
        }
        args.push(`${flag} ${entry}`);
      }
      continue;
    }
    if (typeof value === "object") {
      args.push(`${flag} '${JSON.stringify(value)}'`);
      continue;
    }
    args.push(`${flag} ${value}`);
  }
  return args;
};

// Generate command from recipe
function generateCommand(recipe: Recipe): string {
  const payload = prepareRecipeForSave(recipe);
  const backend = payload.backend || "vllm";
  const args: string[] = [];

  // Base command
  if (backend === "vllm") {
    args.push("vllm serve");
  } else if (backend === "llamacpp") {
    args.push("llama-server");
  } else {
    args.push("python -m sglang.launch_server");
  }

  // Model path (required)
  if (payload.model_path) {
    if (backend === "llamacpp") {
      args.push(`--model ${payload.model_path}`);
    } else {
      args.push(payload.model_path);
    }
  }

  // Server settings
  if (payload.host && payload.host !== "0.0.0.0") args.push(`--host ${payload.host}`);
  if (payload.port && payload.port !== 8000) args.push(`--port ${payload.port}`);
  if (payload.served_model_name) {
    args.push(
      backend === "llamacpp"
        ? `--alias ${payload.served_model_name}`
        : `--served-model-name ${payload.served_model_name}`,
    );
  }

  // Parallelism
  if (backend !== "llamacpp") {
    if (payload.tensor_parallel_size && payload.tensor_parallel_size > 1) {
      args.push(`--tensor-parallel-size ${payload.tensor_parallel_size}`);
    }
    if (payload.pipeline_parallel_size && payload.pipeline_parallel_size > 1) {
      args.push(`--pipeline-parallel-size ${payload.pipeline_parallel_size}`);
    }
  }

  // Memory / context
  const ctxOverride = payload.extra_args?.["ctx-size"] ?? payload.extra_args?.["ctx_size"];
  if (backend === "llamacpp") {
    if (!ctxOverride && payload.max_model_len) args.push(`--ctx-size ${payload.max_model_len}`);
  } else {
    if (payload.max_model_len) args.push(`--max-model-len ${payload.max_model_len}`);
    if (payload.max_num_seqs) args.push(`--max-num-seqs ${payload.max_num_seqs}`);
    if (payload.gpu_memory_utilization !== undefined && payload.gpu_memory_utilization !== null) {
      args.push(`--gpu-memory-utilization ${payload.gpu_memory_utilization}`);
    }
    if (payload.kv_cache_dtype && payload.kv_cache_dtype !== "auto") {
      args.push(`--kv-cache-dtype ${payload.kv_cache_dtype}`);
    }
  }

  if (backend !== "llamacpp") {
    // Quantization
    if (payload.quantization) args.push(`--quantization ${payload.quantization}`);
    if (payload.dtype && payload.dtype !== "auto") args.push(`--dtype ${payload.dtype}`);

    // Flags
    if (payload.trust_remote_code) args.push("--trust-remote-code");

    // Tool calling
    if (payload.tool_call_parser) {
      args.push(`--tool-call-parser ${payload.tool_call_parser}`);
      args.push("--enable-auto-tool-choice");
    } else if (payload.enable_auto_tool_choice) {
      args.push("--enable-auto-tool-choice");
    }

    // Reasoning
    if (payload.reasoning_parser) args.push(`--reasoning-parser ${payload.reasoning_parser}`);

    appendExtraArgsToCommand(args, payload.extra_args ?? {});
  } else {
    appendLlamacppArgsToCommand(args, payload.extra_args ?? {});
  }

  return args.join(" \\\n  ");
}

// Recipe Drawer Component (right-side panel)
function RecipeModal({
  recipe,
  onClose,
  onSave,
  onChange,
  saving,
  availableModels,
  recipes,
}: {
  recipe: Recipe;
  onClose: () => void;
  onSave: () => void;
  onChange: (recipe: Recipe) => void;
  saving: boolean;
  availableModels: ModelInfo[];
  recipes: RecipeWithStatus[];
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mode, setMode] = useState<"form" | "command">("form");
  const [editedCommand, setEditedCommand] = useState<string | null>(null);
  const [extraArgsText, setExtraArgsText] = useState(() =>
    JSON.stringify(filterExtraArgsForEditor(recipe.extra_args ?? {}), null, 2),
  );
  const [extraArgsError, setExtraArgsError] = useState<string | null>(null);
  const [envVarEntries, setEnvVarEntries] = useState(() => {
    const entries = Object.entries(recipe.env_vars ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
    }));
    return entries.length ? entries : [{ key: "", value: "" }];
  });
  const [llamaConfigHelp, setLlamaConfigHelp] = useState<{ config: string | null; error?: string | null } | null>(
    null,
  );
  const backend = recipe.backend ?? "vllm";
  const isLlamacpp = backend === "llamacpp";
  const llamaConfigLoading = isLlamacpp && !llamaConfigHelp;

  useEffect(() => {
    if (!isLlamacpp) {
      return;
    }
    if (llamaConfigHelp) {
      return;
    }
    let cancelled = false;
    api.getLlamacppRuntimeConfig()
      .then((result) => {
        if (!cancelled) {
          setLlamaConfigHelp(result);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLlamaConfigHelp({ config: null, error: (error as Error).message });
        }
      })
    return () => {
      cancelled = true;
    };
  }, [isLlamacpp, llamaConfigHelp]);

  const getExtraArgValueForKey = (key: string): unknown => {
    const extraArgs = recipe.extra_args ?? {};
    const candidates = new Set<string>();
    candidates.add(key);
    candidates.add(key.replace(/-/g, "_"));
    candidates.add(key.replace(/_/g, "-"));
    for (const candidate of candidates) {
      if (Object.prototype.hasOwnProperty.call(extraArgs, candidate)) {
        return extraArgs[candidate];
      }
    }
    return undefined;
  };

  const setExtraArgValueForKey = (key: string, value: unknown) => {
    const extraArgs = { ...(recipe.extra_args ?? {}) } as Record<string, unknown>;
    const candidates = new Set<string>();
    candidates.add(key);
    candidates.add(key.replace(/-/g, "_"));
    candidates.add(key.replace(/_/g, "-"));
    for (const candidate of candidates) {
      delete extraArgs[candidate];
    }
    if (value !== undefined && value !== null && value !== "") {
      extraArgs[key] = value;
    }
    onChange({ ...recipe, extra_args: extraArgs });
  };

  const coerceBooleanValue = (value: unknown): boolean => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.toLowerCase().trim();
      if (["true", "1", "yes", "y"].includes(normalized)) return true;
      if (["false", "0", "no", "n"].includes(normalized)) return false;
    }
    return false;
  };

  const renderLlamacppOptions = (tab: "model" | "resources" | "performance" | "features") => {
    const options = LLAMACPP_OPTIONS.filter((option) => option.tab === tab);
    if (options.length === 0) {
      return null;
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
          <Settings className="w-4 h-4 text-[#d97706]" />
          <span className="text-sm font-medium">llama.cpp Options</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {options.map((option) => {
            const value = getExtraArgValueForKey(option.key);
            const wide = option.type === "text" && /prompt|template|grammar|control|model/.test(option.key);
            if (option.type === "boolean") {
              return (
                <label
                  key={option.key}
                  className={`flex items-center gap-2 px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-xs text-[#9a9088] ${
                    wide ? "col-span-2" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={coerceBooleanValue(value)}
                    onChange={(e) => setExtraArgValueForKey(option.key, e.target.checked ? true : undefined)}
                    className="accent-[#d97706]"
                  />
                  {option.label}
                </label>
              );
            }
            if (option.type === "select") {
              return (
                <div key={option.key} className={wide ? "col-span-2" : ""}>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">{option.label}</label>
                  <select
                    value={value ? String(value) : ""}
                    onChange={(e) => setExtraArgValueForKey(option.key, e.target.value || undefined)}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  >
                    <option value="">Default</option>
                    {option.options?.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            const inputType = option.type === "number" ? "number" : "text";
            return (
              <div key={option.key} className={wide ? "col-span-2" : ""}>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">{option.label}</label>
                <input
                  type={inputType}
                  value={value !== undefined && value !== null ? String(value) : ""}
                  onChange={(e) =>
                    setExtraArgValueForKey(
                      option.key,
                      inputType === "number" ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value,
                    )
                  }
                  placeholder={option.placeholder}
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                />
              </div>
            );
          })}
        </div>
        <p className="text-xs text-[#6a6560]">
          All llama.cpp flags are supported via Extra CLI Arguments. These fields cover the most-used options.
        </p>
      </div>
    );
  };

  // Build a lookup: model_path -> served_model_name (from first recipe that uses it)
  const modelServedNames = useMemo(() => {
    const lookup: Record<string, string> = {};
    for (const r of recipes) {
      if (r.model_path && r.served_model_name && !lookup[r.model_path]) {
        lookup[r.model_path] = r.served_model_name;
      }
    }
    return lookup;
  }, [recipes]);

  // Generated command from recipe (always up to date)
  const generatedCommand = useMemo(() => generateCommand(recipe), [recipe]);

  // Show edited command if user has modified it, otherwise show generated
  const commandText = editedCommand ?? generatedCommand;

  const handleCommandChange = (value: string) => {
    setEditedCommand(value);
  };

  const handleExtraArgsChange = (value: string) => {
    setExtraArgsText(value);
    if (!value.trim()) {
      const merged = mergeExtraArgsFromEditor(recipe.extra_args ?? {}, {});
      onChange({ ...recipe, extra_args: merged });
      setExtraArgsError(null);
      return;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setExtraArgsError("Extra args must be a JSON object.");
        return;
      }
      const merged = mergeExtraArgsFromEditor(recipe.extra_args ?? {}, parsed as Record<string, unknown>);
      onChange({ ...recipe, extra_args: merged });
      setExtraArgsError(null);
    } catch {
      setExtraArgsError("Extra args must be valid JSON.");
    }
  };

  const updateEnvVarEntries = (nextEntries: Array<{ key: string; value: string }>) => {
    setEnvVarEntries(nextEntries);
    const envVars = nextEntries.reduce<Record<string, string>>((acc, entry) => {
      const key = entry.key.trim();
      if (key) {
        acc[key] = entry.value;
      }
      return acc;
    }, {});
    onChange({ ...recipe, env_vars: Object.keys(envVars).length ? envVars : undefined });
  };

  const handleEnvVarChange = (index: number, field: "key" | "value", value: string) => {
    const next = envVarEntries.map((entry, idx) =>
      idx === index ? { ...entry, [field]: value } : entry,
    );
    updateEnvVarEntries(next);
  };

  const handleAddEnvVar = () => {
    updateEnvVarEntries([...envVarEntries, { key: "", value: "" }]);
  };

  const handleRemoveEnvVar = (index: number) => {
    const next = envVarEntries.filter((_, idx) => idx !== index);
    updateEnvVarEntries(next.length ? next : [{ key: "", value: "" }]);
  };

  const handleModeSwitch = (newMode: "form" | "command") => {
    if (newMode === "form") {
      // Reset edits when switching back to form
      setEditedCommand(null);
    }
    setMode(newMode);
  };

  type TabId = "general" | "model" | "resources" | "performance" | "features" | "environment" | "command";
  const [activeTab, setActiveTab] = useState<TabId>("general");

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: "General", icon: <Settings className="w-4 h-4" /> },
    { id: "model", label: "Model", icon: <Layers className="w-4 h-4" /> },
    { id: "resources", label: "Resources", icon: <Cpu className="w-4 h-4" /> },
    { id: "performance", label: "Performance", icon: <Zap className="w-4 h-4" /> },
    { id: "features", label: "Features", icon: <Sparkles className="w-4 h-4" /> },
    { id: "environment", label: "Environment", icon: <Terminal className="w-4 h-4" /> },
    { id: "command", label: "Command", icon: <Code className="w-4 h-4" /> },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case "general":
        return (
          <div className="space-y-5">
            {/* Basic Info */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Info className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">Basic Information</span>
              </div>
              
              <div>
                <label className="block text-xs font-medium text-[#9a9088] uppercase tracking-wider mb-2">
                  Recipe Name <span className="text-[#d97706]">*</span>
                </label>
                <input
                  type="text"
                  value={recipe.name ?? ""}
                  onChange={(e) => onChange({ ...recipe, name: e.target.value })}
                  placeholder="e.g., Llama 3.1 8B Instruct"
                  className="w-full px-3 py-2.5 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706] focus:ring-1 focus:ring-[#d97706]/20 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] uppercase tracking-wider mb-2">
                  Model Path <span className="text-[#d97706]">*</span>
                </label>
                <select
                  value={recipe.model_path ?? ""}
                  onChange={(e) => onChange({ ...recipe, model_path: e.target.value })}
                  className="w-full px-3 py-2.5 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706] focus:ring-1 focus:ring-[#d97706]/20 transition-all"
                >
                  <option value="">Select a model...</option>
                  {availableModels.map((model) => {
                    const servedName = modelServedNames[model.path];
                    return (
                      <option key={model.path} value={model.path}>
                        {servedName ? `${servedName} (${model.name})` : model.name}
                      </option>
                    );
                  })}
                </select>
                {recipe.model_path && !availableModels.some(m => m.path === recipe.model_path) && (
                  <p className="mt-1.5 text-xs text-[#6a6560]">
                    Custom: {recipe.model_path}
                  </p>
                )}
              </div>
            </div>

            {/* Server Config */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Server className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">Server Configuration</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Backend</label>
                  <select
                    value={recipe.backend ?? "vllm"}
                    onChange={(e) => onChange({ ...recipe, backend: e.target.value as "vllm" | "sglang" | "llamacpp" })}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  >
                    <option value="vllm">vLLM</option>
                    <option value="sglang">SGLang</option>
                    <option value="llamacpp">llama.cpp</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Host</label>
                  <input
                    type="text"
                    value={recipe.host ?? "0.0.0.0"}
                    onChange={(e) => onChange({ ...recipe, host: e.target.value || undefined })}
                    placeholder="0.0.0.0"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Port</label>
                  <input
                    type="number"
                    value={recipe.port ?? 8000}
                    onChange={(e) => onChange({ ...recipe, port: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">Served Model Name (Optional)</label>
                <input
                  type="text"
                  value={recipe.served_model_name || ""}
                  onChange={(e) => onChange({ ...recipe, served_model_name: e.target.value || undefined })}
                  placeholder="Custom name exposed in API"
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                />
              </div>
            </div>
          </div>
        );

      case "model":
        if (isLlamacpp) {
          return (
            <div className="space-y-5">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                  <Layers className="w-4 h-4 text-[#d97706]" />
                  <span className="text-sm font-medium">Model & Context</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#9a9088] mb-2">Context Size</label>
                    <input
                      type="number"
                      value={recipe.max_model_len || ""}
                      onChange={(e) => onChange({ ...recipe, max_model_len: Number(e.target.value) || undefined })}
                      placeholder="8192"
                      className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#9a9088] mb-2">Seed</label>
                    <input
                      type="number"
                      value={recipe.seed || ""}
                      onChange={(e) => onChange({ ...recipe, seed: Number(e.target.value) || undefined })}
                      placeholder="Random"
                      className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                    />
                  </div>
                </div>
              </div>

              {renderLlamacppOptions("model")}
            </div>
          );
        }
        return (
          <div className="space-y-5">
            {/* Model Loading */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Layers className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">Model Loading</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Max Model Length</label>
                  <input
                    type="number"
                    value={recipe.max_model_len || ""}
                    onChange={(e) => onChange({ ...recipe, max_model_len: Number(e.target.value) || undefined })}
                    placeholder="32768"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Seed</label>
                  <input
                    type="number"
                    value={recipe.seed || ""}
                    onChange={(e) => onChange({ ...recipe, seed: Number(e.target.value) || undefined })}
                    placeholder="Random"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Tokenizer</label>
                  <input
                    type="text"
                    value={recipe.tokenizer || ""}
                    onChange={(e) => onChange({ ...recipe, tokenizer: e.target.value || undefined })}
                    placeholder="Path or name"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Tokenizer Mode</label>
                  <select
                    value={recipe.tokenizer_mode || "auto"}
                    onChange={(e) => onChange({ ...recipe, tokenizer_mode: e.target.value === "auto" ? undefined : (e.target.value as "auto" | "slow" | "mistral") })}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  >
                    <option value="auto">Auto</option>
                    <option value="slow">Slow</option>
                    <option value="mistral">Mistral</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Revision</label>
                  <input
                    type="text"
                    value={recipe.revision || ""}
                    onChange={(e) => onChange({ ...recipe, revision: e.target.value || undefined })}
                    placeholder="e.g., main"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Code Revision</label>
                  <input
                    type="text"
                    value={recipe.code_revision || ""}
                    onChange={(e) => onChange({ ...recipe, code_revision: e.target.value || undefined })}
                    placeholder="Optional"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Load Format</label>
                  <input
                    type="text"
                    value={recipe.load_format || ""}
                    onChange={(e) => onChange({ ...recipe, load_format: e.target.value || undefined })}
                    placeholder="auto, safetensors"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Quantization</label>
                  <input
                    type="text"
                    value={recipe.quantization || ""}
                    onChange={(e) => onChange({ ...recipe, quantization: e.target.value || undefined })}
                    placeholder="awq, gptq, fp8"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">Quantization Param Path</label>
                <input
                  type="text"
                  value={recipe.quantization_param_path || ""}
                  onChange={(e) => onChange({ ...recipe, quantization_param_path: e.target.value || undefined })}
                  placeholder="Path to calibration file"
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Dtype</label>
                  <select
                    value={recipe.dtype || "auto"}
                    onChange={(e) => onChange({ ...recipe, dtype: e.target.value === "auto" ? undefined : e.target.value })}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  >
                    <option value="auto">Auto</option>
                    <option value="float16">float16</option>
                    <option value="bfloat16">bfloat16</option>
                    <option value="float32">float32</option>
                  </select>
                </div>
                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2 text-sm text-[#9a9088] cursor-pointer hover:text-[#e8e6e3] transition-colors">
                    <input
                      type="checkbox"
                      checked={recipe.trust_remote_code || false}
                      onChange={(e) => onChange({ ...recipe, trust_remote_code: e.target.checked })}
                      className="rounded border-[#363432] bg-[#0d0d0d] w-4 h-4"
                    />
                    Trust Remote Code
                  </label>
                </div>
              </div>
            </div>
          </div>
        );

      case "resources":
        if (isLlamacpp) {
          return (
            <div className="space-y-5">
              {renderLlamacppOptions("resources")}
            </div>
          );
        }
        return (
          <div className="space-y-5">
            {/* Parallelism */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <GitBranch className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">Parallelism</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Tensor Parallel (TP)</label>
                  <input
                    type="number"
                    min={1}
                    value={recipe.tp ?? recipe.tensor_parallel_size ?? 1}
                    onChange={(e) => onChange({ ...recipe, tp: Number(e.target.value), tensor_parallel_size: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Pipeline Parallel (PP)</label>
                  <input
                    type="number"
                    min={1}
                    value={recipe.pp ?? recipe.pipeline_parallel_size ?? 1}
                    onChange={(e) => onChange({ ...recipe, pp: Number(e.target.value), pipeline_parallel_size: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Data Parallel</label>
                  <input
                    type="number"
                    min={1}
                    value={recipe.data_parallel_size || ""}
                    onChange={(e) => onChange({ ...recipe, data_parallel_size: Number(e.target.value) || undefined })}
                    placeholder="1"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Distributed Executor</label>
                  <select
                    value={recipe.distributed_executor_backend || ""}
                    onChange={(e) => onChange({ ...recipe, distributed_executor_backend: e.target.value ? (e.target.value as "ray" | "mp") : undefined })}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  >
                    <option value="">Default</option>
                    <option value="ray">Ray</option>
                    <option value="mp">MP (Multiprocessing)</option>
                  </select>
                </div>
                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2 text-sm text-[#9a9088] cursor-pointer hover:text-[#e8e6e3] transition-colors">
                    <input
                      type="checkbox"
                      checked={recipe.enable_expert_parallel || false}
                      onChange={(e) => onChange({ ...recipe, enable_expert_parallel: e.target.checked })}
                      className="rounded border-[#363432] bg-[#0d0d0d] w-4 h-4"
                    />
                    Expert Parallel (MoE)
                  </label>
                </div>
              </div>
            </div>

            {/* GPU Settings */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Cpu className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">GPU Settings</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">
                  GPU Memory Utilization
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={recipe.gpu_memory_utilization ?? 0.9}
                    onChange={(e) => onChange({ ...recipe, gpu_memory_utilization: Number(e.target.value) })}
                    className="flex-1 h-2 bg-[#363432] rounded-lg appearance-none cursor-pointer accent-[#d97706]"
                  />
                  <span className="text-sm font-mono w-12 text-right">
                    {Math.round((recipe.gpu_memory_utilization ?? 0.9) * 100)}%
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">
                  CUDA Visible Devices
                </label>
                <input
                  type="text"
                  value={recipe.cuda_visible_devices || ""}
                  onChange={(e) => onChange({ ...recipe, cuda_visible_devices: e.target.value || undefined })}
                  placeholder="0,1,2,3 or all"
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                />
              </div>
            </div>

            {/* Memory Management */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Database className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">Memory Management</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Swap Space (GB)</label>
                  <input
                    type="number"
                    value={recipe.swap_space || ""}
                    onChange={(e) => onChange({ ...recipe, swap_space: Number(e.target.value) || undefined })}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">CPU Offload (GB)</label>
                  <input
                    type="number"
                    value={recipe.cpu_offload_gb || ""}
                    onChange={(e) => onChange({ ...recipe, cpu_offload_gb: Number(e.target.value) || undefined })}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">GPU Blocks Override</label>
                  <input
                    type="number"
                    value={recipe.num_gpu_blocks_override || ""}
                    onChange={(e) => onChange({ ...recipe, num_gpu_blocks_override: Number(e.target.value) || undefined })}
                    placeholder="Auto"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case "performance":
        if (isLlamacpp) {
          return (
            <div className="space-y-5">
              {renderLlamacppOptions("performance")}
            </div>
          );
        }
        return (
          <div className="space-y-5">
            {/* CUDA Graphs */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Zap className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">CUDA Graphs & Compilation</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3 bg-[#0d0d0d] border border-[#363432] rounded-lg">
                  <input
                    type="checkbox"
                    id="enforce_eager"
                    checked={recipe.enforce_eager || false}
                    onChange={(e) => onChange({ ...recipe, enforce_eager: e.target.checked })}
                    className="rounded border-[#363432] bg-[#1b1b1b] w-4 h-4"
                  />
                  <div className="flex-1">
                    <label htmlFor="enforce_eager" className="text-sm font-medium text-[#e8e6e3] cursor-pointer">
                      Enforce Eager Mode
                    </label>
                    <p className="text-xs text-[#6a6560]">Disables CUDA graphs for debugging</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-[#0d0d0d] border border-[#363432] rounded-lg">
                  <input
                    type="checkbox"
                    id="disable_cuda_graph"
                    checked={recipe.disable_cuda_graph || false}
                    onChange={(e) => onChange({ ...recipe, disable_cuda_graph: e.target.checked })}
                    className="rounded border-[#363432] bg-[#1b1b1b] w-4 h-4"
                  />
                  <div className="flex-1">
                    <label htmlFor="disable_cuda_graph" className="text-sm font-medium text-[#e8e6e3] cursor-pointer">
                      Disable CUDA Graph
                    </label>
                    <p className="text-xs text-[#6a6560]">Skip graph capture for dynamic shapes</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-[#0d0d0d] border border-[#363432] rounded-lg">
                  <input
                    type="checkbox"
                    id="use_v2_block_manager"
                    checked={recipe.use_v2_block_manager || false}
                    onChange={(e) => onChange({ ...recipe, use_v2_block_manager: e.target.checked })}
                    className="rounded border-[#363432] bg-[#1b1b1b] w-4 h-4"
                  />
                  <div className="flex-1">
                    <label htmlFor="use_v2_block_manager" className="text-sm font-medium text-[#e8e6e3] cursor-pointer">
                      v2 Block Manager
                    </label>
                    <p className="text-xs text-[#6a6560]">New memory management</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-[#0d0d0d] border border-[#363432] rounded-lg">
                  <input
                    type="checkbox"
                    id="disable_custom_all_reduce"
                    checked={recipe.disable_custom_all_reduce || false}
                    onChange={(e) => onChange({ ...recipe, disable_custom_all_reduce: e.target.checked })}
                    className="rounded border-[#363432] bg-[#1b1b1b] w-4 h-4"
                  />
                  <div className="flex-1">
                    <label htmlFor="disable_custom_all_reduce" className="text-sm font-medium text-[#e8e6e3] cursor-pointer">
                      Disable Custom AllReduce
                    </label>
                    <p className="text-xs text-[#6a6560]">Use default NCCL collectives</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">CUDA Graph Max Batch Size</label>
                  <input
                    type="number"
                    value={recipe.cuda_graph_max_bs || ""}
                    onChange={(e) => onChange({ ...recipe, cuda_graph_max_bs: Number(e.target.value) || undefined })}
                    placeholder="Default"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Compilation Config</label>
                  <input
                    type="text"
                    value={recipe.compilation_config || ""}
                    onChange={(e) => onChange({ ...recipe, compilation_config: e.target.value || undefined })}
                    placeholder={`e.g., {"level": 3}`}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              </div>
            </div>

            {/* KV Cache */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Database className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">KV Cache & Memory</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">KV Cache Dtype</label>
                  <select
                    value={recipe.kv_cache_dtype || "auto"}
                    onChange={(e) => onChange({ ...recipe, kv_cache_dtype: e.target.value === "auto" ? undefined : e.target.value })}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  >
                    <option value="auto">Auto</option>
                    <option value="fp8">FP8</option>
                    <option value="fp8_e5m2">FP8 E5M2</option>
                    <option value="fp8_e4m3">FP8 E4M3</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Block Size</label>
                  <select
                    value={recipe.block_size || "16"}
                    onChange={(e) => onChange({ ...recipe, block_size: Number(e.target.value) || undefined })}
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  >
                    <option value="8">8</option>
                    <option value="16">16</option>
                    <option value="32">32</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3 bg-[#0d0d0d] border border-[#363432] rounded-lg">
                  <input
                    type="checkbox"
                    id="enable_prefix_caching"
                    checked={recipe.enable_prefix_caching || false}
                    onChange={(e) => onChange({ ...recipe, enable_prefix_caching: e.target.checked })}
                    className="rounded border-[#363432] bg-[#1b1b1b] w-4 h-4"
                  />
                  <div className="flex-1">
                    <label htmlFor="enable_prefix_caching" className="text-sm font-medium text-[#e8e6e3] cursor-pointer">
                      Prefix Caching
                    </label>
                    <p className="text-xs text-[#6a6560]">Cache shared prefixes</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-[#0d0d0d] border border-[#363432] rounded-lg">
                  <input
                    type="checkbox"
                    id="enable_chunked_prefill"
                    checked={recipe.enable_chunked_prefill || false}
                    onChange={(e) => onChange({ ...recipe, enable_chunked_prefill: e.target.checked })}
                    className="rounded border-[#363432] bg-[#1b1b1b] w-4 h-4"
                  />
                  <div className="flex-1">
                    <label htmlFor="enable_chunked_prefill" className="text-sm font-medium text-[#e8e6e3] cursor-pointer">
                      Chunked Prefill
                    </label>
                    <p className="text-xs text-[#6a6560]">Interleave prefill/decode</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Scheduling */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Clock className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">Scheduler & Batching</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Max Sequences</label>
                  <input
                    type="number"
                    value={recipe.max_num_seqs || ""}
                    onChange={(e) => onChange({ ...recipe, max_num_seqs: Number(e.target.value) || undefined })}
                    placeholder="256"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Max Batched Tokens</label>
                  <input
                    type="number"
                    value={recipe.max_num_batched_tokens || ""}
                    onChange={(e) => onChange({ ...recipe, max_num_batched_tokens: Number(e.target.value) || undefined })}
                    placeholder="Auto"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Max Paddings</label>
                  <input
                    type="number"
                    value={recipe.max_paddings || ""}
                    onChange={(e) => onChange({ ...recipe, max_paddings: Number(e.target.value) || undefined })}
                    placeholder="Auto"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">Scheduling Policy</label>
                <select
                  value={recipe.scheduling_policy || ""}
                  onChange={(e) => onChange({ ...recipe, scheduling_policy: e.target.value ? (e.target.value as "fcfs" | "priority") : undefined })}
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                >
                  <option value="">Default</option>
                  <option value="fcfs">FCFS (First Come First Serve)</option>
                  <option value="priority">Priority</option>
                </select>
              </div>
            </div>
          </div>
        );

      case "features":
        if (isLlamacpp) {
          return (
            <div className="space-y-5">
              {renderLlamacppOptions("features")}
            </div>
          );
        }
        return (
          <div className="space-y-5">
            {/* Tool Calling */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Wrench className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">Tool Calling</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">Tool Call Parser</label>
                <select
                  value={recipe.tool_call_parser || ""}
                  onChange={(e) => onChange({ ...recipe, tool_call_parser: e.target.value || undefined })}
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                >
                  <option value="">None</option>
                  <optgroup label="General">
                    <option value="hermes">Hermes</option>
                    <option value="pythonic">Pythonic</option>
                    <option value="openai">OpenAI</option>
                  </optgroup>
                  <optgroup label="Llama">
                    <option value="llama3_json">Llama 3 JSON</option>
                    <option value="llama4_json">Llama 4 JSON</option>
                    <option value="llama4_pythonic">Llama 4 Pythonic</option>
                  </optgroup>
                  <optgroup label="DeepSeek">
                    <option value="deepseek_v3">DeepSeek V3</option>
                    <option value="deepseek_v31">DeepSeek V3.1</option>
                    <option value="deepseek_v32">DeepSeek V3.2</option>
                  </optgroup>
                  <optgroup label="Qwen">
                    <option value="qwen3_xml">Qwen3 XML</option>
                    <option value="qwen3_coder">Qwen3 Coder</option>
                  </optgroup>
                  <optgroup label="GLM">
                    <option value="glm45">GLM-4.5</option>
                    <option value="glm47">GLM-4.7</option>
                  </optgroup>
                  <optgroup label="Other">
                    <option value="mistral">Mistral</option>
                    <option value="granite">Granite</option>
                    <option value="minimax">MiniMax</option>
                    <option value="kimi_k2">Kimi K2</option>
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">Tool Parser Plugin</label>
                <input
                  type="text"
                  value={recipe.tool_parser_plugin || ""}
                  onChange={(e) => onChange({ ...recipe, tool_parser_plugin: e.target.value || undefined })}
                  placeholder="Path to custom parser module"
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                />
              </div>

              <div className="flex items-center gap-3 p-3 bg-[#0d0d0d] border border-[#363432] rounded-lg">
                <input
                  type="checkbox"
                  id="enable_auto_tool_choice"
                  checked={recipe.enable_auto_tool_choice || false}
                  onChange={(e) => onChange({ ...recipe, enable_auto_tool_choice: e.target.checked })}
                  className="rounded border-[#363432] bg-[#1b1b1b] w-4 h-4"
                />
                <div className="flex-1">
                  <label htmlFor="enable_auto_tool_choice" className="text-sm font-medium text-[#e8e6e3] cursor-pointer">
                    Enable Auto Tool Choice
                  </label>
                  <p className="text-xs text-[#6a6560]">Automatically decide when to use tools</p>
                </div>
              </div>
            </div>

            {/* Reasoning */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Brain className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">Reasoning & Thinking</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">Reasoning Parser</label>
                <select
                  value={recipe.reasoning_parser || ""}
                  onChange={(e) => onChange({ ...recipe, reasoning_parser: e.target.value || undefined })}
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                >
                  <option value="">None</option>
                  <optgroup label="DeepSeek">
                    <option value="deepseek_r1">DeepSeek R1</option>
                    <option value="deepseek_v3">DeepSeek V3</option>
                  </optgroup>
                  <optgroup label="Others">
                    <option value="qwen3">Qwen3</option>
                    <option value="glm45">GLM-4.5</option>
                    <option value="granite">Granite</option>
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">Guided Decoding Backend</label>
                <input
                  type="text"
                  value={recipe.guided_decoding_backend || ""}
                  onChange={(e) => onChange({ ...recipe, guided_decoding_backend: e.target.value || undefined })}
                  placeholder="e.g., xgrammar, outlines"
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                />
              </div>

              <div className="flex items-center gap-3 p-3 bg-[#0d0d0d] border border-[#363432] rounded-lg">
                <input
                  type="checkbox"
                  id="enable_thinking"
                  checked={recipe.enable_thinking || false}
                  onChange={(e) => onChange({ ...recipe, enable_thinking: e.target.checked })}
                  className="rounded border-[#363432] bg-[#1b1b1b] w-4 h-4"
                />
                <div className="flex-1">
                  <label htmlFor="enable_thinking" className="text-sm font-medium text-[#e8e6e3] cursor-pointer">
                    Enable Thinking Mode
                  </label>
                  <p className="text-xs text-[#6a6560]">Show model&apos;s thinking process</p>
                </div>
              </div>

              {recipe.enable_thinking && (
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Thinking Budget (tokens)</label>
                  <input
                    type="number"
                    value={recipe.thinking_budget || ""}
                    onChange={(e) => onChange({ ...recipe, thinking_budget: Number(e.target.value) || undefined })}
                    placeholder="1024"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              )}
            </div>

            {/* Chat & Server */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <MessageSquare className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">Chat & Templates</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Chat Template</label>
                  <input
                    type="text"
                    value={recipe.chat_template || ""}
                    onChange={(e) => onChange({ ...recipe, chat_template: e.target.value || undefined })}
                    placeholder="Path or name"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Response Role</label>
                  <input
                    type="text"
                    value={recipe.response_role || ""}
                    onChange={(e) => onChange({ ...recipe, response_role: e.target.value || undefined })}
                    placeholder="assistant"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9a9088] mb-2">Chat Template Format</label>
                <select
                  value={recipe.chat_template_content_format || "auto"}
                  onChange={(e) => onChange({ ...recipe, chat_template_content_format: e.target.value === "auto" ? undefined : (e.target.value as "auto" | "string" | "openai") })}
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                >
                  <option value="auto">Auto</option>
                  <option value="string">String</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>
            </div>
          </div>
        );

      case "environment":
        return (
          <div className="space-y-5">
            {!isLlamacpp && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                  <Terminal className="w-4 h-4 text-[#d97706]" />
                  <span className="text-sm font-medium">Runtime Configuration</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#9a9088] mb-2">Python Path</label>
                  <input
                    type="text"
                    value={recipe.python_path || ""}
                    onChange={(e) => onChange({ ...recipe, python_path: e.target.value || undefined })}
                    placeholder="/usr/bin/python or venv/bin/python"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
              </div>
            )}
            {isLlamacpp && (
              <p className="text-xs text-[#6a6560]">
                llama.cpp uses the configured server binary. Set <span className="font-mono">VLLM_STUDIO_LLAMA_BIN</span> if
                you need a custom path.
              </p>
            )}

            {/* Environment Variables */}
            <div className="space-y-4">
              <div className="flex items-center justify-between text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <div className="flex items-center gap-2">
                  <Variable className="w-4 h-4 text-[#d97706]" />
                  <span className="text-sm font-medium">Environment Variables</span>
                </div>
                <button
                  type="button"
                  onClick={handleAddEnvVar}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#363432] hover:bg-[#494745] rounded-lg text-xs transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </div>

              <div className="space-y-2">
                {envVarEntries.map((entry, index) => (
                  <div key={`${entry.key}-${index}`} className="grid grid-cols-[1fr,1fr,auto] gap-2">
                    <input
                      type="text"
                      value={entry.key}
                      onChange={(e) => handleEnvVarChange(index, "key", e.target.value)}
                      placeholder="KEY"
                      className="px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm font-mono focus:outline-none focus:border-[#d97706]"
                    />
                    <input
                      type="text"
                      value={entry.value}
                      onChange={(e) => handleEnvVarChange(index, "value", e.target.value)}
                      placeholder="value"
                      className="px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveEnvVar(index)}
                      className="px-3 py-2 bg-[#2a2724] hover:bg-[#363432] rounded-lg text-xs transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Extra Args */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
                <Code className="w-4 h-4 text-[#d97706]" />
                <span className="text-sm font-medium">Extra CLI Arguments</span>
              </div>

              <div className="bg-[#0d0d0d] border border-[#363432] rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-[#1b1b1b] border-b border-[#363432]">
                  <span className="text-xs text-[#9a9088]">JSON Editor</span>
                  {extraArgsError && <span className="text-xs text-[#fca5a5]">Invalid JSON</span>}
                </div>
                <textarea
                  value={extraArgsText}
                  onChange={(e) => handleExtraArgsChange(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="w-full px-3 py-2 bg-transparent border-0 text-xs font-mono focus:outline-none resize-none"
                  placeholder='{"custom-flag": true}'
                />
              </div>
              <p className="text-xs text-[#6a6560]">
                Extra arguments are passed directly to the CLI. These override form fields.
              </p>
            </div>

            {isLlamacpp && (
              <details className="bg-[#0d0d0d] border border-[#363432] rounded-lg overflow-hidden">
                <summary className="cursor-pointer px-3 py-2 text-xs text-[#9a9088] bg-[#1b1b1b] border-b border-[#363432]">
                  llama.cpp CLI Reference
                </summary>
                <div className="px-3 py-2">
                  {llamaConfigLoading && (
                    <div className="text-xs text-[#9a9088]">Loading llama.cpp config…</div>
                  )}
                  {!llamaConfigLoading && llamaConfigHelp?.error && (
                    <div className="text-xs text-[#fca5a5]">{llamaConfigHelp.error}</div>
                  )}
                  {!llamaConfigLoading && !llamaConfigHelp?.error && (
                    <pre className="text-xs text-[#9a9088] whitespace-pre-wrap">
                      {llamaConfigHelp?.config ?? "No config data returned."}
                    </pre>
                  )}
                </div>
              </details>
            )}
          </div>
        );

      case "command":
        return (
          <div className="space-y-4 h-full flex flex-col">
            <div className="flex items-center gap-2 text-[#e8e6e3] pb-2 border-b border-[#363432]/50">
              <Eye className="w-4 h-4 text-[#d97706]" />
              <span className="text-sm font-medium">Command Preview</span>
            </div>

            <p className="text-xs text-[#9a9088]">
              This is the generated command. You can copy it for reference or edit it directly.
              <strong className="text-[#d97706]"> Note: Direct edits here are not saved yet.</strong>
            </p>

            <div className="flex-1 bg-[#0d0d0d] border border-[#363432] rounded-lg overflow-hidden flex flex-col">
              <div className="flex items-center gap-2 px-3 py-2 bg-[#1b1b1b] border-b border-[#363432]">
                <Terminal className="w-4 h-4 text-[#6a6560]" />
                <span className="text-xs text-[#9a9088]">Generated Command</span>
              </div>
              <textarea
                value={commandText}
                onChange={(e) => handleCommandChange(e.target.value)}
                spellCheck={false}
                className="flex-1 w-full px-3 py-3 bg-transparent border-0 text-xs font-mono text-[#4ade80] focus:outline-none resize-none leading-relaxed"
                placeholder="Command will appear here..."
              />
            </div>

            <div className="flex items-start gap-2 p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
              <Info className="w-4 h-4 text-[#d97706] mt-0.5 shrink-0" />
              <div className="text-xs text-[#9a9088] space-y-1">
                <p>Use the form tabs to configure the recipe. This preview updates automatically.</p>
                <p>If you edit this command directly, those changes won&apos;t be saved with the recipe.</p>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <button className="flex-1 bg-black/60" onClick={onClose} aria-label="Close" />
      
      {/* Drawer */}
      <div className="w-full max-w-2xl bg-[#1b1b1b] border-l border-[#363432] flex flex-col h-full animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#363432] shrink-0 bg-[#1b1b1b]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#d97706]/10 rounded-lg flex items-center justify-center">
              <Layers className="w-5 h-5 text-[#d97706]" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">{recipe.id ? "Edit Recipe" : "New Recipe"}</h3>
              <div className="flex items-center gap-2 text-xs text-[#6a6560]">
                <span>Engine</span>
                <span className="px-2 py-0.5 rounded-full bg-[#1b1b1b] border border-[#363432] text-[#d97706]">
                  {formatBackendLabel(recipe.backend)}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#363432] rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 py-3 border-b border-[#363432] shrink-0 bg-[#0d0d0d] overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-[#d97706] text-white shadow-lg shadow-[#d97706]/20"
                  : "text-[#9a9088] hover:text-[#e8e6e3] hover:bg-[#1b1b1b]"
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderTabContent()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#363432] shrink-0 bg-[#1b1b1b]">
          <div className="text-xs text-[#6a6560]">
            {recipe.id ? `Editing ${recipe.name}` : "Creating new recipe"}
            {extraArgsError && <span className="ml-3 text-[#fca5a5]">Extra args has errors</span>}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 bg-[#363432] hover:bg-[#494745] rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving || !!extraArgsError || !(recipe.name ?? "").trim() || !(recipe.model_path ?? "").trim()}
              className="flex items-center gap-2 px-4 py-2 bg-[#d97706] hover:bg-[#b45309] text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Recipe
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RecipesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
      <RecipesContent />
    </Suspense>
  );
}
