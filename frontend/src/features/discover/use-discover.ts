"use client";

import { useCallback, useMemo, useState } from "react";
import api from "@/lib/api/client";
import type { ModelInfo, ModelRecommendation } from "@/lib/types";
import { useHuggingFaceModelSearch } from "@/hooks/use-huggingface-model-search";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useCopiedValue } from "@/hooks/use-copied-flag";
import { RECENT_HF_MODEL_SORT } from "@/lib/huggingface";
import { extractProvider, extractQuantizations, normalizeModelId } from "@/features/discover/utils";

export function useDiscover() {
  const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
  const [recommendations, setRecommendations] = useState<ModelRecommendation[]>([]);
  const [maxVramGb, setMaxVramGb] = useState(0);
  const [selectedVramGb, setSelectedVramGb] = useState(0);
  const [search, setSearch] = useState("");
  const [task, setTask] = useState("");
  const [sort, setSort] = useState("");
  const [library, setLibrary] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [copiedId, markCopiedId] = useCopiedValue<string>(2000);
  const [providerFilter, setProviderFilter] = useState("");
  const [excludedQuantizations, setExcludedQuantizations] = useState<string[]>([]);

  const configureDiscoverParams = useCallback(
    (params: URLSearchParams, isBrowsing: boolean) => {
      // HF's `filter` param is repeatable (AND logic). Setting it twice with
      // params.set() would overwrite — the old code silently dropped the task
      // filter when a library was also selected. Use append for each so both
      // constraints apply.
      if (task) params.append("filter", task);
      if (library) params.append("filter", library);
      const nextSort = isBrowsing ? RECENT_HF_MODEL_SORT : sort;
      if (nextSort) params.set("sort", nextSort);
    },
    [library, sort, task],
  );

  const { models, loading, error, hasMore, loadMore, fetchModels } = useHuggingFaceModelSearch(
    search,
    configureDiscoverParams,
  );

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

  useMountSubscription(() => {
    void loadLocalModels();
    void loadRecommendations();
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

  const copyModelId = useCallback(
    (modelId: string) => {
      navigator.clipboard.writeText(modelId);
      markCopiedId(modelId);
    },
    [markCopiedId],
  );

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

  const refreshModels = useCallback(() => fetchModels(false, 0), [fetchModels]);

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
