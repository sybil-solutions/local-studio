// CRITICAL
import type {
  AgentFileEntry,
  AgentFileVersion,
  ChatSession,
  DeepResearchConfig,
  MCPServer,
  MCPTool,
  SessionUsage,
  ToolResult,
} from "@/lib/types";
import type { Attachment, ModelOption } from "@/app/chat/types";
import type { AgentPlan } from "@/app/chat/_components/agent/agent-types";
import type { SidebarTab } from "@/app/chat/_components/layout";

export interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  currentSessionTitle: string;
  sessionsLoading: boolean;

  input: string;
  error: string | null;

  streamingStartTime: number | null;
  elapsedSeconds: number;
  lastRunDurationSeconds: number | null;
  runDurationsByRunId: Record<string, number>;
  queuedContext: string;

  selectedModel: string;
  availableModels: ModelOption[];
  customChatModels: string[];

  isMobile: boolean;
  userScrolledUp: boolean;

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

  sessionUsage: SessionUsage | null;
  usageDetailsOpen: boolean;
  exportOpen: boolean;

  attachments: Attachment[];
  isRecording: boolean;
  isTranscribing: boolean;
  transcriptionError: string | null;
  recordingDuration: number;
  isTTSEnabled: boolean;

  callModeEnabled: boolean;
  callModeSpeakingMessageId: string | null;

  mcpPendingServer: string | null;
  mcpActionError: string | null;

  copiedMessageId: string | null;
  messageInlineThinkingExpanded: Record<string, boolean>;
  messageInlineToolsExpanded: Record<string, boolean>;
  toolCallGroupsExpanded: Record<string, boolean>;

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

  codeBlockState: Record<string, { copied: boolean; isExpanded: boolean }>;
  mermaidState: Record<string, { svg: string; error: string | null }>;

  splashIsMobile: boolean;

  agentMode: boolean;
  agentPlan: AgentPlan | null;
  agentFiles: AgentFileEntry[];
  agentFilesLoading: boolean;
  selectedAgentFilePath: string | null;
  selectedAgentFileContent: string | null;
  selectedAgentFileLoading: boolean;
  agentFileVersions: Record<string, AgentFileVersion[]>;
  sidebarWidth: number;
  resultsLastTab: SidebarTab | null;
  mobilePlanChipHidden: boolean;

  // Toasts (ephemeral UI; not persisted)
  toasts: Array<{
    id: string;
    kind: "error" | "warning" | "info" | "success";
    title: string;
    message?: string;
    detail?: string;
    createdAt: number;
    expanded: boolean;
    dedupeKey?: string;
  }>;
}

export interface ChatActions {
  setSessions: (sessions: ChatSession[]) => void;
  updateSessions: (updater: (sessions: ChatSession[]) => ChatSession[]) => void;
  setCurrentSessionId: (currentSessionId: string | null) => void;
  setCurrentSessionTitle: (currentSessionTitle: string) => void;
  setSessionsLoading: (sessionsLoading: boolean) => void;

  setInput: (input: string) => void;
  setError: (error: string | null) => void;

  setStreamingStartTime: (streamingStartTime: number | null) => void;
  setElapsedSeconds: (elapsedSeconds: number) => void;
  setLastRunDurationSeconds: (seconds: number | null) => void;
  setRunDurationForRunId: (runId: string, seconds: number) => void;
  setQueuedContext: (queuedContext: string) => void;

  setSelectedModel: (selectedModel: string) => void;
  setAvailableModels: (availableModels: ModelOption[]) => void;
  setCustomChatModels: (customChatModels: ChatSlice["customChatModels"]) => void;
  addCustomChatModel: (modelId: string) => void;
  removeCustomChatModel: (modelId: string) => void;

  setIsMobile: (isMobile: boolean) => void;
  setUserScrolledUp: (userScrolledUp: boolean) => void;

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

  setSystemPrompt: (systemPrompt: string) => void;
  setChatSettingsOpen: (chatSettingsOpen: boolean) => void;
  setDeepResearch: (deepResearch: DeepResearchConfig) => void;

  setSessionUsage: (sessionUsage: SessionUsage | null) => void;
  setUsageDetailsOpen: (usageDetailsOpen: boolean) => void;
  setExportOpen: (exportOpen: boolean) => void;

  setAttachments: (attachments: Attachment[]) => void;
  updateAttachments: (updater: (attachments: Attachment[]) => Attachment[]) => void;
  setIsRecording: (isRecording: boolean) => void;
  setIsTranscribing: (isTranscribing: boolean) => void;
  setTranscriptionError: (transcriptionError: string | null) => void;
  setRecordingDuration: (recordingDuration: number) => void;
  setIsTTSEnabled: (isTTSEnabled: boolean) => void;

  setCallModeEnabled: (callModeEnabled: boolean) => void;
  setCallModeSpeakingMessageId: (id: string | null) => void;

  setMcpPendingServer: (mcpPendingServer: string | null) => void;
  setMcpActionError: (mcpActionError: string | null) => void;

  setCopiedMessageId: (copiedMessageId: string | null) => void;
  setMessageInlineThinkingExpanded: (messageId: string, expanded: boolean) => void;
  setMessageInlineToolsExpanded: (messageId: string, expanded: boolean) => void;
  setToolCallGroupExpanded: (groupId: string, expanded: boolean) => void;

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
    updater: (prev: { copied: boolean; isExpanded: boolean }) => {
      copied: boolean;
      isExpanded: boolean;
    },
  ) => void;
  deleteCodeBlockState: (blockId: string) => void;
  setMermaidState: (id: string, svg: string, error: string | null) => void;
  deleteMermaidState: (id: string) => void;

  setSplashIsMobile: (splashIsMobile: boolean) => void;

  setAgentMode: (enabled: boolean) => void;
  setAgentPlan: (plan: AgentPlan | null) => void;
  setAgentFiles: (files: AgentFileEntry[]) => void;
  setAgentFilesLoading: (loading: boolean) => void;
  setSelectedAgentFilePath: (path: string | null) => void;
  setSelectedAgentFileContent: (content: string | null) => void;
  setSelectedAgentFileLoading: (loading: boolean) => void;
  addAgentFileVersion: (path: string, content: string) => void;
  hydrateAgentFileVersions: (path: string, versions: AgentFileVersion[]) => void;
  moveAgentFileVersions: (from: string, to: string) => void;
  clearAgentFileVersions: () => void;
  setSidebarWidth: (width: number) => void;
  setResultsLastTab: (tab: SidebarTab | null) => void;
  setMobilePlanChipHidden: (hidden: boolean) => void;

  pushToast: (toast: {
    kind: "error" | "warning" | "info" | "success";
    title: string;
    message?: string;
    detail?: string;
    dedupeKey?: string;
  }) => void;
  closeToast: (id: string) => void;
  toggleToastExpanded: (id: string) => void;
}

export type ChatSlice = ChatState & ChatActions;
