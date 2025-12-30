import { useState, useCallback, useRef, useEffect } from 'react';
import type { GPU, Metrics } from '@/lib/types';

interface HistoryPoint {
  timestamp: number;
  value: number;
}

interface GPUHistory {
  memory: HistoryPoint[];
  utilization: HistoryPoint[];
  temperature: HistoryPoint[];
  power: HistoryPoint[];
}

interface MetricsHistory {
  generationTps: HistoryPoint[];
  prefillTps: HistoryPoint[];
  requestCount: HistoryPoint[];
  kvCache: HistoryPoint[];
  runningRequests: HistoryPoint[];
  energy: HistoryPoint[];
  power: HistoryPoint[];
  tokens: HistoryPoint[];
}

const MAX_HISTORY_POINTS = 60; // 1 minute at 1Hz

/**
 * Hook to maintain rolling history of GPU and inference metrics
 * for visualization in charts.
 */
export function useMetricsHistory() {
  const [gpuHistory, setGpuHistory] = useState<Map<number, GPUHistory>>(new Map());
  const [metricsHistory, setMetricsHistory] = useState<MetricsHistory>({
    generationTps: [],
    prefillTps: [],
    requestCount: [],
    kvCache: [],
    runningRequests: [],
    energy: [],
    power: [],
    tokens: [],
  });

  const lastTokensRef = useRef(0);
  const lastRequestsRef = useRef(0);

  const addPoint = useCallback((arr: HistoryPoint[], value: number): HistoryPoint[] => {
    const point = { timestamp: Date.now(), value };
    const updated = [...arr, point];
    if (updated.length > MAX_HISTORY_POINTS) {
      return updated.slice(-MAX_HISTORY_POINTS);
    }
    return updated;
  }, []);

  const updateGPU = useCallback((gpus: GPU[]) => {
    setGpuHistory(prev => {
      const next = new Map(prev);
      const now = Date.now();

      for (const gpu of gpus) {
        const idx = gpu.index ?? gpu.id ?? 0;
        const existing = next.get(idx) || {
          memory: [],
          utilization: [],
          temperature: [],
          power: [],
        };

        // Memory percentage
        const memTotal = gpu.memory_total_mb ?? gpu.memory_total ?? 1;
        const memUsed = gpu.memory_used_mb ?? gpu.memory_used ?? 0;
        const memPct = (memUsed / memTotal) * 100;

        // Utilization
        const util = gpu.utilization_pct ?? gpu.utilization ?? 0;

        // Temperature
        const temp = gpu.temp_c ?? gpu.temperature ?? 0;

        // Power
        const power = gpu.power_draw ?? 0;

        next.set(idx, {
          memory: addPoint(existing.memory, memPct),
          utilization: addPoint(existing.utilization, util),
          temperature: addPoint(existing.temperature, temp),
          power: addPoint(existing.power, power),
        });
      }

      return next;
    });
  }, [addPoint]);

  const updateMetrics = useCallback((metrics: Metrics | null) => {
    if (!metrics) return;

    setMetricsHistory(prev => ({
      generationTps: addPoint(prev.generationTps, metrics.generation_throughput ?? metrics.peak_generation_tps ?? 0),
      prefillTps: addPoint(prev.prefillTps, metrics.prompt_throughput ?? metrics.peak_prefill_tps ?? 0),
      requestCount: addPoint(prev.requestCount, metrics.request_success ?? 0),
      kvCache: addPoint(prev.kvCache, (metrics.kv_cache_usage ?? 0) * 100),
      runningRequests: addPoint(prev.runningRequests, metrics.running_requests ?? 0),
      energy: addPoint(prev.energy, metrics.lifetime_energy_kwh ?? 0),
      power: addPoint(prev.power, metrics.current_power_watts ?? 0),
      tokens: addPoint(prev.tokens, metrics.generation_tokens_total ?? 0),
    }));

    // Track deltas for rate calculations
    const currentTokens = metrics.generation_tokens_total ?? 0;
    const currentRequests = metrics.request_success ?? 0;
    lastTokensRef.current = currentTokens;
    lastRequestsRef.current = currentRequests;
  }, [addPoint]);

  // Get the latest N values from a history array
  const getValues = useCallback((history: HistoryPoint[], count = MAX_HISTORY_POINTS): number[] => {
    return history.slice(-count).map(p => p.value);
  }, []);

  // Get GPU history for a specific GPU
  const getGPUHistory = useCallback((gpuIndex: number) => {
    return gpuHistory.get(gpuIndex) || {
      memory: [],
      utilization: [],
      temperature: [],
      power: [],
    };
  }, [gpuHistory]);

  // Clear all history
  const clear = useCallback(() => {
    setGpuHistory(new Map());
    setMetricsHistory({
      generationTps: [],
      prefillTps: [],
      requestCount: [],
      kvCache: [],
      runningRequests: [],
      energy: [],
      power: [],
      tokens: [],
    });
  }, []);

  return {
    gpuHistory,
    metricsHistory,
    updateGPU,
    updateMetrics,
    getValues,
    getGPUHistory,
    clear,
  };
}
