'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Play, Cpu, Zap, HardDrive, Activity, Clock, Hash, Thermometer, MemoryStick, Settings, MessageSquare, FileText, Square, X, Check, Wifi, WifiOff, Gauge } from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useRealtimeStatus } from '@/hooks/useRealtimeStatus';
import type { GPU, RecipeWithStatus, ProcessInfo, Metrics } from '@/lib/types';

export default function Dashboard() {
  // Real-time data from SSE (updates every 1 second)
  const {
    status: realtimeStatus,
    gpus: realtimeGpus,
    metrics: realtimeMetrics,
    launchProgress,
    isConnected,
    error: connectionError,
    reconnectAttempts,
  } = useRealtimeStatus();

  // State for recipes and UI
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [currentRecipe, setCurrentRecipe] = useState<RecipeWithStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RecipeWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const router = useRouter();

  // Derived state from real-time data
  const gpus = realtimeGpus.length > 0 ? realtimeGpus : [];
  const currentProcess = realtimeStatus?.process || null;
  const metrics = realtimeMetrics;

  // Load recipes (only needs to be done once and when actions occur)
  const loadRecipes = useCallback(async () => {
    try {
      const recipesData = await api.getRecipes();
      const recipesList = recipesData.recipes || [];
      setRecipes(recipesList);

      // Find running recipe if there's a current process
      if (currentProcess) {
        const runningRecipe = recipesList.find((r: RecipeWithStatus) => r.status === 'running');
        setCurrentRecipe(runningRecipe || null);

        if (runningRecipe) {
          const logsData = await api.getLogs(runningRecipe.id, 50).catch(() => ({ logs: [] }));
          setLogs(logsData.logs || []);
        }
      } else {
        setCurrentRecipe(null);
        setLogs([]);
      }
    } catch (e) {
      console.error('Failed to load recipes:', e);
    } finally {
      setLoading(false);
    }
  }, [currentProcess]);

  // Initial load and reload when process status changes
  useEffect(() => {
    loadRecipes();
  }, [loadRecipes]);

  // Refresh recipes when launch progress completes
  useEffect(() => {
    if (launchProgress?.stage === 'ready' || launchProgress?.stage === 'error') {
      loadRecipes();
    }
  }, [launchProgress?.stage, loadRecipes]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const results = recipes.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.model_path.toLowerCase().includes(q)
      ).slice(0, 8);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, recipes]);

  const handleLaunch = async (recipeId: string) => {
    setLaunching(true);
    try {
      // Launch is now async with progress events via SSE
      await api.switchModel(recipeId, true);
      setSearchQuery('');
      // Progress will be shown via launchProgress from SSE
      // loadRecipes will be called when progress reaches 'ready' or 'error'
    } catch (e) {
      alert('Failed to launch: ' + (e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const handleStop = async () => {
    if (!confirm('Stop the current model?')) return;
    try {
      await api.evictModel(true);
      await loadRecipes();
    } catch (e) {
      alert('Failed to stop model: ' + (e as Error).message);
    }
  };

  const handleBenchmark = async () => {
    if (benchmarking) return;
    setBenchmarking(true);
    try {
      const result = await api.runBenchmark(1000, 100);
      if (result.error) {
        alert('Benchmark error: ' + result.error);
      }
      // Peak metrics will be updated via SSE
    } catch (e) {
      alert('Benchmark failed: ' + (e as Error).message);
    } finally {
      setBenchmarking(false);
    }
  };

  const getTempColor = (temp: number) => {
    if (temp > 80) return 'text-[var(--error)]';
    if (temp > 60) return 'text-[var(--warning)]';
    return 'text-[var(--success)]';
  };

  const getMemColor = (pct: number) => {
    if (pct > 90) return 'text-[var(--error)]';
    if (pct > 70) return 'text-[var(--warning)]';
    return 'text-[var(--success)]';
  };

  const getCapabilities = () => {
    if (!currentRecipe) return [];
    const caps = [];
    if (currentRecipe.tool_call_parser) caps.push('Tool Use');
    if (currentRecipe.enable_auto_tool_choice) caps.push('Auto Tools');

    const name = currentRecipe.model_path?.toLowerCase() || '';
    if (name.includes('vision') || name.includes('vl') || name.includes('llava') || name.includes('4.6v')) caps.push('Vision');
    if (name.includes('reason') || name.includes('qwq') || name.includes('r1')) caps.push('Reasoning');
    caps.push('Chat');

    return caps;
  };

  const formatNumber = (num: number | null | undefined, decimals = 1) => {
    if (num === null || num === undefined) return '--';
    return num.toFixed(decimals);
  };

  // Convert memory to GB - handles bytes, MB, or already GB
  const toGB = (value: number): number => {
    // Bytes: typically > 1 billion for GPU memory (e.g., 25769803776 for 24GB)
    if (value > 1e10) return value / (1024 * 1024 * 1024);
    // Also bytes but smaller (e.g., 534773760 for 0.5GB used)
    if (value > 1e8) return value / (1024 * 1024 * 1024);
    // MB: typically thousands (e.g., 24576 for 24GB)
    if (value > 1000) return value / 1024;
    // Already GB
    return value;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse-soft">
          <Activity className="h-8 w-8 text-[var(--muted)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4 sm:space-y-6 overflow-x-hidden w-full">
      {/* Connection status indicator */}
      {!isConnected && (
        <div className="fixed top-16 right-4 z-50 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg shadow-lg animate-pulse">
          <div className="flex items-center gap-2 text-xs text-yellow-400">
            <WifiOff className="h-3 w-3" />
            <span>Reconnecting... (attempt {reconnectAttempts})</span>
          </div>
        </div>
      )}

      {connectionError && isConnected === false && reconnectAttempts >= 10 && (
        <div className="fixed top-16 right-4 z-50 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg shadow-lg">
          <div className="flex items-center gap-2 text-xs text-red-400">
            <X className="h-3 w-3" />
            <span>Connection failed - updates paused</span>
          </div>
        </div>
      )}

      {/* GPU Grid */}
      <section>
        <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2 sm:mb-3">GPU Status</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-3">
          {gpus.map((gpu) => {
            const memUsedRaw = gpu.memory_used_mb ?? gpu.memory_used ?? 0;
            const memTotalRaw = gpu.memory_total_mb ?? gpu.memory_total ?? 1;
            const memUsedGB = toGB(memUsedRaw);
            const memTotalGB = toGB(memTotalRaw);
            const memPct = Math.round((memUsedGB / memTotalGB) * 100);
            const temp = gpu.temp_c ?? gpu.temperature ?? 0;
            const util = gpu.utilization_pct ?? gpu.utilization ?? 0;
            return (
              <div key={gpu.id ?? gpu.index} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-2 sm:p-3">
                <div className="flex items-center justify-between mb-1 sm:mb-2">
                  <span className="text-[10px] sm:text-xs font-medium text-[var(--muted-foreground)]">GPU {gpu.id ?? gpu.index}</span>
                  <span className={`text-[10px] sm:text-xs font-mono ${getTempColor(temp)}`}>
                    {temp}°C
                  </span>
                </div>
                <div className="text-[9px] sm:text-[10px] text-[var(--muted)] truncate mb-1 sm:mb-2">{gpu.name?.replace('NVIDIA GeForce ', '').replace('RTX ', '')}</div>
                <div className="flex items-center justify-between text-[10px] sm:text-xs">
                  <span className={`font-mono ${getMemColor(memPct)}`}>
                    {memUsedGB.toFixed(1)}/{memTotalGB.toFixed(0)}G
                  </span>
                  <span className="text-[var(--muted-foreground)]">{util}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6 min-w-0">
          {/* Running Model */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0 mb-4">
              <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide">Running Model</h2>
              <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                {currentProcess ? (
                  <>
                    <button
                      onClick={() => router.push('/chat')}
                      className="flex items-center gap-1 px-2 py-1 border border-[var(--border)] rounded text-xs hover:bg-[var(--card-hover)]"
                      title="Open chat"
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Chat</span>
                    </button>
                    <button
                      onClick={() => router.push('/logs')}
                      className="flex items-center gap-1 px-2 py-1 border border-[var(--border)] rounded text-xs hover:bg-[var(--card-hover)]"
                      title="Open logs"
                    >
                      <FileText className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Logs</span>
                    </button>
                    <button
                      onClick={handleBenchmark}
                      disabled={benchmarking}
                      className="flex items-center gap-1 px-2 py-1 border border-[var(--border)] rounded text-xs hover:bg-[var(--card-hover)] disabled:opacity-50"
                      title="Run benchmark to measure peak performance"
                    >
                      <Gauge className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{benchmarking ? 'Running...' : 'Benchmark'}</span>
                    </button>
                    {currentRecipe?.id ? (
                      <button
                        onClick={() => router.push(`/recipes?edit=${currentRecipe.id}`)}
                        className="flex items-center gap-1 px-2 py-1 border border-[var(--border)] rounded text-xs hover:bg-[var(--card-hover)]"
                        title="Edit recipe"
                      >
                        <Settings className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
                      </button>
                    ) : null}
                    <button
                      onClick={handleStop}
                      className="flex items-center gap-1 px-2 py-1 border border-[var(--border)] rounded text-xs hover:bg-[var(--card-hover)] text-[var(--error)]"
                      title="Stop model"
                    >
                      <Square className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Stop</span>
                    </button>
                  </>
                ) : null}
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  currentProcess ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--error)]/10 text-[var(--error)]'
                }`}>
                  {currentProcess ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>

            {currentProcess ? (
              <div className="space-y-4">
                <div>
                  <div className="text-lg font-semibold tracking-tight">
                    {currentRecipe?.name || currentProcess.model_path?.split('/').pop() || 'Unknown Model'}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] font-mono truncate mt-1">
                    {currentProcess.model_path || 'Unknown'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {getCapabilities().map((cap) => (
                    <span key={cap} className="px-2 py-1 bg-[var(--accent)] text-[var(--foreground)] rounded text-xs">
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-[var(--background)] rounded-lg p-3 text-center">
                    <div className="text-xl font-mono font-semibold">
                      {metrics?.peak_ttft_ms ? `${Math.round(metrics.peak_ttft_ms)}ms` : (metrics?.avg_ttft_ms ? `${Math.round(metrics.avg_ttft_ms)}ms` : '--')}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)]">Best TTFT</div>
                  </div>
                  <div className="bg-[var(--background)] rounded-lg p-3 text-center">
                    <div className="text-xl font-mono font-semibold">
                      {formatNumber(metrics?.peak_generation_tps) !== '--' ? formatNumber(metrics?.peak_generation_tps) : formatNumber(metrics?.generation_throughput)}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)]">Peak Gen TPS</div>
                  </div>
                  <div className="bg-[var(--background)] rounded-lg p-3 text-center">
                    <div className="text-xl font-mono font-semibold">
                      {formatNumber(metrics?.peak_prefill_tps) !== '--' ? formatNumber(metrics?.peak_prefill_tps) : formatNumber(metrics?.prompt_throughput)}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)]">Peak Prefill TPS</div>
                  </div>
                  <div className="bg-[var(--background)] rounded-lg p-3 text-center">
                    <div className="text-xl font-mono font-semibold">
                      {metrics?.kv_cache_usage !== undefined ? `${Math.round(metrics.kv_cache_usage * 100)}%` : '--'}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)]">KV Cache</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="flex justify-between px-3 py-2 bg-[var(--background)] rounded">
                    <span className="text-[var(--muted-foreground)]">TP Size</span>
                    <span className="font-mono">{currentRecipe?.tp || currentRecipe?.tensor_parallel_size || '-'}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-[var(--background)] rounded">
                    <span className="text-[var(--muted-foreground)]">Max Len</span>
                    <span className="font-mono">{currentRecipe?.max_model_len?.toLocaleString() || '-'}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-[var(--background)] rounded">
                    <span className="text-[var(--muted-foreground)]">Backend</span>
                    <span className="font-mono">{currentProcess.backend}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-[var(--background)] rounded">
                    <span className="text-[var(--muted-foreground)]">PID</span>
                    <span className="font-mono">{currentProcess.pid}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--muted-foreground)]">
                <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No model running</p>
                <p className="text-xs mt-1">Use the search below to launch a model</p>
              </div>
            )}
          </section>

          {/* Quick Launch */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 sm:p-6">
            <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2 sm:mb-3">Quick Launch</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full pl-10 pr-4 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--ring)] transition-colors"
              />
            </div>

            {searchResults.length > 0 && (
              <div className="mt-3 border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
                {searchResults.map((recipe) => (
                  <div
                    key={recipe.id}
                    className="flex items-center justify-between p-3 hover:bg-[var(--accent)]/50 cursor-pointer transition-colors"
                    onClick={() => !launching && recipe.status !== 'running' && handleLaunch(recipe.id)}
                  >
                    <div>
                      <div className="font-medium text-sm">{recipe.name}</div>
                      <div className="text-xs text-[var(--muted-foreground)]">
                        TP{recipe.tp || recipe.tensor_parallel_size} • {recipe.backend}
                      </div>
                    </div>
                    {recipe.status === 'running' ? (
                      <span className="px-2 py-1 bg-[var(--success)]/10 text-[var(--success)] rounded text-xs">Running</span>
                    ) : (
                      <button
                        disabled={launching}
                        className="flex items-center gap-1 px-3 py-1 bg-[var(--foreground)] text-[var(--background)] rounded text-xs hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        <Play className="h-3 w-3" />
                        {launching ? '...' : 'Launch'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Live Logs */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 sm:p-6">
            <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2 sm:mb-3">Live Logs</h2>
            <div className="bg-[var(--background)] rounded-lg p-2 sm:p-3 h-48 sm:h-64 overflow-auto font-mono text-[10px] sm:text-xs">
              {logs.length > 0 ? (
                logs.map((line, i) => (
                  <div key={i} className={`whitespace-pre-wrap break-all py-0.5 ${
                    line.includes('ERROR') ? 'text-[var(--error)]' :
                    line.includes('WARNING') ? 'text-[var(--warning)]' :
                    line.includes('INFO') ? 'text-[var(--muted-foreground)]' :
                    'text-[var(--foreground)]'
                  }`}>{line}</div>
                ))
              ) : (
                <div className="text-[var(--muted-foreground)]">No logs available</div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="space-y-4 sm:space-y-6 min-w-0">
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 sm:p-6">
            <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-2 sm:mb-3">Analytics</h2>
            <div className="space-y-2 sm:space-y-3">
              <div className="flex items-center justify-between p-2 sm:p-3 bg-[var(--background)] rounded-lg">
                <div className="flex items-center gap-2">
                  <Hash className="h-3 sm:h-4 w-3 sm:w-4 text-[var(--muted)]" />
                  <span className="text-xs sm:text-sm">Requests</span>
                </div>
                <span className="font-mono font-semibold text-sm">{metrics?.request_success || 0}</span>
              </div>
              <div className="flex items-center justify-between p-2 sm:p-3 bg-[var(--background)] rounded-lg">
                <div className="flex items-center gap-2">
                  <Activity className="h-3 sm:h-4 w-3 sm:w-4 text-[var(--muted)]" />
                  <span className="text-xs sm:text-sm">Tokens</span>
                </div>
                <span className="font-mono font-semibold text-sm">{metrics?.generation_tokens_total?.toLocaleString() || 0}</span>
              </div>
              <div className="flex items-center justify-between p-2 sm:p-3 bg-[var(--background)] rounded-lg">
                <div className="flex items-center gap-2">
                  <Clock className="h-3 sm:h-4 w-3 sm:w-4 text-[var(--muted)]" />
                  <span className="text-xs sm:text-sm">Running</span>
                </div>
                <span className="font-mono font-semibold text-sm">{metrics?.running_requests || 0}</span>
              </div>
              <div className="flex items-center justify-between p-2 sm:p-3 bg-[var(--background)] rounded-lg">
                <div className="flex items-center gap-2">
                  <Clock className="h-3 sm:h-4 w-3 sm:w-4 text-[var(--muted)]" />
                  <span className="text-xs sm:text-sm">Pending</span>
                </div>
                <span className="font-mono font-semibold text-sm">{metrics?.pending_requests || 0}</span>
              </div>
            </div>
          </section>

          <section className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <h2 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide">Recipes ({recipes.length})</h2>
              <button
                onClick={() => router.push('/recipes?new=1')}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                + New
              </button>
            </div>
            <div className="space-y-1 max-h-60 sm:max-h-80 overflow-y-auto pr-1">
              {recipes.map((recipe) => (
                <div
                  key={recipe.id}
                  className="flex items-center justify-between p-2 hover:bg-[var(--card-hover)] rounded transition-colors group"
                >
                  <button
                    onClick={() => !launching && recipe.status !== 'running' && handleLaunch(recipe.id)}
                    className="flex items-center flex-1 min-w-0 text-left"
                    disabled={launching || recipe.status === 'running'}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mr-2 ${
                      recipe.status === 'running' ? 'bg-[var(--success)]' : 'bg-[var(--muted)]'
                    }`} />
                    <span className="text-sm truncate">{recipe.name}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/recipes?edit=${recipe.id}`);
                    }}
                    className="p-1 opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-all"
                    title="Edit recipe"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Launch progress toast */}
      {launchProgress && (
        <div className="fixed bottom-20 sm:bottom-6 left-4 right-4 sm:left-auto sm:right-6 z-50 px-3 sm:px-4 py-2 sm:py-3 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl sm:max-w-md animate-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-3">
            {launchProgress.stage === 'error' ? (
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <X className="h-4 w-4 text-red-400" />
              </div>
            ) : launchProgress.stage === 'ready' ? (
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                <Check className="h-4 w-4 text-green-400" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Activity className="h-4 w-4 animate-spin text-blue-400" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium capitalize">{launchProgress.stage}</div>
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{launchProgress.message}</div>

              {launchProgress.progress !== undefined && launchProgress.stage !== 'ready' && launchProgress.stage !== 'error' && (
                <div className="mt-2 h-1 bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${Math.round(launchProgress.progress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
