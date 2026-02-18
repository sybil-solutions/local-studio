// CRITICAL
"use client";

import { memo, useCallback, useMemo } from "react";
import { useAppStore } from "@/store";
import * as Icons from "../../icons";
import { MessageRenderer } from "../message-renderer";
import { MiniArtifactCard } from "../../artifacts/mini-artifact-card";
import { PerfProfiler } from "../../perf/perf-profiler";
import type { Artifact, ChatMessage, ChatMessageMetadata } from "@/lib/types";
import { TOOL_PENDING_STATES } from "./constants";
import { InlineThinking } from "./inline-thinking";
import { InlineToolIndicator } from "./inline-tool-indicator";
import { useMessageDerived } from "./use-message-derived";
import { UserMessage } from "./user-message";

interface ChatMessageItemProps {
  message: ChatMessage;
  isStreaming: boolean;
  artifactsEnabled?: boolean;
  artifacts?: Artifact[];
  selectedModel?: string;
  contextUsageLabel?: string | null;
  onOpenContext?: () => void;
  onFork?: (messageId: string) => void;
  onReprompt?: (messageId: string) => void;
  onListen?: (messageId: string) => void;
  isListening?: boolean;
  isListenPending?: boolean;
  onExport: (payload: {
    messageId: string;
    role: "user" | "assistant";
    content: string;
    model?: string;
    totalTokens?: number;
  }) => void;
}

type MessageMetadata = ChatMessageMetadata;

function ChatMessageItemBase({
  message,
  isStreaming,
  artifactsEnabled = false,
  artifacts,
  selectedModel,
  contextUsageLabel,
  onFork,
  onReprompt,
  onListen,
  isListening = false,
  isListenPending = false,
  onExport,
  onOpenContext,
}: ChatMessageItemProps) {
  const messageId = message.id;
  const messageRole = message.role;
  const messageMetadata = message.metadata as MessageMetadata | undefined;
  const isUser = messageRole === "user";
  const runId = (messageMetadata as { runId?: string } | undefined)?.runId ?? null;
  const runDurationSeconds = useAppStore((state) => (runId ? state.runDurationsByRunId[runId] : undefined));
  const copied = useAppStore((state) => state.copiedMessageId === messageId);
  const setCopiedMessageId = useAppStore((state) => state.setCopiedMessageId);
  const setActiveArtifactId = useAppStore((state) => state.setActiveArtifactId);

  const { textContent, thinkingContent, toolParts } = useMessageDerived({
    role: messageRole,
    parts: message.parts,
  });

  const { displayModel, totalTokens } = useMemo(() => {
    const usage = messageMetadata?.usage;
    const totalTokens =
      usage?.totalTokens ??
      (usage?.inputTokens != null || usage?.outputTokens != null
        ? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
        : undefined);

    const modelLabel = messageMetadata?.model ?? selectedModel ?? "Assistant";
    const displayModel = modelLabel.split("/").pop() || modelLabel;
    return { displayModel, totalTokens };
  }, [messageMetadata, selectedModel]);

  const fullModelId = useMemo(() => {
    return (messageMetadata?.model ?? selectedModel ?? "Assistant").trim();
  }, [messageMetadata?.model, selectedModel]);

  const isThinkingActive = isStreaming && !textContent && !!thinkingContent;
  const activeToolCount = useMemo(() => {
    if (toolParts.length === 0) return 0;
    return toolParts.filter((t) => t.state && TOOL_PENDING_STATES.has(t.state)).length;
  }, [toolParts]);

  const durationLabel = useMemo(() => {
    if (typeof runDurationSeconds !== "number" || runDurationSeconds <= 0) return null;
    const mins = Math.floor(runDurationSeconds / 60);
    const secs = runDurationSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, [runDurationSeconds]);

  const canActOnContent = textContent.trim().length > 0;

  const handleCopy = useCallback(async () => {
    if (!canActOnContent) return;
    try {
      await navigator.clipboard.writeText(textContent);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        const current = useAppStore.getState().copiedMessageId;
        if (current === messageId) {
          setCopiedMessageId(null);
        }
      }, 2000);
    } catch (err) {
      console.error("Failed to copy message:", err);
    }
  }, [canActOnContent, messageId, setCopiedMessageId, textContent]);

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

  const actionButtonClassName = "p-1 rounded hover:bg-(--accent) transition-colors disabled:opacity-40";

  // User message rendering - simple on mobile, card on desktop
  if (isUser) {
    return (
      <UserMessage
        messageId={messageId}
        textContent={textContent}
        copied={copied}
        canActOnContent={canActOnContent}
        onCopy={handleCopy}
        onExport={handleExport}
        actionButtonClassName={actionButtonClassName}
      />
    );
  }

  return (
    <div id={`message-${message.id}`} className="flex flex-col group">
      <div className="max-w-full">
        <div className="flex items-center gap-2 mb-1">
          <span className="md:hidden text-[10px] font-mono text-(--dim) truncate max-w-[70vw]" title={fullModelId}>
            {fullModelId}
          </span>
          <span className="hidden md:inline text-[10px] uppercase tracking-wider text-(--dim) md:tracking-[0.2em] md:text-(--dim) truncate max-w-[180px]">
            {displayModel || "Assistant"}
          </span>
          {durationLabel && (
            <span className="text-[10px] text-(--dim) font-mono" title="Turn runtime">
              {durationLabel}
            </span>
          )}
          {activeToolCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-(--dim)">
              <Icons.Loader2 className="h-3 w-3 text-amber-400 animate-spin" />
              <span className="hidden md:inline">tools</span>
            </span>
          )}
          {totalTokens != null && totalTokens > 0 && (
            <span className="hidden md:inline text-[10px] text-(--dim) font-mono">
              {totalTokens.toLocaleString()} tok
            </span>
          )}
          {contextUsageLabel && (
            <button
              onClick={onOpenContext}
              className="hidden md:inline text-[10px] text-(--dim) font-mono hover:text-(--dim) transition-colors cursor-pointer"
            >
              ctx {contextUsageLabel}
            </button>
          )}
          <div className="hidden md:flex ml-auto items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onReprompt && (
              <button
                onClick={() => onReprompt(messageId)}
                disabled={isStreaming}
                className={actionButtonClassName}
                title="Reprompt"
              >
                <Icons.RotateCcw className="h-3.5 w-3.5 text-(--dim)" />
              </button>
            )}
            {onFork && (
              <button onClick={() => onFork(messageId)} className={actionButtonClassName} title="Fork">
                <Icons.GitBranch className="h-3.5 w-3.5 text-(--dim)" />
              </button>
            )}
            {onListen && (
              <button
                onClick={() => onListen(messageId)}
                disabled={!canActOnContent && !isListening}
                className={actionButtonClassName}
                title={isListening ? "Stop" : "Listen"}
              >
                {isListenPending ? (
                  <Icons.Loader2 className="h-3.5 w-3.5 text-(--hl1) animate-spin" />
                ) : isListening ? (
                  <Icons.StopCircle className="h-3.5 w-3.5 text-(--hl1)" />
                ) : (
                  <Icons.Volume2 className="h-3.5 w-3.5 text-(--dim)" />
                )}
              </button>
            )}
            <button
              onClick={handleCopy}
              disabled={!canActOnContent}
              className={actionButtonClassName}
              title="Copy"
            >
              {copied ? (
                <Icons.Check className="h-3.5 w-3.5 text-(--hl2)" />
              ) : (
                <Icons.Copy className="h-3.5 w-3.5 text-(--dim)" />
              )}
            </button>
            <button
              onClick={handleExport}
              disabled={!canActOnContent}
              className={actionButtonClassName}
              title="Export"
            >
              <Icons.Download className="h-3.5 w-3.5 text-(--dim)" />
            </button>
          </div>
        </div>

        <InlineThinking messageId={messageId} content={thinkingContent} isActive={isThinkingActive} />
        <InlineToolIndicator toolParts={toolParts} />

        {textContent ? (
          <PerfProfiler id={`message-renderer:${message.id}`}>
            <MessageRenderer content={textContent} isStreaming={isStreaming} />
          </PerfProfiler>
        ) : isStreaming && !thinkingContent ? (
          <div className="flex items-center gap-2 text-(--dim)">
            <Icons.Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        ) : null}

        {artifactsEnabled && artifacts && artifacts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {artifacts.map((artifact) => (
              <MiniArtifactCard key={artifact.id} artifact={artifact} onClick={() => setActiveArtifactId(artifact.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatMessageItem = memo(ChatMessageItemBase);
