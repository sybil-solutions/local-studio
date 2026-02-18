// CRITICAL
import type { StateCreator } from "zustand";

import type { ChatSlice } from "./chat-slice-types";
import { initialChatState } from "./chat-slice/initial-chat-state";
import { createAgentActions } from "./chat-slice/agent-actions";
import { createToastActions } from "./chat-slice/toast-actions";
import { createArtifactActions } from "./chat-slice/artifact-actions";

export type { ChatSlice } from "./chat-slice-types";

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set) => ({
  ...initialChatState,

  // --- Actions ---

  // Sessions
  setSessions: (sessions) => set({ sessions }),
  updateSessions: (updater) => set((state) => ({ sessions: updater(state.sessions) })),
  setCurrentSessionId: (currentSessionId) => set({ currentSessionId }),
  setCurrentSessionTitle: (currentSessionTitle) => set({ currentSessionTitle }),
  setSessionsLoading: (sessionsLoading) => set({ sessionsLoading }),

  // Input
  setInput: (input) => set({ input }),
  setError: (error) => set({ error }),

  // Streaming
  setStreamingStartTime: (streamingStartTime) => set({ streamingStartTime }),
  setElapsedSeconds: (elapsedSeconds) => set({ elapsedSeconds }),
  setLastRunDurationSeconds: (seconds) => set({ lastRunDurationSeconds: seconds }),
  setRunDurationForRunId: (runId, seconds) =>
    set((state) => {
      if (!runId) return state;
      const prev = state.runDurationsByRunId[runId];
      if (prev === seconds) return state;

      // Prevent unbounded growth.
      const keys = Object.keys(state.runDurationsByRunId);
      let next = state.runDurationsByRunId;
      if (keys.length > 80 && !(runId in next)) {
        // Drop oldest-ish by insertion order (object order) best-effort.
        const keep = new Set(keys.slice(-60));
        keep.add(runId);
        const trimmed: Record<string, number> = {};
        for (const k of keys) {
          if (keep.has(k)) trimmed[k] = next[k]!;
        }
        next = trimmed;
      }

      return { runDurationsByRunId: { ...next, [runId]: seconds } };
    }),
  setQueuedContext: (queuedContext) => set({ queuedContext }),

  // Model
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setAvailableModels: (availableModels) => set({ availableModels }),
  setCustomChatModels: (customChatModels) =>
    set((state) => {
      const next = Array.isArray(customChatModels) ? customChatModels : [];
      if (state.customChatModels.length === next.length && state.customChatModels.every((model, index) => model === next[index])) {
        return state;
      }
      return { customChatModels: next };
    }),
  addCustomChatModel: (modelId) => {
    const normalized = String(modelId).trim();
    if (!normalized) return;
    set((state) => {
      if (state.customChatModels.includes(normalized)) {
        return state;
      }
      return { customChatModels: [...state.customChatModels, normalized] };
    });
  },
  removeCustomChatModel: (modelId) => {
    const normalized = String(modelId).trim();
    if (!normalized) return;
    set((state) => {
      const next = state.customChatModels.filter((model) => model !== normalized);
      if (next.length === state.customChatModels.length) return state;
      return { customChatModels: next };
    });
  },

  // Layout
  setIsMobile: (isMobile) => set({ isMobile }),
  setUserScrolledUp: (userScrolledUp) => set({ userScrolledUp }),

  // MCP & tools
  setMcpEnabled: (mcpEnabled) => set({ mcpEnabled }),
  setArtifactsEnabled: (artifactsEnabled) => set({ artifactsEnabled }),
  setActiveArtifactId: (activeArtifactId) => set({ activeArtifactId }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setMcpSettingsOpen: (mcpSettingsOpen) => set({ mcpSettingsOpen }),
  setMcpTools: (mcpTools) => set({ mcpTools }),
  setExecutingTools: (executingTools) =>
    set((state) => {
      if (state.executingTools === executingTools) return state;
      if (state.executingTools.size === 0 && executingTools.size === 0) return state;
      return { executingTools };
    }),
  updateExecutingTools: (updater) =>
    set((state) => {
      const next = updater(state.executingTools);
      if (next === state.executingTools) return state;
      if (state.executingTools.size === 0 && next.size === 0) return state;
      return { executingTools: next };
    }),
  setToolResultsMap: (toolResultsMap) =>
    set((state) => {
      if (state.toolResultsMap === toolResultsMap) return state;
      if (state.toolResultsMap.size === 0 && toolResultsMap.size === 0) return state;
      return { toolResultsMap };
    }),
  updateToolResultsMap: (updater) =>
    set((state) => {
      const next = updater(state.toolResultsMap);
      if (next === state.toolResultsMap) return state;
      if (state.toolResultsMap.size === 0 && next.size === 0) return state;
      return { toolResultsMap: next };
    }),

  // Settings
  setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
  setChatSettingsOpen: (chatSettingsOpen) => set({ chatSettingsOpen }),
  setDeepResearch: (deepResearch) => set({ deepResearch }),

  // Usage & export
  setSessionUsage: (sessionUsage) => set({ sessionUsage }),
  setUsageDetailsOpen: (usageDetailsOpen) => set({ usageDetailsOpen }),
  setExportOpen: (exportOpen) => set({ exportOpen }),

  // Attachments & recording
  setAttachments: (attachments) => set({ attachments }),
  updateAttachments: (updater) =>
    set((state) => ({ attachments: updater(state.attachments) })),
  setIsRecording: (isRecording) => set({ isRecording }),
  setIsTranscribing: (isTranscribing) => set({ isTranscribing }),
  setTranscriptionError: (transcriptionError) => set({ transcriptionError }),
  setRecordingDuration: (recordingDuration) => set({ recordingDuration }),
  setIsTTSEnabled: (isTTSEnabled) => set({ isTTSEnabled }),

  setCallModeEnabled: (callModeEnabled) => set({ callModeEnabled }),
  setCallModeSpeakingMessageId: (callModeSpeakingMessageId) => set({ callModeSpeakingMessageId }),

  // MCP action state
  setMcpPendingServer: (mcpPendingServer) => set({ mcpPendingServer }),
  setMcpActionError: (mcpActionError) => set({ mcpActionError }),

  // Message UI state
  setCopiedMessageId: (copiedMessageId) =>
    set((state) => (state.copiedMessageId === copiedMessageId ? state : { copiedMessageId })),
  setMessageInlineThinkingExpanded: (messageId, expanded) =>
    set((state) => {
      const prev = state.messageInlineThinkingExpanded[messageId] ?? false;
      if (prev === expanded) return state;
      return {
        messageInlineThinkingExpanded: {
          ...state.messageInlineThinkingExpanded,
          [messageId]: expanded,
        },
      };
    }),
  setMessageInlineToolsExpanded: (messageId, expanded) =>
    set((state) => {
      const prev = state.messageInlineToolsExpanded[messageId] ?? false;
      if (prev === expanded) return state;
      return {
        messageInlineToolsExpanded: {
          ...state.messageInlineToolsExpanded,
          [messageId]: expanded,
        },
      };
    }),
  setToolCallGroupExpanded: (groupId, expanded) =>
    set((state) => {
      const prev = state.toolCallGroupsExpanded[groupId] ?? false;
      if (prev === expanded) return state;
      return {
        toolCallGroupsExpanded: {
          ...state.toolCallGroupsExpanded,
          [groupId]: expanded,
        },
      };
    }),

  // Splash
  setSplashIsMobile: (splashIsMobile) =>
    set((state) => (state.splashIsMobile === splashIsMobile ? state : { splashIsMobile })),

  ...createArtifactActions(set),
  ...createAgentActions(set),
  ...createToastActions(set),
});
