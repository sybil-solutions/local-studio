'use client';

import { useMemo } from 'react';
import { X, Wrench, Layers, Loader2, Check } from 'lucide-react';
import { ArtifactPanel } from '@/components/chat';
import type { ToolCall, ToolResult, Artifact } from '@/lib/types';
import type { ResearchProgress, ResearchSource } from '@/components/chat/research-progress';

interface ExtendedToolCall extends ToolCall {
  messageId: string;
  model?: string;
}

interface ThinkingActivityItem {
  type: 'thinking';
  id: string;
  content: string;
  isComplete: boolean;
  isStreaming: boolean;
}

interface ToolActivityItem {
  type: 'tool';
  id: string;
  toolCall: ExtendedToolCall;
}

type ActivityItem = ThinkingActivityItem | ToolActivityItem;

interface ChatSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  activePanel: 'tools' | 'artifacts';
  onSetActivePanel: (panel: 'tools' | 'artifacts') => void;
  allToolCalls: ExtendedToolCall[];
  toolResultsMap: Map<string, ToolResult>;
  executingTools: Set<string>;
  sessionArtifacts: Artifact[];
  researchProgress: ResearchProgress | null;
  researchSources: ResearchSource[];
  thinkingContent: string | null;
  thinkingActive: boolean;
  activityItems: ActivityItem[];
}

export function ChatSidePanel({
  isOpen,
  onClose,
  activePanel,
  onSetActivePanel,
  allToolCalls,
  toolResultsMap,
  executingTools,
  sessionArtifacts,
  researchProgress,
  researchSources,
  thinkingContent,
  thinkingActive,
  activityItems,
}: ChatSidePanelProps) {
  if (!isOpen) return null;

  return (
    <div className="w-80 flex-shrink-0 border-l border-[var(--border)] bg-[var(--background)] flex flex-col overflow-hidden">
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSetActivePanel('tools')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
              activePanel === 'tools' ? 'bg-[var(--accent)]' : 'text-[#9a9590] hover:bg-[var(--accent)]/50'
            }`}
          >
            <Wrench className="h-3 w-3" />
            Tools
            {(executingTools.size > 0 || thinkingActive) && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute h-full w-full rounded-full bg-[var(--success)] opacity-75" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              </span>
            )}
            {allToolCalls.length > 0 && (
              <span className="text-[10px] bg-[var(--background)] px-1 rounded">{allToolCalls.length}</span>
            )}
          </button>
          <button
            onClick={() => onSetActivePanel('artifacts')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
              activePanel === 'artifacts' ? 'bg-[var(--accent)]' : 'text-[#9a9590] hover:bg-[var(--accent)]/50'
            }`}
          >
            <Layers className="h-3 w-3" />
            Artifacts
            {sessionArtifacts.length > 0 && (
              <span className="text-[10px] bg-[var(--background)] px-1 rounded">{sessionArtifacts.length}</span>
            )}
          </button>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-[var(--accent)]">
          <X className="h-3.5 w-3.5 text-[#9a9590]" />
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto text-sm">
        {activePanel === 'tools' && (
          <ToolsPanel
            allToolCalls={allToolCalls}
            toolResultsMap={toolResultsMap}
            executingTools={executingTools}
            researchProgress={researchProgress}
            researchSources={researchSources}
            thinkingContent={thinkingContent}
            thinkingActive={thinkingActive}
            activityItems={activityItems}
          />
        )}
        {activePanel === 'artifacts' && (
          <ArtifactPanel artifacts={sessionArtifacts} isOpen={true} />
        )}
      </div>
    </div>
  );
}

// Tools Panel Component
interface ToolsPanelProps {
  allToolCalls: ExtendedToolCall[];
  toolResultsMap: Map<string, ToolResult>;
  executingTools: Set<string>;
  researchProgress: ResearchProgress | null;
  researchSources: ResearchSource[];
  thinkingContent: string | null;
  thinkingActive: boolean;
  activityItems: ActivityItem[];
}

function ToolsPanel({
  allToolCalls,
  toolResultsMap,
  executingTools,
  researchProgress,
  researchSources,
  thinkingContent,
  thinkingActive,
  activityItems,
}: ToolsPanelProps) {
  const toolCount = allToolCalls.length;

  const activityRows = useMemo(() => activityItems.map((item) => {
    if (item.type === 'thinking') {
      const label = item.isComplete ? 'Thinking' : 'Thinking...';
      return (
        <div key={item.id} className="px-3 py-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 text-xs font-medium text-[#b0a8a0]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" />
            <span className="uppercase tracking-wider">{label}</span>
            {item.isStreaming && (
              <span className="flex items-center gap-1 text-[10px] text-[#9a9590]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute h-full w-full rounded-full bg-[var(--warning)] opacity-75" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--warning)]" />
                </span>
                working
              </span>
            )}
          </div>
          <div className="mt-2 pl-4 border-l border-[var(--border)] text-[11px] text-[#9a9590] whitespace-pre-wrap break-words">
            {item.content}
          </div>
        </div>
      );
    }

    const tc = item.toolCall;
    const result = toolResultsMap.get(tc.id);
    const isExecuting = executingTools.has(tc.id);
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || '{}');
    } catch {}
    const mainArg = args.query || args.url || args.text || Object.values(args)[0];
    const parts = tc.function.name.split('__');
    const toolName = parts.length > 1 ? parts.slice(1).join('__') : tc.function.name;

    return (
      <div
        key={item.id}
        className={`px-3 py-2 border-b border-[var(--border)] ${isExecuting ? 'bg-[var(--warning)]/5' : ''}`}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-[#b0a8a0]">
          {isExecuting ? (
            <Loader2 className="h-3 w-3 text-[var(--warning)] animate-spin" />
          ) : result ? (
            result.isError ? (
              <X className="h-3 w-3 text-[var(--error)]" />
            ) : (
              <Check className="h-3 w-3 text-[var(--success)]" />
            )
          ) : (
            <Wrench className="h-3 w-3 text-[#9a9590]" />
          )}
          <span className="truncate">{toolName}</span>
        </div>
        <div className="mt-2 pl-4 border-l border-[var(--border)] text-[11px] text-[#9a9590]">
          {mainArg != null && (
            <p className="line-clamp-2">{String(mainArg as string | number | boolean).slice(0, 120)}</p>
          )}
          {result && !isExecuting && (
            <p
              className={`mt-1.5 font-mono line-clamp-3 ${
                result.isError ? 'text-[var(--error)]' : 'text-[#9a9590]'
              }`}
            >
              {result.content.slice(0, 200)}
            </p>
          )}
        </div>
      </div>
    );
  }), [activityItems, executingTools, toolResultsMap]);

  return (
    <>
      {researchProgress && (
        <div className="px-3 py-2 border-b border-[var(--border)] bg-blue-500/5">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />
            <span className="text-xs">{researchProgress.message || 'Researching...'}</span>
          </div>
        </div>
      )}

      <div className="border-b border-[var(--border)]">
        <div className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium text-[#b0a8a0] bg-[var(--accent)]/40">
          <span className="uppercase tracking-wider">Activity</span>
          <span className="text-[10px] text-[#9a9590]">{toolCount}</span>
        </div>
        <div>
          {activityRows}
          {activityRows.length === 0 && !researchProgress && !researchSources.length && !thinkingActive && !thinkingContent && (
            <div className="px-3 py-6 text-center text-xs text-[#9a9590]">No tool activity yet</div>
          )}
        </div>
      </div>

      {researchSources.length > 0 && (
        <div className="border-b border-[var(--border)]">
          <div className="w-full px-3 py-2 text-xs font-medium text-[#b0a8a0] bg-[var(--accent)]/40">
            <span className="uppercase tracking-wider">Sources</span>
          </div>
          <div>
            {researchSources.map((source, i) => (
              <a
                key={i}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-3 py-2 border-b border-[var(--border)] hover:bg-[var(--accent)]"
              >
                <div className="text-xs line-clamp-1">{source.title}</div>
                <div className="text-[10px] text-[#9a9590] truncate">{source.url}</div>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
