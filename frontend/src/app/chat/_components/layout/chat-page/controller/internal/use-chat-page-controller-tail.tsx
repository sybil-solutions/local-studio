// CRITICAL
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store";
import { deriveMessageContent } from "@/app/chat/_components/messages/chat-message-item/use-message-derived";
import type { ChatPageViewProps } from "../../view/chat-page-view/types";
import { buildChatPageViewProps } from "./build-chat-page-view-props";
import { useChatExportActions } from "./actions/use-chat-export-actions";
import { useChatRunActions } from "./actions/use-chat-run-actions";
import { useChatUiActions } from "./actions/use-chat-ui-actions";
import { setLastSessionId as setLastSessionIdStorage } from "../last-session-id";
import type { UseChatPageControllerTailArgs } from "./types/use-chat-page-controller-tail";
import { useCallMode } from "../../../../input/tool-belt/use-call-mode";

type SpeakFailure = {
  kind: "error" | "warning";
  title: string;
  message?: string;
  detail?: string;
};

const parseSpeakFailure = (status: number, raw: string): SpeakFailure => {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  const errorMessage =
    (parsed && typeof parsed["error"] === "string" ? parsed["error"] : null) ??
    (raw.trim() ? raw.trim() : undefined);

  if (status === 409 && parsed?.["code"] === "gpu_lease_conflict") {
    return {
      kind: "warning",
      title: "TTS blocked by active GPU lease",
      message: "Another service holds the GPU lease. Retry with replace or best_effort.",
      detail: raw,
    };
  }

  if (status === 503 && parsed?.["code"] === "tts_cli_missing") {
    return {
      kind: "error",
      title: "TTS is not installed",
      message: "Install piper or configure VLLM_STUDIO_TTS_CLI on the controller host.",
      detail: raw,
    };
  }

  if (status === 400 && parsed?.["code"] === "model_not_found") {
    return {
      kind: "error",
      title: "TTS model not found",
      message: errorMessage,
      detail: raw,
    };
  }

  return {
    kind: "error",
    title: "Speech synthesis failed",
    message: errorMessage,
    detail: raw || `HTTP ${status}`,
  };
};

const normalizeSpeakFailure = (error: unknown): SpeakFailure => {
  if (error && typeof error === "object") {
    const candidate = error as Partial<SpeakFailure>;
    if (candidate.kind && candidate.title) {
      return {
        kind: candidate.kind,
        title: candidate.title,
        ...(candidate.message ? { message: candidate.message } : {}),
        ...(candidate.detail ? { detail: candidate.detail } : {}),
      };
    }
  }

  if (error instanceof Error) {
    return {
      kind: "error",
      title: "Audio playback failed",
      message: error.message,
      detail: error.stack,
    };
  }

  return {
    kind: "error",
    title: "Audio playback failed",
    message: String(error),
  };
};

export function useChatPageControllerTail({
  store,
  sessions,
  tools,
  agentFiles,
  router,
  sessionFromUrl,
  sidebarOpen,
  setSidebarOpen,
  sidebarTab,
  setSidebarTab,
  messages,
  setMessages,
  isLoading,
  streamError,
  streamStalled,
  setStreamError,
  setIsLoading,
  setStreamStalled,
  clearPlan,
  lastUserInputRef,
  generateTitle,
  handleRunEvent,
  activeRunIdRef,
  runAbortControllerRef,
  runCompletedRef,
  lastEventTimeRef,
  sessionIdRef,
  activityPanelVisible,
  thinkingActive,
  activityGroups,
  activityCount,
  thinkingSnippet,
  executingToolsSize,
  contextStats,
  contextBreakdown,
  contextUsageLabel,
  compactionHistory,
  compacting,
  compactionError,
  formatTokenCount,
  runManualCompaction,
  canManualCompact,
  sessionArtifacts,
  artifactsByMessage,
  activeArtifact,
  handleScroll,
  messagesContainerRef,
  messagesEndRef,
}: UseChatPageControllerTailArgs): ChatPageViewProps {
  const [listeningMessageId, setListeningMessageId] = useState<string | null>(null);
  const [listeningPending, setListeningPending] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const speakTokenRef = useRef(0);

  const hasSession = Boolean(sessionFromUrl || sessions.currentSessionId);
  const showEmptyState = messages.length === 0 && !isLoading && !streamError;

  const releasePlaybackResources = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    speakTokenRef.current += 1;
    speakAbortRef.current?.abort();
    speakAbortRef.current = null;
    releasePlaybackResources();
    setListeningPending(false);
    setListeningMessageId(null);
  }, [releasePlaybackResources]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  const onListenMessage = useCallback(
    async (messageId: string) => {
      if (listeningMessageId === messageId && (listeningPending || audioRef.current)) {
        stopListening();
        return;
      }

      const message = messages.find((entry) => entry.id === messageId && entry.role === "assistant");
      if (!message) {
        return;
      }

      const { textContent } = deriveMessageContent({ role: message.role, parts: message.parts });
      const input = textContent.trim();
      if (!input) {
        store.pushToast({
          kind: "warning",
          title: "Nothing to speak",
          message: "This assistant message does not contain speakable text.",
          dedupeKey: "tts-empty-message",
        });
        return;
      }

      stopListening();

      const speakToken = speakTokenRef.current + 1;
      speakTokenRef.current = speakToken;
      const abortController = new AbortController();
      speakAbortRef.current = abortController;

      setListeningMessageId(messageId);
      setListeningPending(true);

      try {
        const response = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input,
            response_format: "wav",
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const rawError = await response.text();
          throw parseSpeakFailure(response.status, rawError);
        }

        const audioBlob = await response.blob();
        if (audioBlob.size === 0) {
          throw {
            kind: "error",
            title: "Speech synthesis failed",
            message: "The TTS service returned an empty audio payload.",
          } as SpeakFailure;
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        if (speakTokenRef.current !== speakToken) {
          URL.revokeObjectURL(audioUrl);
          return;
        }

        audioUrlRef.current = audioUrl;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => {
          if (speakTokenRef.current !== speakToken) return;
          releasePlaybackResources();
          setListeningMessageId(null);
          setListeningPending(false);
        };

        audio.onerror = () => {
          if (speakTokenRef.current !== speakToken) return;
          releasePlaybackResources();
          setListeningMessageId(null);
          setListeningPending(false);
          store.pushToast({
            kind: "error",
            title: "Audio playback failed",
            message: "Your browser could not play the generated speech audio.",
            dedupeKey: "tts-playback-error",
          });
        };

        await audio.play();
        if (speakTokenRef.current === speakToken) {
          setListeningPending(false);
        }
      } catch (error) {
        if (abortController.signal.aborted || speakTokenRef.current !== speakToken) {
          return;
        }

        releasePlaybackResources();
        setListeningMessageId(null);
        setListeningPending(false);

        const failure = normalizeSpeakFailure(error);
        store.pushToast({
          kind: failure.kind,
          title: failure.title,
          ...(failure.message ? { message: failure.message } : {}),
          ...(failure.detail ? { detail: failure.detail } : {}),
          dedupeKey: "tts-speak-failure",
        });
      } finally {
        if (speakAbortRef.current === abortController) {
          speakAbortRef.current = null;
        }
      }
    },
    [
      listeningMessageId,
      listeningPending,
      messages,
      releasePlaybackResources,
      stopListening,
      store,
    ],
  );

  const replaceUrlToSession = useCallback(
    (sessionId: string) => {
      router.replace(`/chat?session=${encodeURIComponent(sessionId)}`);
    },
    [router],
  );

  const { onExportJson, onExportMarkdown } = useChatExportActions({
    currentSessionId: sessions.currentSessionId,
    currentSessionTitle: sessions.currentSessionTitle,
    selectedModel: store.selectedModel,
    messages,
  });

  const { handleSend, handleReprompt, handleForkMessage, handleStop } = useChatRunActions({
    store,
    sessions,
    agentFiles,
    isLoading,
    setMessages,
    setStreamError,
    lastUserInputRef,
    replaceUrlToSession,
    generateTitle,
    setLastSessionId: setLastSessionIdStorage,
    activeRunIdRef,
    runAbortControllerRef,
    runCompletedRef,
    lastEventTimeRef,
    sessionIdRef,
    setIsLoading,
    setStreamStalled,
    setExecutingTools: store.setExecutingTools,
    setToolResultsMap: store.setToolResultsMap,
    handleRunEvent,
    router,
  });

  const callModeEnabled = useAppStore((s) => s.callModeEnabled);

  const { toggleCallMode } = useCallMode({
    messages,
    isLoading,
    selectedModel: store.selectedModel,
    onSubmit: handleSend,
  });

  const {
    toolBelt,
    handleSetSidebarTab,
    openActivityPanel,
    openContextPanel,
    handleOpenAgentFile,
    handleSelectAgentFile,
  } = useChatUiActions({
    store,
    sessions,
    agentFiles,
    isLoading,
    thinkingSnippet,
    clearPlan,
    onSubmit: handleSend,
    onStop: handleStop,
    sidebarOpen,
    setSidebarOpen,
    setSidebarTab,
    sessionFromUrl,
    activityPanelVisible,
    thinkingActive,
    executingToolsSize,
    activityGroupsLength: activityGroups.length,
    callModeEnabled,
    onCallModeToggle: toggleCallMode,
  });

  const onReprompt = useCallback(
    async (messageId: string) => {
      await handleReprompt(messageId, messages);
    },
    [handleReprompt, messages],
  );

  const handleCloseArtifactModal = () => {
    store.setActiveArtifactId(null);
  };

  return buildChatPageViewProps({
    store,
    ui: {
      sidebarOpen,
      setSidebarOpen,
      sidebarTab,
      setSidebarTab: handleSetSidebarTab,
      handleScroll,
      messagesContainerRef,
      messagesEndRef,
      toolBelt,
    },
    derived: {
      activityGroups,
      activityCount,
      thinkingActive,
      isLoading,
      streamError,
      streamStalled,
      showEmptyState,
    },
    context: {
      contextStats,
      contextBreakdown,
      contextUsageLabel,
      compactionHistory,
      compacting,
      compactionError,
      formatTokenCount,
      runManualCompaction,
      canManualCompact,
    },
    artifacts: {
      sessionArtifacts,
      artifactsByMessage,
      activeArtifact,
      onCloseArtifactModal: handleCloseArtifactModal,
    },
    agentFiles: {
      agentFiles: agentFiles.agentFiles,
      agentFileVersions: agentFiles.agentFileVersions,
      selectedAgentFilePath: agentFiles.selectedAgentFilePath,
      selectedAgentFileContent: agentFiles.selectedAgentFileContent,
      selectedAgentFileLoading: agentFiles.selectedAgentFileLoading,
      onSelectAgentFile: handleSelectAgentFile,
      onOpenAgentFile: handleOpenAgentFile,
    },
    chat: {
      hasSession,
      messages,
      onForkMessage: handleForkMessage,
      onReprompt,
      onListenMessage,
      listeningMessageId,
      listeningPending,
      openActivityPanel,
      openContextPanel,
    },
    mcp: {
      mcpServers: tools.mcpServers,
      addMcpServer: tools.addMcpServer,
      updateMcpServer: tools.updateMcpServer,
      removeMcpServer: tools.removeMcpServer,
      loadMCPServers: tools.loadMCPServers,
    },
    exportActions: { onExportJson, onExportMarkdown },
  });
}
