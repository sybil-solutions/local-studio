// CRITICAL
import type { StateCreator } from "zustand";

import type {
  ChatSession,
  ToolCall,
  ToolResult,
  MCPServer,
  MCPTool,
  DeepResearchConfig,
  SessionUsage,
  AgentFileEntry,
  AgentFileVersion,
} from "@/lib/types";
import type { ModelOption, Attachment } from "@/app/chat/types";
import type { AgentPlan } from "@/app/chat/_components/agent/agent-types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  isStreaming?: boolean;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  request_prompt_tokens?: number | null;
  request_tools_tokens?: number | null;
  request_total_input_tokens?: number | null;
  request_completion_tokens?: number | null;
  estimated_cost_usd?: number | null;
}

export interface ChatState {
  // Sessions
  sessions: ChatSession[];
  currentSessionId: string | null;
  currentSessionTitle: string;
  sessionsLoading: boolean;

  // Messages & input
  input: string;
  error: string | null;

  // Streaming
  streamingStartTime: number | null;
  elapsedSeconds: number;
  queuedContext: string;

  // Model
  selectedModel: string;
  availableModels: ModelOption[];

  // Layout
  isMobile: boolean;
  userScrolledUp: boolean;

  // MCP & tools
  mcpEnabled: boolean;
  artifactsEnabled: boolean;
  mcpServers: MCPServer[];
  mcpSettingsOpen: boolean;
  mcpTools: MCPTool[];
  executingTools: Set<string>;
  toolResultsMap: Map<string, ToolResult>;

  // Settings
  systemPrompt: string;
  chatSettingsOpen: boolean;
  deepResearch: DeepResearchConfig;

  // Usage & export
  sessionUsage: SessionUsage | null;
  usageDetailsOpen: boolean;
  exportOpen: boolean;

  // Attachments & recording
  attachments: Attachment[];
  isRecording: boolean;
  isTranscribing: boolean;
  transcriptionError: string | null;
  recordingDuration: number;
  isTTSEnabled: boolean;

  // MCP action state
  mcpPendingServer: string | null;
  mcpActionError: string | null;

  // Message UI state
  copiedMessageId: string | null;
  messageInlineThinkingExpanded: Record<string, boolean>;
  messageInlineToolsExpanded: Record<string, boolean>;

  // Artifacts
  activeArtifactId: string | null;
  artifactViewerState: Record<
    string,
    {
      isFullscreen: boolean;
      showCode: boolean;
      copied: boolean;
      scale: number;
      position: { x: number; y: number };
      isDragging: boolean;
      isRunning: boolean;
      error: string | null;
    }
  >;

  // Code blocks & sandboxes
  codeBlockState: Record<string, { copied: boolean; isExpanded: boolean }>;
  mermaidState: Record<string, { svg: string; error: string | null }>;

  // Splash
  splashIsMobile: boolean;

  // Agent mode
  agentMode: boolean;
  agentPlan: AgentPlan | null;
  agentFiles: AgentFileEntry[];
  agentFilesLoading: boolean;
  selectedAgentFilePath: string | null;
  selectedAgentFileContent: string | null;
  selectedAgentFileLoading: boolean;
  agentFileVersions: Record<string, AgentFileVersion[]>;
  sidebarWidth: number;
}

export interface ChatActions {
  // Sessions
  setSessions: (sessions: ChatSession[]) => void;
  updateSessions: (updater: (sessions: ChatSession[]) => ChatSession[]) => void;
  setCurrentSessionId: (currentSessionId: string | null) => void;
  setCurrentSessionTitle: (currentSessionTitle: string) => void;
  setSessionsLoading: (sessionsLoading: boolean) => void;

  // Input
  setInput: (input: string) => void;
  setError: (error: string | null) => void;

  // Streaming
  setStreamingStartTime: (streamingStartTime: number | null) => void;
  setElapsedSeconds: (elapsedSeconds: number) => void;
  setQueuedContext: (queuedContext: string) => void;

  // Model
  setSelectedModel: (selectedModel: string) => void;
  setAvailableModels: (availableModels: ModelOption[]) => void;

  // Layout
  setIsMobile: (isMobile: boolean) => void;
  setUserScrolledUp: (userScrolledUp: boolean) => void;

  // MCP & tools
  setMcpEnabled: (mcpEnabled: boolean) => void;
  setArtifactsEnabled: (artifactsEnabled: boolean) => void;
  setActiveArtifactId: (artifactId: string | null) => void;
  setMcpServers: (mcpServers: MCPServer[]) => void;
  setMcpSettingsOpen: (mcpSettingsOpen: boolean) => void;
  setMcpTools: (mcpTools: MCPTool[]) => void;
  setExecutingTools: (executingTools: Set<string>) => void;
  updateExecutingTools: (updater: (executingTools: Set<string>) => Set<string>) => void;
  setToolResultsMap: (toolResultsMap: Map<string, ToolResult>) => void;
  updateToolResultsMap: (
    updater: (toolResultsMap: Map<string, ToolResult>) => Map<string, ToolResult>,
  ) => void;

  // Settings
  setSystemPrompt: (systemPrompt: string) => void;
  setChatSettingsOpen: (chatSettingsOpen: boolean) => void;
  setDeepResearch: (deepResearch: DeepResearchConfig) => void;

  // Usage & export
  setSessionUsage: (sessionUsage: SessionUsage | null) => void;
  setUsageDetailsOpen: (usageDetailsOpen: boolean) => void;
  setExportOpen: (exportOpen: boolean) => void;

  // Attachments & recording
  setAttachments: (attachments: Attachment[]) => void;
  updateAttachments: (updater: (attachments: Attachment[]) => Attachment[]) => void;
  setIsRecording: (isRecording: boolean) => void;
  setIsTranscribing: (isTranscribing: boolean) => void;
  setTranscriptionError: (transcriptionError: string | null) => void;
  setRecordingDuration: (recordingDuration: number) => void;
  setIsTTSEnabled: (isTTSEnabled: boolean) => void;

  // MCP action state
  setMcpPendingServer: (mcpPendingServer: string | null) => void;
  setMcpActionError: (mcpActionError: string | null) => void;

  // Message UI state
  setCopiedMessageId: (copiedMessageId: string | null) => void;
  setMessageInlineThinkingExpanded: (messageId: string, expanded: boolean) => void;
  setMessageInlineToolsExpanded: (messageId: string, expanded: boolean) => void;

  // Artifacts
  updateArtifactViewerState: (
    artifactId: string,
    updater: (prev: {
      isFullscreen: boolean;
      showCode: boolean;
      copied: boolean;
      scale: number;
      position: { x: number; y: number };
      isDragging: boolean;
      isRunning: boolean;
      error: string | null;
    }) => {
      isFullscreen: boolean;
      showCode: boolean;
      copied: boolean;
      scale: number;
      position: { x: number; y: number };
      isDragging: boolean;
      isRunning: boolean;
      error: string | null;
    },
  ) => void;

  // Code blocks & sandboxes
  updateCodeBlockState: (
    blockId: string,
    updater: (prev: { copied: boolean; isExpanded: boolean }) => {
      copied: boolean;
      isExpanded: boolean;
    },
  ) => void;
  setMermaidState: (id: string, svg: string, error: string | null) => void;

  // Splash
  setSplashIsMobile: (splashIsMobile: boolean) => void;

  // Agent mode
  setAgentMode: (enabled: boolean) => void;
  setAgentPlan: (plan: AgentPlan | null) => void;
  setAgentFiles: (files: AgentFileEntry[]) => void;
  setAgentFilesLoading: (loading: boolean) => void;
  setSelectedAgentFilePath: (path: string | null) => void;
  setSelectedAgentFileContent: (content: string | null) => void;
  setSelectedAgentFileLoading: (loading: boolean) => void;
  addAgentFileVersion: (path: string, content: string) => void;
  moveAgentFileVersions: (from: string, to: string) => void;
  clearAgentFileVersions: () => void;
  setSidebarWidth: (width: number) => void;
}

export type ChatSlice = ChatState & ChatActions;

const DEFAULT_DEEP_RESEARCH: DeepResearchConfig = {
  enabled: false,
  maxSources: 10,
  searchDepth: "medium",
  autoSummarize: true,
  includeCitations: true,
};

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set) => ({
  // Sessions
  sessions: [],
  currentSessionId: null,
  currentSessionTitle: "New Chat",
  sessionsLoading: true,

  // Input
  input: "",
  error: null,

  // Streaming
  streamingStartTime: null,
  elapsedSeconds: 0,
  queuedContext: "",

  // Model
  selectedModel: "",
  availableModels: [],

  // Layout
  isMobile: false,
  userScrolledUp: false,

  // MCP & tools
  mcpEnabled: false,
  artifactsEnabled: false,
  mcpServers: [],
  mcpSettingsOpen: false,
  mcpTools: [],
  executingTools: new Set(),
  toolResultsMap: new Map(),

  // Settings
  systemPrompt: "",
  chatSettingsOpen: false,
  deepResearch: DEFAULT_DEEP_RESEARCH,

  // Usage & export
  sessionUsage: null,
  usageDetailsOpen: false,
  exportOpen: false,

  // Attachments & recording
  attachments: [],
  isRecording: false,
  isTranscribing: false,
  transcriptionError: null,
  recordingDuration: 0,
  isTTSEnabled: false,

  // MCP action state
  mcpPendingServer: null,
  mcpActionError: null,

  // Message UI state
  copiedMessageId: null,
  messageInlineThinkingExpanded: {},
  messageInlineToolsExpanded: {},

  // Artifacts
  activeArtifactId: null,
  artifactViewerState: {},

  // Code blocks & sandboxes
  codeBlockState: {},
  mermaidState: {},

  // Splash
  splashIsMobile: false,

  // Agent mode
  agentMode: false,
  agentPlan: null,
  agentFiles: [],
  agentFilesLoading: false,
  selectedAgentFilePath: null,
  selectedAgentFileContent: null,
  selectedAgentFileLoading: false,
  agentFileVersions: {},
  sidebarWidth: 400,

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
  setQueuedContext: (queuedContext) => set({ queuedContext }),

  // Model
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setAvailableModels: (availableModels) => set({ availableModels }),

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
  setExecutingTools: (executingTools) => set({ executingTools }),
  updateExecutingTools: (updater) =>
    set((state) => ({ executingTools: updater(state.executingTools) })),
  setToolResultsMap: (toolResultsMap) => set({ toolResultsMap }),
  updateToolResultsMap: (updater) =>
    set((state) => ({ toolResultsMap: updater(state.toolResultsMap) })),

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

  // MCP action state
  setMcpPendingServer: (mcpPendingServer) => set({ mcpPendingServer }),
  setMcpActionError: (mcpActionError) => set({ mcpActionError }),

  // Message UI state
  setCopiedMessageId: (copiedMessageId) => set({ copiedMessageId }),
  setMessageInlineThinkingExpanded: (messageId, expanded) =>
    set((state) => ({
      messageInlineThinkingExpanded: {
        ...state.messageInlineThinkingExpanded,
        [messageId]: expanded,
      },
    })),
  setMessageInlineToolsExpanded: (messageId, expanded) =>
    set((state) => ({
      messageInlineToolsExpanded: {
        ...state.messageInlineToolsExpanded,
        [messageId]: expanded,
      },
    })),

  // Artifacts
  updateArtifactViewerState: (artifactId, updater) =>
    set((state) => {
      const prev = state.artifactViewerState[artifactId] ?? {
        isFullscreen: false,
        showCode: false,
        copied: false,
        scale: 1,
        position: { x: 0, y: 0 },
        isDragging: false,
        isRunning: true,
        error: null,
      };
      return {
        artifactViewerState: {
          ...state.artifactViewerState,
          [artifactId]: updater(prev),
        },
      };
    }),

  // Code blocks & sandboxes
  updateCodeBlockState: (blockId, updater) =>
    set((state) => {
      const prev = state.codeBlockState[blockId] ?? {
        copied: false,
        isExpanded: false,
      };
      return {
        codeBlockState: {
          ...state.codeBlockState,
          [blockId]: updater(prev),
        },
      };
    }),
  setMermaidState: (id, svg, error) =>
    set((state) => ({
      mermaidState: {
        ...state.mermaidState,
        [id]: { svg, error },
      },
    })),

  // Splash
  setSplashIsMobile: (splashIsMobile) => set({ splashIsMobile }),

  // Agent mode
  setAgentMode: (enabled) => set({ agentMode: enabled }),
  setAgentPlan: (plan) => set({ agentPlan: plan }),
  setAgentFiles: (files) => set({ agentFiles: files }),
  setAgentFilesLoading: (loading) => set({ agentFilesLoading: loading }),
  setSelectedAgentFilePath: (path) => set({ selectedAgentFilePath: path }),
  setSelectedAgentFileContent: (content) => set({ selectedAgentFileContent: content }),
  setSelectedAgentFileLoading: (loading) => set({ selectedAgentFileLoading: loading }),
  addAgentFileVersion: (path, content) =>
    set((state) => {
      const existing = state.agentFileVersions[path] ?? [];
      const last = existing[existing.length - 1];
      if (last?.content === content) return state;
      const nextVersion = (last?.version ?? 0) + 1;
      const nextEntry: AgentFileVersion = {
        version: nextVersion,
        content,
        timestamp: Date.now(),
      };
      return {
        agentFileVersions: {
          ...state.agentFileVersions,
          [path]: [...existing, nextEntry],
        },
      };
    }),
  moveAgentFileVersions: (from, to) =>
    set((state) => {
      if (from === to) return state;
      const existing = state.agentFileVersions[from];
      if (!existing) return state;
      const next = { ...state.agentFileVersions };
      delete next[from];
      next[to] = existing;
      return { agentFileVersions: next };
    }),
  clearAgentFileVersions: () => set({ agentFileVersions: {} }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
});
