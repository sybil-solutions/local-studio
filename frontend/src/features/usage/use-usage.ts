"use client";

import { useCallback, useMemo, useState } from "react";
import api from "@/lib/api/client";
import type { PeakMetrics, UsageStats } from "@/lib/types";
import { normalizeUsageStats } from "@/features/usage/normalize-usage-stats";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

import type { SortDirection, SortField } from "@/features/usage/model-performance-table-model";

function normalizePeakNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type UsageSource = "provider" | "pi-sessions";

export function useUsage(source: UsageSource = "provider") {
  // Stale-while-revalidate: the controller round-trip can take seconds, so
  // seed from the last-loaded data and refresh in the background instead of
  // blanking the page behind a spinner on every navigation.
  const [stats, setStats] = useState<UsageStats | null>(() =>
    readPageCache<UsageStats>(`usage:stats:${source}`),
  );
  const [peakMetrics, setPeakMetrics] = useState<Map<string, PeakMetrics>>(
    () => readPageCache<Map<string, PeakMetrics>>("usage:peaks") ?? new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("tokens");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedModel, setSelectedModel] = useState<string>("all");

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchUsage =
        source === "pi-sessions" ? api.getPiSessionsUsageStats() : api.getUsageStats();
      // Peak metrics are keyed by this controller's served models and are only
      // rendered for the provider source; skip the round-trip for pi-sessions.
      const fetchPeaks =
        source === "pi-sessions"
          ? Promise.resolve({ metrics: [] as [] })
          : api.getPeakMetrics().catch(() => ({ metrics: [] }));
      const [usageData, peakResult] = await Promise.all([fetchUsage, fetchPeaks]);
      const normalized = normalizeUsageStats(usageData);
      writePageCache(`usage:stats:${source}`, normalized);
      setStats(normalized);

      if (Array.isArray(peakResult.metrics)) {
        const metricsMap = new Map<string, PeakMetrics>();
        for (const metric of peakResult.metrics) {
          const modelId = typeof metric.model_id === "string" ? metric.model_id : "";
          if (!modelId) continue;
          metricsMap.set(modelId, {
            model_id: modelId,
            prefill_tps: normalizePeakNumber(metric.prefill_tps),
            generation_tps: normalizePeakNumber(metric.generation_tps),
            ttft_ms: normalizePeakNumber(metric.ttft_ms),
            best_session_id:
              typeof metric.best_session_id === "string" ? metric.best_session_id : null,
            best_session_prefill_tps: normalizePeakNumber(metric.best_session_prefill_tps),
            best_session_generation_tps: normalizePeakNumber(metric.best_session_generation_tps),
            best_session_ttft_ms: normalizePeakNumber(metric.best_session_ttft_ms),
            total_tokens: normalizePeakNumber(metric.total_tokens) ?? 0,
            total_requests: normalizePeakNumber(metric.total_requests) ?? 0,
          });
        }
        writePageCache("usage:peaks", metricsMap);
        setPeakMetrics(metricsMap);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useMountSubscription(() => {
    void loadStats();
  }, [loadStats]);

  const dailyByModel = useMemo(() => {
    if (!stats || !stats.daily_by_model || !Array.isArray(stats.daily_by_model)) {
      return new Map<string, Map<string, { date: string; model: string; total_tokens: number }>>();
    }
    const grouped = new Map<string, Map<string, (typeof stats.daily_by_model)[0]>>();
    for (const entry of stats.daily_by_model) {
      if (selectedModel !== "all" && entry.model !== selectedModel) continue;
      if (!grouped.has(entry.model)) {
        grouped.set(entry.model, new Map());
      }
      grouped.get(entry.model)!.set(entry.date, entry);
    }
    return grouped;
  }, [stats, selectedModel]);

  const sortedModelNames = useMemo(() => {
    if (!stats) return [];
    return [...stats.by_model].sort((a, b) => b.total_tokens - a.total_tokens).map((m) => m.model);
  }, [stats]);

  const modelOptions = sortedModelNames;

  const modelsForChart = useMemo(
    () =>
      selectedModel === "all"
        ? sortedModelNames
        : sortedModelNames.filter((model) => model === selectedModel),
    [sortedModelNames, selectedModel],
  );

  const modelColorIndex = useMemo(() => {
    const indexByModel = new Map<string, number>();
    sortedModelNames.forEach((model, index) => indexByModel.set(model, index));
    return indexByModel;
  }, [sortedModelNames]);

  const filteredDaily = useMemo(() => {
    if (!stats) return [];
    if (selectedModel === "all") return stats.daily;
    if (!stats.daily_by_model) return [];
    return stats.daily_by_model
      .filter((entry) => entry.model === selectedModel)
      .map((entry) => ({
        date: entry.date,
        requests: entry.requests,
        successful: entry.successful,
        success_rate: entry.success_rate,
        total_tokens: entry.total_tokens,
        prompt_tokens: entry.prompt_tokens,
        completion_tokens: entry.completion_tokens,
        avg_latency_ms: 0,
      }));
  }, [stats, selectedModel]);

  const sortedModels = useMemo(() => {
    if (!stats) return [];
    const sorted =
      selectedModel === "all"
        ? [...stats.by_model]
        : stats.by_model.filter((m) => m.model === selectedModel);
    sorted.sort((a, b) => {
      let aVal: number | string | null;
      let bVal: number | string | null;

      switch (sortField) {
        case "model":
          aVal = a.model.toLowerCase();
          bVal = b.model.toLowerCase();
          break;
        case "requests":
          aVal = a.requests;
          bVal = b.requests;
          break;
        case "tokens":
          aVal = a.total_tokens;
          bVal = b.total_tokens;
          break;
        case "latency":
          aVal = a.avg_latency_ms;
          bVal = b.avg_latency_ms;
          break;
        case "ttft":
          aVal = a.avg_ttft_ms;
          bVal = b.avg_ttft_ms;
          break;
        case "speed":
          aVal = a.tokens_per_sec ?? 0;
          bVal = b.tokens_per_sec ?? 0;
          break;
        default:
          return 0;
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const aNumber = aVal ?? -1;
      const bNumber = bVal ?? -1;
      return sortDirection === "asc"
        ? (aNumber as number) - (bNumber as number)
        : (bNumber as number) - (aNumber as number);
    });
    return sorted;
  }, [sortField, sortDirection, stats, selectedModel]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      } else {
        setSortField(field);
        setSortDirection("desc");
      }
    },
    [sortDirection, sortField],
  );

  const toggleRow = useCallback((model: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(model)) {
        next.delete(model);
      } else {
        next.add(model);
      }
      return next;
    });
  }, []);

  return {
    stats,
    peakMetrics,
    loading,
    error,
    expandedRows,
    sortField,
    sortDirection,
    loadStats,
    dailyByModel,
    modelsForChart,
    modelColorIndex,
    modelOptions,
    filteredDaily,
    selectedModel,
    setSelectedModel,
    sortedModels,
    handleSort,
    toggleRow,
  };
}
