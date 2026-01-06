'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Play, Square, X, Check, Activity, ChevronRight, Settings } from 'lucide-react';

const ELECTRICITY_PRICE_PLN = 1.20;
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useRealtimeStatus } from '@/hooks/useRealtimeStatus';
import type { RecipeWithStatus } from '@/lib/types';

export default function Dashboard() {
  const {
    status: realtimeStatus,
    gpus: realtimeGpus,
    metrics: realtimeMetrics,
    launchProgress,
    isConnected,
    reconnectAttempts,
  } = useRealtimeStatus();

  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [currentRecipe, setCurrentRecipe] = useState<RecipeWithStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RecipeWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const router = useRouter();

  const gpus = realtimeGpus.length > 0 ? realtimeGpus : [];
  const currentProcess = realtimeStatus?.process || null;
  const metrics = realtimeMetrics;

  const loadRecipes = useCallback(async () => {
    try {
      const recipesData = await api.getRecipes();
      const recipesList = recipesData.recipes || [];
      setRecipes(recipesList);
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

  useEffect(() => { loadRecipes(); }, [loadRecipes]);
  useEffect(() => {
    if (launchProgress?.stage === 'ready' || launchProgress?.stage === 'error' || launchProgress?.stage === 'cancelled') loadRecipes();
  }, [launchProgress?.stage, loadRecipes]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      setSearchResults(recipes.filter(r =>
        r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.model_path.toLowerCase().includes(q)
      ).slice(0, 8));
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, recipes]);

  const handleLaunch = async (recipeId: string) => {
    setLaunching(true);
    try {
      await api.switchModel(recipeId, true);
      setSearchQuery('');
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
      alert('Failed to stop: ' + (e as Error).message);
    }
  };

  const handleBenchmark = async () => {
    if (benchmarking) return;
    setBenchmarking(true);
    try {
      const result = await api.runBenchmark(1000, 100);
      if (result.error) alert('Benchmark error: ' + result.error);
    } catch (e) {
      alert('Benchmark failed: ' + (e as Error).message);
    } finally {
      setBenchmarking(false);
    }
  };

  const toGB = (value: number): number => {
    if (value > 1e10) return value / (1024 * 1024 * 1024);
    if (value > 1e8) return value / (1024 * 1024 * 1024);
    if (value > 1000) return value / 1024;
    return value;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1b1b1b]">
        <Activity className="h-5 w-5 text-[#9a9088] animate-pulse" />
      </div>
    );
  }

  const totalPower = gpus.reduce((sum, g) => sum + (g.power_draw || 0), 0);
  const totalMem = gpus.reduce((sum, g) => sum + toGB(g.memory_used_mb ?? g.memory_used ?? 0), 0);
  const totalMemMax = gpus.reduce((sum, g) => sum + toGB(g.memory_total_mb ?? g.memory_total ?? 0), 0);

  return (
    <div className="min-h-screen bg-[#1b1b1b] text-[#f0ebe3]">
      {/* Connection Warning */}
      {!isConnected && (
        <div className="fixed top-14 right-4 z-50 px-3 py-1.5 bg-[#c9a66b]/10 text-[#c9a66b] text-sm rounded">
          Reconnecting... ({reconnectAttempts})
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">

        {/* Model Status */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${currentProcess ? 'bg-[#7d9a6a]' : 'bg-[#363432]'}`} />
            {currentProcess ? (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[#f0ebe3] font-medium truncate">{currentRecipe?.name || currentProcess.model_path?.split('/').pop()}</span>
                <span className="text-[#9a9088] text-sm flex-shrink-0 hidden sm:inline">pid {currentProcess.pid}</span>
              </div>
            ) : (
              <span className="text-[#9a9088]">No model running</span>
            )}
          </div>
          {currentProcess && (
            <div className="flex items-center gap-3 sm:gap-4 text-sm ml-5 sm:ml-0">
              <button onClick={() => router.push('/chat')} className="text-[#9a9088] hover:text-[#f0ebe3] active:text-[#f0ebe3] transition-colors py-1">chat</button>
              <button onClick={() => router.push('/logs')} className="text-[#9a9088] hover:text-[#f0ebe3] active:text-[#f0ebe3] transition-colors py-1">logs</button>
              <button onClick={handleBenchmark} disabled={benchmarking} className="text-[#9a9088] hover:text-[#f0ebe3] active:text-[#f0ebe3] transition-colors disabled:text-[#363432] py-1 hidden sm:block">
                {benchmarking ? 'running...' : 'benchmark'}
              </button>
              <button onClick={handleStop} className="text-[#c97a6b] hover:text-[#c97a6b]/80 active:text-[#c97a6b]/80 transition-colors py-1">stop</button>
            </div>
          )}
        </div>

        {/* Metrics Row */}
        {currentProcess && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 sm:gap-8 mb-6 sm:mb-10">
            <Metric label="Requests" value={metrics?.running_requests || 0} sub={`${metrics?.pending_requests || 0} pending`} />
            <Metric
              label="Gen"
              value={metrics?.generation_throughput?.toFixed(1) || '--'}
              sub={metrics?.peak_generation_tps ? `peak ${metrics.peak_generation_tps.toFixed(1)}` : 'tok/s'}
            />
            <Metric
              label="Prefill"
              value={metrics?.prompt_throughput?.toFixed(1) || '--'}
              sub={metrics?.peak_prefill_tps ? `peak ${metrics.peak_prefill_tps.toFixed(1)}` : 'tok/s'}
            />
            <Metric
              label="TTFT"
              value={metrics?.avg_ttft_ms ? Math.round(metrics.avg_ttft_ms) : '--'}
              sub={metrics?.peak_ttft_ms ? `best ${Math.round(metrics.peak_ttft_ms)}ms` : 'ms'}
            />
            <Metric label="KV Cache" value={metrics?.kv_cache_usage != null ? `${Math.round(metrics.kv_cache_usage * 100)}%` : '--'} />
            <Metric label="Power" value={`${Math.round(totalPower)}W`} sub={`${totalMem.toFixed(0)}/${totalMemMax.toFixed(0)}G`} />
          </div>
        )}

        {/* Main Grid */}
        <div className="grid lg:grid-cols-3 gap-6 sm:gap-10">

          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6 sm:space-y-8">

            {/* GPU Status - Card layout on mobile, table on desktop */}
            <div>
              <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">GPU Status</div>

              {/* Mobile: Card Layout */}
              <div className="sm:hidden space-y-2">
                {gpus.map((gpu) => {
                  const memUsed = toGB(gpu.memory_used_mb ?? gpu.memory_used ?? 0);
                  const memTotal = toGB(gpu.memory_total_mb ?? gpu.memory_total ?? 1);
                  const memPct = (memUsed / memTotal) * 100;
                  const temp = gpu.temp_c ?? gpu.temperature ?? 0;
                  const util = gpu.utilization_pct ?? gpu.utilization ?? 0;
                  return (
                    <div key={gpu.id ?? gpu.index} className="bg-[#1e1e1e] rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[#f0ebe3] font-medium">GPU {gpu.id ?? gpu.index}</span>
                        <div className="flex items-center gap-3">
                          <span className={`text-sm ${temp > 80 ? 'text-[#c97a6b]' : temp > 65 ? 'text-[#c9a66b]' : 'text-[#7d9a6a]'}`}>{temp}°</span>
                          <span className="text-[#9a9088] text-sm">{gpu.power_draw ? `${Math.round(gpu.power_draw)}W` : '--'}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <div className="flex items-center justify-between text-xs text-[#9a9088] mb-1">
                            <span>Util</span>
                            <span>{util}%</span>
                          </div>
                          <div className="h-1.5 bg-[#363432] rounded-full overflow-hidden">
                            <div className="h-full bg-[#8b7355] rounded-full" style={{ width: `${util}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-xs text-[#9a9088] mb-1">
                            <span>Memory</span>
                            <span>{memUsed.toFixed(1)}/{memTotal.toFixed(0)}G</span>
                          </div>
                          <div className="h-1.5 bg-[#363432] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${memPct > 90 ? 'bg-[#c97a6b]' : memPct > 70 ? 'bg-[#c9a66b]' : 'bg-[#7d9a6a]'}`} style={{ width: `${memPct}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop: Table Layout */}
              <div className="hidden sm:block bg-[#1e1e1e] rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[#9a9088] text-xs border-b border-[#363432]">
                      <th className="text-left py-3 px-4 font-normal">#</th>
                      <th className="text-left py-3 px-4 font-normal">Util</th>
                      <th className="text-left py-3 px-4 font-normal">Memory</th>
                      <th className="text-left py-3 px-4 font-normal">Temp</th>
                      <th className="text-left py-3 px-4 font-normal">Power</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gpus.map((gpu, i) => {
                      const memUsed = toGB(gpu.memory_used_mb ?? gpu.memory_used ?? 0);
                      const memTotal = toGB(gpu.memory_total_mb ?? gpu.memory_total ?? 1);
                      const memPct = (memUsed / memTotal) * 100;
                      const temp = gpu.temp_c ?? gpu.temperature ?? 0;
                      const util = gpu.utilization_pct ?? gpu.utilization ?? 0;
                      return (
                        <tr key={gpu.id ?? gpu.index} className={i > 0 ? 'border-t border-[#363432]/50' : ''}>
                          <td className="py-3 px-4 text-[#9a9088]">{gpu.id ?? gpu.index}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-16 h-1 bg-[#363432] rounded-full overflow-hidden">
                                <div className="h-full bg-[#8b7355] rounded-full" style={{ width: `${util}%` }} />
                              </div>
                              <span className="text-[#9a9088] text-xs w-8">{util}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-20 h-1 bg-[#363432] rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${memPct > 90 ? 'bg-[#c97a6b]' : memPct > 70 ? 'bg-[#c9a66b]' : 'bg-[#7d9a6a]'}`}
                                  style={{ width: `${memPct}%` }}
                                />
                              </div>
                              <span className="text-[#9a9088] text-xs">{memUsed.toFixed(1)}/{memTotal.toFixed(0)}G</span>
                            </div>
                          </td>
                          <td className={`py-3 px-4 text-sm ${temp > 80 ? 'text-[#c97a6b]' : temp > 65 ? 'text-[#c9a66b]' : 'text-[#7d9a6a]'}`}>
                            {temp}°
                          </td>
                          <td className="py-3 px-4 text-[#9a9088] text-sm">
                            {gpu.power_draw ? `${Math.round(gpu.power_draw)}W` : '--'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {gpus.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-[#363432] text-xs text-[#9a9088]">
                        <td className="py-2.5 px-4 font-medium">Total</td>
                        <td className="py-2.5 px-4">
                          {Math.round(gpus.reduce((sum, g) => sum + (g.utilization_pct ?? g.utilization ?? 0), 0) / gpus.length)}% avg
                        </td>
                        <td className="py-2.5 px-4">
                          {totalMem.toFixed(1)}/{totalMemMax.toFixed(0)}G
                        </td>
                        <td className="py-2.5 px-4">
                          {Math.round(gpus.reduce((sum, g) => sum + (g.temp_c ?? g.temperature ?? 0), 0) / gpus.length)}° avg
                        </td>
                        <td className="py-2.5 px-4 font-medium text-[#f0ebe3]">
                          {Math.round(totalPower)}W
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Search */}
            <div>
              <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Quick Launch</div>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9a9088]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search recipes..."
                  className="w-full pl-11 pr-4 py-3.5 sm:py-3 bg-[#1e1e1e] rounded-lg text-base sm:text-sm text-[#f0ebe3] placeholder:text-[#9a9088]/50 focus:outline-none focus:ring-2 focus:ring-[#5a4a3a] transition-shadow"
                />
              </div>
              {searchResults.length > 0 && (
                <div className="mt-2 bg-[#1e1e1e] rounded-lg overflow-hidden">
                  {searchResults.map((recipe, i) => (
                    <div
                      key={recipe.id}
                      onClick={() => !launching && recipe.status !== 'running' && handleLaunch(recipe.id)}
                      className={`flex items-center justify-between px-4 py-3.5 sm:py-3 hover:bg-[#363432]/50 active:bg-[#363432]/70 cursor-pointer transition-colors ${i > 0 ? 'border-t border-[#363432]/50' : ''}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${recipe.status === 'running' ? 'bg-[#7d9a6a]' : 'bg-[#363432]'}`} />
                        <div className="min-w-0">
                          <div className="text-[#f0ebe3] truncate">{recipe.name}</div>
                          <div className="text-xs text-[#9a9088]">TP{recipe.tp || recipe.tensor_parallel_size} · {recipe.backend}</div>
                        </div>
                      </div>
                      {recipe.status !== 'running' && <ChevronRight className="h-4 w-4 text-[#363432] flex-shrink-0" />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Logs */}
            <div>
              <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Logs</div>
              <div className="bg-[#1e1e1e] rounded-lg p-3 sm:p-4 h-64 sm:h-80 overflow-auto font-mono text-xs leading-relaxed">
                {logs.length > 0 ? logs.map((line, i) => (
                  <div key={i} className={`py-0.5 break-all ${
                    line.includes('ERROR') ? 'text-[#c97a6b]' :
                    line.includes('WARNING') ? 'text-[#c9a66b]' :
                    'text-[#9a9088]'
                  }`}>{line}</div>
                )) : (
                  <div className="text-[#9a9088]/50">No logs available</div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6 sm:space-y-8">

            {/* Stats Grid - Side by side on mobile */}
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-4 sm:gap-6">
              {/* Session */}
              <div>
                <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Session</div>
                <div className="space-y-1.5 sm:space-y-2">
                  <Row label="Requests" value={metrics?.request_success || 0} />
                  <Row label="Input" value={metrics?.prompt_tokens_total?.toLocaleString() || 0} />
                  <Row label="Output" value={metrics?.generation_tokens_total?.toLocaleString() || 0} />
                  <Row label="Running" value={metrics?.running_requests || 0} />
                </div>
              </div>

              {/* Lifetime */}
              <div>
                <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Lifetime</div>
                <div className="space-y-1.5 sm:space-y-2">
                  <Row label="Input" value={metrics?.lifetime_prompt_tokens?.toLocaleString() || 0} />
                  <Row label="Output" value={metrics?.lifetime_completion_tokens?.toLocaleString() || 0} />
                  <Row label="Requests" value={metrics?.lifetime_requests?.toLocaleString() || 0} />
                  <Row label="Energy" value={metrics?.lifetime_energy_kwh ? `${metrics.lifetime_energy_kwh.toFixed(2)} kWh` : '--'} />
                  <Row label="Uptime" value={metrics?.lifetime_uptime_hours ? `${metrics.lifetime_uptime_hours.toFixed(1)}h` : '--'} />
                </div>
              </div>
            </div>

            {/* Cost Analytics */}
            <div>
              <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Cost Analytics</div>
              <div className="bg-[#1e1e1e] rounded-lg p-3 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#9a9088]">Total Cost</span>
                  <span className="text-lg font-medium text-[#7d9a6a]">
                    {metrics?.lifetime_energy_kwh ? `${(metrics.lifetime_energy_kwh * ELECTRICITY_PRICE_PLN).toFixed(2)} PLN` : '--'}
                  </span>
                </div>
                <div className="border-t border-[#363432] pt-2 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#9a9088]">kWh/M Input</span>
                    <span className="text-[#6b9ac9]">
                      {metrics?.kwh_per_million_input ? metrics.kwh_per_million_input.toFixed(3) : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#9a9088]">kWh/M Output</span>
                    <span className="text-[#7d9a6a]">
                      {metrics?.kwh_per_million_output ? metrics.kwh_per_million_output.toFixed(3) : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#9a9088]">PLN/M Input</span>
                    <span className="text-[#6b9ac9]">
                      {metrics?.kwh_per_million_input ? (metrics.kwh_per_million_input * ELECTRICITY_PRICE_PLN).toFixed(2) : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#9a9088]">PLN/M Output</span>
                    <span className="text-[#7d9a6a]">
                      {metrics?.kwh_per_million_output ? (metrics.kwh_per_million_output * ELECTRICITY_PRICE_PLN).toFixed(2) : '--'}
                    </span>
                  </div>
                </div>
                <div className="border-t border-[#363432] pt-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#9a9088]">Current Draw</span>
                    <span className="text-[#f0ebe3]">
                      {metrics?.current_power_watts ? `${Math.round(metrics.current_power_watts)}W` : '--'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Recipes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-[#9a9088] uppercase tracking-wider">Recipes ({recipes.length})</div>
                <button onClick={() => router.push('/recipes?new=1')} className="text-xs text-[#9a9088] hover:text-[#f0ebe3] active:text-[#f0ebe3] transition-colors py-1 px-2 -mr-2">+ new</button>
              </div>
              <div className="space-y-0.5 max-h-48 sm:max-h-64 overflow-y-auto -mx-1">
                {recipes.map((recipe) => (
                  <div
                    key={recipe.id}
                    onClick={() => !launching && recipe.status !== 'running' && handleLaunch(recipe.id)}
                    className="flex items-center justify-between py-2.5 sm:py-2 px-3 mx-1 rounded hover:bg-[#363432]/30 active:bg-[#363432]/50 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${recipe.status === 'running' ? 'bg-[#7d9a6a]' : 'bg-[#363432]'}`} />
                      <span className="text-[#f0ebe3] text-sm truncate">{recipe.name}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push(`/recipes?edit=${recipe.id}`); }}
                      className="opacity-100 sm:opacity-0 group-hover:opacity-100 text-[#9a9088] hover:text-[#f0ebe3] active:text-[#f0ebe3] transition-all p-1.5 -mr-1.5"
                    >
                      <Settings className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
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

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] sm:text-xs text-[#9a9088] mb-0.5 sm:mb-1">{label}</div>
      <div className="text-lg sm:text-2xl text-[#f0ebe3] font-light tracking-tight">{value}</div>
      {sub && <div className="text-[10px] sm:text-xs text-[#9a9088]/60 mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[#9a9088] text-sm">{label}</span>
      <span className={`text-sm ${accent ? 'text-[#7d9a6a]' : 'text-[#f0ebe3]'}`}>{value}</span>
    </div>
  );
}
