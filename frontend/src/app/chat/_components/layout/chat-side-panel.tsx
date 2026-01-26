// CRITICAL
"use client";

import { X, Loader2, Globe } from "lucide-react";
import { ArtifactPanel } from "../artifacts/artifact-panel";
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
      <div className="flex items-center justify-between px-4 py-3">
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
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-4">
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

interface ActivityPanelProps {
  activityGroups: ActivityGroup[];
}

function ActivityPanel({ activityGroups }: ActivityPanelProps) {
  const activityEmpty = activityGroups.length === 0;

  if (activityEmpty) {
    return <div className="py-8 text-center text-sm text-[#6a6560]">No activity yet</div>;
  }

  return (
    <div className="relative">
      {/* Vertical timeline line */}
      <div className="absolute left-[5px] top-2 bottom-2 w-px bg-[#2a2725]" />

      <div className="space-y-4">
        {activityGroups.map((group) => (
          <div key={group.id}>
            {/* Thinking section */}
            {(group.thinkingActive || group.thinkingContent) && (
              <div className="relative pl-5 mb-3">
                {/* Node */}
                <div className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full border-2 border-[#2a2725] bg-[#1a1918] flex items-center justify-center">
                  {group.thinkingActive && (
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  )}
                </div>

                <div className="flex items-center gap-2 mb-2">
                  {group.thinkingActive && (
                    <Loader2 className="h-3 w-3 text-[#9a9590] animate-spin" />
                  )}
                  <span className="text-xs text-[#9a9590]">Thinking</span>
                </div>

                {group.thinkingContent && <ThinkingContent content={group.thinkingContent} />}
              </div>
            )}

            {/* Tool calls */}
            {group.toolItems.map((item) => (
              <ToolItem key={item.id} item={item} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ThinkingContent({ content }: { content: string }) {
  // Strip markdown formatting
  const stripMarkdown = (text: string) => {
    return text
      .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold**
      .replace(/\*([^*]+)\*/g, "$1") // *italic*
      .replace(/__([^_]+)__/g, "$1") // __bold__
      .replace(/_([^_]+)_/g, "$1") // _italic_
      .replace(/`([^`]+)`/g, "$1") // `code`
      .replace(/```[\s\S]*?```/g, "") // code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [links](url)
      .replace(/^#+\s*/gm, "") // # headers
      .replace(/^[-*+]\s+/gm, "") // list items
      .replace(/^\d+\.\s+/gm, "") // numbered lists
      .replace(/^>\s*/gm, "") // blockquotes
      .trim();
  };

  const cleanContent = stripMarkdown(content);

  const lines = cleanContent
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const bulletPoints: { title: string; body?: string }[] = [];

  for (const line of lines) {
    // Check if line looks like a section header
    const isTitle =
      (line.endsWith(":") && line.length < 60) ||
      (line.length < 50 && /^[A-Z]/.test(line) && !/[.!?]$/.test(line));

    if (isTitle || bulletPoints.length === 0) {
      bulletPoints.push({ title: line.replace(/:$/, "") });
    } else {
      const last = bulletPoints[bulletPoints.length - 1];
      if (last.body) {
        last.body += " " + line;
      } else {
        last.body = line;
      }
    }
  }

  const displayPoints = bulletPoints.slice(0, 8);

  return (
    <div className="space-y-2">
      {displayPoints.map((point, index) => (
        <div key={index} className="flex gap-2">
          <span className="mt-[7px] h-1 w-1 rounded-full bg-[#4a4745] shrink-0" />
          <div className="min-w-0 text-xs leading-relaxed">
            <span className="text-[#c8c4bd]">{point.title}</span>
            {point.body && (
              <span className="text-[#7a7570]">
                {" "}
                {point.body.length > 150 ? point.body.slice(0, 150) + "..." : point.body}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface ContextPanelProps {
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

function ContextPanel({
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
    return name
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
      const candidate = record.query ?? record.url ?? record.text ?? record.input;
      return candidate != null ? String(candidate) : undefined;
    }
    return undefined;
  };

  const getSources = (output?: unknown): string[] => {
    if (!output) return [];
    const text = typeof output === "string" ? output : JSON.stringify(output);
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
    <div className="relative pl-5 mb-3">
      {/* Node */}
      <div className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full border-2 border-[#2a2725] bg-[#1a1918] flex items-center justify-center">
        {isExecuting ? (
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        ) : hasResult ? (
          <div className={`w-1.5 h-1.5 rounded-full ${isError ? "bg-red-400" : "bg-green-500"}`} />
        ) : null}
      </div>

      <div className="flex items-center gap-2 mb-1">
        {isExecuting ? (
          <Globe className="h-3 w-3 text-amber-400" />
        ) : (
          <Globe className="h-3 w-3 text-[#6a6560]" />
        )}
        <span className="text-xs text-[#9a9590]">{toolName}</span>
      </div>

      {mainArg && (
        <p className="text-xs text-[#6a6560] mb-1.5 line-clamp-1">{mainArg.slice(0, 60)}</p>
      )}

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sources.map((domain, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#252321] text-[10px] text-[#7a7570]"
            >
              <span className="w-2 h-2 rounded-full bg-[#3a3735]" />
              {domain}
            </span>
          ))}
          {sources.length === 4 && (
            <span className="px-1.5 py-0.5 rounded bg-[#252321] text-[10px] text-[#5a5550]">
              +more
            </span>
          )}
        </div>
      )}
    </div>
  );
}
