"use client";

import { useCallback, useRef, useState } from "react";
import type { HuggingFaceModel } from "@/lib/types";
import {
  DownloadStatusSection,
  ExploreControls,
  ExploreResultsSection,
} from "./explore-tab-sections";
import { useExplore } from "./use-explore";
import { useDownloads } from "@/features/recipes/use-downloads";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import { LazyHuggingFaceModelCardPanel } from "@/ui/lazy-huggingface-model-card";
import type { ModelFit } from "./hardware-profile";

export function ExploreTab() {
  const {
    groups,
    maxVramGb,
    detectedPoolGb,
    poolOverrideGb,
    hardwareProfile,
    setPoolOverrideGb,
    loading,
    error,
    search,
    library,
    sort,
    hasMore,
    setSearch,
    setLibrary,
    setSort,
    loadMore,
    refresh,
  } = useExplore();
  const {
    downloads,
    downloadsByModel,
    startingModelIds,
    error: downloadError,
    startDownload,
    pauseDownload,
    resumeDownload,
  } = useDownloads();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [localModelIds, setLocalModelIds] = useState<Set<string>>(new Set());
  const [selectedModelCard, setSelectedModelCard] = useState<{
    model: HuggingFaceModel;
    variants: HuggingFaceModel[];
    fit?: ModelFit;
  } | null>(null);
  const completedSet = useRef<Set<string>>(new Set());

  const loadLocalModels = useCallback(async () => {
    try {
      const data = await api.getModels();
      const ids = new Set<string>();
      for (const m of data.models || []) {
        ids.add(m.name.toLowerCase());
        for (const part of m.path.split("/")) {
          if (part) ids.add(part.toLowerCase());
        }
      }
      setLocalModelIds(ids);
    } catch {}
  }, []);

  useMountSubscription(() => {
    void loadLocalModels();
  }, [loadLocalModels]);
  useMountSubscription(() => {
    let shouldRefresh = false;
    for (const d of downloads) {
      if (d.status === "completed" && !completedSet.current.has(d.id)) {
        completedSet.current.add(d.id);
        shouldRefresh = true;
      }
    }
    if (shouldRefresh) {
      void loadLocalModels();
    }
  }, [downloads, loadLocalModels]);

  const isLocal = useCallback(
    (modelId: string) => {
      const normalized = modelId.toLowerCase();
      return localModelIds.has(normalized) || localModelIds.has(normalized.split("/").pop() ?? "");
    },
    [localModelIds],
  );

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleStartDownload = useCallback(
    async (modelId: string) => {
      await startDownload({ model_id: modelId });
    },
    [startDownload],
  );

  const handlePause = useCallback(
    async (id: string) => {
      await pauseDownload(id);
    },
    [pauseDownload],
  );

  const handleResume = useCallback(
    async (id: string) => {
      await resumeDownload(id);
    },
    [resumeDownload],
  );

  const openModelCard = useCallback(
    (model: HuggingFaceModel, variants: HuggingFaceModel[], fit?: ModelFit) => {
      setSelectedModelCard({ model, variants, fit });
    },
    [],
  );

  return (
    <div className="space-y-4">
      <ExploreControls
        groupsCount={groups.length}
        maxVramGb={maxVramGb}
        detectedPoolGb={detectedPoolGb}
        poolOverrideGb={poolOverrideGb}
        hardwareProfile={hardwareProfile}
        loading={loading}
        search={search}
        setSearch={setSearch}
        library={library}
        setLibrary={setLibrary}
        sort={sort}
        setSort={setSort}
        setPoolOverrideGb={setPoolOverrideGb}
        refresh={refresh}
      />
      <DownloadStatusSection error={downloadError} />
      <ExploreResultsSection
        groups={groups}
        expandedKeys={expandedKeys}
        search={search}
        loading={loading}
        error={error}
        hasMore={hasMore}
        maxVramGb={maxVramGb}
        downloadsByModel={downloadsByModel}
        startingModelIds={startingModelIds}
        isLocal={isLocal}
        toggleExpand={toggleExpand}
        startDownload={handleStartDownload}
        pauseDownload={handlePause}
        resumeDownload={handleResume}
        loadMore={loadMore}
        openModelCard={openModelCard}
      />
      <LazyHuggingFaceModelCardPanel
        open={Boolean(selectedModelCard)}
        model={selectedModelCard?.model ?? null}
        variants={selectedModelCard?.variants ?? []}
        fit={selectedModelCard?.fit}
        onClose={() => setSelectedModelCard(null)}
      />
    </div>
  );
}
