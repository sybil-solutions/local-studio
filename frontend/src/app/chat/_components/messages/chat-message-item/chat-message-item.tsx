// CRITICAL
"use client";

import { memo, useCallback, useMemo } from "react";
import { useAppStore } from "@/store";
import * as Icons from "../../icons";
import { MessageRenderer } from "../message-renderer";
import { MiniArtifactCard } from "../../artifacts/mini-artifact-card";
import { PerfProfiler } from "../../perf/perf-profiler";
import type { AgentFileEntry, Artifact, ChatMessage, ChatMessageMetadata } from "@/lib/types";
import { useMessageDerived } from "./use-message-derived";
import { UserMessage } from "./user-message";
import { ReferencedAgentFilePreviews } from "../referenced-agent-file-previews";
import { InlineToolBlock, type ToolPart } from "./inline-tool-block";

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
  currentSessionId?: string | null;
  agentFiles?: AgentFileEntry[];
  agentFilesBrowsePath?: string;
  onOpenAgentFile?: (path: string) => void;
  onExport: (payload: {
    messageId: string;
    role: "user" | "assistant";
    content: string;
    model?: string;
    totalTokens?: number;
  }) => void;
}

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
  currentSessionId = null,
  agentFiles = [],
  agentFilesBrowsePath = "",
  onOpenAgentFile,
}: ChatMessageItemProps) {
  const messageId = message.id;
  const isUser = message.role === "user";
  const metadata = message.metadata as ChatMessageMetadata | undefined;
  const runId = (metadata as { runId?: string } | undefined)?.runId ?? null;
  const runDuration = useAppStore((s) => (runId ? s.runDurationsByRunId[runId] : undefined));
  const copied = useAppStore((s) => s.copiedMessageId === messageId);
  const setCopiedMessageId = useAppStore((s) => s.setCopiedMessageId);
  const setActiveArtifactId = useAppStore((s) => s.setActiveArtifactId);

  const { textContent } = useMessageDerived({
    role: message.role,
    parts: message.parts,
  });

  const toolParts = useMemo(() => {
    if (isUser) return [];
    return message.parts.filter(
      (p) => p.type === "dynamic-tool" || p.type.startsWith("tool-")
    );
  }, [isUser, message.parts]);

  // For streaming messages, subscribe reactively; for completed ones, snapshot is enough
  const imageParts = useMemo(() => {
    if (!isUser) return undefined;
    const imgs = message.parts
      .filter((p): p is Extract<typeof p, { type: "image" }> => p.type === "image")
      .map((p) => ({ url: p.url, name: p.name }));
    return imgs.length > 0 ? imgs : undefined;
  }, [isUser, message.parts]);

  const displayModel = useMemo(() => {
    const label = metadata?.model ?? selectedModel ?? "";
    return label.split("/").pop() || label;
  }, [metadata?.model, selectedModel]);

  const totalTokens = useMemo(() => {
    const u = metadata?.usage;
    const sum = (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0);
    return u?.totalTokens ?? (sum > 0 ? sum : undefined);
  }, [metadata?.usage]);

  const durationLabel = useMemo(() => {
    if (typeof runDuration !== "number" || runDuration <= 0) return null;
    const m = Math.floor(runDuration / 60);
    const s = runDuration % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [runDuration]);

  const canAct = textContent.trim().length > 0;

  const handleCopy = useCallback(async () => {
    if (!canAct) return;
    try {
      await navigator.clipboard.writeText(textContent);
      setCopiedMessageId(messageId);
      setTimeout(() => {
        if (useAppStore.getState().copiedMessageId === messageId) setCopiedMessageId(null);
      }, 2000);
    } catch {}
  }, [canAct, messageId, setCopiedMessageId, textContent]);

  const handleExport = useCallback(() => {
    if (!canAct) return;
    onExport({
      messageId,
      role: isUser ? "user" : "assistant",
      content: textContent,
      model: isUser ? undefined : displayModel,
      totalTokens: isUser ? undefined : totalTokens,
    });
  }, [canAct, displayModel, isUser, messageId, onExport, textContent, totalTokens]);

  // ── User ──
  if (isUser) {
    return (
      <UserMessage
        messageId={messageId}
        textContent={textContent}
        images={imageParts}
        copied={copied}
        canActOnContent={canAct || !!imageParts}
        onCopy={handleCopy}
        onExport={handleExport}
      />
    );
  }

  // ── Assistant ──

  return (
    <div id={`message-${messageId}`} className="group py-1.5">
      {toolParts.length > 0 && (
        <div className="mb-1.5">
          {toolParts.map((part, i) => (
            <InlineToolBlock
              key={(part as { toolCallId?: string }).toolCallId ?? `tool-${i}`}
              part={part as ToolPart}
            />
          ))}
        </div>
      )}

      {textContent ? (
        <PerfProfiler id={`message-renderer:${messageId}`}>
          <MessageRenderer content={textContent} isStreaming={isStreaming} />
        </PerfProfiler>
      ) : null}

      {onOpenAgentFile && agentFiles.length > 0 ? (
        <ReferencedAgentFilePreviews
          text={textContent}
          agentFiles={agentFiles}
          agentFilesBrowsePath={agentFilesBrowsePath}
          sessionId={currentSessionId}
          onOpenFile={onOpenAgentFile}
        />
      ) : null}

      {artifactsEnabled && artifacts && artifacts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {artifacts.map((a) => (
            <MiniArtifactCard key={a.id} artifact={a} onClick={() => setActiveArtifactId(a.id)} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-1 h-4 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {displayModel && (
          <span className="text-[10px] text-(--dim)/40 font-mono truncate max-w-[140px]">
            {displayModel}
          </span>
        )}
        {durationLabel && (
          <span className="text-[10px] text-(--dim)/35 font-mono tabular-nums">
            {durationLabel}
          </span>
        )}
        {totalTokens != null && totalTokens > 0 && (
          <span className="hidden md:inline text-[10px] text-(--dim)/35 font-mono">
            {totalTokens.toLocaleString()}t
          </span>
        )}
        {contextUsageLabel && (
          <button
            onClick={onOpenContext}
            className="hidden md:inline text-[10px] text-(--dim)/35 font-mono hover:text-(--dim) transition-colors cursor-pointer"
          >
            ctx {contextUsageLabel}
          </button>
        )}

        <div className="hidden md:flex ml-auto items-center gap-0.5">
          {onReprompt && (
            <button
              onClick={() => onReprompt(messageId)}
              disabled={isStreaming}
              className="p-1 rounded-md hover:bg-(--surface) transition-colors disabled:opacity-30"
              title="Reprompt"
            >
              <Icons.RotateCcw className="h-3 w-3 text-(--dim)/40" />
            </button>
          )}
          {onFork && (
            <button
              onClick={() => onFork(messageId)}
              className="p-1 rounded-md hover:bg-(--surface) transition-colors"
              title="Fork"
            >
              <Icons.GitBranch className="h-3 w-3 text-(--dim)/40" />
            </button>
          )}
          {onListen && (
            <button
              onClick={() => onListen(messageId)}
              disabled={!canAct && !isListening}
              className="p-1 rounded-md hover:bg-(--surface) transition-colors disabled:opacity-30"
              title={isListening ? "Stop" : "Listen"}
            >
              {isListenPending ? (
                <Icons.Loader2 className="h-3 w-3 text-(--hl1) animate-spin" />
              ) : isListening ? (
                <Icons.StopCircle className="h-3 w-3 text-(--hl1)" />
              ) : (
                <Icons.Volume2 className="h-3 w-3 text-(--dim)/40" />
              )}
            </button>
          )}
          <button
            onClick={handleCopy}
            disabled={!canAct}
            className="p-1 rounded-md hover:bg-(--surface) transition-colors disabled:opacity-30"
            title="Copy"
          >
            {copied ? (
              <Icons.Check className="h-3 w-3 text-(--hl2)" />
            ) : (
              <Icons.Copy className="h-3 w-3 text-(--dim)/40" />
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={!canAct}
            className="p-1 rounded-md hover:bg-(--surface) transition-colors disabled:opacity-30"
            title="Export"
          >
            <Icons.Download className="h-3 w-3 text-(--dim)/40" />
          </button>
        </div>
      </div>
    </div>
  );
}

export const ChatMessageItem = memo(ChatMessageItemBase);
