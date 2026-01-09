'use client';

import { useState, useEffect } from 'react';
import { Search, Globe, FileText, CheckCircle, XCircle, Loader2, ExternalLink, BookOpen, Brain, Sparkles } from 'lucide-react';

export interface ResearchSource {
  title: string;
  url: string;
  snippet?: string;
  status: 'pending' | 'fetching' | 'done' | 'error';
  relevance?: number; // 0-100
}

export interface ResearchProgress {
  stage: 'searching' | 'analyzing' | 'synthesizing' | 'done' | 'error';
  message: string;
  sources: ResearchSource[];
  totalSteps: number;
  currentStep: number;
  searchQueries?: string[];
  error?: string;
}

interface ResearchProgressProps {
  progress: ResearchProgress | null;
  onCancel?: () => void;
  className?: string;
}

/**
 * Visual progress indicator for deep research mode.
 * Shows search queries, sources being fetched, and synthesis status.
 */
export function ResearchProgressIndicator({
  progress,
  onCancel,
  className = '',
}: ResearchProgressProps) {
  const [expanded, setExpanded] = useState(true);

  if (!progress) return null;

  const stageIcons = {
    searching: <Search className="h-4 w-4 animate-pulse" />,
    analyzing: <Brain className="h-4 w-4 animate-pulse" />,
    synthesizing: <Sparkles className="h-4 w-4 animate-pulse" />,
    done: <CheckCircle className="h-4 w-4 text-green-400" />,
    error: <XCircle className="h-4 w-4 text-red-400" />,
  };

  const stageLabels = {
    searching: 'Searching the web...',
    analyzing: 'Analyzing sources...',
    synthesizing: 'Synthesizing findings...',
    done: 'Research complete',
    error: 'Research failed',
  };

  const progressPct = (progress.currentStep / progress.totalSteps) * 100;
  const isDone = progress.stage === 'done' || progress.stage === 'error';

  return (
    <div className={`bg-[var(--card)] border border-[var(--border)] rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--accent)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded-lg ${
            progress.stage === 'error' ? 'bg-red-500/10' :
            progress.stage === 'done' ? 'bg-green-500/10' :
            'bg-blue-500/10'
          }`}>
            {stageIcons[progress.stage]}
          </div>
          <div className="text-left">
            <div className="text-sm font-medium">{stageLabels[progress.stage]}</div>
            <div className="text-xs text-[#9a9590]">{progress.message}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-[#9a9590]">
            {progress.sources.filter(s => s.status === 'done').length}/{progress.sources.length} sources
          </span>
          {!isDone && onCancel && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-500/30 hover:bg-red-500/10"
            >
              Cancel
            </button>
          )}
        </div>
      </button>

      {/* Progress Bar */}
      <div className="h-0.5 bg-[var(--border)]">
        <div
          className={`h-full transition-all duration-500 ${
            progress.stage === 'error' ? 'bg-red-500' :
            progress.stage === 'done' ? 'bg-green-500' :
            'bg-blue-500'
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 py-3 border-t border-[var(--border)] space-y-3">
          {/* Search Queries */}
          {progress.searchQueries && progress.searchQueries.length > 0 && (
            <div>
              <div className="text-[10px] uppercase text-[#9a9590] font-medium mb-2">Search Queries</div>
              <div className="flex flex-wrap gap-1.5">
                {progress.searchQueries.map((query, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 text-xs bg-blue-500/10 text-blue-400 rounded-full border border-blue-500/20"
                  >
                    {query}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Sources */}
          <div>
            <div className="text-[10px] uppercase text-[#9a9590] font-medium mb-2">Sources</div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {progress.sources.map((source, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 p-2 bg-[var(--background)] rounded-lg"
                >
                  {/* Status Icon */}
                  <div className="mt-0.5 flex-shrink-0">
                    {source.status === 'pending' && <div className="w-3 h-3 rounded-full bg-[var(--muted)]" />}
                    {source.status === 'fetching' && <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />}
                    {source.status === 'done' && <CheckCircle className="h-3 w-3 text-green-400" />}
                    {source.status === 'error' && <XCircle className="h-3 w-3 text-red-400" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate">{source.title || 'Loading...'}</span>
                      {source.relevance !== undefined && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          source.relevance > 70 ? 'bg-green-500/10 text-green-400' :
                          source.relevance > 40 ? 'bg-yellow-500/10 text-yellow-400' :
                          'bg-[var(--muted)]/10 text-[#9a9590]'
                        }`}>
                          {source.relevance}%
                        </span>
                      )}
                    </div>
                    {source.url && (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[#9a9590] hover:text-[var(--accent)] truncate flex items-center gap-1"
                      >
                        <Globe className="h-2.5 w-2.5 flex-shrink-0" />
                        <span className="truncate">{new URL(source.url).hostname}</span>
                        <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                      </a>
                    )}
                    {source.snippet && (
                      <p className="text-[10px] text-[#9a9590] mt-1 line-clamp-2">{source.snippet}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Error */}
          {progress.error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
              {progress.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Citations panel for displaying sources used in a response.
 */
interface CitationsPanelProps {
  sources: ResearchSource[];
  className?: string;
}

export function CitationsPanel({ sources, className = '' }: CitationsPanelProps) {
  if (!sources || sources.length === 0) return null;

  const completedSources = sources.filter(s => s.status === 'done');

  return (
    <div className={`bg-[var(--card)] border border-[var(--border)] rounded-lg p-3 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <BookOpen className="h-4 w-4 text-[#9a9590]" />
        <span className="text-xs font-medium uppercase text-[#9a9590]">
          Sources ({completedSources.length})
        </span>
      </div>

      <div className="space-y-2">
        {completedSources.map((source, i) => (
          <a
            key={i}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 p-2 bg-[var(--background)] rounded-lg hover:bg-[var(--accent)] transition-colors group"
          >
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-[10px] font-mono bg-[var(--muted)]/10 rounded text-[#9a9590]">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate group-hover:text-[var(--accent)]">
                {source.title}
              </div>
              <div className="text-[10px] text-[#9a9590] truncate flex items-center gap-1">
                <Globe className="h-2.5 w-2.5 flex-shrink-0" />
                {new URL(source.url).hostname}
              </div>
            </div>
            <ExternalLink className="h-3 w-3 text-[#9a9590] opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
        ))}
      </div>
    </div>
  );
}
