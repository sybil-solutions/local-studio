'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import {
  Calculator,
  ChevronDown,
  MoreVertical,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import type { Recipe, RecipeWithStatus, VRAMCalculation } from '@/lib/types';
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
  const [tab, setTab] = useState<Tab>('recipes');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [filter, setFilter] = useState('');
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
      if (saved) setPinnedRecipes(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

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

  const loadRecipes = useCallback(async () => {
    try {
      const recipesData = await api.getRecipes().catch(() => ({ recipes: [] as RecipeWithStatus[] }));
      const recipesList = recipesData.recipes || [];
      setRecipes(recipesList);
      const running = recipesList.find((r) => r.status === 'running')?.id || null;
      setRunningRecipeId(running);
    } catch (e) {
      console.error('Failed to load recipes:', e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadRecipes();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadRecipes]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadRecipes();
    setRefreshing(false);
  };

  const handleNewRecipe = () => {
    setModalRecipe({ ...DEFAULT_RECIPE });
    setModalOpen(true);
  };

  const handleEditRecipe = (recipe: RecipeWithStatus) => {
    setModalRecipe({ ...recipe });
    setModalOpen(true);
    setRecipeMenuOpen(null);
  };

  const handleSaveRecipe = async () => {
    if (!modalRecipe) return;

    setSaving(true);
    try {
      if (modalRecipe.id) {
        await api.updateRecipe(modalRecipe.id, modalRecipe);
      } else {
        // Generate ID from name
        const id = modalRecipe.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        await api.createRecipe({ ...modalRecipe, id });
      }
      await loadRecipes();
      setModalOpen(false);
      setModalRecipe(null);
    } catch (e) {
      alert('Failed to save recipe: ' + (e as Error).message);
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
      alert('Failed to delete: ' + (e as Error).message);
    }
  };

  const handleLaunchRecipe = async (recipeId: string) => {
    setLaunching(true);
    try {
      await api.launch(recipeId);
      // Wait for launch to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      await loadRecipes();
    } catch (e) {
      alert('Failed to launch: ' + (e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const handleEvictModel = async () => {
    try {
      await api.evictModel();
      await loadRecipes();
    } catch (e) {
      alert('Failed to evict: ' + (e as Error).message);
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
      alert('Failed to calculate: ' + (e as Error).message);
    } finally {
      setCalculating(false);
    }
  };

  // Filter recipes
  const filteredRecipes = recipes.filter(r =>
    r.name.toLowerCase().includes(filter.toLowerCase()) ||
    r.model_path.toLowerCase().includes(filter.toLowerCase())
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
      <div className="flex items-center justify-between border-b border-[#1f1f1f]" style={{ paddingLeft: '1.5rem', paddingRight: '1.5rem', paddingTop: '1rem', paddingBottom: '1rem' }}>
        <h1 className="text-xl font-semibold">Recipes</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 hover:bg-[#1f1f1f] rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#1f1f1f]" style={{ paddingLeft: '1.5rem', paddingRight: '1.5rem', paddingTop: '1rem' }}>
        <button
          onClick={() => setTab('recipes')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            tab === 'recipes'
              ? 'text-[#e8e6e3] border-[#d97706]'
              : 'text-[#9a9088] border-transparent hover:text-[#e8e6e3]'
          }`}
        >
          Recipes
        </button>
        <button
          onClick={() => setTab('tools')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            tab === 'tools'
              ? 'text-[#e8e6e3] border-[#d97706]'
              : 'text-[#9a9088] border-transparent hover:text-[#e8e6e3]'
          }`}
        >
          <Calculator className="w-4 h-4 inline mr-2" />
          VRAM Calculator
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === 'recipes' && (
          <div style={{ padding: '1.5rem' }}>
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
                      Model Running: {recipes.find(r => r.id === runningRecipeId)?.name}
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
                {filter ? 'No recipes match your search' : 'No recipes yet. Create one to get started.'}
              </div>
            ) : (
              <div className="border border-[#363432] rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-[#1b1b1b] border-b border-[#363432]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider w-8"></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider">Model</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider">Backend</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider">TP/PP</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[#9a9088] uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[#9a9088] uppercase tracking-wider">Actions</th>
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
                        <td className="px-4 py-3 text-sm text-[#9a9088] font-mono truncate max-w-xs">
                          {recipe.model_path.split('/').pop()}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="px-2 py-1 bg-[#1b1b1b] border border-[#363432] rounded text-xs">
                            {recipe.backend || 'vllm'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-[#9a9088]">
                          {recipe.tp || recipe.tensor_parallel_size || 1}/{recipe.pp || recipe.pipeline_parallel_size || 1}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                              recipe.status === 'running'
                                ? 'bg-[#15803d]/20 text-[#4ade80] border border-[#15803d]/30'
                                : recipe.status === 'starting'
                                ? 'bg-[#d97706]/20 text-[#fbbf24] border border-[#d97706]/30'
                                : 'bg-[#363432]/20 text-[#9a9088] border border-[#363432]'
                            }`}
                          >
                            {recipe.status || 'stopped'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {recipe.status === 'running' ? (
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
                                  setRecipeMenuOpen(recipeMenuOpen === recipe.id ? null : recipe.id);
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

        {tab === 'tools' && (
          <div style={{ padding: '1.5rem' }} className="max-w-2xl">
            <h2 className="text-lg font-semibold mb-4">VRAM Calculator</h2>
            <div className="space-y-4 bg-[#1b1b1b] border border-[#363432] rounded-lg p-6">
              <div>
                <label className="block text-sm text-[#9a9088] mb-2">Model Path</label>
                <input
                  type="text"
                  value={vramModel}
                  onChange={(e) => setVramModel(e.target.value)}
                  placeholder="/path/to/model"
                  className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                />
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
                    onChange={(e) => setKvDtype(e.target.value as 'auto' | 'fp16' | 'fp8')}
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
                {calculating ? 'Calculating...' : 'Calculate VRAM'}
              </button>

              {vramResult && (
                <div className="mt-6 space-y-3 pt-6 border-t border-[#363432]">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9a9088]">Model Size</span>
                    <span className="font-medium">{vramResult.breakdown.model_weights_gb.toFixed(2)} GB</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9a9088]">KV Cache</span>
                    <span className="font-medium">{vramResult.breakdown.kv_cache_gb.toFixed(2)} GB</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9a9088]">Activations</span>
                    <span className="font-medium">{vramResult.breakdown.activations_gb.toFixed(2)} GB</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9a9088]">Per GPU</span>
                    <span className="font-medium">{vramResult.breakdown.per_gpu_gb.toFixed(2)} GB</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold pt-3 border-t border-[#363432]">
                    <span>Total VRAM</span>
                    <span className={vramResult.fits ? 'text-[#4ade80]' : 'text-[#dc2626]'}>
                      {vramResult.breakdown.total_gb.toFixed(2)} GB
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#9a9088]">Utilization</span>
                    <span className="font-medium">{vramResult.utilization_percent.toFixed(1)}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1b1b1b] border border-[#363432] rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Delete Recipe</h3>
            <p className="text-sm text-[#9a9088] mb-6">
              Are you sure you want to delete &quot;{recipes.find(r => r.id === deleteConfirm)?.name}&quot;?
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
        />
      )}
    </div>
  );
}

// Recipe Modal Component
function RecipeModal({
  recipe,
  onClose,
  onSave,
  onChange,
  saving,
}: {
  recipe: Recipe;
  onClose: () => void;
  onSave: () => void;
  onChange: (recipe: Recipe) => void;
  saving: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1b1b1b] border border-[#363432] rounded-lg max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#363432]">
          <h3 className="text-lg font-semibold">{recipe.id ? 'Edit Recipe' : 'New Recipe'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-[#363432] rounded transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Basic fields */}
          <div>
            <label className="block text-sm text-[#9a9088] mb-2">Name *</label>
            <input
              type="text"
              value={recipe.name}
              onChange={(e) => onChange({ ...recipe, name: e.target.value })}
              placeholder="My Recipe"
              className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#9a9088] mb-2">Model Path *</label>
            <input
              type="text"
              value={recipe.model_path}
              onChange={(e) => onChange({ ...recipe, model_path: e.target.value })}
              placeholder="/path/to/model"
              className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#9a9088] mb-2">Backend</label>
              <select
                value={recipe.backend || 'vllm'}
                onChange={(e) => onChange({ ...recipe, backend: e.target.value as 'vllm' | 'sglang' })}
                className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
              >
                <option value="vllm">vLLM</option>
                <option value="sglang">SGLang</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-[#9a9088] mb-2">Port</label>
              <input
                type="number"
                value={recipe.port}
                onChange={(e) => onChange({ ...recipe, port: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#9a9088] mb-2">Tensor Parallel (TP)</label>
              <input
                type="number"
                value={recipe.tp}
                onChange={(e) => onChange({ ...recipe, tp: Number(e.target.value) })}
                min={1}
                className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#9a9088] mb-2">Pipeline Parallel (PP)</label>
              <input
                type="number"
                value={recipe.pp}
                onChange={(e) => onChange({ ...recipe, pp: Number(e.target.value) })}
                min={1}
                className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#9a9088] mb-2">GPU Memory Utilization</label>
            <input
              type="number"
              value={recipe.gpu_memory_utilization}
              onChange={(e) => onChange({ ...recipe, gpu_memory_utilization: Number(e.target.value) })}
              min={0}
              max={1}
              step={0.05}
              className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
            />
          </div>

          {/* Advanced section */}
          <div>
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-2 text-sm text-[#9a9088] hover:text-[#e8e6e3] transition-colors"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              Advanced Options
            </button>
            {advancedOpen && (
              <div className="mt-4 space-y-4 pl-6">
                <div>
                  <label className="block text-sm text-[#9a9088] mb-2">Max Model Length</label>
                  <input
                    type="number"
                    value={recipe.max_model_len || ''}
                    onChange={(e) => onChange({ ...recipe, max_model_len: Number(e.target.value) || undefined })}
                    placeholder="32768"
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#9a9088] mb-2">Quantization</label>
                  <input
                    type="text"
                    value={recipe.quantization || ''}
                    onChange={(e) => onChange({ ...recipe, quantization: e.target.value || undefined })}
                    placeholder="awq, gptq, fp8, etc."
                    className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#363432] rounded-lg text-sm focus:outline-none focus:border-[#d97706]"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm text-[#9a9088]">
                    <input
                      type="checkbox"
                      checked={recipe.trust_remote_code || false}
                      onChange={(e) => onChange({ ...recipe, trust_remote_code: e.target.checked })}
                      className="rounded border-[#363432] bg-[#0d0d0d]"
                    />
                    Trust Remote Code
                  </label>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm text-[#9a9088]">
                    <input
                      type="checkbox"
                      checked={recipe.enable_prefix_caching || false}
                      onChange={(e) => onChange({ ...recipe, enable_prefix_caching: e.target.checked })}
                      className="rounded border-[#363432] bg-[#0d0d0d]"
                    />
                    Enable Prefix Caching
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#363432]">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 bg-[#363432] hover:bg-[#494745] rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !recipe.name.trim() || !recipe.model_path.trim()}
            className="px-4 py-2 bg-[#d97706] hover:bg-[#b45309] text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Recipe'}
          </button>
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
