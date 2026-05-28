"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import api from "@/lib/api";
import type { PeakMetrics, SortDirection, SortField, UsageStats } from "@/lib/types";
import { normalizeUsageStats } from "../lib/normalize-usage-stats";

function normalizePeakNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type UsageSource = "provider" | "pi-sessions";

export function useUsage(source: UsageSource = "provider") {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [peakMetrics, setPeakMetrics] = useState<Map<string, PeakMetrics>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("success");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchUsage =
        source === "pi-sessions" ? api.getPiSessionsUsageStats() : api.getUsageStats();
      const [usageData, peakData] = await Promise.all([fetchUsage, api.getPeakMetrics()]);
      setStats(normalizeUsageStats(usageData));

      if (Array.isArray(peakData.metrics)) {
        const metricsMap = new Map<string, PeakMetrics>();
        for (const metric of peakData.metrics) {
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
        setPeakMetrics(metricsMap);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [source]);

  const subscribeUsageStats = useCallback(
    (_notify: () => void) => {
      void loadStats();
      return () => {};
    },
    [loadStats],
  );

  useSyncExternalStore(subscribeUsageStats, getUsageSnapshot, getUsageSnapshot);

  const dailyByModel = useMemo(() => {
    if (!stats || !stats.daily_by_model || !Array.isArray(stats.daily_by_model)) {
      return new Map<string, Map<string, { date: string; model: string; total_tokens: number }>>();
    }
    const grouped = new Map<string, Map<string, (typeof stats.daily_by_model)[0]>>();
    for (const entry of stats.daily_by_model) {
      if (!grouped.has(entry.model)) {
        grouped.set(entry.model, new Map());
      }
      grouped.get(entry.model)!.set(entry.date, entry);
    }
    return grouped;
  }, [stats]);

  const modelsForChart = useMemo(() => {
    if (!stats) return [];
    return [...stats.by_model].sort((a, b) => b.total_tokens - a.total_tokens).map((m) => m.model);
  }, [stats]);

  const sortedModels = useMemo(() => {
    if (!stats) return [];
    const sorted = [...stats.by_model];
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
        case "success":
          aVal = a.success_rate;
          bVal = b.success_rate;
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
  }, [sortField, sortDirection, stats]);

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
    sortedModels,
    handleSort,
    toggleRow,
  };
}

const getUsageSnapshot = (): number => 0;
