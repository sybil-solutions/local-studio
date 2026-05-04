"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import type { GPU, HuggingFaceModel, ModelRecommendation } from "@/lib/types";
import {
  filterRecommendationsWithinPool,
  hasHfEngagementStats,
  interleaveExploreGroupsByVramTier,
  isRecentlyCreatedOnHf,
  sumGpuMemoryPoolGb,
} from "@/app/recipes/_components/recipes-content/explore-eligibility";
import { readExplorePoolOverrideGb, writeExplorePoolOverrideGb } from "./explore-pool-storage";
import {
  modelRecencyMs,
  resolveGroupNeedGb,
} from "@/app/recipes/_components/recipes-content/explore-model-stats";

import { normalizeModelId } from "@/app/discover/_components/utils";

export interface ModelGroup {
  key: string;
  lead: HuggingFaceModel;
  variants: HuggingFaceModel[];
  /** Peak monthly downloads across merged variants (same family, different repos). */
  maxDownloads: number;
  maxLikes: number;
  lastModifiedMs: number;
  needGb: number | null;
}

function groupPassesExploreFilters(group: ModelGroup, search: string): boolean {
  if (!hasHfEngagementStats(group.lead)) return false;
  // When the user searches, relevance matters more than the Explore recency gate;
  // otherwise well-known models disappear and the page looks broken.
  if (search.trim().length > 0) return true;
  return isRecentlyCreatedOnHf(group.lead);
}

export function useExplore() {
  const [models, setModels] = useState<HuggingFaceModel[]>([]);
  const [gpus, setGpus] = useState<GPU[]>([]);
  const [apiMaxVramGb, setApiMaxVramGb] = useState(0);
  const [poolOverrideGb, setPoolOverrideGbState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [recommendations, setRecommendations] = useState<ModelRecommendation[]>([]);
  const PAGE_SIZE = 50;

  useEffect(() => {
    setPoolOverrideGbState(readExplorePoolOverrideGb());
  }, []);

  const setPoolOverrideGb = useCallback((value: number | null) => {
    writeExplorePoolOverrideGb(value);
    setPoolOverrideGbState(value);
  }, []);

  const poolGbFromGpus = useMemo(() => sumGpuMemoryPoolGb(gpus), [gpus]);

  /** From hardware + API only (no manual override). */
  const detectedPoolGb = poolGbFromGpus > 0 ? poolGbFromGpus : apiMaxVramGb;

  /** User override wins when set; otherwise detected pool. */
  const poolGb =
    poolOverrideGb != null && poolOverrideGb > 0
      ? poolOverrideGb
      : detectedPoolGb > 0
        ? detectedPoolGb
        : 0;

  const spotlightRecommendations = useMemo(() => {
    return filterRecommendationsWithinPool(recommendations, poolGb);
  }, [recommendations, poolGb]);

  const loadRecommendationsAndGpus = useCallback(async () => {
    try {
      const [recData, gpuData] = await Promise.all([
        api.getModelRecommendations(),
        api.getGPUs().catch(() => ({ gpus: [] as GPU[] })),
      ]);
      setRecommendations(recData.recommendations ?? []);
      const vram = typeof recData.max_vram_gb === "number" ? recData.max_vram_gb : 0;
      setApiMaxVramGb(vram);
      setGpus(gpuData.gpus ?? []);
    } catch {
      setRecommendations([]);
      setApiMaxVramGb(0);
      setGpus([]);
    }
  }, []);

  const fetchModels = useCallback(
    async (append: boolean, pageIndex: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        params.set("filter", "text-generation");
        params.set("sort", search.trim().length > 0 ? "downloads" : "trending");
        params.set("limit", String(PAGE_SIZE));
        params.set("full", "false");
        params.set("offset", String(pageIndex * PAGE_SIZE));

        const response = await fetch(`/api/proxy/v1/huggingface/models?${params.toString()}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ detail: "Failed to fetch" }));
          throw new Error(errorData.detail || "Failed to fetch");
        }
        const data = (await response.json()) as HuggingFaceModel[];

        if (append) {
          setModels((prev) => [...prev, ...data]);
          setPage(pageIndex);
        } else {
          setModels(data);
          setPage(0);
        }
        setHasMore(data.length === PAGE_SIZE);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [search],
  );

  useEffect(() => {
    void loadRecommendationsAndGpus();
  }, [loadRecommendationsAndGpus]);

  useEffect(() => {
    setPage(0);
    const debounce = setTimeout(() => {
      void fetchModels(false, 0);
    }, 300);
    return () => clearTimeout(debounce);
  }, [search, fetchModels]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      void fetchModels(true, page + 1);
    }
  }, [loading, hasMore, page, fetchModels]);

  const recByKey = useMemo(() => {
    const m = new Map<string, ModelRecommendation>();
    for (const r of recommendations) {
      const k = normalizeModelId(r.id) || r.id.toLowerCase();
      m.set(k, r);
    }
    return m;
  }, [recommendations]);

  const spotlightRecKeys = useMemo(() => {
    return new Set(
      spotlightRecommendations.map((r) => normalizeModelId(r.id) || r.id.toLowerCase()),
    );
  }, [spotlightRecommendations]);

  const groupedModels = useMemo((): ModelGroup[] => {
    const groups = new Map<string, HuggingFaceModel[]>();
    const seen = new Set<string>();

    for (const model of models) {
      const key = normalizeModelId(model.modelId) || model.modelId.toLowerCase();
      const existing = groups.get(key);
      if (existing) {
        existing.push(model);
      } else if (!seen.has(key)) {
        seen.add(key);
        groups.set(key, [model]);
      } else {
        const g = groups.get(key);
        if (g) g.push(model);
      }
    }

    return Array.from(groups.entries()).map(([key, variants]) => {
      const sorted = [...variants].sort((a, b) => {
        const tm = modelRecencyMs(b) - modelRecencyMs(a);
        if (tm !== 0) return tm;
        if (b.downloads !== a.downloads) return b.downloads - a.downloads;
        return b.likes - a.likes;
      });
      const lead = sorted[0];
      const maxDownloads = sorted.reduce((m, v) => Math.max(m, v.downloads), 0);
      const maxLikes = sorted.reduce((m, v) => Math.max(m, v.likes), 0);
      const lastModifiedMs = sorted.reduce((m, v) => Math.max(m, modelRecencyMs(v)), 0);
      const needGb = resolveGroupNeedGb(key, recByKey, lead);
      return { key, lead, variants: sorted, maxDownloads, maxLikes, lastModifiedMs, needGb };
    });
  }, [models, recByKey]);

  const sortedGroups = useMemo(() => {
    return [...groupedModels].sort((a, b) => {
      const aSpot = spotlightRecKeys.has(a.key);
      const bSpot = spotlightRecKeys.has(b.key);
      if (aSpot && !bSpot) return -1;
      if (!aSpot && bSpot) return 1;

      const ta = a.lastModifiedMs;
      const tb = b.lastModifiedMs;
      if (tb !== ta) return tb - ta;

      if (b.maxDownloads !== a.maxDownloads) return b.maxDownloads - a.maxDownloads;
      if (b.maxLikes !== a.maxLikes) return b.maxLikes - a.maxLikes;

      if (poolGb > 0) {
        const ea = a.needGb;
        const eb = b.needGb;
        const fitA = ea != null && ea <= poolGb;
        const fitB = eb != null && eb <= poolGb;
        if (fitA !== fitB) return fitA ? -1 : 1;
        if (ea != null && eb != null) {
          if (fitA) return ea - eb;
          return ea - poolGb - (eb - poolGb);
        }
      }
      return 0;
    });
  }, [groupedModels, spotlightRecKeys, poolGb]);

  const mixedGroups = useMemo(
    () => interleaveExploreGroupsByVramTier(sortedGroups, poolGb),
    [sortedGroups, poolGb],
  );

  const visibleGroups = useMemo(() => {
    return mixedGroups.filter((g) => groupPassesExploreFilters(g, search));
  }, [mixedGroups, search]);

  const refresh = useCallback(() => {
    void (async () => {
      await loadRecommendationsAndGpus();
      await fetchModels(false, 0);
    })();
  }, [loadRecommendationsAndGpus, fetchModels]);

  return {
    groups: visibleGroups,
    maxVramGb: poolGb,
    detectedPoolGb,
    poolOverrideGb,
    setPoolOverrideGb,
    gpuCount: gpus.length,
    loading,
    error,
    search,
    hasMore,
    recommendations,
    setSearch,
    loadMore,
    refresh,
  };
}
