// CRITICAL
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Heart,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { HuggingFaceModel } from "@/lib/types";
import { formatNumber } from "@/lib/formatters";
import { RefreshButton } from "@/components/shared";
import { SORT_OPTIONS, TASKS } from "./config";
import { extractProvider, extractQuantizations } from "./utils";

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
  onSearchChange: (value: string) => void;
  onTaskChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onLibraryChange: (value: string) => void;
  onToggleFilters: () => void;
  onProviderFilterChange: (value: string) => void;
  onCopyModelId: (modelId: string) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  isModelLocal: (modelId: string) => boolean;
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
  onSearchChange,
  onTaskChange,
  onSortChange,
  onLibraryChange,
  onToggleFilters,
  onProviderFilterChange,
  onCopyModelId,
  onLoadMore,
  onRefresh,
  isModelLocal,
}: DiscoverViewProps) {
  return (
    <div className="flex flex-col h-full bg-(--background) text-(--foreground)">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-(--border)"
        style={{
          paddingLeft: "1.5rem",
          paddingRight: "1.5rem",
          paddingTop: "1rem",
          paddingBottom: "1rem",
        }}
      >
        <h1 className="text-xl font-semibold">Discover Models</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleFilters}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              showFilters
                ? "bg-(--accent-purple) text-white"
                : "bg-(--card) border border-(--border) text-(--muted-foreground) hover:text-(--foreground)"
            }`}
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline">Filters</span>
          </button>
          {RefreshButton({
            onRefresh,
            loading,
            className: "hover:bg-(--card-hover) disabled:opacity-50",
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div style={{ padding: "1.5rem" }}>
          {/* Toolbar */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-(--muted-foreground)" />
              <input
                type="text"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search models..."
                className="w-full pl-10 pr-4 py-2 bg-(--card) border border-(--border) rounded-lg text-sm text-(--foreground) placeholder:text-(--muted-foreground)/50 focus:outline-none focus:border-(--accent-purple)"
              />
              {search && (
                <button
                  onClick={() => onSearchChange("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-(--card-hover) rounded transition-colors"
                >
                  <X className="h-3.5 w-3.5 text-(--muted-foreground)" />
                </button>
              )}
            </div>
          </div>

          {/* Filters */}
          {showFilters && (
            <div className="mb-4 p-4 bg-(--card) border border-(--border) rounded-lg">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                {/* Task filter */}
                <div>
                  <label className="block text-xs text-(--muted-foreground) mb-1.5">Task</label>
                  <select
                    value={task}
                    onChange={(event) => onTaskChange(event.target.value)}
                    className="w-full px-3 py-2 bg-(--background) border border-(--border) rounded-lg text-sm text-(--foreground) focus:outline-none focus:border-(--accent-purple)"
                  >
                    {TASKS.map((taskOption) => (
                      <option key={taskOption.value} value={taskOption.value}>
                        {taskOption.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Provider filter */}
                <div>
                  <label className="block text-xs text-(--muted-foreground) mb-1.5">Provider</label>
                  <select
                    value={providerFilter}
                    onChange={(event) => onProviderFilterChange(event.target.value)}
                    className="w-full px-3 py-2 bg-(--background) border border-(--border) rounded-lg text-sm text-(--foreground) focus:outline-none focus:border-(--accent-purple)"
                  >
                    <option value="">All Providers</option>
                    {providers.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Library filter */}
                <div>
                  <label className="block text-xs text-(--muted-foreground) mb-1.5">Library</label>
                  <select
                    value={library}
                    onChange={(event) => onLibraryChange(event.target.value)}
                    className="w-full px-3 py-2 bg-(--background) border border-(--border) rounded-lg text-sm text-(--foreground) focus:outline-none focus:border-(--accent-purple)"
                  >
                    <option value="">All Libraries</option>
                    <option value="transformers">Transformers</option>
                    <option value="pytorch">PyTorch</option>
                    <option value="safetensors">Safetensors</option>
                    <option value="gguf">GGUF</option>
                    <option value="exl2">EXL2</option>
                    <option value="awq">AWQ</option>
                    <option value="gptq">GPTQ</option>
                  </select>
                </div>

                {/* Sort */}
                <div>
                  <label className="block text-xs text-(--muted-foreground) mb-1.5">Sort By</label>
                  <select
                    value={sort}
                    onChange={(event) => onSortChange(event.target.value)}
                    className="w-full px-3 py-2 bg-(--background) border border-(--border) rounded-lg text-sm text-(--foreground) focus:outline-none focus:border-(--accent-purple)"
                  >
                    {SORT_OPTIONS.map((sortOption) => (
                      <option key={sortOption.value} value={sortOption.value}>
                        {sortOption.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Quick sort chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {SORT_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => onSortChange(option.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors ${
                    sort === option.value
                      ? "bg-(--accent-purple) text-white"
                      : "bg-(--card) border border-(--border) text-(--muted-foreground) hover:text-(--foreground) hover:bg-(--card-hover)"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {option.label}
                </button>
              );
            })}
          </div>

          {/* Results */}
          {error ? (
            <div className="text-center py-12">
              <p className="text-(--error) mb-4">{error}</p>
              <button
                onClick={onRefresh}
                className="px-4 py-2 bg-(--card) border border-(--border) rounded-lg text-(--foreground) hover:bg-(--card-hover) transition-colors"
              >
                Retry
              </button>
            </div>
          ) : loading && models.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-(--muted-foreground)">
              <RefreshCw className="h-5 w-5 animate-spin" />
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="text-center py-12 text-(--muted-foreground)">
              <p>No models found</p>
              <p className="text-sm mt-1">Try adjusting your search or filters</p>
            </div>
          ) : (
            <>
              <div className="text-xs text-(--muted-foreground) mb-3">
                {filteredModels.length} {filteredModels.length === 1 ? "model" : "models"}
                {providerFilter && ` from ${providerFilter}`}
              </div>
              <div className="border border-(--border) rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-(--card) border-b border-(--border)">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-(--muted-foreground) uppercase tracking-wider">
                        Model
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-(--muted-foreground) uppercase tracking-wider">
                        Provider
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-(--muted-foreground) uppercase tracking-wider">
                        Task
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-(--muted-foreground) uppercase tracking-wider">
                        Quantization
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-(--muted-foreground) uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-(--muted-foreground) uppercase tracking-wider">
                        Stats
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-(--muted-foreground) uppercase tracking-wider w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--border)">
                    {filteredModels.map((model) => {
                      const provider = extractProvider(model.modelId);
                      const quantizations = extractQuantizations(model.tags);
                      const isLocal = isModelLocal(model.modelId);

                      return (
                        <tr key={model._id} className="hover:bg-(--card)/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="text-sm font-medium text-(--foreground) truncate max-w-xs"
                                title={model.modelId}
                              >
                                {model.modelId}
                              </div>
                              <button
                                onClick={() => onCopyModelId(model.modelId)}
                                className="p-1 hover:bg-(--card-hover) rounded transition-colors shrink-0"
                                title="Copy model ID"
                              >
                                {copiedId === model.modelId ? (
                                  <Check className="h-3 w-3 text-(--success)" />
                                ) : (
                                  <Copy className="h-3 w-3 text-(--muted-foreground)" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-1 bg-(--card) border border-(--border) rounded text-xs text-(--foreground)">
                              {provider}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {model.pipeline_tag ? (
                              <span className="px-2 py-1 bg-(--card) border border-(--border) rounded text-xs text-(--muted-foreground)">
                                {model.pipeline_tag}
                              </span>
                            ) : (
                              <span className="text-xs text-(--muted-foreground)">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {quantizations.length > 0 ? (
                                quantizations.map((quantization) => (
                                  <span
                                    key={quantization}
                                    className="px-2 py-1 bg-(--warning)/20 text-(--warning) border border-(--warning)/30 rounded text-xs font-medium"
                                  >
                                    {quantization}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-(--muted-foreground)">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {isLocal ? (
                              <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-(--success)/20 text-(--success) border border-(--success)/30">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Local
                              </span>
                            ) : (
                              <span className="text-xs text-(--muted-foreground)">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-4 text-xs text-(--muted-foreground)">
                              <div className="flex items-center gap-1" title="Downloads">
                                <Download className="h-3.5 w-3.5" />
                                <span>{formatNumber(model.downloads)}</span>
                              </div>
                              <div className="flex items-center gap-1" title="Likes">
                                <Heart className="h-3.5 w-3.5" />
                                <span>{formatNumber(model.likes)}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <a
                              href={`https://huggingface.co/${model.modelId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 hover:bg-(--card-hover) rounded transition-colors inline-block text-(--link) hover:text-(--link-hover)"
                              title="View on Hugging Face"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Load More */}
              {hasMore && (
                <div className="mt-6 text-center">
                  <button
                    onClick={onLoadMore}
                    disabled={loading}
                    className="px-4 py-2 bg-(--card) border border-(--border) rounded-lg text-sm text-(--foreground) hover:bg-(--card-hover) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Loading...
                      </span>
                    ) : (
                      "Load More"
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
