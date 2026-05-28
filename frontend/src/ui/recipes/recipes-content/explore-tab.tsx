"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  DownloadStatusSection,
  ExploreControls,
  ExploreResultsSection,
} from "./explore-tab-sections";
import { useExplore } from "./use-explore";
import { useDownloads } from "@/hooks/use-downloads";
import api from "@/lib/api";

export function ExploreTab() {
  const {
    groups,
    maxVramGb,
    detectedPoolGb,
    poolOverrideGb,
    setPoolOverrideGb,
    gpuCount,
    loading,
    error,
    search,
    hasMore,
    setSearch,
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

  const subscribeLocalModels = useCallback(
    (_notify: () => void) => {
      void loadLocalModels();
      return () => {};
    },
    [loadLocalModels],
  );

  const subscribeCompletedDownloads = useCallback(
    (_notify: () => void) => {
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
      return () => {};
    },
    [downloads, loadLocalModels],
  );

  useSyncExternalStore(subscribeLocalModels, getExploreTabSnapshot, getExploreTabSnapshot);
  useSyncExternalStore(subscribeCompletedDownloads, getExploreTabSnapshot, getExploreTabSnapshot);

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

  return (
    <div className="space-y-5">
      <ExploreControls
        groupsCount={groups.length}
        maxVramGb={maxVramGb}
        detectedPoolGb={detectedPoolGb}
        poolOverrideGb={poolOverrideGb}
        gpuCount={gpuCount}
        loading={loading}
        error={error}
        search={search}
        setSearch={setSearch}
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
      />
    </div>
  );
}

const getExploreTabSnapshot = (): number => 0;
