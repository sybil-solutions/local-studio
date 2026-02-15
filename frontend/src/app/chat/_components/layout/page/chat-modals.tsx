// CRITICAL
"use client";

import { memo } from "react";
import type { DeepResearchConfig, SessionUsage, MCPServer, ChatMessage } from "@/lib/types";
import type { ModelOption } from "@/app/chat/types";
import { ChatSettingsModal } from "../../modals/chat-settings-modal";
import { MCPSettingsModal } from "../../modals/mcp-settings-modal";
import { UsageModal } from "../../modals/usage-modal";
import { ExportModal } from "../../modals/export-modal";

interface ChatModalsProps {
  settingsOpen: boolean;
  onCloseSettings: () => void;
  mcpSettingsOpen: boolean;
  onCloseMcpSettings: () => void;
  usageOpen: boolean;
  onCloseUsage: () => void;
  exportOpen: boolean;
  onCloseExport: () => void;
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  selectedModel: string;
  onSelectedModelChange: (model: string) => void;
  availableModels: ModelOption[];
  customChatModels: string[];
  onAddCustomChatModel: (modelId: string) => void;
  onRemoveCustomChatModel: (modelId: string) => void;
  deepResearch: DeepResearchConfig;
  onDeepResearchChange: (config: DeepResearchConfig) => void;
  mcpServers: MCPServer[];
  onAddServer: (server: MCPServer) => Promise<void>;
  onUpdateServer: (server: MCPServer) => Promise<void>;
  onRemoveServer: (name: string) => Promise<void>;
  onRefreshServers: () => void;
  sessionUsage: SessionUsage | null;
  messages: ChatMessage[];
  onExportJson: () => void;
  onExportMarkdown: () => void;
}

function ChatModalsBase({
  settingsOpen,
  onCloseSettings,
  mcpSettingsOpen,
  onCloseMcpSettings,
  usageOpen,
  onCloseUsage,
  exportOpen,
  onCloseExport,
  systemPrompt,
  onSystemPromptChange,
  selectedModel,
  onSelectedModelChange,
  availableModels,
  customChatModels,
  onAddCustomChatModel,
  onRemoveCustomChatModel,
  deepResearch,
  onDeepResearchChange,
  mcpServers,
  onAddServer,
  onUpdateServer,
  onRemoveServer,
  onRefreshServers,
  sessionUsage,
  messages,
  onExportJson,
  onExportMarkdown,
}: ChatModalsProps) {
  return (
    <>
      <ChatSettingsModal
        isOpen={settingsOpen}
        onClose={onCloseSettings}
        systemPrompt={systemPrompt}
        onSystemPromptChange={onSystemPromptChange}
        selectedModel={selectedModel}
        onSelectedModelChange={onSelectedModelChange}
        availableModels={availableModels}
        customChatModels={customChatModels}
        onAddCustomChatModel={onAddCustomChatModel}
        onRemoveCustomChatModel={onRemoveCustomChatModel}
        deepResearch={deepResearch}
        onDeepResearchChange={onDeepResearchChange}
      />

      <MCPSettingsModal
        isOpen={mcpSettingsOpen}
        onClose={onCloseMcpSettings}
        servers={mcpServers}
        onAddServer={onAddServer}
        onUpdateServer={onUpdateServer}
        onRemoveServer={onRemoveServer}
        onRefresh={onRefreshServers}
      />

      <UsageModal
        isOpen={usageOpen}
        onClose={onCloseUsage}
        sessionUsage={sessionUsage}
        messages={messages}
        selectedModel={selectedModel}
      />

      <ExportModal
        isOpen={exportOpen}
        onClose={onCloseExport}
        onExportJson={onExportJson}
        onExportMarkdown={onExportMarkdown}
      />
    </>
  );
}

function areChatModalsPropsEqual(prev: ChatModalsProps, next: ChatModalsProps): boolean {
  const prevAnyOpen = prev.settingsOpen || prev.mcpSettingsOpen || prev.usageOpen || prev.exportOpen;
  const nextAnyOpen = next.settingsOpen || next.mcpSettingsOpen || next.usageOpen || next.exportOpen;

  // When everything is closed, none of the props matter since all modal components render `null`.
  if (!prevAnyOpen && !nextAnyOpen) return true;

  if (prev.settingsOpen !== next.settingsOpen) return false;
  if (prev.mcpSettingsOpen !== next.mcpSettingsOpen) return false;
  if (prev.usageOpen !== next.usageOpen) return false;
  if (prev.exportOpen !== next.exportOpen) return false;

    if (next.settingsOpen) {
      if (prev.systemPrompt !== next.systemPrompt) return false;
      if (prev.onSystemPromptChange !== next.onSystemPromptChange) return false;
      if (prev.selectedModel !== next.selectedModel) return false;
      if (prev.onSelectedModelChange !== next.onSelectedModelChange) return false;
      if (prev.availableModels !== next.availableModels) return false;
      if (prev.customChatModels !== next.customChatModels) return false;
      if (prev.onAddCustomChatModel !== next.onAddCustomChatModel) return false;
      if (prev.onRemoveCustomChatModel !== next.onRemoveCustomChatModel) return false;
      if (prev.deepResearch !== next.deepResearch) return false;
      if (prev.onDeepResearchChange !== next.onDeepResearchChange) return false;
      if (prev.onCloseSettings !== next.onCloseSettings) return false;
  }

  if (next.mcpSettingsOpen) {
    if (prev.mcpServers !== next.mcpServers) return false;
    if (prev.onAddServer !== next.onAddServer) return false;
    if (prev.onUpdateServer !== next.onUpdateServer) return false;
    if (prev.onRemoveServer !== next.onRemoveServer) return false;
    if (prev.onRefreshServers !== next.onRefreshServers) return false;
    if (prev.onCloseMcpSettings !== next.onCloseMcpSettings) return false;
  }

  if (next.usageOpen) {
    if (prev.sessionUsage !== next.sessionUsage) return false;
    if (prev.messages !== next.messages) return false;
    if (prev.selectedModel !== next.selectedModel) return false;
    if (prev.onCloseUsage !== next.onCloseUsage) return false;
  }

  if (next.exportOpen) {
    if (prev.onExportJson !== next.onExportJson) return false;
    if (prev.onExportMarkdown !== next.onExportMarkdown) return false;
    if (prev.onCloseExport !== next.onCloseExport) return false;
  }

  return true;
}

export const ChatModals = memo(ChatModalsBase, areChatModalsPropsEqual);
