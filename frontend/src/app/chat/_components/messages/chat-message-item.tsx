"use client";

import { memo, useState } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { LanguageModelUsage } from "ai";
import {
  Loader2,
  Copy,
  Check,
  GitBranch,
  RotateCcw,
  Download,
  ChevronDown,
  ChevronUp,
  Brain,
  Wrench,
} from "lucide-react";
import { MessageRenderer, thinkingParser } from "./message-renderer";

interface ChatMessageItemProps {
  message: UIMessage;
  isStreaming: boolean;
  artifactsEnabled?: boolean;
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
function InlineThinking({ content, isActive }: { content: string; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!content && !isActive) return null;

  return (
    <div className="md:hidden mb-2">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-left">
        {isActive ? (
          <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
        ) : (
          <Brain className="h-3 w-3 text-[#6a6560]" />
        )}
        <span className="text-xs text-[#6a6560]">{isActive ? "Thinking..." : "Reasoning"}</span>
        {content &&
          (expanded ? (
            <ChevronUp className="h-3 w-3 text-[#6a6560]" />
          ) : (
            <ChevronDown className="h-3 w-3 text-[#6a6560]" />
          ))}
      </button>
      {content && expanded && (
        <p className="mt-1 text-xs text-[#6a6560] whitespace-pre-wrap break-words max-h-40 overflow-auto pl-5">
          {content}
        </p>
      )}
    </div>
  );
}

// Inline tool calls component for mobile - minimal style
function InlineToolCalls({
  toolParts,
}: {
  toolParts: Array<{
    type: string;
    toolCallId: string;
    state?: string;
    input?: unknown;
    output?: unknown;
  }>;
}) {
  const [expanded, setExpanded] = useState(false);

  if (toolParts.length === 0) return null;

  const activeTools = toolParts.filter((t) => t.state === "call" || t.state === "input-streaming");
  const hasActiveTools = activeTools.length > 0;

  return (
    <div className="md:hidden mb-2">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-left">
        {hasActiveTools ? (
          <Loader2 className="h-3 w-3 text-amber-400 animate-spin" />
        ) : (
          <Wrench className="h-3 w-3 text-[#6a6560]" />
        )}
        <span className="text-xs text-[#6a6560]">
          {hasActiveTools
            ? `Running ${activeTools.length} tool${activeTools.length > 1 ? "s" : ""}...`
            : `${toolParts.length} tool${toolParts.length > 1 ? "s" : ""}`}
        </span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-[#6a6560]" />
        ) : (
          <ChevronDown className="h-3 w-3 text-[#6a6560]" />
        )}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1 pl-5">
          {toolParts.map((tool) => {
            const toolName = tool.type.replace(/^tool-/, "");
            const isRunning = tool.state === "call" || tool.state === "input-streaming";
            const isComplete = tool.state === "result" || tool.state === "output-available";

            return (
              <div key={tool.toolCallId} className="flex items-center gap-2 text-xs text-[#6a6560]">
                {isRunning ? (
                  <Loader2 className="h-2.5 w-2.5 text-amber-400 animate-spin" />
                ) : isComplete ? (
                  <Check className="h-2.5 w-2.5 text-green-500" />
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
  selectedModel,
  contextUsageLabel,
  copied,
  onCopy,
  onFork,
  onReprompt,
  onExport,
}: ChatMessageItemProps) {
  const isUser = message.role === "user";

  // Extract text content from parts
  const rawTextContent = message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");

  // For assistant messages, parse thinking content and get mainContent without <think> tags
  const parsedThinking = !isUser ? thinkingParser.parse(rawTextContent) : null;
  const textContent = isUser ? rawTextContent : parsedThinking?.mainContent || "";

  // DEBUG: Log if </think> tag appears in textContent (should never happen)
  if (!isUser && textContent.includes("</think>")) {
    console.error("[THINKING BUG] </think> tag found in textContent!", {
      messageId: message.id,
      rawTextContent: rawTextContent.substring(0, 500),
      textContent: textContent.substring(0, 500),
      parsedThinking,
      partsTypes: message.parts.map((p) => p.type),
      textParts: message.parts
        .filter((p) => p.type === "text")
        .map((p) => ({ text: (p as { text: string }).text.substring(0, 200) })),
    });
  }
  const thinkingContent = parsedThinking?.thinkingContent || "";
  const isThinkingActive = isStreaming && !textContent && !!thinkingContent;

  // Extract tool parts (they have type starting with "tool-")
  const toolParts = message.parts.filter(
    (
      part,
    ): part is typeof part & {
      toolCallId: string;
      state?: string;
      input?: unknown;
      output?: unknown;
    } => part.type.startsWith("tool-") && "toolCallId" in part,
  );

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
                    <Check className="h-3.5 w-3.5 text-(--success)" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-[#9a9590]" />
                  )}
                </button>
                <button
                  onClick={handleExport}
                  disabled={!canActOnContent}
                  className={actionButtonClassName}
                  title="Export"
                >
                  <Download className="h-3.5 w-3.5 text-[#9a9590]" />
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
            <span className="hidden md:inline text-[10px] text-[#6a6560] font-mono">
              ctx {contextUsageLabel}
            </span>
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
                <RotateCcw className="h-3.5 w-3.5 text-[#9a9590]" />
              </button>
            )}
            {onFork && (
              <button
                onClick={() => onFork(message.id)}
                className={actionButtonClassName}
                title="Fork"
              >
                <GitBranch className="h-3.5 w-3.5 text-[#9a9590]" />
              </button>
            )}
            <button
              onClick={() => onCopy(textContent, message.id)}
              disabled={!canActOnContent}
              className={actionButtonClassName}
              title="Copy"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-(--success)" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-[#9a9590]" />
              )}
            </button>
            <button
              onClick={handleExport}
              disabled={!canActOnContent}
              className={actionButtonClassName}
              title="Export"
            >
              <Download className="h-3.5 w-3.5 text-[#9a9590]" />
            </button>
          </div>
        </div>

        {/* Mobile inline thinking */}
        <InlineThinking content={thinkingContent} isActive={isThinkingActive} />

        {/* Mobile inline tool calls */}
        <InlineToolCalls toolParts={toolParts} />

        {/* Text content with MessageRenderer */}
        {textContent ? (
          <MessageRenderer
            content={textContent}
            isStreaming={isStreaming}
            artifactsEnabled={artifactsEnabled}
          />
        ) : isStreaming && !thinkingContent ? (
          <div className="flex items-center gap-2 text-[#6a6560]">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        ) : null}

        {/* Desktop tool invocations preview */}
        {toolParts.length > 0 && (
          <div className="hidden md:block mt-3 pt-3 border-t border-(--border)">
            {toolParts.map((tool) => {
              const toolName = tool.type.replace(/^tool-/, "");
              const state = tool.state;
              return (
                <div
                  key={tool.toolCallId}
                  className="flex items-center gap-2 text-xs text-[#9a9590]"
                >
                  <span className="font-mono">{toolName}</span>
                  <span className="text-[#6a6560]">
                    {state === "call" || state === "input-streaming" ? "calling..." : ""}
                    {state === "result" || state === "output-available" ? "complete" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatMessageItem = memo(ChatMessageItemBase);
