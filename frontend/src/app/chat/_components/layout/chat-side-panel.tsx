// CRITICAL
"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { X, Loader2, Globe, ChevronDown, ChevronRight } from "lucide-react";
import { ArtifactPanel } from "../artifacts/artifact-panel";
import { safeJsonStringify } from "@/lib/safe-json";
import type { ActivePanel, Artifact } from "@/lib/types";
import type { ActivityGroup, ActivityItem } from "../../types";
import type { CompactionEvent, ContextStats } from "@/lib/services/context-management";

interface ChatSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  activePanel: ActivePanel;
  onSetActivePanel: (panel: ActivePanel) => void;
  activityGroups: ActivityGroup[];
  thinkingActive: boolean;
  executingTools: Set<string>;
  artifacts: Artifact[];
  elapsedTime?: number;
  contextStats?: Omit<
    ContextStats,
    "compactionHistory" | "lastCompaction" | "totalCompactions" | "totalTokensCompacted"
  > | null;
  contextBreakdown?: {
    messages: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    userTokens: number;
    assistantTokens: number;
    thinkingTokens: number;
  } | null;
  compactionHistory?: CompactionEvent[];
  compacting?: boolean;
  compactionError?: string | null;
  formatTokenCount?: (tokens: number) => string;
}

export function ChatSidePanel({
  isOpen,
  onClose,
  activePanel,
  onSetActivePanel,
  activityGroups,
  thinkingActive,
  executingTools,
  artifacts,
  elapsedTime,
  contextStats,
  contextBreakdown,
  compactionHistory = [],
  compacting = false,
  compactionError = null,
  formatTokenCount,
}: ChatSidePanelProps) {
  if (!isOpen) return null;

  const showPing = executingTools.size > 0 || thinkingActive;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  };

  return (
    <div className="hidden md:flex w-80 flex-shrink-0 border-l border-[#2a2725] bg-[#1a1918] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSetActivePanel("activity")}
            className={`text-sm transition-colors ${
              activePanel === "activity" ? "text-[#e8e4dd]" : "text-[#6a6560] hover:text-[#9a9590]"
            }`}
          >
            Activity
          </button>
          <button
            onClick={() => onSetActivePanel("context")}
            className={`text-sm transition-colors ${
              activePanel === "context" ? "text-[#e8e4dd]" : "text-[#6a6560] hover:text-[#9a9590]"
            }`}
          >
            Context
          </button>
          {showPing && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute h-full w-full rounded-full bg-green-500 opacity-75" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-green-500" />
            </span>
          )}
          {elapsedTime != null && elapsedTime > 0 && (
            <span className="text-xs text-[#6a6560]">{formatTime(elapsedTime)}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSetActivePanel("artifacts")}
            className={`text-sm transition-colors ${
              activePanel === "artifacts" ? "text-[#e8e4dd]" : "text-[#6a6560] hover:text-[#9a9590]"
            }`}
          >
            Artifacts
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#2a2725]" title="Close">
            <X className="h-4 w-4 text-[#6a6560]" />
          </button>
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 pb-4">
        {activePanel === "activity" && <ActivityPanel activityGroups={activityGroups} />}
        {activePanel === "context" && (
          <ContextPanel
            stats={contextStats}
            breakdown={contextBreakdown}
            compactionHistory={compactionHistory}
            compacting={compacting}
            compactionError={compactionError}
            formatTokenCount={formatTokenCount}
          />
        )}
        {activePanel === "artifacts" && <ArtifactPanel artifacts={artifacts} isOpen={true} />}
      </div>

      <style jsx>{`
        .scrollbar-thin::-webkit-scrollbar {
          width: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.12);
        }
      `}</style>
    </div>
  );
}

export interface ActivityPanelProps {
  activityGroups: ActivityGroup[];
  agentPlan?: { steps: Array<{ status: string; title: string }> } | null;
  isLoading?: boolean;
}

export function ActivityPanel({ activityGroups, agentPlan, isLoading }: ActivityPanelProps) {
  if (activityGroups.length === 0) {
    return <div className="py-8 text-center text-sm text-[#6a6560]">No activity yet</div>;
  }

  // Calculate agent progress
  const totalSteps = agentPlan?.steps.length ?? 0;
  const doneSteps = agentPlan?.steps.filter((s) => s.status === "done").length ?? 0;
  const currentStep = agentPlan?.steps.find((s) => s.status === "running");
  const hasIncomplete = doneSteps < totalSteps;

  return (
    <div className="h-full flex flex-col">
      {/* Progress Header - shows when agent is active */}
      {totalSteps > 0 && (
        <div className="px-3 py-3 border-b border-[#2a2725] mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-[#aaa]">Plan Progress</span>
            <span className="text-[10px] text-[#666] font-mono">
              {doneSteps}/{totalSteps}
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-[#2a2725] overflow-hidden">
            <div
              className="h-full rounded-full bg-violet-500/60 transition-all duration-300"
              style={{ width: `${totalSteps > 0 ? (doneSteps / totalSteps) * 100 : 0}%` }}
            />
          </div>
          {currentStep && isLoading && (
            <div className="flex items-center gap-2 mt-2">
              <Loader2 className="h-3 w-3 text-violet-400 animate-spin" />
              <span className="text-[11px] text-violet-300 truncate">{currentStep.title}</span>
            </div>
          )}
          {!currentStep && hasIncomplete && isLoading && (
            <div className="flex items-center gap-2 mt-2">
              <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
              <span className="text-[11px] text-blue-300">Working...</span>
            </div>
          )}
        </div>
      )}

      <div className="relative flex-1 overflow-y-auto px-2">
        {/* Vertical timeline line */}
        <div className="absolute left-[19px] top-2 bottom-2 w-px bg-[#2a2725]" />

        <div className="space-y-1 pb-4">
          {activityGroups.map((group, groupIdx) => (
            <div key={group.id}>
              {/* Turn header */}
              <div className="flex items-center gap-2 py-2 pl-1">
                <div className="w-5 h-5 rounded-full bg-[#1c1b1a] border border-[#2a2725] flex items-center justify-center z-10">
                  <span className="text-[9px] text-[#666] font-medium">{groupIdx + 1}</span>
                </div>
                <span className="text-[10px] text-[#555] uppercase tracking-wider">
                  {group.isLatest ? "Current" : "Turn"}
                </span>
                {group.isLatest && group.thinkingActive && (
                  <span className="relative flex h-1.5 w-1.5 ml-auto mr-2">
                    <span className="animate-ping absolute h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-blue-400" />
                  </span>
                )}
              </div>

              {/* Interleaved thinking and tool calls */}
              <div className="space-y-1">
                {/* Thinking comes first in a turn */}
                {(group.thinkingActive || group.thinkingContent) && (
                  <ThinkingItem
                    content={group.thinkingContent}
                    isActive={group.thinkingActive}
                  />
                )}

                {/* Tool calls follow */}
                {group.toolItems.map((item) => (
                  <ToolItem key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThinkingItem({
  content,
  isActive,
}: {
  content?: string;
  isActive?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isActive, expanded]);

  return (
    <div className="relative pl-7 pr-2 py-2">
      {/* Timeline node - brain/think icon */}
      <div className="absolute left-[7px] top-2.5 w-[9px] h-[9px] rounded-full border border-[#3a3735] bg-[#1c1b1a] flex items-center justify-center">
        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left group"
      >
        {isActive ? (
          <Loader2 className="h-3 w-3 text-blue-400 animate-spin flex-shrink-0" />
        ) : (
          <BrainIcon className="h-3 w-3 text-[#666] flex-shrink-0" />
        )}
        <span className={`text-[11px] ${isActive ? "text-blue-300" : "text-[#888]"} group-hover:text-[#bbb] transition-colors`}>
          {isActive ? "Thinking..." : "Thought"}
        </span>
        {content && (
          <span className="ml-auto text-[9px] text-[#555]">
            {expanded ? "−" : "+"}
          </span>
        )}
      </button>

      {expanded && content && (
        <div
          ref={contentRef}
          className="mt-2 max-h-[200px] overflow-y-auto text-[11px] leading-relaxed text-[#777] whitespace-pre-wrap break-words scrollbar-thin"
        >
          {content}
        </div>
      )}
    </div>
  );
}

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

export interface ContextPanelProps {
  stats?: Omit<
    ContextStats,
    "compactionHistory" | "lastCompaction" | "totalCompactions" | "totalTokensCompacted"
  > | null;
  breakdown?: {
    messages: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    userTokens: number;
    assistantTokens: number;
    thinkingTokens: number;
  } | null;
  compactionHistory: CompactionEvent[];
  compacting: boolean;
  compactionError: string | null;
  formatTokenCount?: (tokens: number) => string;
}

export function ContextPanel({
  stats,
  breakdown,
  compactionHistory,
  compacting,
  compactionError,
  formatTokenCount,
}: ContextPanelProps) {
  if (!stats || !breakdown) {
    return <div className="py-8 text-center text-sm text-[#6a6560]">Context stats unavailable</div>;
  }

  const fmt = formatTokenCount ?? ((value: number) => value.toString());
  const utilizationPct = Math.round(stats.utilization * 100);
  const recentCompactions = compactionHistory.slice(-3).reverse();

  return (
    <div className="space-y-4 text-xs text-[#c8c4bd]">
      <div className="rounded-lg border border-[#2a2725] bg-[#1c1b1a] p-3">
        <div className="flex items-center justify-between">
          <span className="text-[#e8e4dd]">Context Usage</span>
          <span className="text-[#9a9590]">{utilizationPct}%</span>
        </div>
        <div className="mt-2 text-[11px] text-[#9a9590]">
          {fmt(stats.currentTokens)} / {fmt(stats.maxContext)} tokens • headroom {fmt(stats.headroom)}
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-[#2a2725]">
          <div
            className="h-full rounded-full bg-[#88b57f]"
            style={{ width: `${Math.min(100, utilizationPct)}%` }}
          />
        </div>
      </div>

      <div className="rounded-lg border border-[#2a2725] bg-[#1c1b1a] p-3 space-y-2">
        <div className="text-[#e8e4dd]">Breakdown</div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-[#9a9590]">
          <div>Messages: {breakdown.messages}</div>
          <div>Tool calls: {breakdown.toolCalls}</div>
          <div>User tokens: {fmt(breakdown.userTokens)}</div>
          <div>Assistant tokens: {fmt(breakdown.assistantTokens)}</div>
          <div>Thinking tokens: {fmt(breakdown.thinkingTokens)}</div>
          <div>System+tools: {fmt(stats.systemPromptTokens + stats.toolsTokens)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-[#2a2725] bg-[#1c1b1a] p-3 space-y-2">
        <div className="flex items-center justify-between text-[#e8e4dd]">
          <span>Compaction</span>
          {compacting && <span className="text-[#9a9590]">Running…</span>}
        </div>
        {compactionError && <div className="text-[11px] text-red-400">{compactionError}</div>}
        {recentCompactions.length === 0 ? (
          <div className="text-[11px] text-[#9a9590]">No compactions yet</div>
        ) : (
          <div className="space-y-2 text-[11px] text-[#9a9590]">
            {recentCompactions.map((event) => (
              <div key={event.id} className="flex items-center justify-between">
                <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                <span>
                  {fmt(event.beforeTokens)} → {fmt(event.afterTokens)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ToolItemProps {
  item: ActivityItem;
}

function ToolItem({ item }: ToolItemProps) {
  const isExecuting = item.state === "running";
  const hasResult = item.output != null;
  const isError = item.state === "error";

  const getToolDisplayName = (name?: string) => {
    if (!name) return "Tool";
    // Strip server__ prefix if present
    const cleanName = name.includes("__") ? name.split("__").slice(1).join("__") : name;
    return cleanName
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const getMainArg = (input?: unknown): string | undefined => {
    if (input == null) return undefined;
    if (typeof input === "string") return input;
    if (typeof input === "object") {
      const record = input as Record<string, unknown>;
      const candidate = record.query ?? record.url ?? record.text ?? record.input ?? record.path ?? record.command;
      return candidate != null ? String(candidate) : undefined;
    }
    return undefined;
  };

  const getSources = (output?: unknown): string[] => {
    if (!output) return [];
    const text = typeof output === "string" ? output : safeJsonStringify(output, "");
    const urlMatches = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
    const domains = [
      ...new Set(
        urlMatches
          .map((url) => {
            try {
              return new URL(url).hostname.replace("www.", "");
            } catch {
              return null;
            }
          })
          .filter(Boolean),
      ),
    ].slice(0, 4);
    return domains as string[];
  };

  const mainArg = getMainArg(item.input);
  const sources = getSources(item.output);
  const toolName = getToolDisplayName(item.toolName);

  return (
    <div className="relative pl-7 pr-2 py-2 bg-white/[0.01] rounded">
      {/* Timeline node - status indicator */}
      <div
        className="absolute left-[7px] top-3 w-[9px] h-[9px] rounded-full border flex items-center justify-center"
        style={{
          borderColor: isExecuting ? "#f59e0b40" : isError ? "#ef444440" : hasResult ? "#22c55e40" : "#3a3735",
          backgroundColor: isExecuting ? "#1c1917" : isError ? "#1c1917" : hasResult ? "#1c1917" : "#1c1b1a"
        }}
      >
        {isExecuting && <div className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />}
        {isError && <div className="w-1 h-1 rounded-full bg-red-400" />}
        {hasResult && !isError && <div className="w-1 h-1 rounded-full bg-emerald-400" />}
      </div>

      {/* Tool name row */}
      <div className="flex items-center gap-2">
        {isExecuting ? (
          <Loader2 className="h-3 w-3 text-amber-400 animate-spin flex-shrink-0" />
        ) : isError ? (
          <WrenchIcon className="h-3 w-3 text-red-400 flex-shrink-0" />
        ) : hasResult ? (
          <WrenchIcon className="h-3 w-3 text-emerald-400 flex-shrink-0" />
        ) : (
          <WrenchIcon className="h-3 w-3 text-[#555] flex-shrink-0" />
        )}
        <span className={`text-[11px] truncate ${isExecuting ? "text-amber-300" : isError ? "text-red-300" : hasResult ? "text-emerald-300" : "text-[#888]"}`}>
          {toolName}
        </span>
      </div>

      {/* Arguments preview */}
      {mainArg && (
        <p className="mt-1 text-[10px] text-[#555] line-clamp-1 pl-5">{mainArg.slice(0, 80)}</p>
      )}

      {/* Sources from output */}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5 pl-5">
          {sources.map((domain, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#252321] text-[9px] text-[#777]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#444]" />
              {domain}
            </span>
          ))}
          {sources.length === 4 && (
            <span className="px-1.5 py-0.5 rounded bg-[#252321] text-[9px] text-[#555]">
              +more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}
