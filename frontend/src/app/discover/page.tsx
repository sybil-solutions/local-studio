'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  Download,
  Heart,
  ExternalLink,
  Filter,
  TrendingUp,
  ChevronDown,
  X,
  Copy,
  Check,
} from 'lucide-react';

interface HuggingFaceModel {
  _id: string;
  modelId: string;
  downloads: number;
  likes: number;
  tags: string[];
  pipeline_tag?: string;
  library_name?: string;
  lastModified?: string;
  author?: string;
  private: boolean;
}

const TASKS = [
  { value: '', label: 'All Tasks' },
  { value: 'text-generation', label: 'Text Generation' },
  { value: 'text2text-generation', label: 'Text-to-Text' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'fill-mask', label: 'Fill Mask' },
  { value: 'question-answering', label: 'Question Answering' },
  { value: 'summarization', label: 'Summarization' },
  { value: 'translation', label: 'Translation' },
  { value: 'feature-extraction', label: 'Feature Extraction' },
  { value: 'image-to-text', label: 'Image to Text' },
];

const SORT_OPTIONS = [
  { value: 'trending', label: 'Trending', icon: TrendingUp },
  { value: 'downloads', label: 'Most Downloads', icon: Download },
  { value: 'likes', label: 'Most Likes', icon: Heart },
  { value: 'modified', label: 'Recently Updated', icon: RefreshCw },
];

const LIBRARY_FILTERS = [
  { value: '', label: 'All Libraries' },
  { value: 'transformers', label: 'Transformers' },
  { value: 'pytorch', label: 'PyTorch' },
  { value: 'safetensors', label: 'Safetensors' },
  { value: 'gguf', label: 'GGUF' },
  { value: 'exl2', label: 'EXL2' },
  { value: 'awq', label: 'AWQ' },
  { value: 'gptq', label: 'GPTQ' },
];

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return date.toLocaleDateString();
}

export default function DiscoverPage() {
  const [models, setModels] = useState<HuggingFaceModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [task, setTask] = useState('text-generation');
  const [sort, setSort] = useState('trending');
  const [library, setLibrary] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (task) params.set('filter', task);
      if (library) params.set('filter', library);
      params.set('sort', sort);
      params.set('limit', '50');
      params.set('full', 'false');

      const response = await fetch(`/api/proxy/v1/huggingface/models?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch models');
      const data = await response.json();
      setModels(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, task, sort, library]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchModels();
    }, 300);
    return () => clearTimeout(debounce);
  }, [fetchModels]);

  const copyModelId = (modelId: string) => {
    navigator.clipboard.writeText(modelId);
    setCopiedId(modelId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getTaskBadgeColor = (tag?: string) => {
    return 'bg-[var(--highlight-bg)] text-[var(--accent-purple)]';
  };

  const getLibraryBadgeColor = (lib?: string) => {
    return 'bg-[var(--highlight-bg)] text-[var(--accent-purple)]';
  };

  return (
    <div className="min-h-full bg-[#1b1b1b] text-[#f0ebe3]">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-lg sm:text-xl font-medium">Discover Models</h1>
            <p className="text-xs sm:text-sm text-[#9a9088] mt-1">
              Browse models from Hugging Face Hub
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                showFilters ? 'bg-[var(--accent-purple)] text-[#f0ebe3]' : 'bg-[#363432] text-[#9a9088] hover:text-[#f0ebe3]'
              }`}
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">Filters</span>
            </button>
            <button
              onClick={fetchModels}
              disabled={loading}
              className="p-2 bg-[#363432] hover:bg-[#4a4846] rounded-lg transition-colors"
            >
              <RefreshCw className={`h-4 w-4 text-[#9a9088] ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="space-y-4 mb-6">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9a9088]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full pl-10 pr-4 py-2.5 bg-[#1e1e1e] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-[var(--accent-purple)]"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-[#363432] rounded"
              >
                <X className="h-3.5 w-3.5 text-[#9a9088]" />
              </button>
            )}
          </div>

          {/* Filters row */}
          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-[#1e1e1e] rounded-lg border border-[#363432]">
              {/* Task filter */}
              <div>
                <label className="block text-xs text-[#9a9088] mb-1.5">Task</label>
                <div className="relative">
                  <select
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[var(--accent-purple)] appearance-none cursor-pointer"
                  >
                    {TASKS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9a9088] pointer-events-none" />
                </div>
              </div>

              {/* Library filter */}
              <div>
                <label className="block text-xs text-[#9a9088] mb-1.5">Library</label>
                <div className="relative">
                  <select
                    value={library}
                    onChange={(e) => setLibrary(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[var(--accent-purple)] appearance-none cursor-pointer"
                  >
                    {LIBRARY_FILTERS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9a9088] pointer-events-none" />
                </div>
              </div>

              {/* Sort */}
              <div>
                <label className="block text-xs text-[#9a9088] mb-1.5">Sort By</label>
                <div className="relative">
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] focus:outline-none focus:border-[var(--accent-purple)] appearance-none cursor-pointer"
                  >
                    {SORT_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9a9088] pointer-events-none" />
                </div>
              </div>
            </div>
          )}

          {/* Quick sort chips */}
          <div className="flex flex-wrap gap-2">
            {SORT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  onClick={() => setSort(opt.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors ${
                    sort === opt.value
                      ? 'bg-[var(--accent-purple)] text-[#f0ebe3]'
                      : 'bg-[#363432] text-[#9a9088] hover:text-[#f0ebe3]'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Results */}
        {error ? (
          <div className="text-center py-12">
            <p className="text-[#c97a6b] mb-4">{error}</p>
            <button
              onClick={fetchModels}
              className="px-4 py-2 bg-[#363432] rounded-lg text-[#f0ebe3] hover:bg-[#4a4846]"
            >
              Retry
            </button>
          </div>
        ) : loading && models.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-5 w-5 text-[#9a9088] animate-spin" />
          </div>
        ) : models.length === 0 ? (
          <div className="text-center py-12 text-[#9a9088]">
            <p>No models found</p>
            <p className="text-sm mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            <div className="text-xs text-[#9a9088] mb-3">
              {models.length} models
            </div>
            <div className="grid gap-3 w-full overflow-hidden">
              {models.map((model) => (
                <div
                  key={model._id}
                  className="bg-[#1e1e1e] rounded-lg p-3 sm:p-4 border border-[#363432] hover:border-[#4a4846] transition-colors w-full overflow-hidden"
                >
                  {/* Mobile: stacked layout */}
                  <div className="sm:hidden w-full">
                    <div className="flex items-center justify-between gap-2 mb-2 w-full">
                      <h3 className="text-sm font-medium text-[#f0ebe3] truncate flex-1 min-w-0">
                        {model.modelId}
                      </h3>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => copyModelId(model.modelId)}
                          className="p-1.5 hover:bg-[#363432] rounded transition-colors"
                          title="Copy model ID"
                        >
                          {copiedId === model.modelId ? (
                            <Check className="h-4 w-4 text-[#7d9a6a]" />
                          ) : (
                            <Copy className="h-4 w-4 text-[#9a9088]" />
                          )}
                        </button>
                        <a
                          href={`https://huggingface.co/${model.modelId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 hover:bg-[#363432] rounded transition-colors"
                          title="View on Hugging Face"
                        >
                          <ExternalLink className="h-4 w-4 text-[#9a9088]" />
                        </a>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 w-full">
                      <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                        {model.pipeline_tag && (
                          <span className={`px-2 py-0.5 rounded text-[10px] ${getTaskBadgeColor(model.pipeline_tag)}`}>
                            {model.pipeline_tag}
                          </span>
                        )}
                        {model.library_name && (
                          <span className={`px-2 py-0.5 rounded text-[10px] ${getLibraryBadgeColor(model.library_name)}`}>
                            {model.library_name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[#9a9088] shrink-0">
                        <span className="flex items-center gap-1">
                          <Download className="h-3 w-3 shrink-0" />
                          {formatNumber(model.downloads)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Heart className="h-3 w-3 shrink-0" />
                          {formatNumber(model.likes)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Desktop: row layout */}
                  <div className="hidden sm:flex sm:items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-[#f0ebe3] truncate">
                          {model.modelId}
                        </h3>
                        <button
                          onClick={() => copyModelId(model.modelId)}
                          className="p-1 hover:bg-[#363432] rounded transition-colors shrink-0"
                          title="Copy model ID"
                        >
                          {copiedId === model.modelId ? (
                            <Check className="h-3 w-3 text-[#7d9a6a]" />
                          ) : (
                            <Copy className="h-3 w-3 text-[#9a9088]" />
                          )}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {model.pipeline_tag && (
                          <span className={`px-2 py-0.5 rounded text-[10px] ${getTaskBadgeColor(model.pipeline_tag)}`}>
                            {model.pipeline_tag}
                          </span>
                        )}
                        {model.library_name && (
                          <span className={`px-2 py-0.5 rounded text-[10px] ${getLibraryBadgeColor(model.library_name)}`}>
                            {model.library_name}
                          </span>
                        )}
                        {model.tags?.includes('gguf') && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--highlight-bg)] text-[var(--accent-purple)]">
                            GGUF
                          </span>
                        )}
                        {model.tags?.includes('exl2') && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--highlight-bg)] text-[var(--accent-purple)]">
                            EXL2
                          </span>
                        )}
                        {model.tags?.includes('awq') && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--highlight-bg)] text-[var(--accent-purple)]">
                            AWQ
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[#9a9088] shrink-0">
                      <div className="flex items-center gap-1" title="Downloads">
                        <Download className="h-3.5 w-3.5" />
                        <span>{formatNumber(model.downloads)}</span>
                      </div>
                      <div className="flex items-center gap-1" title="Likes">
                        <Heart className="h-3.5 w-3.5" />
                        <span>{formatNumber(model.likes)}</span>
                      </div>
                      {model.lastModified && (
                        <span className="text-[#9a9088]/70">
                          {formatDate(model.lastModified)}
                        </span>
                      )}
                      <a
                        href={`https://huggingface.co/${model.modelId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 hover:bg-[#363432] rounded transition-colors"
                        title="View on Hugging Face"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
