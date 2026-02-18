// CRITICAL
"use client";

import type { ReactNode, RefObject } from "react";
import type { SidebarTab } from "../../../sidebar/unified-sidebar";
import type {
  AgentFileEntry,
  AgentFileVersion,
  Artifact,
  ChatMessage,
  MCPServer,
  SessionUsage,
} from "@/lib/types";
import type { AgentPlan } from "../../../../agent/agent-types";
import type { ActivityGroup, ModelOption } from "../../../../../types";
import type { CompactionEvent, ContextStats } from "@/lib/services/context-management";
import type { DeepResearchConfig } from "@/lib/types";

export interface ChatPageViewProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;

  // Activity + context
  activityGroups: ActivityGroup[];
  activityCount: number;
  agentPlan: AgentPlan | null;
  thinkingActive: boolean;
  isLoading: boolean;
  streamError: string | null;
  streamStalled: boolean;
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
  contextUsageLabel: string | null;
  compactionHistory: CompactionEvent[];
  compacting: boolean;
  compactionError: string | null;
  formatTokenCount: (tokens: number) => string;
  runManualCompaction: () => void;
  canManualCompact: boolean;

  // Artifacts
  artifactsEnabled: boolean;
  sessionArtifacts: Artifact[];
  artifactsByMessage: Map<string, Artifact[]>;
  activeArtifact: Artifact | null;
  onCloseArtifactModal: () => void;

  // Agent files
  agentFiles: AgentFileEntry[];
  agentFileVersions: Record<string, AgentFileVersion[]>;
  selectedAgentFilePath: string | null;
  selectedAgentFileContent: string | null;
  selectedAgentFileLoading: boolean;
  onSelectAgentFile: (path: string | null) => void;
  hasSession: boolean;
  onOpenAgentFile: (path: string) => void;

  // Messages + list refs
  messages: ChatMessage[];
  selectedModel: string;
  showEmptyState: boolean;
  onForkMessage: (messageId: string) => void;
  onReprompt: (messageId: string) => void;
  onListenMessage: (messageId: string) => void;
  listeningMessageId: string | null;
  listeningPending: boolean;
  openActivityPanel: () => void;
  openContextPanel: () => void;
  handleScroll: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;

  toolBelt: ReactNode;

  // Modals
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  mcpSettingsOpen: boolean;
  setMcpSettingsOpen: (open: boolean) => void;
  usageOpen: boolean;
  setUsageOpen: (open: boolean) => void;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
  systemPrompt: string;
  setSystemPrompt: (value: string) => void;
  setSelectedModel: (modelId: string) => void;
  availableModels: ModelOption[];
  customChatModels: string[];
  onAddCustomChatModel: (modelId: string) => void;
  onRemoveCustomChatModel: (modelId: string) => void;
  deepResearch: DeepResearchConfig;
  setDeepResearch: (next: DeepResearchConfig) => void;
  mcpServers: MCPServer[];
  addMcpServer: (server: MCPServer) => Promise<void>;
  updateMcpServer: (server: MCPServer) => Promise<void>;
  removeMcpServer: (name: string) => Promise<void>;
  loadMCPServers: () => void | Promise<void>;
  sessionUsage: SessionUsage | null;
  onExportJson: () => void;
  onExportMarkdown: () => void;
}
