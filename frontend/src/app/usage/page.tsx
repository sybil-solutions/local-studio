'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Activity, Database, Zap, BarChart3 } from 'lucide-react';
import api from '@/lib/api';

interface UsageStats {
  totals: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_requests: number;
  };
  cache: {
    hits: number;
    misses: number;
    hit_tokens: number;
    miss_tokens: number;
  };
  by_model: Array<{
    model: string;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    requests: number;
  }>;
  daily: Array<{
    date: string;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    requests: number;
  }>;
}

interface PeakMetrics {
  model_id: string;
  prefill_tps: number | null;
  generation_tps: number | null;
  ttft_ms: number | null;
  total_tokens: number;
  total_requests: number;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function UsagePage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [peakMetrics, setPeakMetrics] = useState<Map<string, PeakMetrics>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const [usageData, peakData] = await Promise.all([
        api.getUsageStats(),
        api.getPeakMetrics()
      ]);
      setStats(usageData);

      // Build map of model_id -> peak metrics
      if (peakData.metrics) {
        const metricsMap = new Map<string, PeakMetrics>();
        for (const m of peakData.metrics) {
          metricsMap.set(m.model_id, m);
        }
        setPeakMetrics(metricsMap);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-full bg-[#1b1b1b]">
        <Activity className="h-5 w-5 text-[#9a9088] animate-pulse" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex items-center justify-center h-full bg-[#1b1b1b]">
        <div className="text-center">
          <p className="text-[#c97a6b] mb-4">{error}</p>
          <button
            onClick={loadStats}
            className="px-4 py-2 bg-[#363432] rounded-lg text-[#f0ebe3] hover:bg-[#4a4846]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const cacheHitRate = stats ? (stats.cache.hits / (stats.cache.hits + stats.cache.misses) * 100) || 0 : 0;
  const maxDailyTokens = stats ? Math.max(...stats.daily.map(d => d.total_tokens), 1) : 1;
  const promptPct = stats ? ((stats.totals.prompt_tokens / stats.totals.total_tokens) * 100).toFixed(1) : '0';
  const completionPct = stats ? ((stats.totals.completion_tokens / stats.totals.total_tokens) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-full bg-[#1b1b1b] text-[#f0ebe3]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-[#8b7355]" />
            <h1 className="text-lg font-medium">Token Usage</h1>
          </div>
          <button
            onClick={loadStats}
            disabled={loading}
            className="p-2 hover:bg-[#363432] rounded-lg transition-colors"
          >
            <RefreshCw className={`h-4 w-4 text-[#9a9088] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {stats && (
          <>
            {/* Totals Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 mb-8">
              <StatCard
                label="Total Tokens"
                value={formatNumber(stats.totals.total_tokens)}
                icon={<Database className="h-4 w-4" />}
              />
              <StatCard
                label="Prompt Tokens"
                value={formatNumber(stats.totals.prompt_tokens)}
                sub={`${promptPct}%`}
                color="#6b9ac9"
              />
              <StatCard
                label="Completion Tokens"
                value={formatNumber(stats.totals.completion_tokens)}
                sub={`${completionPct}%`}
                color="#7d9a6a"
              />
              <StatCard
                label="Total Requests"
                value={formatNumber(stats.totals.total_requests)}
                icon={<Zap className="h-4 w-4" />}
              />
            </div>

            {/* Cache Stats */}
            <div className="mb-8">
              <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Cache Performance</div>
              <div className="bg-[#1e1e1e] rounded-lg p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
                  <div>
                    <div className="text-xs text-[#9a9088] mb-1">Hit Rate</div>
                    <div className="text-2xl font-light text-[#7d9a6a]">{cacheHitRate.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#9a9088] mb-1">Cache Hits</div>
                    <div className="text-lg font-light">{stats.cache.hits.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#9a9088] mb-1">Cache Misses</div>
                    <div className="text-lg font-light">{stats.cache.misses.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#9a9088] mb-1">Cached Tokens</div>
                    <div className="text-lg font-light text-[#7d9a6a]">{formatNumber(stats.cache.hit_tokens)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#9a9088] mb-1">Uncached Tokens</div>
                    <div className="text-lg font-light text-[#c97a6b]">{formatNumber(stats.cache.miss_tokens)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#9a9088] mb-1">Token Hit Rate</div>
                    <div className="text-lg font-light text-[#6b9ac9]">
                      {((stats.cache.hit_tokens / (stats.cache.hit_tokens + stats.cache.miss_tokens)) * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
                {/* Token-based progress bar */}
                <div className="h-2 bg-[#363432] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#7d9a6a] rounded-full transition-all"
                    style={{ width: `${(stats.cache.hit_tokens / (stats.cache.hit_tokens + stats.cache.miss_tokens)) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-[#9a9088]">
                  <span>Cached: {formatNumber(stats.cache.hit_tokens)}</span>
                  <span>Uncached: {formatNumber(stats.cache.miss_tokens)}</span>
                </div>
              </div>
            </div>

            {/* Main Grid */}
            <div className="grid lg:grid-cols-3 gap-6 sm:gap-8">
              
              {/* Daily Chart */}
              <div className="lg:col-span-2 min-w-0">
                <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Daily Usage (Last 14 Days)</div>
                <div className="bg-[#1e1e1e] rounded-lg p-3 sm:p-4 overflow-x-auto">
                  <div className="flex items-end gap-0.5 sm:gap-1 h-40 min-w-0">
                    {stats.daily.slice().reverse().map((day, i) => {
                      const promptHeight = (day.prompt_tokens / maxDailyTokens) * 100;
                      const completionHeight = (day.completion_tokens / maxDailyTokens) * 100;
                      // On mobile, show fewer bars (last 7 days)
                      const showOnMobile = i >= stats.daily.length - 7;
                      return (
                        <div key={day.date} className={`flex-1 flex flex-col items-center gap-1 group min-w-0 ${showOnMobile ? '' : 'hidden sm:flex'}`}>
                          <div className="w-full flex flex-col justify-end h-32">
                            <div
                              className="w-full bg-[#7d9a6a] rounded-t transition-all group-hover:opacity-80"
                              style={{ height: `${completionHeight}%`, minHeight: completionHeight > 0 ? '2px' : '0' }}
                              title={`Completion: ${formatNumber(day.completion_tokens)}`}
                            />
                            <div
                              className="w-full bg-[#6b9ac9] rounded-b transition-all group-hover:opacity-80"
                              style={{ height: `${promptHeight}%`, minHeight: promptHeight > 0 ? '2px' : '0' }}
                              title={`Prompt: ${formatNumber(day.prompt_tokens)}`}
                            />
                          </div>
                          <div className="text-[8px] sm:text-[10px] text-[#9a9088] truncate w-full text-center">
                            {formatDate(day.date)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-center gap-6 mt-4 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-[#6b9ac9] rounded" />
                      <span className="text-[#9a9088]">Prompt</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-[#7d9a6a] rounded" />
                      <span className="text-[#9a9088]">Completion</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* By Model */}
              <div className="min-w-0">
                <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">By Model</div>
                <div className="bg-[#1e1e1e] rounded-lg overflow-hidden">
                  <div className="max-h-80 overflow-y-auto overflow-x-hidden">
                    {stats.by_model.map((model, i) => {
                      const maxTokens = stats.by_model[0]?.total_tokens || 1;
                      const pct = (model.total_tokens / maxTokens) * 100;
                      const modelPromptPct = (model.prompt_tokens / model.total_tokens) * 100;
                      const peak = peakMetrics.get(model.model);
                      return (
                        <div
                          key={model.model}
                          className={`p-3 hover:bg-[#363432]/30 transition-colors ${i > 0 ? 'border-t border-[#363432]/50' : ''}`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
                            <span className="text-xs sm:text-sm text-[#f0ebe3] truncate flex-1 min-w-0" title={model.model}>
                              {model.model}
                            </span>
                            <span className="text-[10px] sm:text-xs text-[#9a9088] flex-shrink-0">
                              {formatNumber(model.total_tokens)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-[#363432] rounded-full overflow-hidden">
                            <div className="h-full flex">
                              <div
                                className="bg-[#6b9ac9] transition-all"
                                style={{ width: `${(modelPromptPct / 100) * pct}%` }}
                              />
                              <div
                                className="bg-[#7d9a6a] transition-all"
                                style={{ width: `${((100 - modelPromptPct) / 100) * pct}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-1.5 text-[9px] sm:text-[10px] text-[#9a9088] min-w-0">
                            <span className="truncate">{model.requests.toLocaleString()} req</span>
                            <span className="flex-shrink-0 ml-2">{formatNumber(model.prompt_tokens)}/{formatNumber(model.completion_tokens)}</span>
                          </div>
                          {/* Peak Performance Metrics */}
                          {peak && (peak.generation_tps || peak.prefill_tps) && (
                            <div className="flex items-center gap-3 mt-2 text-[9px] sm:text-[10px]">
                              {peak.generation_tps && (
                                <span className="text-[#7d9a6a]" title="Peak Generation Speed">
                                  ⚡ {peak.generation_tps.toFixed(1)} tok/s
                                </span>
                              )}
                              {peak.prefill_tps && (
                                <span className="text-[#6b9ac9]" title="Peak Prefill Speed">
                                  📥 {peak.prefill_tps.toFixed(1)} tok/s
                                </span>
                              )}
                              {peak.ttft_ms && (
                                <span className="text-[#c9a66b]" title="Best Time to First Token">
                                  ⏱ {Math.round(peak.ttft_ms)}ms
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ 
  label, 
  value, 
  sub, 
  icon, 
  color 
}: { 
  label: string; 
  value: string; 
  sub?: string; 
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="bg-[#1e1e1e] rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className="text-[#9a9088]">{icon}</span>}
        <span className="text-xs text-[#9a9088] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl sm:text-3xl font-light" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="text-xs text-[#9a9088] mt-1">{sub}</div>}
    </div>
  );
}
