// CRITICAL
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import type { PeakMetrics, SortDirection, SortField, UsageStats } from "@/lib/types";

export function useUsage() {
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
      const [usageData, peakData] = await Promise.all([api.getUsageStats(), api.getPeakMetrics()]);
      setStats(usageData);

      if (peakData.metrics) {
        const metricsMap = new Map<string, PeakMetrics>();
        for (const metric of peakData.metrics) {
          metricsMap.set(metric.model_id, metric);
        }
        setPeakMetrics(metricsMap);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

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
      let aVal: number | string;
      let bVal: number | string;

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
      return sortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
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
