// CRITICAL
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import type { HuggingFaceModel, ModelInfo } from "@/lib/types";
import { extractProvider, normalizeModelId } from "../_components/utils";

export function useDiscover() {
  const [models, setModels] = useState<HuggingFaceModel[]>([]);
  const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
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

  const PAGE_SIZE = 50;

  useEffect(() => {
    let mounted = true;
    api
      .getModels()
      .then((data) => {
        if (mounted) {
          setLocalModels(data.models || []);
        }
      })
      .catch(() => {
        if (mounted) setLocalModels([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

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
    if (!providerFilter) return models;
    return models.filter((model) => extractProvider(model.modelId) === providerFilter);
  }, [models, providerFilter]);

  const refreshModels = useCallback(() => fetchModels(false), [fetchModels]);

  return {
    models,
    filteredModels,
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
    setSearch,
    setTask,
    setSort,
    setLibrary,
    setShowFilters,
    setProviderFilter,
    copyModelId,
    loadMore,
    refreshModels,
    isModelLocal,
  };
}
