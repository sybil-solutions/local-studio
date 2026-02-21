// CRITICAL
import type { HuggingFaceModel, ModelDownload, ModelRecommendation } from "@/lib/types";
import { SORT_OPTIONS, TASKS } from "./config";
import { DiscoverHeader } from "./discover/discover-header";
import { DiscoverSearchToolbar } from "./discover/discover-search-toolbar";
import { DiscoverFiltersPanel } from "./discover/discover-filters-panel";
import { DiscoverSortChips } from "./discover/discover-sort-chips";
import { DiscoverDownloadQueue } from "./discover/discover-download-queue";
import { DiscoverResults } from "./discover/discover-results";

interface DiscoverViewProps {
  models: HuggingFaceModel[];
  filteredModels: HuggingFaceModel[];
  loading: boolean;
  error: string | null;
  search: string;
  task: string;
  sort: string;
  library: string;
  showFilters: boolean;
  copiedId: string | null;
  hasMore: boolean;
  providerFilter: string;
  providers: string[];
  recommendations: ModelRecommendation[];
  maxVramGb: number;
  selectedVramGb: number;
  excludedQuantizations: string[];
  downloads: ModelDownload[];
  getDownloadForModel: (modelId: string) => ModelDownload | null;
  onSearchChange: (value: string) => void;
  onTaskChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onLibraryChange: (value: string) => void;
  onToggleFilters: () => void;
  onProviderFilterChange: (value: string) => void;
  onExcludedQuantizationsChange: (value: string[]) => void;
  onSelectedVramChange: (value: number) => void;
  onCopyModelId: (modelId: string) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  isModelLocal: (modelId: string) => boolean;
  onStartDownload: (params: { model_id: string }) => Promise<void>;
  onPauseDownload: (downloadId: string) => Promise<void>;
  onResumeDownload: (downloadId: string) => Promise<void>;
  onCancelDownload: (downloadId: string) => Promise<void>;
}

export function DiscoverView({
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
  downloads,
  getDownloadForModel,
  onSearchChange,
  onTaskChange,
  onSortChange,
  onLibraryChange,
  onToggleFilters,
  onProviderFilterChange,
  onExcludedQuantizationsChange,
  onSelectedVramChange,
  onCopyModelId,
  onLoadMore,
  onRefresh,
  isModelLocal,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
}: DiscoverViewProps) {
  const effectiveVramGb = selectedVramGb > 0 ? selectedVramGb : maxVramGb;
  const visibleRecommendations = recommendations.filter((recommendation) => {
    if (typeof recommendation.min_vram_gb !== "number") return true;
    if (effectiveVramGb <= 0) return true;
    return recommendation.min_vram_gb <= effectiveVramGb;
  });
  const sliderMax = Math.max(1, Math.round(maxVramGb));
  const sliderValue = Math.max(1, Math.min(sliderMax, Math.round(effectiveVramGb || sliderMax)));

  return (
    <div className="flex flex-col h-full bg-(--bg) text-(--fg)">
      <DiscoverHeader showFilters={showFilters} onToggleFilters={onToggleFilters} onRefresh={onRefresh} loading={loading} />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div style={{ padding: "1.5rem" }}>
          <DiscoverDownloadQueue
            downloads={downloads}
            onPauseDownload={onPauseDownload}
            onResumeDownload={onResumeDownload}
            onCancelDownload={onCancelDownload}
          />

          {/* Toolbar */}
          <DiscoverSearchToolbar search={search} onSearchChange={onSearchChange} />

          {/* Filters */}
          <DiscoverFiltersPanel
            showFilters={showFilters}
            task={task}
            providerFilter={providerFilter}
            providers={providers}
            library={library}
            sort={sort}
            tasks={TASKS}
            sortOptions={SORT_OPTIONS}
            excludedQuantizations={excludedQuantizations}
            onTaskChange={onTaskChange}
            onProviderFilterChange={onProviderFilterChange}
            onLibraryChange={onLibraryChange}
            onSortChange={onSortChange}
            onExcludedQuantizationsChange={onExcludedQuantizationsChange}
          />

          {/* Quick sort chips */}
          <DiscoverSortChips sort={sort} sortOptions={SORT_OPTIONS} onSortChange={onSortChange} />

          {recommendations.length > 0 && (
            <div className="mb-4 p-4 bg-(--surface) border border-(--border) rounded-lg">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <h3 className="text-sm font-semibold text-(--fg)">VRAM-aware Recommendations</h3>
                <div className="text-xs text-(--dim)">
                  {maxVramGb > 0 ? `Available VRAM ${Math.round(maxVramGb)} GB` : "VRAM unknown"}
                </div>
              </div>
              {maxVramGb > 0 && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-(--dim) mb-1">
                    <span>Recommendation budget</span>
                    <span>{Math.round(effectiveVramGb)} GB</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={sliderMax}
                    value={sliderValue}
                    onChange={(event) => onSelectedVramChange(Number(event.target.value))}
                    className="w-full accent-(--hl1)"
                    aria-label="VRAM recommendation budget"
                  />
                </div>
              )}
              <div className="space-y-2">
                {visibleRecommendations.slice(0, 5).map((rec) => (
                  <div key={rec.id} className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm text-(--fg) truncate">{rec.name}</div>
                      <div className="text-xs text-(--dim) truncate">{rec.description}</div>
                    </div>
                    {typeof rec.min_vram_gb === "number" && (
                      <div
                        className={
                          "shrink-0 text-xs px-2 py-1 rounded-md border " +
                          ((effectiveVramGb === 0 || rec.min_vram_gb <= effectiveVramGb)
                            ? "text-(--hl2) border-(--hl2)/30 bg-(--hl2)/10"
                            : "text-(--err) border-(--err)/30 bg-(--err)/10")
                        }
                      >
                        min {Math.round(rec.min_vram_gb)} GB
                      </div>
                    )}
                  </div>
                ))}
                {visibleRecommendations.length === 0 && (
                  <div className="text-xs text-(--dim)">
                    No recommendations fit the current VRAM budget. Increase the slider.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Results */}
          <DiscoverResults
            models={models}
            filteredModels={filteredModels}
            loading={loading}
            error={error}
            providerFilter={providerFilter}
            copiedId={copiedId}
            hasMore={hasMore}
            isModelLocal={isModelLocal}
            getDownloadForModel={getDownloadForModel}
            onCopyModelId={onCopyModelId}
            onRefresh={onRefresh}
            onLoadMore={onLoadMore}
            onStartDownload={onStartDownload}
            onPauseDownload={onPauseDownload}
            onResumeDownload={onResumeDownload}
          />
        </div>
      </div>
    </div>
  );
}
