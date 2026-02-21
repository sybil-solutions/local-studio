// CRITICAL
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import type { HuggingFaceModel, ModelInfo, ModelRecommendation } from "@/lib/types";
import { extractProvider, extractQuantizations, normalizeModelId } from "../_components/utils";

export function useDiscover() {
  const [models, setModels] = useState<HuggingFaceModel[]>([]);
  const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
  const [recommendations, setRecommendations] = useState<ModelRecommendation[]>([]);
  const [maxVramGb, setMaxVramGb] = useState(0);
  const [selectedVramGb, setSelectedVramGb] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [task, setTask] = useState("text-generation");
  const [sort, setSort] = useState("trending");
  const [library, setLibrary] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [providerFilter, setProviderFilter] = useState("");
  const [excludedQuantizations, setExcludedQuantizations] = useState<string[]>([]);

  const PAGE_SIZE = 50;

  const loadRecommendations = useCallback(async () => {
    try {
      const data = await api.getModelRecommendations();
      setRecommendations(data.recommendations ?? []);
      const nextMaxVramGb = typeof data.max_vram_gb === "number" ? data.max_vram_gb : 0;
      setMaxVramGb(nextMaxVramGb);
      setSelectedVramGb((previous) => {
        if (nextMaxVramGb <= 0) return 0;
        if (previous <= 0) return nextMaxVramGb;
        return Math.min(previous, nextMaxVramGb);
      });
    } catch {
      setRecommendations([]);
      setMaxVramGb(0);
      setSelectedVramGb(0);
    }
  }, []);

  const loadLocalModels = useCallback(async () => {
    try {
      const data = await api.getModels();
      setLocalModels(data.models || []);
    } catch {
      setLocalModels([]);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    if (mounted) {
      loadLocalModels();
      loadRecommendations();
    }
    return () => {
      mounted = false;
    };
  }, [loadLocalModels, loadRecommendations]);

  const localModelMap = useMemo(() => {
    const map = new Map<string, boolean>();
    localModels.forEach((model) => {
      const normalized = normalizeModelId(model.name);
      map.set(normalized, true);
      const pathParts = model.path.split("/");
      pathParts.forEach((part) => {
        const normalizedPart = normalizeModelId(part);
        if (normalizedPart) map.set(normalizedPart, true);
      });
    });
    return map;
  }, [localModels]);

  const isModelLocal = useCallback(
    (modelId: string): boolean => {
      const normalized = normalizeModelId(modelId);
      if (localModelMap.has(normalized)) return true;
      const parts = normalized.split(/[-_/]/);
      for (const part of parts) {
        if (part && localModelMap.has(part)) return true;
      }
      return false;
    },
    [localModelMap],
  );

  const fetchModels = useCallback(
    async (append = false) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (task) params.set("filter", task);
        if (library) params.set("filter", library);
        params.set("sort", sort);
        params.set("limit", String(PAGE_SIZE));
        params.set("full", "false");
        params.set("offset", String(append ? page * PAGE_SIZE : 0));

        const response = await fetch(`/api/proxy/v1/huggingface/models?${params.toString()}`);
        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ detail: "Failed to fetch models" }));
          throw new Error(errorData.detail || "Failed to fetch models");
        }
        const data = await response.json();

        if (append) {
          setModels((prev) => [...prev, ...data]);
        } else {
          setModels(data);
        }

        setHasMore(data.length === PAGE_SIZE);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [library, page, search, sort, task],
  );

  useEffect(() => {
    setPage(0);
    const debounce = setTimeout(() => {
      fetchModels(false);
    }, 300);
    return () => clearTimeout(debounce);
  }, [fetchModels, library, search, sort, task]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchModels(true);
    }
  }, [page, loading, hasMore, fetchModels]);

  const copyModelId = useCallback((modelId: string) => {
    navigator.clipboard.writeText(modelId);
    setCopiedId(modelId);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const providers = useMemo(() => {
    const providerSet = new Set<string>();
    models.forEach((model) => {
      providerSet.add(extractProvider(model.modelId));
    });
    return Array.from(providerSet).sort();
  }, [models]);

  const filteredModels = useMemo(() => {
    let out = models;
    if (providerFilter) {
      out = out.filter((model) => extractProvider(model.modelId) === providerFilter);
    }
    if (excludedQuantizations.length > 0) {
      out = out.filter((model) => {
        const quants = extractQuantizations(model.tags ?? []);
        return !quants.some((q) => excludedQuantizations.includes(q));
      });
    }
    return out;
  }, [models, providerFilter, excludedQuantizations]);

  const refreshModels = useCallback(() => fetchModels(false), [fetchModels]);

  return {
    models,
    filteredModels,
    recommendations,
    maxVramGb,
    selectedVramGb,
    loading,
    error,
    search,
    task,
    sort,
    library,
    showFilters,
    copiedId,
    hasMore,
    providerFilter,
    providers,
    excludedQuantizations,
    setSearch,
    setTask,
    setSort,
    setLibrary,
    setShowFilters,
    setProviderFilter,
    setExcludedQuantizations,
    setSelectedVramGb,
    copyModelId,
    loadMore,
    refreshModels,
    refreshLocalModels: loadLocalModels,
    isModelLocal,
  };
}
