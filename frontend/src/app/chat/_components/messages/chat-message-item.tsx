// CRITICAL
"use client";

import { memo } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { LanguageModelUsage } from "ai";
import { useAppStore } from "@/store";
import * as Icons from "../icons";
import { MessageRenderer, thinkingParser } from "./message-renderer";
import { MiniArtifactCard } from "../artifacts/mini-artifact-card";
import type { Artifact } from "@/lib/types";

interface ChatMessageItemProps {
  message: UIMessage;
  isStreaming: boolean;
  artifactsEnabled?: boolean;
  artifacts?: Artifact[];
  selectedModel?: string;
  contextUsageLabel?: string | null;
  copied: boolean;
  onCopy: (text: string, messageId: string) => void;
  onFork?: (messageId: string) => void;
  onReprompt?: (messageId: string) => void;
  onExport: (payload: {
    messageId: string;
    role: "user" | "assistant";
    content: string;
    model?: string;
    totalTokens?: number;
  }) => void;
}

type MessageMetadata = {
  model?: string;
  usage?: LanguageModelUsage;
};

// Inline thinking component for mobile - minimal style
function InlineThinking({
  messageId,
  content,
  isActive,
}: {
  messageId: string;
  content: string;
  isActive: boolean;
}) {
  const expanded = useAppStore((state) => state.messageInlineThinkingExpanded[messageId] ?? false);
  const setExpanded = useAppStore((state) => state.setMessageInlineThinkingExpanded);

  if (!content && !isActive) return null;

  return (
    <div className="md:hidden mb-2">
      <button
        onClick={() => setExpanded(messageId, !expanded)}
        className="flex items-center gap-2 text-left"
      >
        {isActive ? (
          <Icons.Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
        ) : (
          <Icons.Brain className="h-3 w-3 text-[#6a6560]" />
        )}
        <span className="text-xs text-[#6a6560]">{isActive ? "Thinking..." : "Reasoning"}</span>
        {content &&
          (expanded ? (
            <Icons.ChevronUp className="h-3 w-3 text-[#6a6560]" />
          ) : (
            <Icons.ChevronDown className="h-3 w-3 text-[#6a6560]" />
          ))}
      </button>
      {content && expanded && (
        <p className="mt-1 text-xs text-[#6a6560] whitespace-pre-wrap wrap-break-word max-h-40 overflow-auto pl-5">
          {content}
        </p>
      )}
    </div>
  );
}

// Desktop: single-line tool summary
function ToolCallSummary({
  toolParts,
  isStreaming,
}: {
  toolParts: Array<{
    type: string;
    toolCallId: string;
    state?: string;
    toolName?: string;
  }>;
  isStreaming?: boolean;
}) {
  const hasError = toolParts.some(
    (t) => t.state === "output-error" || t.state === "error" || t.state === "output-denied",
  );
  const pendingStates = new Set([
    "input-streaming",
    "input-available",
    "approval-requested",
    "approval-responded",
  ]);
  // Only "running" if this message is still streaming AND has pending calls
  const hasPendingCalls = toolParts.some((t) => t.state && pendingStates.has(t.state));
  const isRunning = Boolean(isStreaming) && hasPendingCalls;
  const total = toolParts.length;

  // Last tool name (strip server__ prefix)
  const lastTool = toolParts[toolParts.length - 1];
  const lastToolRaw = lastTool?.toolName ?? lastTool?.type.replace(/^tool-/, "") ?? "";
  const lastToolName = lastToolRaw.includes("__")
    ? lastToolRaw.split("__").slice(1).join("__")
    : lastToolRaw;

  const label = hasError ? "error" : isRunning ? "running" : "done";

  return (
    <div className="hidden md:flex items-center gap-2 mt-3 pt-3 border-t border-(--border) text-xs text-[#6a6560]">
      {isRunning ? (
        <Icons.Loader2 className="h-3 w-3 text-[#6a6560] animate-spin shrink-0" />
      ) : hasError ? (
        <span className="w-3 h-3 flex items-center justify-center shrink-0 text-red-400 text-[10px]">
          ✕
        </span>
      ) : (
        <Icons.Check className="h-3 w-3 text-emerald-500/70 shrink-0" />
      )}
      <span className={hasError ? "text-red-400/70" : ""}>{label}</span>
      <span className="text-[#3a3735]">·</span>
      <span>
        {total} tool call{total !== 1 ? "s" : ""}
      </span>
      {lastToolName && (
        <>
          <span className="text-[#3a3735]">·</span>
          <span className="font-mono truncate max-w-[160px]">{lastToolName}</span>
        </>
      )}
    </div>
  );
}

// Inline tool calls component for mobile - minimal style
function InlineToolCalls({
  messageId,
  toolParts,
}: {
  messageId: string;
  toolParts: Array<{
    type: string;
    toolCallId: string;
    state?: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
  }>;
}) {
  const expanded = useAppStore((state) => state.messageInlineToolsExpanded[messageId] ?? false);
  const setExpanded = useAppStore((state) => state.setMessageInlineToolsExpanded);

  if (toolParts.length === 0) return null;

  const pendingStates = new Set([
    "input-streaming",
    "input-available",
    "approval-requested",
    "approval-responded",
  ]);
  const completeStates = new Set(["output-available", "output-error", "output-denied", "result"]);

  const activeTools = toolParts.filter((t) => t.state && pendingStates.has(t.state));
  const hasActiveTools = activeTools.length > 0;

  return (
    <div className="md:hidden mb-2">
      <button
        onClick={() => setExpanded(messageId, !expanded)}
        className="flex items-center gap-2 text-left"
      >
        {hasActiveTools ? (
          <Icons.Loader2 className="h-3 w-3 text-amber-400 animate-spin" />
        ) : (
          <Icons.Wrench className="h-3 w-3 text-[#6a6560]" />
        )}
        <span className="text-xs text-[#6a6560]">
          {hasActiveTools
            ? `Running ${activeTools.length} tool${activeTools.length > 1 ? "s" : ""}...`
            : `${toolParts.length} tool${toolParts.length > 1 ? "s" : ""}`}
        </span>
        {expanded ? (
          <Icons.ChevronUp className="h-3 w-3 text-[#6a6560]" />
        ) : (
          <Icons.ChevronDown className="h-3 w-3 text-[#6a6560]" />
        )}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1 pl-5">
          {toolParts.map((tool) => {
            const toolName = tool.toolName ?? tool.type.replace(/^tool-/, "");
            const isRunning = tool.state ? pendingStates.has(tool.state) : false;
            const isComplete = tool.state ? completeStates.has(tool.state) : false;

            return (
              <div key={tool.toolCallId} className="flex items-center gap-2 text-xs text-[#6a6560]">
                {isRunning ? (
                  <Icons.Loader2 className="h-2.5 w-2.5 text-amber-400 animate-spin" />
                ) : isComplete ? (
                  <Icons.Check className="h-2.5 w-2.5 text-green-500" />
                ) : (
                  <span className="w-2.5 h-2.5 rounded-full bg-[#6a6560]/50" />
                )}
                <span className="font-mono">{toolName}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChatMessageItemBase({
  message,
  isStreaming,
  artifactsEnabled = false,
  artifacts,
  selectedModel,
  contextUsageLabel,
  copied,
  onCopy,
  onFork,
  onReprompt,
  onExport,
}: ChatMessageItemProps) {
  const isUser = message.role === "user";
  const setActiveArtifactId = useAppStore((state) => state.setActiveArtifactId);
  const setToolPanelOpen = useAppStore((state) => state.setToolPanelOpen);
  const setActivePanel = useAppStore((state) => state.setActivePanel);

  // Extract text content from parts
  const rawTextContent = message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");

  // Extract AI SDK reasoning parts (type: "reasoning" from sendReasoning: true)
  const aiSdkReasoning = message.parts
    .filter(
      (part): part is { type: "reasoning"; text: string } =>
        part.type === "reasoning" && "text" in part,
    )
    .map((part) => part.text)
    .join("");

  // For assistant messages, parse thinking content and get mainContent without <think> tags
  const parsedThinking = !isUser ? thinkingParser.parse(rawTextContent) : null;
  const textContent = isUser ? rawTextContent : parsedThinking?.mainContent || "";

  // Combine parsed <think> tags with AI SDK reasoning parts
  const thinkingContent = aiSdkReasoning || parsedThinking?.thinkingContent || "";
  const isThinkingActive = isStreaming && !textContent && !!thinkingContent;

  // Extract tool parts (static + dynamic tools)
  const toolParts = message.parts
    .filter(
      (
        part,
      ): part is typeof part & {
        toolCallId: string;
        state?: string;
        input?: unknown;
        output?: unknown;
        toolName?: string;
      } => {
        if (part.type === "dynamic-tool") return "toolCallId" in part;
        return (
          typeof part.type === "string" && part.type.startsWith("tool-") && "toolCallId" in part
        );
      },
    )
    .map((part) => {
      if (part.type === "dynamic-tool") {
        return { ...part, toolName: "toolName" in part ? String(part.toolName) : "tool" };
      }
      const rawName = part.type.replace(/^tool-/, "");
      const toolName = rawName.includes("__") ? rawName.split("__").slice(1).join("__") : rawName;
      return { ...part, toolName };
    });

  const metadata = message.metadata as MessageMetadata | undefined;
  const usage = metadata?.usage;
  const totalTokens =
    usage?.totalTokens ??
    (usage?.inputTokens != null || usage?.outputTokens != null
      ? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
      : undefined);

  const modelLabel = metadata?.model ?? selectedModel ?? "Assistant";
  const displayModel = modelLabel.split("/").pop() || modelLabel;

  const canActOnContent = textContent.trim().length > 0;

  const handleExport = () => {
    if (!canActOnContent) return;
    onExport({
      messageId: message.id,
      role: isUser ? "user" : "assistant",
      content: textContent,
      model: isUser ? undefined : displayModel,
      totalTokens: isUser ? undefined : totalTokens,
    });
  };

  const actionButtonClassName =
    "p-1 rounded hover:bg-(--accent) transition-colors disabled:opacity-40";

  // User message rendering - simple on mobile, card on desktop
  if (isUser) {
    return (
      <div id={`message-${message.id}`} className="group">
        {/* Mobile: simple right-aligned text */}
        <div className="md:hidden">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-[#6a6560]">You</span>
          </div>
          <div className="text-[15px] leading-relaxed text-[#e8e4dd] whitespace-pre-wrap break-words">
            {textContent}
          </div>
        </div>

        {/* Desktop: card style */}
        <div className="hidden md:flex justify-end">
          <div className="ml-auto max-w-[62%] rounded-xl border border-(--border) bg-(--card)/70 px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#9a9590]">You</div>
              <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onCopy(textContent, message.id)}
                  disabled={!canActOnContent}
                  className={actionButtonClassName}
                  title="Copy"
                >
                  {copied ? (
                    <Icons.Check className="h-3.5 w-3.5 text-(--success)" />
                  ) : (
                    <Icons.Copy className="h-3.5 w-3.5 text-[#9a9590]" />
                  )}
                </button>
                <button
                  onClick={handleExport}
                  disabled={!canActOnContent}
                  className={actionButtonClassName}
                  title="Export"
                >
                  <Icons.Download className="h-3.5 w-3.5 text-[#9a9590]" />
                </button>
              </div>
            </div>
            <div className="text-[15px] leading-relaxed text-[#e8e4dd] whitespace-pre-wrap break-words">
              {textContent}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Assistant message rendering
  return (
    <div id={`message-${message.id}`} className="flex flex-col group">
      <div className="max-w-full">
        {/* Header with model name and actions */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-wider text-[#6a6560] md:tracking-[0.2em] md:text-[#9a9590] truncate max-w-[180px]">
            {displayModel || "Assistant"}
          </span>
          {totalTokens != null && totalTokens > 0 && (
            <span className="hidden md:inline text-[10px] text-[#6a6560] font-mono">
              {totalTokens.toLocaleString()} tok
            </span>
          )}
          {contextUsageLabel && (
            <button
              onClick={() => {
                setToolPanelOpen(true);
                setActivePanel("context");
              }}
              className="hidden md:inline text-[10px] text-[#6a6560] font-mono hover:text-[#9a9590] transition-colors cursor-pointer"
            >
              ctx {contextUsageLabel}
            </button>
          )}
          {/* Desktop actions */}
          <div className="hidden md:flex ml-auto items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onReprompt && (
              <button
                onClick={() => onReprompt(message.id)}
                disabled={isStreaming}
                className={actionButtonClassName}
                title="Reprompt"
              >
                <Icons.RotateCcw className="h-3.5 w-3.5 text-[#9a9590]" />
              </button>
            )}
            {onFork && (
              <button
                onClick={() => onFork(message.id)}
                className={actionButtonClassName}
                title="Fork"
              >
                <Icons.GitBranch className="h-3.5 w-3.5 text-[#9a9590]" />
              </button>
            )}
            <button
              onClick={() => onCopy(textContent, message.id)}
              disabled={!canActOnContent}
              className={actionButtonClassName}
              title="Copy"
            >
              {copied ? (
                <Icons.Check className="h-3.5 w-3.5 text-(--success)" />
              ) : (
                <Icons.Copy className="h-3.5 w-3.5 text-[#9a9590]" />
              )}
            </button>
            <button
              onClick={handleExport}
              disabled={!canActOnContent}
              className={actionButtonClassName}
              title="Export"
            >
              <Icons.Download className="h-3.5 w-3.5 text-[#9a9590]" />
            </button>
          </div>
        </div>

        {/* Mobile inline thinking */}
        <InlineThinking
          messageId={message.id}
          content={thinkingContent}
          isActive={isThinkingActive}
        />

        {/* Mobile inline tool calls */}
        <InlineToolCalls messageId={message.id} toolParts={toolParts} />

        {/* Text content with MessageRenderer */}
        {textContent ? (
          <MessageRenderer content={textContent} isStreaming={isStreaming} />
        ) : isStreaming && !thinkingContent ? (
          <div className="flex items-center gap-2 text-[#6a6560]">
            <Icons.Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        ) : null}

        {artifactsEnabled && artifacts && artifacts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {artifacts.map((artifact) => (
              <MiniArtifactCard
                key={artifact.id}
                artifact={artifact}
                onClick={() => setActiveArtifactId(artifact.id)}
              />
            ))}
          </div>
        )}

        {/* Desktop tool summary — single line */}
        {toolParts.length > 0 && (
          <ToolCallSummary toolParts={toolParts} isStreaming={isStreaming} />
        )}
      </div>
    </div>
  );
}

export const ChatMessageItem = memo(ChatMessageItemBase);
