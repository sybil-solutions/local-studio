'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Menu,
  Plus,
  RefreshCw,
  Save,
  Search,
  Square,
  Play,
  Trash2,
  Check,
  X,
  Pin,
  PinOff,
  MoreVertical,
} from 'lucide-react';
import api from '@/lib/api';
import type { ModelInfo, Recipe, RecipeWithStatus, VRAMCalculation, ProcessInfo, StudioModelsRoot } from '@/lib/types';
import { parseCommand, recipeToCommand, slugifyRecipeId } from '@/lib/recipe-command';
import { useRealtimeStatus } from '@/hooks/useRealtimeStatus';

type Tab = 'recipes' | 'tools';

const DEFAULT_RECIPE: Recipe = {
  id: '',
  name: '',
  model_path: '',
  backend: 'vllm',
  tp: 1,
  pp: 1,
  port: 8000,
  host: '0.0.0.0',
  gpu_memory_utilization: 0.9,
  extra_args: {},
};

function RecipesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editRecipeId = searchParams.get('edit');
  const startNew = searchParams.get('new') === '1';
  const [tab, setTab] = useState<Tab>('recipes');
  const [sidebarView, setSidebarView] = useState<'recipes' | 'models'>('recipes');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [copied, setCopied] = useState(false);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelRoots, setModelRoots] = useState<StudioModelsRoot[]>([]);
  const [configuredModelsDir, setConfiguredModelsDir] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [runningProcess, setRunningProcess] = useState<ProcessInfo | null>(null);
  const [runningRecipeId, setRunningRecipeId] = useState<string | null>(null);

  const [filter, setFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [onlyUnconfiguredModels, setOnlyUnconfiguredModels] = useState(false);
  const [modelRecipeChoice, setModelRecipeChoice] = useState<Record<string, string>>({});
  const [pinnedRecipes, setPinnedRecipes] = useState<Set<string>>(new Set());
  const [recipeMenuOpen, setRecipeMenuOpen] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Recipe>({ ...DEFAULT_RECIPE });
  const [isDirty, setIsDirty] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [commandMode, setCommandMode] = useState(false);
  const [commandText, setCommandText] = useState('');
  const [commandParseError, setCommandParseError] = useState<string | null>(null);
  const [extraArgsText, setExtraArgsText] = useState('{}');
  const [envVarsText, setEnvVarsText] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // VRAM Tool
  const [vramModel, setVramModel] = useState('');
  const [contextLength, setContextLength] = useState(32768);
  const [tpSize, setTpSize] = useState(8);
  const [kvDtype, setKvDtype] = useState<'auto' | 'fp16' | 'fp8'>('auto');
  const [vramResult, setVramResult] = useState<VRAMCalculation | null>(null);
  const [calculating, setCalculating] = useState(false);

  const { launchProgress } = useRealtimeStatus();

  // Load pinned recipes from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vllm-studio-pinned-recipes');
      if (saved) {
        setPinnedRecipes(new Set(JSON.parse(saved)));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Toggle pin for a recipe
  const togglePin = useCallback((recipeId: string) => {
    setPinnedRecipes(prev => {
      const next = new Set(prev);
      if (next.has(recipeId)) {
        next.delete(recipeId);
      } else {
        next.add(recipeId);
      }
      localStorage.setItem('vllm-studio-pinned-recipes', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Close recipe menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setRecipeMenuOpen(null);
      setDeleteConfirm(null);
    };
    if (recipeMenuOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [recipeMenuOpen]);

  const loadData = useCallback(async () => {
    const [modelsData, recipesData, statusData] = await Promise.all([
      api.getModels().catch(() => ({ models: [] as ModelInfo[], roots: [] as StudioModelsRoot[], configured_models_dir: undefined })),
      api.getRecipes().catch(() => ({ recipes: [] as RecipeWithStatus[] })),
      api.getStatus().catch(() => ({ running: false, process: null as ProcessInfo | null, inference_port: 8000 })),
    ]);

    setModels(modelsData.models || []);
    setModelRoots(modelsData.roots || []);
    setConfiguredModelsDir(modelsData.configured_models_dir || null);
    const recipesList = recipesData.recipes || [];
    setRecipes(recipesList);
    setRunningProcess(statusData.process || null);
    const running = recipesList.find((r) => r.status === 'running')?.id || null;
    setRunningRecipeId(running);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadData();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadData]);

  const selectRecipe = useCallback((recipe: RecipeWithStatus) => {
    setSelectedId(recipe.id);
    setDraft({ ...recipe });
    setIsDirty(false);
    setCommandParseError(null);
    const cmd = recipeToCommand(recipe);
    setCommandText(cmd);
    setExtraArgsText(JSON.stringify(recipe.extra_args || {}, null, 2));
    setEnvVarsText(JSON.stringify(recipe.env_vars || {}, null, 2));
    setJsonError(null);
    setSidebarOpen(false); // Close sidebar on mobile when selecting
  }, []);

  const startNewRecipe = useCallback(() => {
    setSelectedId(null);
    setDraft({ ...DEFAULT_RECIPE });
    setIsDirty(false);
    setCommandParseError(null);
    setCommandText(`# Paste a vLLM command here (optional)\n# Or fill in the fields below.\n\nvllm serve /mnt/llm_models/YourModel \\\n  --tensor-parallel-size 8 \\\n  --max-model-len 32768 \\\n  --gpu-memory-utilization 0.9 \\\n  --trust-remote-code \\\n  --host 0.0.0.0 \\\n  --port 8000`);
    setExtraArgsText('{}');
    setEnvVarsText('{}');
    setJsonError(null);
    setSidebarOpen(false); // Close sidebar on mobile
  }, []);

  // Delete a recipe by ID directly (inline confirmation in UI)
  const deleteRecipeById = useCallback(async (recipeId: string) => {
    try {
      await api.deleteRecipe(recipeId);
      await loadData();
      if ((selectedId || draft.id) === recipeId) {
        startNewRecipe();
      }
      setDeleteConfirm(null);
      setRecipeMenuOpen(null);
    } catch (e) {
      alert('Failed to delete: ' + (e as Error).message);
    }
  }, [loadData, selectedId, draft.id, startNewRecipe]);

  const startNewRecipeFromModel = useCallback((model: ModelInfo) => {
    router.replace('/recipes?new=1');
    const id = slugifyRecipeId(model.name || model.path.split('/').pop() || 'new-recipe');
    const recipe: Recipe = {
      ...DEFAULT_RECIPE,
      id,
      name: model.name || model.path.split('/').pop() || id,
      model_path: model.path,
      max_model_len: model.context_length || DEFAULT_RECIPE.max_model_len,
      quantization: model.quantization || undefined,
      served_model_name: id,
      extra_args: {},
      env_vars: {},
    };
    setSelectedId(null);
    setDraft(recipe);
    setIsDirty(true);
    setAdvancedOpen(false);
    setCommandParseError(null);
    setCommandText(recipeToCommand(recipe));
    setExtraArgsText(JSON.stringify(recipe.extra_args || {}, null, 2));
    setEnvVarsText(JSON.stringify(recipe.env_vars || {}, null, 2));
    setJsonError(null);
  }, [router]);

  const recipeById = useMemo(() => {
    const map = new Map<string, RecipeWithStatus>();
    for (const r of recipes) map.set(r.id, r);
    return map;
  }, [recipes]);

  const openRecipeById = useCallback((id: string) => {
    const recipe = recipeById.get(id);
    if (!recipe) return;
    router.replace(`/recipes?edit=${encodeURIComponent(id)}`);
    selectRecipe(recipe);
  }, [recipeById, router, selectRecipe]);

  const launchRecipeById = useCallback(async (id: string) => {
    setLaunching(true);
    try {
      await api.switchModel(id, true);
      await loadData();
    } catch (e) {
      alert('Failed to launch: ' + (e as Error).message);
    } finally {
      setLaunching(false);
    }
  }, [loadData]);

  useEffect(() => {
    if (startNew) startNewRecipe();
  }, [startNew, startNewRecipe]);

  useEffect(() => {
    if (!editRecipeId) return;
    const recipe = recipes.find((r) => r.id === editRecipeId);
    if (recipe) selectRecipe(recipe);
  }, [editRecipeId, recipes, selectRecipe]);

  const filteredRecipes = useMemo(() => {
    let list = recipes;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = recipes.filter((r) => {
        return (
          r.id.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.model_path.toLowerCase().includes(q)
        );
      });
    }
    // Sort: pinned first, then running, then alphabetical
    return [...list].sort((a, b) => {
      const aPinned = pinnedRecipes.has(a.id);
      const bPinned = pinnedRecipes.has(b.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      const aRunning = a.status === 'running';
      const bRunning = b.status === 'running';
      if (aRunning !== bRunning) return aRunning ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [filter, recipes, pinnedRecipes]);

  const filteredModels = useMemo(() => {
    let list = models;
    if (onlyUnconfiguredModels) {
      list = list.filter((m) => !(m.recipe_ids && m.recipe_ids.length > 0) && !m.has_recipe);
    }
    if (!modelFilter.trim()) return list;
    const q = modelFilter.toLowerCase();
    return list.filter((m) => {
      return (
        m.name.toLowerCase().includes(q) ||
        m.path.toLowerCase().includes(q) ||
        (m.architecture || '').toLowerCase().includes(q) ||
        (m.quantization || '').toLowerCase().includes(q)
      );
    });
  }, [modelFilter, models, onlyUnconfiguredModels]);

  const setDraftField = <K extends keyof Recipe>(key: K, value: Recipe[K]) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: value } as Recipe;
      if (key === 'model_path') {
        const modelPath = String(value || '').trim();
        const baseName = modelPath ? modelPath.split('/').pop() || '' : '';
        if (!prev.id && baseName) next.id = slugifyRecipeId(baseName);
        if (!prev.name && baseName) next.name = baseName;
        if (!prev.served_model_name && next.id) next.served_model_name = next.id;
      }
      return next;
    });
    setIsDirty(true);
  };

  const ensureIdAndName = (recipe: Recipe): Recipe => {
    let id = recipe.id;
    let name = recipe.name;
    if (!id && recipe.model_path) id = slugifyRecipeId(recipe.model_path.split('/').pop() || 'new-recipe');
    if (!name && recipe.model_path) name = recipe.model_path.split('/').pop() || 'New Recipe';
    return { ...recipe, id, name };
  };

  const parseAdvancedJson = (): { extra_args: Record<string, unknown>; env_vars: Record<string, string> } | null => {
    try {
      const extra = extraArgsText.trim() ? JSON.parse(extraArgsText) : {};
      const env = envVarsText.trim() ? JSON.parse(envVarsText) : {};
      if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) throw new Error('extra_args must be a JSON object');
      if (typeof env !== 'object' || env === null || Array.isArray(env)) throw new Error('env_vars must be a JSON object');
      for (const [k, v] of Object.entries(env)) {
        if (typeof v !== 'string') throw new Error(`env_vars.${k} must be a string`);
      }
      setJsonError(null);
      return { extra_args: extra as Record<string, unknown>, env_vars: env as Record<string, string> };
    } catch (e) {
      setJsonError((e as Error).message);
      return null;
    }
  };

  const saveRecipe = useCallback(async () => {
    const normalized = ensureIdAndName(draft);
    if (!normalized.id || !normalized.name || !normalized.model_path) {
      alert('Please provide: model path, recipe id, and name.');
      return null;
    }

    const advanced = parseAdvancedJson();
    if (!advanced) return null;

    const recipeToSave: Recipe = {
      ...normalized,
      extra_args: advanced.extra_args,
      env_vars: advanced.env_vars,
      tp: normalized.tp || normalized.tensor_parallel_size || 1,
      pp: normalized.pp || normalized.pipeline_parallel_size || 1,
      backend: normalized.backend || 'vllm',
    };

    setSaving(true);
    try {
      const exists = recipes.some((r) => r.id === recipeToSave.id);
      if (exists) await api.updateRecipe(recipeToSave.id, recipeToSave);
      else await api.createRecipe(recipeToSave);

      await loadData();
      const updated = await api.getRecipe(recipeToSave.id).catch(() => recipeToSave as unknown as RecipeWithStatus);
      setSelectedId(recipeToSave.id);
      setDraft({ ...updated });
      setIsDirty(false);
      setCommandText(recipeToCommand(updated));
      setExtraArgsText(JSON.stringify(recipeToSave.extra_args || {}, null, 2));
      setEnvVarsText(JSON.stringify(recipeToSave.env_vars || {}, null, 2));
      return recipeToSave.id;
    } catch (e) {
      alert('Failed to save: ' + (e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, loadData, recipes, extraArgsText, envVarsText]);

  const launchSelected = useCallback(async () => {
    const id = await saveRecipe();
    if (!id) return;
    setLaunching(true);
    try {
      await api.switchModel(id, true);
      await loadData();
    } catch (e) {
      alert('Failed to launch: ' + (e as Error).message);
    } finally {
      setLaunching(false);
    }
  }, [loadData, saveRecipe]);

  const stopRunning = useCallback(async () => {
    if (!confirm('Stop the currently running model?')) return;
    try {
      await api.evictModel(true);
      await loadData();
    } catch (e) {
      alert('Failed to stop: ' + (e as Error).message);
    }
  }, [loadData]);

  const deleteSelected = useCallback(async () => {
    const id = selectedId || draft.id;
    if (!id) return;
    if (!confirm(`Delete recipe "${id}"?`)) return;
    try {
      await api.deleteRecipe(id);
      await loadData();
      startNewRecipe();
    } catch (e) {
      alert('Failed to delete: ' + (e as Error).message);
    }
  }, [draft.id, loadData, selectedId, startNewRecipe]);

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const parseCommandIntoDraft = () => {
    setCommandParseError(null);
    try {
      const parsed = parseCommand(commandText, { id: draft.id, name: draft.name });
      const merged = ensureIdAndName({ ...draft, ...parsed });
      setDraft(merged);
      setIsDirty(true);
      setExtraArgsText(JSON.stringify(merged.extra_args || {}, null, 2));
      setEnvVarsText(JSON.stringify(merged.env_vars || {}, null, 2));
      setJsonError(null);
    } catch (e) {
      setCommandParseError((e as Error).message);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  const commandPreview = useMemo(() => {
    const normalized = ensureIdAndName(draft);
    if (!normalized.model_path) return '';
    return recipeToCommand(normalized);
  }, [draft]);

  const selectedIsRunning = !!runningRecipeId && (selectedId === runningRecipeId || draft.id === runningRecipeId);

  const draftModelInfo = useMemo(() => {
    const path = (draft.model_path || '').trim();
    if (!path) return null;
    return models.find((m) => m.path === path) || null;
  }, [draft.model_path, models]);

  const modelsConfigRoot = useMemo(() => {
    return modelRoots.find((r) => (r.sources || []).includes('config')) || null;
  }, [modelRoots]);

  const formatBytes = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) return null;
    const gb = bytes / (1024 ** 3);
    return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  };

  const calculateVRAM = async () => {
    if (!vramModel) return;
    setCalculating(true);
    try {
      const data = await api.calculateVRAM({
        model_path: vramModel,
        context_length: contextLength,
        batch_size: 1,
        tp_size: tpSize,
        kv_cache_dtype: kvDtype,
      });
      setVramResult(data);
    } catch (e) {
      alert('Failed to calculate VRAM: ' + (e as Error).message);
    } finally {
      setCalculating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-[#1b1b1b]">
        <div className="flex items-center gap-2 text-[#9a9088]">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading recipes...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#1b1b1b] text-[#f0ebe3]">
      <div className="p-3 sm:p-4 md:p-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-medium text-[#f0ebe3]">Recipes</h1>
            <div className="text-sm text-[#9a9088]">
              {runningProcess
                ? `Running: ${runningRecipeId || runningProcess.model_path?.split('/').pop() || 'Unknown'}`
                : 'No model running'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab('recipes')}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                tab === 'recipes'
                  ? 'bg-[#2a2826] border-[#363432] text-[#f0ebe3]'
                  : 'border-[#363432] text-[#9a9088] hover:bg-[#1e1e1e]'
              }`}
            >
              Recipes
            </button>
            <button
              onClick={() => setTab('tools')}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                tab === 'tools'
                  ? 'bg-[#2a2826] border-[#363432] text-[#f0ebe3]'
                  : 'border-[#363432] text-[#9a9088] hover:bg-[#1e1e1e]'
              }`}
            >
              Tools
            </button>
            <button
              onClick={refresh}
              className="p-2 border border-[#363432] rounded-lg hover:bg-[#1e1e1e] transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 text-[#9a9088] ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {tab === 'tools' ? (
          <div className="bg-[#1e1e1e] border border-[#363432] rounded-lg">
            <div className="flex items-center gap-2 p-4 border-b border-[#363432]">
              <Calculator className="h-5 w-5 text-[#8b7355]" />
              <h2 className="font-medium">VRAM Calculator</h2>
            </div>
            <div className="p-4 grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#9a9088] mb-1">Model</label>
                <input
                  value={vramModel}
                  onChange={(e) => setVramModel(e.target.value)}
                  placeholder="/mnt/llm_models/..."
                  className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-[#8b7355]"
                  list="models-list"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-[#9a9088] mb-1">Context</label>
                  <input
                    type="number"
                    value={contextLength}
                    onChange={(e) => setContextLength(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#9a9088] mb-1">TP</label>
                  <select
                    value={tpSize}
                    onChange={(e) => setTpSize(parseInt(e.target.value))}
                    className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                  >
                    {[1, 2, 4, 8].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[#9a9088] mb-1">KV</label>
                  <select
                    value={kvDtype}
                    onChange={(e) => setKvDtype(e.target.value as 'auto' | 'fp16' | 'fp8')}
                    className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                  >
                    <option value="auto">auto</option>
                    <option value="fp16">fp16</option>
                    <option value="fp8">fp8</option>
                  </select>
                </div>
              </div>

              <div className="md:col-span-2 flex gap-2">
                <button
                  onClick={calculateVRAM}
                  disabled={!vramModel || calculating}
                  className="px-4 py-2 bg-[#8b7355] text-white rounded-lg text-sm font-medium hover:bg-[#8b7355]/90 disabled:opacity-50 transition-colors"
                >
                  {calculating ? 'Calculating...' : 'Calculate'}
                </button>
                {vramResult && (
                  <div className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                    vramResult.fits ? 'bg-[#7d9a6a]/10 text-[#7d9a6a]' : 'bg-[#c97a6b]/10 text-[#c97a6b]'
                  }`}>
                    {vramResult.fits ? 'Fits' : 'May not fit'} • {vramResult.breakdown.per_gpu_gb.toFixed(2)} GB/GPU • {Math.round(vramResult.utilization_percent)}% util
                  </div>
                )}
              </div>

              {vramResult && (
                <div className="md:col-span-2 bg-[#1b1b1b] rounded-lg p-4 text-sm">
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="flex justify-between"><span className="text-[#9a9088]">Weights</span><span className="font-mono text-[#f0ebe3]">{vramResult.breakdown.model_weights_gb.toFixed(2)} GB</span></div>
                    <div className="flex justify-between"><span className="text-[#9a9088]">KV Cache</span><span className="font-mono text-[#f0ebe3]">{vramResult.breakdown.kv_cache_gb.toFixed(2)} GB</span></div>
                    <div className="flex justify-between"><span className="text-[#9a9088]">Activations</span><span className="font-mono text-[#f0ebe3]">{vramResult.breakdown.activations_gb.toFixed(2)} GB</span></div>
                    <div className="flex justify-between"><span className="text-[#9a9088]">Total</span><span className="font-mono text-[#f0ebe3]">{vramResult.breakdown.total_gb.toFixed(2)} GB</span></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex gap-4 relative">
            {/* Mobile Overlay */}
            {sidebarOpen && (
              <div
                className="fixed inset-0 bg-black/50 z-20 lg:hidden"
                onClick={() => setSidebarOpen(false)}
              />
            )}

            {/* Recipe List Sidebar */}
            <section className={`
              fixed lg:relative inset-y-0 left-0 z-30 lg:z-auto
              w-80 lg:w-80 lg:flex-shrink-0
              bg-[#1e1e1e] border-r lg:border border-[#363432] lg:rounded-lg overflow-hidden
              transform transition-transform duration-200 ease-in-out
              ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
              flex flex-col
            `}>
              <div className="p-3 border-b border-[#363432] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setSidebarView('recipes')}
                      className={`px-2 py-1.5 rounded text-xs transition-colors ${
                        sidebarView === 'recipes'
                          ? 'bg-[#2a2826] text-[#f0ebe3]'
                          : 'text-[#9a9088] hover:bg-[#1b1b1b]'
                      }`}
                    >
                      Recipes ({recipes.length})
                    </button>
                    <button
                      onClick={() => setSidebarView('models')}
                      className={`px-2 py-1.5 rounded text-xs transition-colors ${
                        sidebarView === 'models'
                          ? 'bg-[#2a2826] text-[#f0ebe3]'
                          : 'text-[#9a9088] hover:bg-[#1b1b1b]'
                      }`}
                    >
                      Models ({models.length})
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        router.replace('/recipes?new=1');
                        startNewRecipe();
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-[#8b7355] text-white rounded hover:bg-[#8b7355]/90"
                    >
                      <Plus className="h-3 w-3" /> New
                    </button>
                    <button
                      onClick={() => setSidebarOpen(false)}
                      className="lg:hidden p-1.5 hover:bg-[#2a2826] rounded"
                    >
                      <ChevronLeft className="h-4 w-4 text-[#9a9088]" />
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9a9088]" />
                  <input
                    value={sidebarView === 'recipes' ? filter : modelFilter}
                    onChange={(e) => (sidebarView === 'recipes' ? setFilter(e.target.value) : setModelFilter(e.target.value))}
                    placeholder={sidebarView === 'recipes' ? 'Search recipes...' : 'Search models...'}
                    className="w-full pl-9 pr-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-[#8b7355]"
                  />
                </div>

                {sidebarView === 'models' && (
                  <div className="flex items-center justify-between text-xs text-[#9a9088]">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={onlyUnconfiguredModels}
                        onChange={(e) => setOnlyUnconfiguredModels(e.target.checked)}
                        className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]"
                      />
                      Only without recipes
                    </label>
                    {modelsConfigRoot && (
                      <span
                        className={`${modelsConfigRoot.exists ? 'text-[#9a9088]' : 'text-[#c97a6b]'}`}
                        title={modelsConfigRoot.path}
                      >
                        {modelsConfigRoot.exists ? 'models_dir ok' : 'models_dir missing'}
                      </span>
                    )}
                  </div>
                )}

                {sidebarView === 'models' && modelRoots.length > 0 && (
                  <div className="text-[10px] text-[#9a9088]/80 space-y-1">
                    <div className="uppercase tracking-wider">Scan roots</div>
                    <div className="space-y-0.5">
                      {modelRoots.slice(0, 4).map((r) => (
                        <div key={r.path} className="flex items-center justify-between gap-2">
                          <span className="truncate" title={r.path}>{r.path}</span>
                          <span className={`${r.exists ? 'text-[#7d9a6a]' : 'text-[#c97a6b]'}`}>
                            {r.exists ? 'ok' : 'missing'}
                          </span>
                        </div>
                      ))}
                      {modelRoots.length > 4 && (
                        <div className="text-[#9a9088]/60">+{modelRoots.length - 4} more…</div>
                      )}
                      {!modelsConfigRoot?.exists && configuredModelsDir && (
                        <div className="text-[#c97a6b]">
                          Set `VLLM_STUDIO_MODELS_DIR` (current: {configuredModelsDir})
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                {sidebarView === 'recipes' ? (
                  filteredRecipes.length === 0 ? (
                    <div className="p-6 text-sm text-center text-[#9a9088]">No recipes found</div>
                  ) : (
                    filteredRecipes.map((r) => {
                      const isPinned = pinnedRecipes.has(r.id);
                      const isSelected = (selectedId || draft.id) === r.id;
                      const isMenuOpen = recipeMenuOpen === r.id;
                      const isConfirmingDelete = deleteConfirm === r.id;
                      const isRunning = r.status === 'running';

                      return (
                        <div
                          key={r.id}
                          className={`relative group border-b border-[#363432]/50 transition-colors ${
                            isSelected ? 'bg-[#2a2826]' : 'hover:bg-[#1e1e1e]'
                          }`}
                        >
                          <button
                            onClick={() => {
                              router.replace(`/recipes?edit=${encodeURIComponent(r.id)}`);
                              selectRecipe(r);
                              setRecipeMenuOpen(null);
                            }}
                            className="w-full text-left p-3 sm:p-3 pr-12"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex items-center gap-2">
                                {isPinned && <Pin className="h-3 w-3 text-[#8b7355] flex-shrink-0" />}
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-[#f0ebe3] truncate">{r.name}</div>
                                  <div className="text-xs text-[#9a9088] truncate">{r.id}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {isRunning && (
                                  <span className="px-1.5 py-0.5 bg-[#7d9a6a]/10 text-[#7d9a6a] rounded text-[10px]">
                                    Running
                                  </span>
                                )}
                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                  r.backend === 'vllm' ? 'bg-[#6b9ac9]/10 text-[#6b9ac9]' : 'bg-[#9a6bc9]/10 text-[#9a6bc9]'
                                }`}>
                                  {r.backend}
                                </span>
                              </div>
                            </div>
                            <div className="text-xs text-[#9a9088]/70 mt-1 truncate">{r.model_path}</div>
                          </button>

                          {/* Actions menu button - always visible on mobile, hover on desktop */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRecipeMenuOpen(isMenuOpen ? null : r.id);
                              setDeleteConfirm(null);
                            }}
                            className="absolute right-2 top-3 p-2 rounded hover:bg-[#363432] sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                          >
                            <MoreVertical className="h-4 w-4 text-[#9a9088]" />
                          </button>

                          {/* Dropdown menu */}
                          {isMenuOpen && (
                            <div className="absolute right-2 top-12 z-20 bg-[#1e1e1e] border border-[#363432] rounded-lg shadow-xl py-1 min-w-[160px]">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  launchRecipeById(r.id);
                                  setRecipeMenuOpen(null);
                                }}
                                disabled={launching}
                                className="w-full px-4 py-3 text-left text-sm hover:bg-[#2a2826] flex items-center gap-3 text-[#f0ebe3]"
                              >
                                <Play className="h-4 w-4 text-[#7d9a6a]" /> Launch
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePin(r.id);
                                  setRecipeMenuOpen(null);
                                }}
                                className="w-full px-4 py-3 text-left text-sm hover:bg-[#2a2826] flex items-center gap-3 text-[#f0ebe3]"
                              >
                                {isPinned ? (
                                  <><PinOff className="h-4 w-4 text-[#9a9088]" /> Unpin</>
                                ) : (
                                  <><Pin className="h-4 w-4 text-[#8b7355]" /> Pin</>
                                )}
                              </button>
                              <div className="border-t border-[#363432] my-1" />
                              {isConfirmingDelete ? (
                                <div className="px-4 py-3 space-y-3">
                                  <div className="text-sm text-[#c97a6b]">Delete this recipe?</div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteRecipeById(r.id);
                                      }}
                                      disabled={isRunning}
                                      className="px-4 py-2 text-sm bg-[#c97a6b] text-white rounded-lg hover:bg-[#c97a6b]/90 disabled:opacity-50"
                                    >
                                      Delete
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteConfirm(null);
                                      }}
                                      className="px-4 py-2 text-sm border border-[#363432] rounded-lg hover:bg-[#2a2826] text-[#9a9088]"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isRunning) {
                                      alert('Stop the model before deleting this recipe.');
                                      return;
                                    }
                                    setDeleteConfirm(r.id);
                                  }}
                                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#2a2826] flex items-center gap-3 text-[#c97a6b]"
                                >
                                  <Trash2 className="h-4 w-4" /> Delete
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )
                ) : (
                  filteredModels.length === 0 ? (
                    <div className="p-6 text-sm text-center text-[#9a9088]">
                      {models.length === 0 ? 'No local models discovered' : 'No models match your filter'}
                    </div>
                  ) : (
                    filteredModels.map((m) => {
                      const recipeIds = m.recipe_ids || [];
                      const defaultRecipeId = recipeIds[0] || '';
                      const chosenRecipeId = modelRecipeChoice[m.path] || defaultRecipeId;
                      const chosenRecipe = chosenRecipeId ? recipeById.get(chosenRecipeId) : null;

                      const size = formatBytes(m.size_bytes);
                      const meta = [
                        size,
                        m.context_length ? `ctx ${m.context_length}` : null,
                        m.quantization || null,
                        m.architecture || null,
                      ].filter(Boolean).join(' • ');

                      return (
                        <div
                          key={m.path}
                          onClick={() => {
                            if (chosenRecipe) openRecipeById(chosenRecipe.id);
                            else startNewRecipeFromModel(m);
                          }}
                          className="p-3 sm:p-3 border-b border-[#363432]/50 hover:bg-[#1e1e1e] cursor-pointer transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-[#f0ebe3] truncate">{m.name}</div>
                              <div className="text-[10px] text-[#9a9088] truncate" title={m.path}>{m.path}</div>
                              {meta && <div className="text-[10px] text-[#9a9088]/70 mt-1 truncate">{meta}</div>}
                              {recipeIds.length > 0 && chosenRecipe && (
                                <div className="text-[10px] text-[#9a9088]/70 mt-1 truncate">
                                  Recipe: {chosenRecipe.name} ({chosenRecipe.id})
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col items-end gap-2 flex-shrink-0">
                              {recipeIds.length > 1 && (
                                <select
                                  value={chosenRecipeId}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setModelRecipeChoice((prev) => ({ ...prev, [m.path]: e.target.value }))}
                                  className="px-2.5 py-1.5 bg-[#1b1b1b] border border-[#363432] rounded text-xs text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                                  title="Choose recipe"
                                >
                                  {recipeIds.map((id) => (
                                    <option key={id} value={id}>
                                      {recipeById.get(id)?.name || id}
                                    </option>
                                  ))}
                                </select>
                              )}

                              {recipeIds.length > 0 ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (chosenRecipeId) void launchRecipeById(chosenRecipeId);
                                    }}
                                    disabled={launching || !chosenRecipeId}
                                    className="p-2.5 bg-[#7d9a6a] text-white rounded-lg hover:bg-[#7d9a6a]/90 disabled:opacity-50"
                                    title="Launch"
                                  >
                                    <Play className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (chosenRecipeId) openRecipeById(chosenRecipeId);
                                    }}
                                    disabled={!chosenRecipeId}
                                    className="p-2.5 border border-[#363432] rounded-lg hover:bg-[#2a2826] text-[#9a9088] disabled:opacity-50"
                                    title="Open recipe"
                                  >
                                    <ChevronRight className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startNewRecipeFromModel(m);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-2.5 text-sm bg-[#8b7355] text-white rounded-lg hover:bg-[#8b7355]/90"
                                  title="Create recipe"
                                >
                                  <Plus className="h-4 w-4" /> Create
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )
                )}
              </div>
            </section>

            {/* Recipe Editor */}
            <section className="flex-1 min-w-0 bg-[#1e1e1e] border border-[#363432] rounded-lg flex flex-col">
              <div className="p-3 sm:p-4 border-b border-[#363432] flex items-center justify-between gap-2 sm:gap-3">
                <div className="min-w-0 flex items-center gap-2">
                  {/* Mobile menu button */}
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="lg:hidden p-2 -ml-1 hover:bg-[#2a2826] rounded flex-shrink-0"
                  >
                    <Menu className="h-4 w-4 text-[#9a9088]" />
                  </button>
                  {draft.id && pinnedRecipes.has(draft.id) && (
                    <Pin className="h-4 w-4 text-[#8b7355] flex-shrink-0 hidden sm:block" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-[#f0ebe3] truncate text-sm sm:text-base">
                      {draft.name || (draft.model_path ? draft.model_path.split('/').pop() : 'New Recipe')}
                    </div>
                    <div className="text-[10px] sm:text-xs text-[#9a9088] truncate">
                      {draft.id ? `ID: ${draft.id}` : 'Not saved yet'}
                      {selectedIsRunning ? ' • running' : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                  {/* Pin toggle - hidden on mobile */}
                  {draft.id && (
                    <button
                      onClick={() => togglePin(draft.id)}
                      className={`hidden sm:flex p-2 border rounded-lg transition-colors ${
                        pinnedRecipes.has(draft.id)
                          ? 'border-[#8b7355] bg-[#8b7355]/10 text-[#8b7355]'
                          : 'border-[#363432] text-[#9a9088] hover:bg-[#2a2826]'
                      }`}
                      title={pinnedRecipes.has(draft.id) ? 'Unpin recipe' : 'Pin recipe'}
                    >
                      {pinnedRecipes.has(draft.id) ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </button>
                  )}
                  {/* Delete button - hidden on mobile */}
                  {draft.id && (
                    <button
                      onClick={deleteSelected}
                      disabled={selectedIsRunning}
                      className="hidden sm:flex p-2 border border-[#363432] rounded-lg hover:bg-[#2a2826] text-[#c97a6b] disabled:opacity-50"
                      title={selectedIsRunning ? 'Stop model first' : 'Delete recipe'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  {runningProcess && (
                    <button
                      onClick={stopRunning}
                      className="flex items-center gap-1 p-2 sm:px-3 sm:py-1.5 text-sm border border-[#363432] rounded-lg hover:bg-[#2a2826] text-[#9a9088]"
                      title="Stop running model"
                    >
                      <Square className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Stop</span>
                    </button>
                  )}
                  <button
                    onClick={launchSelected}
                    disabled={launching || saving || !draft.model_path}
                    className="flex items-center gap-1 p-2 sm:px-3 sm:py-1.5 text-sm bg-[#7d9a6a] text-white rounded-lg hover:bg-[#7d9a6a]/90 disabled:opacity-50"
                    title="Save and launch"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{launching ? 'Launching...' : 'Launch'}</span>
                  </button>
                  <button
                    onClick={async () => { await saveRecipe(); }}
                    disabled={saving || !isDirty}
                    className="flex items-center gap-1 p-2 sm:px-3 sm:py-1.5 text-sm border border-[#363432] rounded-lg hover:bg-[#2a2826] disabled:opacity-50 text-[#9a9088]"
                    title="Save recipe"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{saving ? 'Saving...' : 'Save'}</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-3 sm:p-4 space-y-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <div className="grid md:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">Model path</label>
                    <input
                      value={draft.model_path}
                      onChange={(e) => setDraftField('model_path', e.target.value)}
                      placeholder="/mnt/llm_models/..."
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-[#8b7355]"
                      list="models-list"
                    />
                    {draftModelInfo && (
                      <div className="mt-1 text-xs text-[#9a9088] truncate">
                        {[
                          formatBytes(draftModelInfo.size_bytes),
                          draftModelInfo.context_length ? `ctx ${draftModelInfo.context_length}` : null,
                          draftModelInfo.quantization || null,
                          draftModelInfo.architecture || null,
                          (draftModelInfo.recipe_ids?.length || 0) > 0 ? `${draftModelInfo.recipe_ids?.length} recipe(s)` : null,
                        ].filter(Boolean).join(' • ')}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-[#9a9088] mb-1">Backend</label>
                      <select
                        value={draft.backend}
                        onChange={(e) => setDraftField('backend', e.target.value as 'vllm' | 'sglang')}
                        className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                      >
                        <option value="vllm">vLLM</option>
                        <option value="sglang">SGLang</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-[#9a9088] mb-1">Port</label>
                      <input
                        type="number"
                        value={draft.port || 8000}
                        onChange={(e) => setDraftField('port', parseInt(e.target.value) || 8000)}
                        className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">Recipe name</label>
                    <input
                      value={draft.name}
                      onChange={(e) => setDraftField('name', e.target.value)}
                      placeholder="Human-friendly name"
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-[#8b7355]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">Recipe id</label>
                    <input
                      value={draft.id}
                      onChange={(e) => setDraftField('id', slugifyRecipeId(e.target.value))}
                      placeholder="e.g. glm-4-6v-awq"
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-[#8b7355]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">TP</label>
                    <input
                      type="number"
                      value={draft.tp || draft.tensor_parallel_size || 1}
                      onChange={(e) => setDraftField('tp', Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full px-3 py-2.5 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">PP</label>
                    <input
                      type="number"
                      value={draft.pp || draft.pipeline_parallel_size || 1}
                      onChange={(e) => setDraftField('pp', Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">Max context</label>
                    <input
                      type="number"
                      value={draft.max_model_len || ''}
                      onChange={(e) => setDraftField('max_model_len', e.target.value ? parseInt(e.target.value) : undefined)}
                      placeholder="e.g. 32768"
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-[#8b7355]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">GPU util</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.1"
                      max="1"
                      value={draft.gpu_memory_utilization ?? 0.9}
                      onChange={(e) => setDraftField('gpu_memory_utilization', Math.max(0.1, Math.min(1, parseFloat(e.target.value) || 0.9)))}
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">Max seqs</label>
                    <input
                      type="number"
                      value={draft.max_num_seqs || ''}
                      onChange={(e) => setDraftField('max_num_seqs', e.target.value ? parseInt(e.target.value) : undefined)}
                      placeholder="256"
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-[#8b7355]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">KV dtype</label>
                    <select
                      value={draft.kv_cache_dtype || 'auto'}
                      onChange={(e) => setDraftField('kv_cache_dtype', e.target.value)}
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                    >
                      <option value="auto">auto</option>
                      <option value="fp8">fp8</option>
                      <option value="fp8_e5m2">fp8_e5m2</option>
                      <option value="fp8_e4m3">fp8_e4m3</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">Quantization</label>
                    <select
                      value={draft.quantization || ''}
                      onChange={(e) => setDraftField('quantization', e.target.value || undefined)}
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                    >
                      <option value="">None</option>
                      <option value="awq">AWQ</option>
                      <option value="gptq">GPTQ</option>
                      <option value="fp8">FP8</option>
                      <option value="marlin">Marlin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-[#9a9088] mb-1">Dtype</label>
                    <select
                      value={draft.dtype || ''}
                      onChange={(e) => setDraftField('dtype', e.target.value || undefined)}
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                    >
                      <option value="">auto</option>
                      <option value="float16">float16</option>
                      <option value="bfloat16">bfloat16</option>
                      <option value="float32">float32</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex items-center gap-2 text-sm text-[#9a9088] hover:text-[#f0ebe3]"
                  >
                    {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    Advanced
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCommandMode((v) => !v)}
                      className="px-3 py-1.5 text-xs border border-[#363432] rounded-lg hover:bg-[#2a2826] text-[#9a9088]"
                    >
                      {commandMode ? 'Guided fields' : 'Command mode'}
                    </button>
                    <button
                      onClick={() => copyText(commandPreview)}
                      disabled={!commandPreview}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs border border-[#363432] rounded-lg hover:bg-[#2a2826] disabled:opacity-50 text-[#9a9088]"
                      title="Copy launch command"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-[#7d9a6a]" /> : <Copy className="h-3.5 w-3.5" />}
                      Copy command
                    </button>
                  </div>
                </div>

                {commandMode ? (
                  <div className="space-y-2">
                    <textarea
                      value={commandText}
                      onChange={(e) => setCommandText(e.target.value)}
                      rows={8}
                      className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-xs font-mono text-[#f0ebe3] focus:outline-none focus:border-[#8b7355]"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={parseCommandIntoDraft}
                        className="px-3 py-2 text-sm bg-[#8b7355] text-white rounded-lg hover:bg-[#8b7355]/90"
                      >
                        Parse into fields
                      </button>
                      {commandParseError && <div className="text-sm text-[#c97a6b]">{commandParseError}</div>}
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#1b1b1b] rounded-lg p-3 text-xs font-mono text-[#9a9088] whitespace-pre-wrap break-words">
                    {commandPreview || 'Fill the model path to see the command preview.'}
                  </div>
                )}

                {advancedOpen && (
                  <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                    {/* Reasoning & Tool Calling */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Reasoning & Tool Calling</h4>
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Reasoning parser</label>
                          <select value={draft.reasoning_parser || ''} onChange={(e) => setDraftField('reasoning_parser', e.target.value || undefined)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="">None</option>
                            <option value="deepseek_r1">DeepSeek R1</option>
                            <option value="qwen3">Qwen3</option>
                            <option value="granite">Granite</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Tool call parser</label>
                          <select value={draft.tool_call_parser || ''} onChange={(e) => setDraftField('tool_call_parser', e.target.value || undefined)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="">Auto-detect</option>
                            <option value="hermes">Hermes</option>
                            <option value="llama3_json">Llama 3 JSON</option>
                            <option value="mistral">Mistral</option>
                            <option value="internlm">InternLM</option>
                            <option value="jamba">Jamba</option>
                            <option value="pythonic">Pythonic</option>
                            <option value="glm4">GLM-4</option>
                            <option value="granite-20b-fc">Granite 20B FC</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Guided decoding</label>
                          <select value={draft.guided_decoding_backend || ''} onChange={(e) => setDraftField('guided_decoding_backend', e.target.value || undefined)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="">Default</option>
                            <option value="outlines">Outlines</option>
                            <option value="lm-format-enforcer">LM Format Enforcer</option>
                            <option value="xgrammar">XGrammar</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1.5 pt-1">
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.enable_thinking} onChange={(e) => setDraftField('enable_thinking', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Enable thinking blocks
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.enable_auto_tool_choice} onChange={(e) => setDraftField('enable_auto_tool_choice', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Auto tool choice
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Model Loading */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Model Loading</h4>
                      <div className="grid md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Served model name</label>
                          <input value={draft.served_model_name || ''} onChange={(e) => setDraftField('served_model_name', e.target.value || undefined)} placeholder="Override name" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Tokenizer</label>
                          <input value={draft.tokenizer || ''} onChange={(e) => setDraftField('tokenizer', e.target.value || undefined)} placeholder="Default: model path" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Tokenizer mode</label>
                          <select value={draft.tokenizer_mode || 'auto'} onChange={(e) => setDraftField('tokenizer_mode', e.target.value as 'auto' | 'slow' | 'mistral')} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="auto">Auto</option>
                            <option value="slow">Slow</option>
                            <option value="mistral">Mistral</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Dtype</label>
                          <select value={draft.dtype || ''} onChange={(e) => setDraftField('dtype', e.target.value || undefined)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="">Auto</option>
                            <option value="auto">auto</option>
                            <option value="float16">float16</option>
                            <option value="bfloat16">bfloat16</option>
                            <option value="float32">float32</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Load format</label>
                          <select value={draft.load_format || ''} onChange={(e) => setDraftField('load_format', e.target.value || undefined)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="">Auto</option>
                            <option value="auto">auto</option>
                            <option value="pt">pt (PyTorch)</option>
                            <option value="safetensors">safetensors</option>
                            <option value="npcache">npcache</option>
                            <option value="dummy">dummy</option>
                            <option value="tensorizer">tensorizer</option>
                            <option value="bitsandbytes">bitsandbytes</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Seed</label>
                          <input type="number" value={draft.seed || ''} onChange={(e) => setDraftField('seed', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="0" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Revision</label>
                          <input value={draft.revision || ''} onChange={(e) => setDraftField('revision', e.target.value || undefined)} placeholder="main" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div className="flex items-end">
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={draft.trust_remote_code !== false} onChange={(e) => setDraftField('trust_remote_code', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Trust remote code
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Quantization */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Quantization</h4>
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Method</label>
                          <select value={draft.quantization || ''} onChange={(e) => setDraftField('quantization', e.target.value || undefined)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="">None</option>
                            <option value="awq">AWQ</option>
                            <option value="gptq">GPTQ</option>
                            <option value="gptq_marlin">GPTQ Marlin</option>
                            <option value="awq_marlin">AWQ Marlin</option>
                            <option value="squeezellm">SqueezeLLM</option>
                            <option value="fp8">FP8</option>
                            <option value="fbgemm_fp8">FBGEMM FP8</option>
                            <option value="marlin">Marlin</option>
                            <option value="bitsandbytes">BitsAndBytes</option>
                            <option value="gguf">GGUF</option>
                            <option value="experts_int8">Experts INT8</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Quantization param path</label>
                          <input value={draft.quantization_param_path || ''} onChange={(e) => setDraftField('quantization_param_path', e.target.value || undefined)} placeholder="Optional JSON path" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                      </div>
                    </div>

                    {/* Parallelism */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Parallelism</h4>
                      <div className="grid md:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Tensor parallel (TP)</label>
                          <input type="number" value={draft.tp || draft.tensor_parallel_size || 1} onChange={(e) => setDraftField('tp', Math.max(1, parseInt(e.target.value) || 1))} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Pipeline parallel (PP)</label>
                          <input type="number" value={draft.pp || draft.pipeline_parallel_size || 1} onChange={(e) => setDraftField('pp', Math.max(1, parseInt(e.target.value) || 1))} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Data parallel (DP)</label>
                          <input type="number" value={draft.data_parallel_size || ''} onChange={(e) => setDraftField('data_parallel_size', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="1" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Executor backend</label>
                          <select value={draft.distributed_executor_backend || ''} onChange={(e) => setDraftField('distributed_executor_backend', e.target.value as 'ray' | 'mp' | undefined)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="">Auto</option>
                            <option value="mp">Multiprocessing</option>
                            <option value="ray">Ray</option>
                          </select>
                        </div>
                      </div>
                      <label className="mt-2 flex items-center gap-2 text-xs text-[#9a9088]">
                        <input type="checkbox" checked={!!draft.enable_expert_parallel} onChange={(e) => setDraftField('enable_expert_parallel', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                        Expert parallel (MoE models)
                      </label>
                    </div>

                    {/* Memory & KV Cache */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Memory & KV Cache</h4>
                      <div className="grid md:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">KV cache dtype</label>
                          <select value={draft.kv_cache_dtype || 'auto'} onChange={(e) => setDraftField('kv_cache_dtype', e.target.value)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="auto">Auto</option>
                            <option value="fp8">FP8</option>
                            <option value="fp8_e5m2">FP8 E5M2</option>
                            <option value="fp8_e4m3">FP8 E4M3</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Block size</label>
                          <select value={draft.block_size || ''} onChange={(e) => setDraftField('block_size', e.target.value ? parseInt(e.target.value) : undefined)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="">Auto</option>
                            <option value="8">8</option>
                            <option value="16">16</option>
                            <option value="32">32</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Swap space (GB)</label>
                          <input type="number" step="0.5" value={draft.swap_space || ''} onChange={(e) => setDraftField('swap_space', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="4" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">CPU offload (GB)</label>
                          <input type="number" step="0.5" value={draft.cpu_offload_gb || ''} onChange={(e) => setDraftField('cpu_offload_gb', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="0" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">GPU blocks override</label>
                          <input type="number" value={draft.num_gpu_blocks_override || ''} onChange={(e) => setDraftField('num_gpu_blocks_override', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Auto" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div className="md:col-span-3 flex items-end gap-4">
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.enable_prefix_caching} onChange={(e) => setDraftField('enable_prefix_caching', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Prefix caching
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.use_v2_block_manager} onChange={(e) => setDraftField('use_v2_block_manager', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            V2 block manager
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Scheduler & Batching */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Scheduler & Batching</h4>
                      <div className="grid md:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Max seqs</label>
                          <input type="number" value={draft.max_num_seqs || ''} onChange={(e) => setDraftField('max_num_seqs', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="256" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Max batched tokens</label>
                          <input type="number" value={draft.max_num_batched_tokens || ''} onChange={(e) => setDraftField('max_num_batched_tokens', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Auto" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Scheduling policy</label>
                          <select value={draft.scheduling_policy || 'fcfs'} onChange={(e) => setDraftField('scheduling_policy', e.target.value as 'fcfs' | 'priority')} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="fcfs">FCFS</option>
                            <option value="priority">Priority</option>
                          </select>
                        </div>
                        <div className="flex items-end">
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.enable_chunked_prefill} onChange={(e) => setDraftField('enable_chunked_prefill', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Chunked prefill
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Performance Tuning */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Performance</h4>
                      <div className="grid md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">CUDA graph max batch</label>
                          <input type="number" value={draft.cuda_graph_max_bs || ''} onChange={(e) => setDraftField('cuda_graph_max_bs', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Auto" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div className="md:col-span-2 flex items-end gap-4 flex-wrap">
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.enforce_eager} onChange={(e) => setDraftField('enforce_eager', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Enforce eager
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.disable_cuda_graph} onChange={(e) => setDraftField('disable_cuda_graph', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Disable CUDA graph
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.disable_custom_all_reduce} onChange={(e) => setDraftField('disable_custom_all_reduce', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Disable custom all-reduce
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Speculative Decoding */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Speculative Decoding</h4>
                      <div className="grid md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Speculative model</label>
                          <input value={draft.speculative_model || ''} onChange={(e) => setDraftField('speculative_model', e.target.value || undefined)} placeholder="Path or [ngram]" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Num spec tokens</label>
                          <input type="number" value={draft.num_speculative_tokens || ''} onChange={(e) => setDraftField('num_speculative_tokens', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="5" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Draft TP size</label>
                          <input type="number" value={draft.speculative_draft_tensor_parallel_size || ''} onChange={(e) => setDraftField('speculative_draft_tensor_parallel_size', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="1" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Spec quant</label>
                          <input value={draft.speculative_model_quantization || ''} onChange={(e) => setDraftField('speculative_model_quantization', e.target.value || undefined)} placeholder="None" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Acceptance method</label>
                          <select value={draft.spec_decoding_acceptance_method || ''} onChange={(e) => setDraftField('spec_decoding_acceptance_method', e.target.value as 'rejection_sampler' | 'typical_acceptance_sampler' | undefined)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="">Default</option>
                            <option value="rejection_sampler">Rejection sampler</option>
                            <option value="typical_acceptance_sampler">Typical acceptance</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Ngram lookup max</label>
                          <input type="number" value={draft.ngram_prompt_lookup_max || ''} onChange={(e) => setDraftField('ngram_prompt_lookup_max', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="4" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                      </div>
                    </div>

                    {/* LoRA */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">LoRA Adapters</h4>
                      <div className="grid md:grid-cols-4 gap-3">
                        <div className="flex items-end">
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.enable_lora} onChange={(e) => setDraftField('enable_lora', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Enable LoRA
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Max LoRAs</label>
                          <input type="number" value={draft.max_loras || ''} onChange={(e) => setDraftField('max_loras', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="1" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Max rank</label>
                          <input type="number" value={draft.max_lora_rank || ''} onChange={(e) => setDraftField('max_lora_rank', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="16" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Extra vocab size</label>
                          <input type="number" value={draft.lora_extra_vocab_size || ''} onChange={(e) => setDraftField('lora_extra_vocab_size', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="256" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                      </div>
                    </div>

                    {/* Chat & Templates */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Chat & Templates</h4>
                      <div className="grid md:grid-cols-3 gap-3">
                        <div className="md:col-span-2">
                          <label className="block text-xs text-[#9a9088] mb-1">Chat template path</label>
                          <input value={draft.chat_template || ''} onChange={(e) => setDraftField('chat_template', e.target.value || undefined)} placeholder="Optional Jinja2 template path" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Content format</label>
                          <select value={draft.chat_template_content_format || 'auto'} onChange={(e) => setDraftField('chat_template_content_format', e.target.value as 'auto' | 'string' | 'openai')} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="auto">Auto</option>
                            <option value="string">String</option>
                            <option value="openai">OpenAI</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Response role</label>
                          <input value={draft.response_role || ''} onChange={(e) => setDraftField('response_role', e.target.value || undefined)} placeholder="assistant" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                      </div>
                    </div>

                    {/* Multimodal */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Multimodal</h4>
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Allowed local media path</label>
                          <input value={draft.allowed_local_media_path || ''} onChange={(e) => setDraftField('allowed_local_media_path', e.target.value || undefined)} placeholder="/path/to/media" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Limit MM per prompt</label>
                          <input value={draft.limit_mm_per_prompt || ''} onChange={(e) => setDraftField('limit_mm_per_prompt', e.target.value || undefined)} placeholder='{"image": 1}' className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm font-mono text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                      </div>
                    </div>

                    {/* Logging */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Logging & Server</h4>
                      <div className="grid md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Log level</label>
                          <select value={draft.uvicorn_log_level || 'info'} onChange={(e) => setDraftField('uvicorn_log_level', e.target.value)} className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3]">
                            <option value="debug">Debug</option>
                            <option value="info">Info</option>
                            <option value="warning">Warning</option>
                            <option value="error">Error</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Max log length</label>
                          <input type="number" value={draft.max_log_len || ''} onChange={(e) => setDraftField('max_log_len', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Unlimited" className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-sm text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div className="flex items-end gap-4 flex-wrap">
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.disable_log_requests} onChange={(e) => setDraftField('disable_log_requests', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Disable request logs
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                            <input type="checkbox" checked={!!draft.disable_log_stats} onChange={(e) => setDraftField('disable_log_stats', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                            Disable stats logs
                          </label>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-4 flex-wrap">
                        <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                          <input type="checkbox" checked={!!draft.disable_frontend_multiprocessing} onChange={(e) => setDraftField('disable_frontend_multiprocessing', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                          Disable frontend multiprocessing
                        </label>
                        <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                          <input type="checkbox" checked={!!draft.disable_fastapi_docs} onChange={(e) => setDraftField('disable_fastapi_docs', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                          Disable FastAPI docs
                        </label>
                        <label className="flex items-center gap-2 text-xs text-[#9a9088]">
                          <input type="checkbox" checked={!!draft.enable_request_id_headers} onChange={(e) => setDraftField('enable_request_id_headers', e.target.checked)} className="rounded border-[#363432] bg-[#1b1b1b] text-[#7d9a6a]" />
                          Request ID headers
                        </label>
                      </div>
                    </div>

                    {/* Extra Args / Env Vars */}
                    <div className="p-3 bg-[#1b1b1b] border border-[#363432] rounded-lg">
                      <h4 className="text-xs font-medium text-[#8b7355] uppercase tracking-wider mb-3">Custom Arguments</h4>
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Environment variables (JSON)</label>
                          <textarea value={envVarsText} onChange={(e) => { setEnvVarsText(e.target.value); setIsDirty(true); }} rows={4} placeholder='{"CUDA_VISIBLE_DEVICES": "0,1"}' className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-xs font-mono text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#9a9088] mb-1">Extra args (JSON)</label>
                          <textarea value={extraArgsText} onChange={(e) => { setExtraArgsText(e.target.value); setIsDirty(true); }} rows={4} placeholder='{"--custom-arg": "value"}' className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#363432] rounded text-xs font-mono text-[#f0ebe3] placeholder-[#9a9088]/50" />
                        </div>
                      </div>
                      {jsonError && <div className="mt-2 text-xs text-[#c97a6b]">{jsonError}</div>}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        <datalist id="models-list">
          {models.map((m) => (
            <option key={m.path} value={m.path}>
              {m.name}
            </option>
          ))}
        </datalist>
      </div>
      </div>

      {/* Launch Toast */}
      {(launching || launchProgress) && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 px-4 py-3 bg-[#1e1e1e] rounded-lg shadow-2xl sm:max-w-xs border border-[#363432]" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex items-center gap-3">
            {launchProgress?.stage === 'error' || launchProgress?.stage === 'cancelled' ? (
              <X className="h-4 w-4 text-[#c97a6b] flex-shrink-0" />
            ) : launchProgress?.stage === 'ready' ? (
              <Check className="h-4 w-4 text-[#7d9a6a] flex-shrink-0" />
            ) : (
              <Activity className="h-4 w-4 text-[#8b7355] animate-pulse flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm text-[#f0ebe3] capitalize">{launchProgress?.stage || 'Starting...'}</div>
              <div className="text-xs text-[#9a9088] truncate">{launchProgress?.message || 'Preparing...'}</div>
            </div>
          </div>
          {launchProgress?.progress != null && launchProgress.stage !== 'ready' && launchProgress.stage !== 'error' && launchProgress.stage !== 'cancelled' && (
            <div className="mt-2 h-1.5 sm:h-1 bg-[#363432] rounded-full overflow-hidden">
              <div className="h-full bg-[#8b7355] rounded-full transition-all" style={{ width: `${Math.round(launchProgress.progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RecipesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full bg-[#1b1b1b]">
          <div className="flex items-center gap-2 text-[#9a9088]">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        </div>
      }
    >
      <RecipesContent />
    </Suspense>
  );
}
