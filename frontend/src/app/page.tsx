'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

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
  const [quickLaunchExpanded, setQuickLaunchExpanded] = useState(true);
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
      <div className="flex items-center justify-center h-full bg-[var(--background)]">
        <div className="text-[var(--muted-foreground)] animate-pulse">Loading...</div>
      </div>
    );
  }

  const totalPower = gpus.reduce((sum, g) => sum + (g.power_draw || 0), 0);
  const totalMem = gpus.reduce((sum, g) => sum + toGB(g.memory_used_mb ?? g.memory_used ?? 0), 0);
  const totalMemMax = gpus.reduce((sum, g) => sum + toGB(g.memory_total_mb ?? g.memory_total ?? 0), 0);

  return (
    <div className="min-h-full bg-[var(--background)] text-[var(--foreground)]">
      {/* Connection Warning */}
      {!isConnected && (
        <div className="fixed top-4 right-4 z-50 px-3 py-1.5 text-xs text-[var(--muted-foreground)] bg-[var(--card)] border border-[var(--border)]">
          Reconnecting... ({reconnectAttempts})
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 sm:px-8 py-6 sm:py-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">

        {/* Header Section */}
        <header className="mb-6 pb-4 border-b border-[var(--border)]/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
            <div className="space-y-2">
              {currentProcess ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-2.5 h-2.5 rounded-full bg-[var(--success)]"></div>
                      <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-[var(--success)] animate-ping opacity-75"></div>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-[var(--foreground)]">
                      {currentRecipe?.name || currentProcess.model_path?.split('/').pop()}
                    </h1>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)] pl-5">
                    <span className="font-medium">{currentProcess.backend}</span>
                    <span className="opacity-40">·</span>
                    <span>pid {currentProcess.pid}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--muted)]/60"></div>
                    <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-[var(--muted-foreground)]">
                      No model running
                    </h1>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)]/80 pl-5">Select a recipe to launch</p>
                </>
              )}
            </div>
            {currentProcess && (
              <nav className="flex items-center gap-5 text-xs">
                <button 
                  onClick={() => router.push('/chat')} 
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-200"
                >
                  chat
                </button>
                <button 
                  onClick={() => router.push('/logs')} 
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-200"
                >
                  logs
                </button>
                <button 
                  onClick={handleBenchmark} 
                  disabled={benchmarking} 
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-200 disabled:opacity-30 disabled:cursor-not-allowed hidden sm:block"
                >
                  {benchmarking ? 'running...' : 'benchmark'}
                </button>
                <span className="text-[var(--border)]/40">·</span>
                <button 
                  onClick={handleStop} 
                  className="text-[var(--muted-foreground)] hover:text-[var(--error)] transition-colors duration-200"
                >
                  stop
                </button>
              </nav>
            )}
          </div>
        </header>

        {/* Metrics Section */}
        {currentProcess && (
          <section className="mb-6 pb-5 border-b border-[var(--border)]/40">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-6">
              <Metric 
                label="Requests" 
                value={metrics?.running_requests || 0} 
                sub={metrics?.pending_requests ? `${metrics.pending_requests} pending` : undefined}
              />
              <Metric
                label="Generation"
                value={metrics?.generation_throughput?.toFixed(1) || '--'}
                sub={metrics?.peak_generation_tps ? `peak ${metrics.peak_generation_tps.toFixed(1)}` : undefined}
              />
              <Metric
                label="Prefill"
                value={metrics?.prompt_throughput?.toFixed(1) || '--'}
                sub={metrics?.peak_prefill_tps ? `peak ${metrics.peak_prefill_tps.toFixed(1)}` : undefined}
              />
              <Metric
                label="TTFT"
                value={metrics?.avg_ttft_ms ? Math.round(metrics.avg_ttft_ms) : '--'}
                sub={metrics?.peak_ttft_ms ? `best ${Math.round(metrics.peak_ttft_ms)}ms` : undefined}
              />
              <Metric 
                label="KV Cache" 
                value={metrics?.kv_cache_usage != null ? `${Math.round(metrics.kv_cache_usage * 100)}%` : '--'} 
              />
              <Metric 
                label="Power" 
                value={`${Math.round(totalPower)}W`} 
                sub={`${totalMem.toFixed(0)}/${totalMemMax.toFixed(0)}G`} 
              />
            </div>
          </section>
        )}

        {/* Main Content */}
        <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">

          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">

            {/* GPU Status */}
            <section>
              <h2 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-3 font-medium">GPU Status</h2>

              {gpus.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">No GPU data available</p>
              ) : (
                <div className="space-y-0.5">
                  {gpus.map((gpu, i) => {
                    const memUsed = toGB(gpu.memory_used_mb ?? gpu.memory_used ?? 0);
                    const memTotal = toGB(gpu.memory_total_mb ?? gpu.memory_total ?? 1);
                    const memPct = (memUsed / memTotal) * 100;
                    const temp = gpu.temp_c ?? gpu.temperature ?? 0;
                    const util = gpu.utilization_pct ?? gpu.utilization ?? 0;
                    return (
                      <div 
                        key={gpu.id ?? gpu.index} 
                        className={`py-2.5 px-3 -mx-3 rounded-lg hover:bg-[var(--card)]/50 transition-all duration-200 ${
                          i < gpus.length - 1 ? 'mb-1' : ''
                        }`}
                      >
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-center">
                          <div className="text-sm text-[var(--foreground)]">
                            GPU {gpu.id ?? gpu.index}
                          </div>
                          <div className="text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="flex-1 h-1 bg-[var(--muted)]/20 rounded-full overflow-hidden">
                                <div className="h-full bg-[var(--foreground)]/50 rounded-full transition-all duration-500" style={{ width: `${util}%` }} />
                              </div>
                              <span className="text-[var(--muted-foreground)] w-10 text-right tabular-nums font-medium">{util}%</span>
                            </div>
                          </div>
                          <div className="text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="flex-1 h-1 bg-[var(--muted)]/20 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    memPct > 90 ? 'bg-[var(--error)]/70' : 
                                    memPct > 70 ? 'bg-[var(--warning)]/70' : 
                                    'bg-[var(--success)]/70'
                                  }`}
                                  style={{ width: `${memPct}%` }}
                                />
                              </div>
                              <span className="text-[var(--muted-foreground)] text-right tabular-nums font-medium">
                                {memUsed.toFixed(1)}/{memTotal.toFixed(0)}G
                              </span>
                            </div>
                          </div>
                          <div className="text-xs">
                            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium ${
                              temp > 80 ? 'bg-[var(--error)]/15 text-[var(--error)]' : 
                              temp > 65 ? 'bg-[var(--warning)]/15 text-[var(--warning)]' : 
                              'bg-[var(--success)]/15 text-[var(--success)]'
                            }`}>
                              <span className="tabular-nums">{temp}°</span>
                            </div>
                          </div>
                          <div className="text-xs text-[var(--muted-foreground)] tabular-nums">
                            {gpu.power_draw ? `${Math.round(gpu.power_draw)}W` : '--'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {gpus.length > 0 && (
                    <div className="pt-3 mt-3">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                        <div className="text-[var(--muted-foreground)] font-medium">Total</div>
                        <div className="text-[var(--foreground)] tabular-nums font-medium">
                          {Math.round(gpus.reduce((sum, g) => sum + (g.utilization_pct ?? g.utilization ?? 0), 0) / gpus.length)}% avg
                        </div>
                        <div className="text-[var(--foreground)] tabular-nums font-medium">
                          {totalMem.toFixed(1)}/{totalMemMax.toFixed(0)}G
                        </div>
                        <div className="text-[var(--foreground)] tabular-nums font-medium">
                          {Math.round(gpus.reduce((sum, g) => sum + (g.temp_c ?? g.temperature ?? 0), 0) / gpus.length)}° avg
                        </div>
                        <div className="text-[var(--foreground)] tabular-nums font-medium">
                          {Math.round(totalPower)}W
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Quick Launch */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => setQuickLaunchExpanded(!quickLaunchExpanded)}
                  className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-medium hover:text-[var(--foreground)] transition-colors"
                >
                  {quickLaunchExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronUp className="h-3 w-3" />
                  )}
                  Quick Launch
                </button>
                <button 
                  onClick={() => router.push('/recipes?new=1')} 
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-200"
                >
                  new
                </button>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search recipes..."
                className="w-full px-3 py-2 bg-[var(--card)]/50 border border-[var(--border)]/40 rounded-lg text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50 focus:outline-none focus:border-[var(--border)] focus:bg-[var(--card)] transition-all duration-200 mb-3"
              />
              {quickLaunchExpanded && (
                <>
                  {searchQuery.trim() ? (
                    searchResults.length > 0 ? (
                      <div className="space-y-0.5">
                        {searchResults.map((recipe) => (
                          <div
                            key={recipe.id}
                            onClick={() => !launching && recipe.status !== 'running' && handleLaunch(recipe.id)}
                            className={`px-3 py-2 -mx-3 rounded-lg cursor-pointer transition-all duration-200 hover:bg-[var(--card)]/50 ${
                              recipe.status === 'running' ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full ${recipe.status === 'running' ? 'bg-[var(--success)]' : 'bg-[var(--muted)]/60'}`}></div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-[var(--foreground)] truncate font-medium">{recipe.name}</div>
                                <div className="text-xs text-[var(--muted-foreground)]">
                                  TP{recipe.tp || recipe.tensor_parallel_size} · {recipe.backend || 'vllm'}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--muted-foreground)]/60 px-3">No recipes found</p>
                    )
                  ) : (
                    <div className="space-y-0.5">
                      {recipes.slice(0, 8).map((recipe) => (
                        <div
                          key={recipe.id}
                          onClick={() => !launching && recipe.status !== 'running' && handleLaunch(recipe.id)}
                          className={`group px-3 py-2 -mx-3 rounded-lg cursor-pointer transition-all duration-200 hover:bg-[var(--card)]/50 ${
                            recipe.status === 'running' ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${recipe.status === 'running' ? 'bg-[var(--success)]' : 'bg-[var(--muted)]/60'}`}></div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-[var(--foreground)] truncate font-medium">{recipe.name}</div>
                              <div className="text-xs text-[var(--muted-foreground)]">
                                TP{recipe.tp || recipe.tensor_parallel_size} · {recipe.backend || 'vllm'}
                              </div>
                            </div>
                            <button
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                router.push(`/recipes?edit=${recipe.id}`); 
                              }}
                              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-200 opacity-0 group-hover:opacity-100"
                            >
                              edit
                            </button>
                          </div>
                        </div>
                      ))}
                      {recipes.length > 8 && (
                        <button
                          onClick={() => router.push('/recipes')}
                          className="w-full px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors duration-200"
                        >
                          View all {recipes.length} recipes →
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Logs */}
            <section>
              <h2 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-3 font-medium">Recent Logs</h2>
              {logs.length > 0 ? (
                <div className="h-48 sm:h-64 overflow-auto font-mono text-xs leading-relaxed border border-[var(--border)]/30 rounded-lg p-3 bg-[var(--card)]/30 backdrop-blur-sm">
                  <div className="space-y-1">
                    {logs.map((line, i) => {
                      const isError = line.includes('ERROR');
                      const isWarning = line.includes('WARNING');
                      return (
                        <div 
                          key={i} 
                          className={`break-all ${
                            isError ? 'text-[var(--error)]' :
                            isWarning ? 'text-[var(--warning)]' :
                            'text-[var(--muted-foreground)]'
                          }`}
                        >
                          {line}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="h-48 sm:h-64 flex items-center justify-center border border-[var(--border)]/30 rounded-lg bg-[var(--card)]/20">
                  <p className="text-xs text-[var(--muted-foreground)]/50">No logs available</p>
                </div>
              )}
            </section>
          </div>

          {/* Right Column */}
          <div className="space-y-6">

            {/* Session Stats */}
            {(metrics?.request_success || metrics?.prompt_tokens_total || metrics?.generation_tokens_total || metrics?.running_requests) ? (
              <section>
                <h2 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-3 font-medium">Session</h2>
                <div className="space-y-2">
                  {metrics?.request_success !== undefined && (
                    <StatRow label="Requests" value={metrics.request_success} />
                  )}
                  {metrics?.prompt_tokens_total !== undefined && (
                    <StatRow label="Input Tokens" value={metrics.prompt_tokens_total.toLocaleString()} />
                  )}
                  {metrics?.generation_tokens_total !== undefined && (
                    <StatRow label="Output Tokens" value={metrics.generation_tokens_total.toLocaleString()} />
                  )}
                  {metrics?.running_requests !== undefined && (
                    <StatRow label="Running" value={metrics.running_requests} accent />
                  )}
                </div>
              </section>
            ) : null}

            {/* Lifetime Stats */}
            {(metrics?.lifetime_prompt_tokens || metrics?.lifetime_completion_tokens || metrics?.lifetime_requests || metrics?.lifetime_energy_kwh || metrics?.lifetime_uptime_hours) ? (
              <section>
                <h2 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-3 font-medium">Lifetime</h2>
                <div className="space-y-2">
                  {metrics?.lifetime_prompt_tokens !== undefined && (
                    <StatRow label="Input Tokens" value={metrics.lifetime_prompt_tokens.toLocaleString()} />
                  )}
                  {metrics?.lifetime_completion_tokens !== undefined && (
                    <StatRow label="Output Tokens" value={metrics.lifetime_completion_tokens.toLocaleString()} />
                  )}
                  {metrics?.lifetime_requests !== undefined && (
                    <StatRow label="Total Requests" value={metrics.lifetime_requests.toLocaleString()} />
                  )}
                  {metrics?.lifetime_energy_kwh !== undefined && (
                    <StatRow label="Energy" value={`${metrics.lifetime_energy_kwh.toFixed(2)} kWh`} />
                  )}
                  {metrics?.lifetime_uptime_hours !== undefined && (
                    <StatRow label="Uptime" value={`${metrics.lifetime_uptime_hours.toFixed(1)}h`} />
                  )}
                </div>
              </section>
            ) : null}

            {/* Cost Analytics */}
            {metrics?.lifetime_energy_kwh || metrics?.current_power_watts ? (
              <section>
                <h2 className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-3 font-medium">Cost Analytics</h2>
                <div className="space-y-3">
                  {metrics?.lifetime_energy_kwh && (
                    <div className="pb-3">
                      <div className="text-xs text-[var(--muted-foreground)] mb-1">Total Cost</div>
                      <div className="text-sm font-medium text-[var(--success)]">
                        {(metrics.lifetime_energy_kwh * ELECTRICITY_PRICE_PLN).toFixed(2)} PLN
                      </div>
                    </div>
                  )}
                  {metrics?.kwh_per_million_input || metrics?.kwh_per_million_output ? (
                    <div className="space-y-2">
                      {metrics?.kwh_per_million_input && (
                        <CostRow label="kWh/M Input" value={metrics.kwh_per_million_input.toFixed(3)} />
                      )}
                      {metrics?.kwh_per_million_output && (
                        <CostRow label="kWh/M Output" value={metrics.kwh_per_million_output.toFixed(3)} />
                      )}
                      {metrics?.kwh_per_million_input && (
                        <CostRow label="PLN/M Input" value={(metrics.kwh_per_million_input * ELECTRICITY_PRICE_PLN).toFixed(2)} />
                      )}
                      {metrics?.kwh_per_million_output && (
                        <CostRow label="PLN/M Output" value={(metrics.kwh_per_million_output * ELECTRICITY_PRICE_PLN).toFixed(2)} />
                      )}
                    </div>
                  ) : null}
                  {metrics?.current_power_watts && (
                    <div className={`${metrics?.lifetime_energy_kwh || metrics?.kwh_per_million_input || metrics?.kwh_per_million_output ? 'pt-3' : ''}`}>
                      <div className="text-xs text-[var(--muted-foreground)] mb-1">Current Draw</div>
                      <div className="text-sm font-medium text-[var(--foreground)]">
                        {Math.round(metrics.current_power_watts)}W
                      </div>
                    </div>
                  )}
                </div>
              </section>
            ) : null}

          </div>
        </div>
      </div>

      {/* Launch Toast */}
      {(launching || launchProgress) && (
        <div 
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 px-4 py-3 bg-[var(--card)] border border-[var(--border)]/50 rounded sm:max-w-xs" 
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-[var(--foreground)] capitalize">
              {launchProgress?.stage === 'error' || launchProgress?.stage === 'cancelled' ? (
                <span className="text-[var(--error)]">{launchProgress.stage}</span>
              ) : launchProgress?.stage === 'ready' ? (
                <span className="text-[var(--success)]">{launchProgress.stage}</span>
              ) : (
                launchProgress?.stage || 'Starting...'
              )}
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">
              {launchProgress?.message || 'Preparing model launch...'}
            </div>
          </div>
          {launchProgress?.progress != null && launchProgress.stage !== 'ready' && launchProgress.stage !== 'error' && launchProgress.stage !== 'cancelled' && (
            <div className="mt-3 h-0.5 bg-[var(--muted)]/30 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[var(--foreground)]/40 rounded-full transition-all duration-300" 
                style={{ width: `${Math.round(launchProgress.progress * 100)}%` }} 
              />
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
      <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] mb-1 font-medium">{label}</div>
      <div className="text-base sm:text-lg text-[var(--foreground)] font-normal tracking-tight tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[var(--muted-foreground)]/70 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatRow({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
      <span className={`text-xs font-medium tabular-nums ${accent ? 'text-[var(--success)]' : 'text-[var(--foreground)]'}`}>
        {value}
      </span>
    </div>
  );
}

function CostRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between text-xs py-1">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="text-[var(--foreground)] font-medium tabular-nums">{value}</span>
    </div>
  );
}
