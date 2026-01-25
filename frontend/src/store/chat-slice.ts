// CRITICAL
import type { StateCreator } from "zustand";

interface Reaction {
  type: "up" | "down";
  count: number;
}

import type {
  ChatSession,
  ToolCall,
  ToolResult,
  MCPServer,
  MCPTool,
  DeepResearchConfig,
  SessionUsage,
  ActivePanel,
} from "@/lib/types";
import type { ModelOption, Attachment } from "@/app/chat/types";

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

export interface ResearchSource {
  title: string;
  url: string;
  snippet?: string;
  status: "pending" | "fetching" | "done" | "error";
  relevance?: number;
}

export interface ResearchProgress {
  stage: "searching" | "analyzing" | "synthesizing" | "done" | "error";
  message: string;
  sources: ResearchSource[];
  totalSteps: number;
  currentStep: number;
  searchQueries?: string[];
  error?: string;
}

export interface LegacyDeepResearchSettings {
  enabled: boolean;
  numSources: number;
  autoSummarize: boolean;
  includeCitations: boolean;
  searchDepth: "quick" | "normal" | "thorough";
}

export interface LegacyRagSettings {
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  topK: number;
  minScore: number;
  includeMetadata: boolean;
  contextPosition: "before" | "after" | "system";
  useProxy: boolean;
}

export interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  currentSessionTitle: string;
  sessionsLoading: boolean;
  sessionsAvailable: boolean;

  messages: ChatMessage[];
  input: string;
  isLoading: boolean;
  error: string | null;

  streamingStartTime: number | null;
  elapsedSeconds: number;
  queuedContext: string;

  runningModel: string | null;
  modelName: string;
  selectedModel: string;
  availableModels: ModelOption[];
  pageLoading: boolean;

  copiedIndex: number | null;
  sidebarCollapsed: boolean;
  isMobile: boolean;
  toolPanelOpen: boolean;
  activePanel: ActivePanel;
  historyDropdownOpen: boolean;

  mcpEnabled: boolean;
  artifactsEnabled: boolean;
  mcpServers: MCPServer[];
  mcpSettingsOpen: boolean;
  mcpTools: MCPTool[];
  executingTools: Set<string>;
  toolResultsMap: Map<string, ToolResult>;

  systemPrompt: string;
  chatSettingsOpen: boolean;

  deepResearch: DeepResearchConfig;
  researchProgress: ResearchProgress | null;
  researchSources: ResearchSource[];

  sessionUsage: SessionUsage | null;
  usageDetailsOpen: boolean;
  exportOpen: boolean;

  messageSearchOpen: boolean;
  bookmarkedMessages: Set<string>;
  editingTitle: boolean;
  titleDraft: string;
  userScrolledUp: boolean;

  recentChatsOpen: boolean;
  chatSearchQuery: string;
  toolDropdownOpen: Record<string, boolean>;

  attachments: Attachment[];
  isRecording: boolean;
  isTranscribing: boolean;
  transcriptionError: string | null;
  recordingDuration: number;
  isTTSEnabled: boolean;

  mcpPendingServer: string | null;
  mcpActionError: string | null;

  copiedMessageId: string | null;
  messageInlineThinkingExpanded: Record<string, boolean>;
  messageInlineToolsExpanded: Record<string, boolean>;

  artifactPanelSelectedId: string | null;
  artifactRendererState: Record<
    string,
    { isFullscreen: boolean; showCode: boolean; copied: boolean; showPreview?: boolean }
  >;
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

  codeBlockState: Record<string, { copied: boolean; isExpanded: boolean; showPreview: boolean }>;
  codeSandboxState: Record<
    string,
    { isRunning: boolean; isFullscreen: boolean; copied: boolean; error: string | null }
  >;

  mermaidState: Record<string, { svg: string; error: string | null }>;

  splashIsMobile: boolean;

  themeMode: "light" | "dark" | "system";
  resolvedTheme: "light" | "dark";
  themeMenuOpen: boolean;

  legacyMessageSearch: {
    query: string;
    filterType: "all" | "user" | "assistant" | "bookmarked" | "hasCode";
    isFilterOpen: boolean;
    selectedIndex: number;
  };

  legacyToolCallCardState: Record<
    string,
    { isExpanded: boolean; showModal: boolean; modalCopied: boolean }
  >;

  legacyThinkingExpanded: Record<string, boolean>;

  legacyMessageActions: Record<
    string,
    { copied: boolean; bookmarked: boolean; reaction: Reaction | null; showMenu: boolean }
  >;

  legacyContextIndicator: {
    showDetails: boolean;
    showHistory: boolean;
    showSettings: boolean;
  };

  legacyChatSidebar: {
    hoveredId: string | null;
    searchQuery: string;
    visibleCount: number;
  };

  legacyToolBelt: {
    attachments: Attachment[];
    isRecording: boolean;
    isTranscribing: boolean;
    transcriptionError: string | null;
    isTTSEnabled: boolean;
    recordingDuration: number;
  };

  legacyMcpSettings: {
    localServers: MCPServer[];
    isAdding: boolean;
    newServer: { name: string; command: string; args: string; envKey: string; envValue: string };
    envPairs: Array<{ key: string; value: string }>;
    error: string | null;
    saving: boolean;
  };

  legacyChatSettings: {
    localPrompt: string;
    forkSelection: Record<string, boolean>;
    localDeepResearch: LegacyDeepResearchSettings;
    localRagSettings: LegacyRagSettings;
    ragTestStatus: "idle" | "testing" | "success" | "error";
    ragTestResult: string | null;
  };
}

export interface ChatActions {
  setSessions: (sessions: ChatSession[]) => void;
  updateSessions: (updater: (sessions: ChatSession[]) => ChatSession[]) => void;
  setCurrentSessionId: (currentSessionId: string | null) => void;
  setCurrentSessionTitle: (currentSessionTitle: string) => void;
  setSessionsLoading: (sessionsLoading: boolean) => void;
  setSessionsAvailable: (sessionsAvailable: boolean) => void;

  setMessages: (messages: ChatMessage[]) => void;
  updateMessages: (updater: (messages: ChatMessage[]) => ChatMessage[]) => void;

  setInput: (input: string) => void;
  setIsLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;

  setStreamingStartTime: (streamingStartTime: number | null) => void;
  setElapsedSeconds: (elapsedSeconds: number) => void;
  setQueuedContext: (queuedContext: string) => void;

  setRunningModel: (runningModel: string | null) => void;
  setModelName: (modelName: string) => void;
  setSelectedModel: (selectedModel: string) => void;
  setAvailableModels: (availableModels: ModelOption[]) => void;
  setPageLoading: (pageLoading: boolean) => void;

  setCopiedIndex: (copiedIndex: number | null) => void;
  setSidebarCollapsed: (sidebarCollapsed: boolean) => void;
  setIsMobile: (isMobile: boolean) => void;
  setToolPanelOpen: (toolPanelOpen: boolean) => void;
  setActivePanel: (activePanel: ActivePanel) => void;
  setHistoryDropdownOpen: (historyDropdownOpen: boolean) => void;

  setMcpEnabled: (mcpEnabled: boolean) => void;
  setArtifactsEnabled: (artifactsEnabled: boolean) => void;
  setMcpServers: (mcpServers: MCPServer[]) => void;
  setMcpSettingsOpen: (mcpSettingsOpen: boolean) => void;
  setMcpTools: (mcpTools: MCPTool[]) => void;
  setExecutingTools: (executingTools: Set<string>) => void;
  updateExecutingTools: (updater: (executingTools: Set<string>) => Set<string>) => void;
  setToolResultsMap: (toolResultsMap: Map<string, ToolResult>) => void;
  updateToolResultsMap: (
    updater: (toolResultsMap: Map<string, ToolResult>) => Map<string, ToolResult>,
  ) => void;

  setSystemPrompt: (systemPrompt: string) => void;
  setChatSettingsOpen: (chatSettingsOpen: boolean) => void;

  setDeepResearch: (deepResearch: DeepResearchConfig) => void;
  setResearchProgress: (researchProgress: ResearchProgress | null) => void;
  setResearchSources: (researchSources: ResearchSource[]) => void;

  setSessionUsage: (sessionUsage: SessionUsage | null) => void;
  setUsageDetailsOpen: (usageDetailsOpen: boolean) => void;
  setExportOpen: (exportOpen: boolean) => void;

  setMessageSearchOpen: (messageSearchOpen: boolean) => void;
  setBookmarkedMessages: (bookmarkedMessages: Set<string>) => void;
  updateBookmarkedMessages: (updater: (bookmarkedMessages: Set<string>) => Set<string>) => void;
  setEditingTitle: (editingTitle: boolean) => void;
  setTitleDraft: (titleDraft: string) => void;
  setUserScrolledUp: (userScrolledUp: boolean) => void;

  setRecentChatsOpen: (recentChatsOpen: boolean) => void;
  setChatSearchQuery: (chatSearchQuery: string) => void;
  setToolDropdownOpen: (key: string, open: boolean) => void;

  setAttachments: (attachments: Attachment[]) => void;
  updateAttachments: (updater: (attachments: Attachment[]) => Attachment[]) => void;
  setIsRecording: (isRecording: boolean) => void;
  setIsTranscribing: (isTranscribing: boolean) => void;
  setTranscriptionError: (transcriptionError: string | null) => void;
  setRecordingDuration: (recordingDuration: number) => void;
  setIsTTSEnabled: (isTTSEnabled: boolean) => void;

  setMcpPendingServer: (mcpPendingServer: string | null) => void;
  setMcpActionError: (mcpActionError: string | null) => void;

  setCopiedMessageId: (copiedMessageId: string | null) => void;
  setMessageInlineThinkingExpanded: (messageId: string, expanded: boolean) => void;
  setMessageInlineToolsExpanded: (messageId: string, expanded: boolean) => void;

  setArtifactPanelSelectedId: (artifactId: string | null) => void;
  updateArtifactRendererState: (
    artifactId: string,
    updater: (prev: {
      isFullscreen: boolean;
      showCode: boolean;
      copied: boolean;
      showPreview?: boolean;
    }) => {
      isFullscreen: boolean;
      showCode: boolean;
      copied: boolean;
      showPreview?: boolean;
    },
  ) => void;
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

  updateCodeBlockState: (
    blockId: string,
    updater: (prev: { copied: boolean; isExpanded: boolean; showPreview: boolean }) => {
      copied: boolean;
      isExpanded: boolean;
      showPreview: boolean;
    },
  ) => void;
  updateCodeSandboxState: (
    sandboxId: string,
    updater: (prev: {
      isRunning: boolean;
      isFullscreen: boolean;
      copied: boolean;
      error: string | null;
    }) => {
      isRunning: boolean;
      isFullscreen: boolean;
      copied: boolean;
      error: string | null;
    },
  ) => void;

  setMermaidState: (id: string, svg: string, error: string | null) => void;

  setSplashIsMobile: (splashIsMobile: boolean) => void;

  setThemeMode: (themeMode: "light" | "dark" | "system") => void;
  setResolvedTheme: (resolvedTheme: "light" | "dark") => void;
  setThemeMenuOpen: (themeMenuOpen: boolean) => void;

  setLegacyMessageSearch: (updates: Partial<ChatState["legacyMessageSearch"]>) => void;
  setLegacyToolCallCardState: (
    toolCallId: string,
    updates: Partial<ChatState["legacyToolCallCardState"][string]>,
  ) => void;
  setLegacyThinkingExpanded: (key: string, expanded: boolean) => void;
  setLegacyMessageActions: (
    messageId: string,
    updates: Partial<ChatState["legacyMessageActions"][string]>,
  ) => void;
  setLegacyContextIndicator: (updates: Partial<ChatState["legacyContextIndicator"]>) => void;
  setLegacyChatSidebar: (updates: Partial<ChatState["legacyChatSidebar"]>) => void;
  setLegacyToolBelt: (updates: Partial<ChatState["legacyToolBelt"]>) => void;
  setLegacyMcpSettings: (updates: Partial<ChatState["legacyMcpSettings"]>) => void;
  setLegacyChatSettings: (updates: Partial<ChatState["legacyChatSettings"]>) => void;
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
  sessions: [],
  currentSessionId: null,
  currentSessionTitle: "New Chat",
  sessionsLoading: true,
  sessionsAvailable: true,

  messages: [],
  input: "",
  isLoading: false,
  error: null,

  streamingStartTime: null,
  elapsedSeconds: 0,
  queuedContext: "",

  runningModel: null,
  modelName: "",
  selectedModel: "",
  availableModels: [],
  pageLoading: true,

  copiedIndex: null,
  sidebarCollapsed: false,
  isMobile: false,
  toolPanelOpen: false,
  activePanel: "activity",
  historyDropdownOpen: false,

  mcpEnabled: false,
  artifactsEnabled: false,
  mcpServers: [],
  mcpSettingsOpen: false,
  mcpTools: [],
  executingTools: new Set(),
  toolResultsMap: new Map(),

  systemPrompt: "",
  chatSettingsOpen: false,

  deepResearch: DEFAULT_DEEP_RESEARCH,
  researchProgress: null,
  researchSources: [],

  sessionUsage: null,
  usageDetailsOpen: false,
  exportOpen: false,

  messageSearchOpen: false,
  bookmarkedMessages: new Set(),
  editingTitle: false,
  titleDraft: "",
  userScrolledUp: false,

  recentChatsOpen: false,
  chatSearchQuery: "",
  toolDropdownOpen: {},

  attachments: [],
  isRecording: false,
  isTranscribing: false,
  transcriptionError: null,
  recordingDuration: 0,
  isTTSEnabled: false,

  mcpPendingServer: null,
  mcpActionError: null,

  copiedMessageId: null,
  messageInlineThinkingExpanded: {},
  messageInlineToolsExpanded: {},

  artifactPanelSelectedId: null,
  artifactRendererState: {},
  artifactViewerState: {},

  codeBlockState: {},
  codeSandboxState: {},

  mermaidState: {},

  splashIsMobile: false,

  themeMode: "dark",
  resolvedTheme: "dark",
  themeMenuOpen: false,

  legacyMessageSearch: {
    query: "",
    filterType: "all",
    isFilterOpen: false,
    selectedIndex: 0,
  },

  legacyToolCallCardState: {},

  legacyThinkingExpanded: {},

  legacyMessageActions: {},

  legacyContextIndicator: {
    showDetails: false,
    showHistory: false,
    showSettings: false,
  },

  legacyChatSidebar: {
    hoveredId: null,
    searchQuery: "",
    visibleCount: 15,
  },

  legacyToolBelt: {
    attachments: [],
    isRecording: false,
    isTranscribing: false,
    transcriptionError: null,
    isTTSEnabled: false,
    recordingDuration: 0,
  },

  legacyMcpSettings: {
    localServers: [],
    isAdding: false,
    newServer: { name: "", command: "", args: "", envKey: "", envValue: "" },
    envPairs: [],
    error: null,
    saving: false,
  },

  legacyChatSettings: {
    localPrompt: "",
    forkSelection: {},
    localDeepResearch: {
      enabled: false,
      numSources: 5,
      autoSummarize: true,
      includeCitations: true,
      searchDepth: "normal",
    },
    localRagSettings: {
      enabled: false,
      endpoint: "http://localhost:3002",
      topK: 5,
      minScore: 0.0,
      includeMetadata: true,
      contextPosition: "system",
      useProxy: true,
    },
    ragTestStatus: "idle",
    ragTestResult: null,
  },

  setSessions: (sessions) => set({ sessions }),
  updateSessions: (updater) => set((state) => ({ sessions: updater(state.sessions) })),
  setCurrentSessionId: (currentSessionId) => set({ currentSessionId }),
  setCurrentSessionTitle: (currentSessionTitle) => set({ currentSessionTitle }),
  setSessionsLoading: (sessionsLoading) => set({ sessionsLoading }),
  setSessionsAvailable: (sessionsAvailable) => set({ sessionsAvailable }),

  setMessages: (messages) => set({ messages }),
  updateMessages: (updater) => set((state) => ({ messages: updater(state.messages) })),

  setInput: (input) => set({ input }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  setStreamingStartTime: (streamingStartTime) => set({ streamingStartTime }),
  setElapsedSeconds: (elapsedSeconds) => set({ elapsedSeconds }),
  setQueuedContext: (queuedContext) => set({ queuedContext }),

  setRunningModel: (runningModel) => set({ runningModel }),
  setModelName: (modelName) => set({ modelName }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setAvailableModels: (availableModels) => set({ availableModels }),
  setPageLoading: (pageLoading) => set({ pageLoading }),

  setCopiedIndex: (copiedIndex) => set({ copiedIndex }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setIsMobile: (isMobile) => set({ isMobile }),
  setToolPanelOpen: (toolPanelOpen) => set({ toolPanelOpen }),
  setActivePanel: (activePanel) => set({ activePanel }),
  setHistoryDropdownOpen: (historyDropdownOpen) => set({ historyDropdownOpen }),

  setMcpEnabled: (mcpEnabled) => set({ mcpEnabled }),
  setArtifactsEnabled: (artifactsEnabled) => set({ artifactsEnabled }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setMcpSettingsOpen: (mcpSettingsOpen) => set({ mcpSettingsOpen }),
  setMcpTools: (mcpTools) => set({ mcpTools }),
  setExecutingTools: (executingTools) => set({ executingTools }),
  updateExecutingTools: (updater) =>
    set((state) => ({ executingTools: updater(state.executingTools) })),
  setToolResultsMap: (toolResultsMap) => set({ toolResultsMap }),
  updateToolResultsMap: (updater) =>
    set((state) => ({ toolResultsMap: updater(state.toolResultsMap) })),

  setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
  setChatSettingsOpen: (chatSettingsOpen) => set({ chatSettingsOpen }),

  setDeepResearch: (deepResearch) => set({ deepResearch }),
  setResearchProgress: (researchProgress) => set({ researchProgress }),
  setResearchSources: (researchSources) => set({ researchSources }),

  setSessionUsage: (sessionUsage) => set({ sessionUsage }),
  setUsageDetailsOpen: (usageDetailsOpen) => set({ usageDetailsOpen }),
  setExportOpen: (exportOpen) => set({ exportOpen }),

  setMessageSearchOpen: (messageSearchOpen) => set({ messageSearchOpen }),
  setBookmarkedMessages: (bookmarkedMessages) => set({ bookmarkedMessages }),
  updateBookmarkedMessages: (updater) =>
    set((state) => ({ bookmarkedMessages: updater(state.bookmarkedMessages) })),
  setEditingTitle: (editingTitle) => set({ editingTitle }),
  setTitleDraft: (titleDraft) => set({ titleDraft }),
  setUserScrolledUp: (userScrolledUp) => set({ userScrolledUp }),

  setRecentChatsOpen: (recentChatsOpen) => set({ recentChatsOpen }),
  setChatSearchQuery: (chatSearchQuery) => set({ chatSearchQuery }),
  setToolDropdownOpen: (key, open) =>
    set((state) => ({
      toolDropdownOpen: {
        ...state.toolDropdownOpen,
        [key]: open,
      },
    })),

  setAttachments: (attachments) => set({ attachments }),
  updateAttachments: (updater) =>
    set((state) => ({ attachments: updater(state.attachments) })),
  setIsRecording: (isRecording) => set({ isRecording }),
  setIsTranscribing: (isTranscribing) => set({ isTranscribing }),
  setTranscriptionError: (transcriptionError) => set({ transcriptionError }),
  setRecordingDuration: (recordingDuration) => set({ recordingDuration }),
  setIsTTSEnabled: (isTTSEnabled) => set({ isTTSEnabled }),

  setMcpPendingServer: (mcpPendingServer) => set({ mcpPendingServer }),
  setMcpActionError: (mcpActionError) => set({ mcpActionError }),

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

  setArtifactPanelSelectedId: (artifactId) => set({ artifactPanelSelectedId: artifactId }),
  updateArtifactRendererState: (artifactId, updater) =>
    set((state) => {
      const prev = state.artifactRendererState[artifactId] ?? {
        isFullscreen: false,
        showCode: false,
        copied: false,
        showPreview: false,
      };
      return {
        artifactRendererState: {
          ...state.artifactRendererState,
          [artifactId]: updater(prev),
        },
      };
    }),
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

  updateCodeBlockState: (blockId, updater) =>
    set((state) => {
      const prev = state.codeBlockState[blockId] ?? {
        copied: false,
        isExpanded: false,
        showPreview: false,
      };
      return {
        codeBlockState: {
          ...state.codeBlockState,
          [blockId]: updater(prev),
        },
      };
    }),
  updateCodeSandboxState: (sandboxId, updater) =>
    set((state) => {
      const prev = state.codeSandboxState[sandboxId] ?? {
        isRunning: false,
        isFullscreen: false,
        copied: false,
        error: null,
      };
      return {
        codeSandboxState: {
          ...state.codeSandboxState,
          [sandboxId]: updater(prev),
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

  setSplashIsMobile: (splashIsMobile) => set({ splashIsMobile }),

  setThemeMode: (themeMode) => set({ themeMode }),
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
  setThemeMenuOpen: (themeMenuOpen) => set({ themeMenuOpen }),

  setLegacyMessageSearch: (updates) =>
    set((state) => ({
      legacyMessageSearch: { ...state.legacyMessageSearch, ...updates },
    })),
  setLegacyToolCallCardState: (toolCallId, updates) =>
    set((state) => ({
      legacyToolCallCardState: {
        ...state.legacyToolCallCardState,
        [toolCallId]: {
          ...(state.legacyToolCallCardState[toolCallId] ?? {}),
          isExpanded: false,
          showModal: false,
          modalCopied: false,
          ...updates,
        },
      },
    })),
  setLegacyThinkingExpanded: (key, expanded) =>
    set((state) => ({
      legacyThinkingExpanded: {
        ...state.legacyThinkingExpanded,
        [key]: expanded,
      },
    })),
  setLegacyMessageActions: (messageId, updates) =>
    set((state) => ({
      legacyMessageActions: {
        ...state.legacyMessageActions,
        [messageId]: {
          ...(state.legacyMessageActions[messageId] ?? {}),
          copied: false,
          bookmarked: false,
          reaction: null,
          showMenu: false,
          ...updates,
        },
      },
    })),
  setLegacyContextIndicator: (updates) =>
    set((state) => ({
      legacyContextIndicator: { ...state.legacyContextIndicator, ...updates },
    })),
  setLegacyChatSidebar: (updates) =>
    set((state) => ({
      legacyChatSidebar: { ...state.legacyChatSidebar, ...updates },
    })),
  setLegacyToolBelt: (updates) =>
    set((state) => ({
      legacyToolBelt: { ...state.legacyToolBelt, ...updates },
    })),
  setLegacyMcpSettings: (updates) =>
    set((state) => ({
      legacyMcpSettings: { ...state.legacyMcpSettings, ...updates },
    })),
  setLegacyChatSettings: (updates) =>
    set((state) => ({
      legacyChatSettings: { ...state.legacyChatSettings, ...updates },
    })),
});
