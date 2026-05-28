"use client";

import { DiscoverView } from "./_components/discover-view";
import { useDiscover } from "./hooks/use-discover";
import { useDownloads } from "@/hooks/use-downloads";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

export default function DiscoverPage() {
  const {
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
    recommendations,
    maxVramGb,
    selectedVramGb,
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
    refreshLocalModels,
    isModelLocal,
  } = useDiscover();

  const {
    downloads,
    downloadsByModel,
    startingModelIds,
    error: downloadError,
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
  } = useDownloads();

  const completedSet = useRef<Set<string>>(new Set());

  const subscribeCompletedDownloads = useCallback(
    (_notify: () => void) => {
      let shouldRefresh = false;
      for (const download of downloads) {
        if (download.status === "completed" && !completedSet.current.has(download.id)) {
          completedSet.current.add(download.id);
          shouldRefresh = true;
        }
      }
      if (shouldRefresh) {
        void refreshLocalModels();
      }
      return () => {};
    },
    [downloads, refreshLocalModels],
  );

  useSyncExternalStore(
    subscribeCompletedDownloads,
    getCompletedDownloadsSnapshot,
    getCompletedDownloadsSnapshot,
  );

  const getDownloadForModel = useMemo(() => {
    return (modelId: string) => downloadsByModel.get(modelId) ?? null;
  }, [downloadsByModel]);

  return (
    <DiscoverView
      models={models}
      filteredModels={filteredModels}
      loading={loading}
      error={error}
      search={search}
      task={task}
      sort={sort}
      library={library}
      showFilters={showFilters}
      copiedId={copiedId}
      hasMore={hasMore}
      providerFilter={providerFilter}
      providers={providers}
      recommendations={recommendations}
      maxVramGb={maxVramGb}
      selectedVramGb={selectedVramGb}
      excludedQuantizations={excludedQuantizations}
      onSearchChange={setSearch}
      onTaskChange={setTask}
      onSortChange={setSort}
      onLibraryChange={setLibrary}
      onToggleFilters={() => setShowFilters(!showFilters)}
      onProviderFilterChange={setProviderFilter}
      onExcludedQuantizationsChange={setExcludedQuantizations}
      onSelectedVramChange={setSelectedVramGb}
      onCopyModelId={copyModelId}
      onLoadMore={loadMore}
      onRefresh={refreshModels}
      isModelLocal={isModelLocal}
      downloads={downloads}
      downloadError={downloadError}
      startingModelIds={startingModelIds}
      getDownloadForModel={getDownloadForModel}
      onStartDownload={async (params) => {
        await startDownload(params);
      }}
      onPauseDownload={async (id) => {
        await pauseDownload(id);
      }}
      onResumeDownload={async (id) => {
        await resumeDownload(id);
      }}
      onCancelDownload={async (id) => {
        await cancelDownload(id);
      }}
    />
  );
}

const getCompletedDownloadsSnapshot = (): number => 0;
