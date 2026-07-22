"use client";

import { useCallback, useMemo, useState } from "react";
import api from "@/lib/api/client";
import type { GPU, HuggingFaceModel } from "@/lib/types";
import type { ModelIndexModel } from "@/lib/api/studio";
import { useHuggingFaceModelSearch } from "@/features/recipes/use-huggingface-model-search";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  engagementTier,
  isDerivativeModel,
  modelFamilyName,
  modelRecencyMs,
  originalModelKey,
  RECENT_HF_MODEL_SORT,
} from "@/lib/huggingface";
import {
  filterIndexModelsWithinPool,
  hasHfEngagementStats,
  interleaveExploreGroupsByVramTier,
  isRecentlyCreatedOnHf,
  sumGpuMemoryPoolGb,
} from "@/features/recipes/recipes-content/explore-eligibility";
import { readExplorePoolOverrideGb, writeExplorePoolOverrideGb } from "./explore-pool-storage";
import { resolveGroupNeedGb } from "@/features/recipes/recipes-content/explore-model-stats";
import {
  buildHardwareProfile,
  scoreModelFit,
  type HardwareProfile,
  type ModelFit,
} from "./hardware-profile";

export interface ModelGroup {
  key: string;
  lead: HuggingFaceModel;
  variants: HuggingFaceModel[];
  /** Peak monthly downloads across merged variants (same family, different repos). */
  maxDownloads: number;
  maxLikes: number;
  lastModifiedMs: number;
  needGb: number | null;
  tier: "heavy" | "warm" | "fresh";
  fit: ModelFit;
}

function groupPassesExploreFilters(group: ModelGroup, search: string): boolean {
  if (!hasHfEngagementStats(group.lead)) return false;
  // When the user searches, relevance matters more than the Explore recency gate;
  // otherwise well-known models disappear and the page looks broken.
  if (search.trim().length > 0) return true;
  if (group.tier === "heavy" || group.tier === "warm") return true;
  return isRecentlyCreatedOnHf(group.lead);
}

export function exploreGroupKey(modelId: string): string {
  return modelFamilyName(modelId) || modelId.toLowerCase();
}

export function derivativeScore(model: HuggingFaceModel, search: string): number {
  const id = model.modelId.toLowerCase();
  const tags = model.tags.join(" ").toLowerCase();
  const query = search.trim().toLowerCase();
  let score = 0;
  if (query && (id === query || id.endsWith(`/${query}`))) score -= 50;
  if (/(gguf|awq|gptq|exl2|exl3|mlx|onnx|quant|int4|int8|fp8)/.test(`${id} ${tags}`)) {
    score += 20;
  }
  if (/instruct|chat|base/.test(id)) score -= 2;
  return score;
}

export function useExplore() {
  const [gpus, setGpus] = useState<GPU[]>([]);
  const [apiMaxVramGb, setApiMaxVramGb] = useState(0);
  const [search, setSearch] = useState("");
  const [library, setLibrary] = useState("");
  const [sort, setSort] = useState("");
  const [poolOverrideGb, setPoolOverrideGbState] = useState<number | null>(null);
  const [catalogModels, setCatalogModels] = useState<ModelIndexModel[]>([]);

  const configureExploreParams = useCallback(
    (params: URLSearchParams, isBrowsing: boolean) => {
      // HF `filter` is repeatable (AND logic).
      if (library) params.append("filter", library);
      params.set("sort", isBrowsing ? RECENT_HF_MODEL_SORT : sort || "downloads");
    },
    [library, sort],
  );

  const { models, loading, error, hasMore, loadMore, fetchModels } = useHuggingFaceModelSearch(
    search,
    configureExploreParams,
  );

  useMountSubscription(() => {
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

  const hardwareProfile = useMemo(
    () => buildHardwareProfile({ gpus, poolGb, detectedPoolGb, poolOverrideGb }),
    [gpus, poolGb, detectedPoolGb, poolOverrideGb],
  );

  const spotlightCatalog = useMemo(() => {
    return filterIndexModelsWithinPool(catalogModels, poolGb);
  }, [catalogModels, poolGb]);

  const loadCatalogAndGpus = useCallback(async () => {
    try {
      const [indexData, presetsData, gpuData] = await Promise.all([
        api.getModelIndex(),
        api.getStarterPresets().catch(() => null),
        api.getGPUs().catch(() => ({ gpus: [] as GPU[] })),
      ]);
      setCatalogModels(indexData.tiers?.flatMap((tier) => tier.models) ?? []);
      const vram = typeof presetsData?.max_vram_gb === "number" ? presetsData.max_vram_gb : 0;
      setApiMaxVramGb(vram);
      setGpus(gpuData.gpus ?? []);
    } catch {
      setCatalogModels([]);
      setApiMaxVramGb(0);
      setGpus([]);
    }
  }, []);

  useMountSubscription(() => {
    void loadCatalogAndGpus();
  }, [loadCatalogAndGpus]);

  const catalogByKey = useMemo(() => {
    const m = new Map<string, ModelIndexModel>();
    const add = (repo: string | null | undefined, model: ModelIndexModel, override: boolean) => {
      if (!repo) return;
      const k = exploreGroupKey(repo);
      if (override || !m.has(k)) m.set(k, model);
    };
    for (const model of catalogModels) {
      add(model.id, model, false);
      for (const variant of model.variants) {
        if (variant.format !== "bf16") add(variant.repo, model, false);
      }
      for (const variant of model.variants) {
        if (variant.format === "bf16") add(variant.repo, model, true);
      }
    }
    return m;
  }, [catalogModels]);

  const spotlightKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const model of spotlightCatalog) {
      keys.add(exploreGroupKey(model.id));
      for (const variant of model.variants) keys.add(exploreGroupKey(variant.repo));
    }
    return keys;
  }, [spotlightCatalog]);

  const groupedModels = useMemo((): ModelGroup[] => {
    const groups = new Map<string, HuggingFaceModel[]>();
    const seen = new Set<string>();

    for (const model of models) {
      const key = originalModelKey(model);
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
        const leadDelta = leadPreferenceScore(a, search) - leadPreferenceScore(b, search);
        if (leadDelta !== 0) return leadDelta;
        const tm = modelRecencyMs(b) - modelRecencyMs(a);
        if (tm !== 0) return tm;
        if (b.downloads !== a.downloads) return b.downloads - a.downloads;
        return b.likes - a.likes;
      });
      const lead = sorted[0];
      const maxDownloads = sorted.reduce((m, v) => Math.max(m, v.downloads), 0);
      const maxLikes = sorted.reduce((m, v) => Math.max(m, v.likes), 0);
      const lastModifiedMs = sorted.reduce((m, v) => Math.max(m, modelRecencyMs(v)), 0);
      const needGb = resolveGroupNeedGb(key, catalogByKey, lead);
      const tier = engagementTier(maxLikes, maxDownloads);
      const fit = scoreModelFit({
        model: lead,
        variants: sorted,
        needGb,
        maxLikes,
        maxDownloads,
        lastModifiedMs,
        hardware: hardwareProfile,
      });
      return {
        key,
        lead,
        variants: sorted,
        maxDownloads,
        maxLikes,
        lastModifiedMs,
        needGb,
        tier,
        fit,
      };
    });
  }, [models, catalogByKey, search, hardwareProfile]);

  const sortedGroups = useMemo(() => {
    const isSearching = search.trim().length > 0;
    return [...groupedModels].sort((a, b) => {
      const aSpot = spotlightKeys.has(a.key);
      const bSpot = spotlightKeys.has(b.key);
      if (aSpot && !bSpot) return -1;
      if (!aSpot && bSpot) return 1;

      if (isSearching) {
        // SEARCH MODE: HF already ranked these by relevance (it matched the
        // search term server-side and returned them in downloads order within
        // that match set). Preserve HF's order — only break ties by downloads
        // then recency. The old code discarded HF's relevance ranking and
        // re-sorted by raw likes, which buried exact matches under popular
        // unrelated models.
        if (b.maxDownloads !== a.maxDownloads) return b.maxDownloads - a.maxDownloads;
        const ta = a.lastModifiedMs;
        const tb = b.lastModifiedMs;
        if (tb !== ta) return tb - ta;
        return 0;
      }

      // BROWSE MODE (no search): engagement + freshness matter since there's no
      // query to prioritize. Likes are a stronger quality signal than downloads
      // for browsing, so they lead.
      if (b.maxLikes !== a.maxLikes) return b.maxLikes - a.maxLikes;
      if (b.maxDownloads !== a.maxDownloads) return b.maxDownloads - a.maxDownloads;
      const ta = a.lastModifiedMs;
      const tb = b.lastModifiedMs;
      if (tb !== ta) return tb - ta;

      // Final tie-break: prefer models that fit the VRAM pool.
      if (poolGb > 0) {
        const ea = a.needGb;
        const eb = b.needGb;
        const fitA = ea != null && ea <= poolGb;
        const fitB = eb != null && eb <= poolGb;
        if (fitA !== fitB) return fitA ? -1 : 1;
      }
      return 0;
    });
  }, [groupedModels, spotlightKeys, poolGb, search]);

  // VRAM-tier interleaving only makes sense when browsing — when the user has
  // searched for something specific, scrambling the relevance order to mix
  // footprint sizes would bury the match they typed.
  const mixedGroups = useMemo(
    () =>
      search.trim().length > 0
        ? sortedGroups
        : interleaveExploreGroupsByVramTier(sortedGroups, poolGb),
    [sortedGroups, poolGb, search],
  );

  const visibleGroups = useMemo(() => {
    return mixedGroups.filter((g) => groupPassesExploreFilters(g, search));
  }, [mixedGroups, search]);

  const refresh = useCallback(() => {
    void (async () => {
      await loadCatalogAndGpus();
      await fetchModels(false, 0);
    })();
  }, [loadCatalogAndGpus, fetchModels]);

  return {
    groups: visibleGroups,
    maxVramGb: poolGb,
    detectedPoolGb,
    poolOverrideGb,
    hardwareProfile,
    setPoolOverrideGb,
    gpuCount: gpus.length,
    loading,
    error,
    search,
    library,
    sort,
    hasMore,
    catalogModels,
    setSearch,
    setLibrary,
    setSort,
    loadMore,
    refresh,
  };
}

function leadPreferenceScore(model: HuggingFaceModel, search: string): number {
  let score = derivativeScore(model, search);
  if (isDerivativeModel(model)) score += 100;
  if (model.likes >= 1000) score -= 10;
  if (model.likes >= 250) score -= 4;
  return score;
}

export type { HardwareProfile };
