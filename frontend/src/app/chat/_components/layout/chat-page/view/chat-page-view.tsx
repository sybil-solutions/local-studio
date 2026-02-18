// CRITICAL
"use client";

import { memo, useCallback } from "react";
import { UnifiedSidebar } from "../../sidebar/unified-sidebar";
import { ChatConversation } from "../../page/chat-conversation";
import { ChatTopControls } from "../../page/chat-top-controls";
import { ChatActionButtons } from "../../page/chat-action-buttons";
import { ChatToolbeltDock } from "../../sidebar/chat-toolbelt-dock";
import { ChatModals } from "../../page/chat-modals";
import { MobileResultsDrawer } from "../../sidebar/mobile-results-drawer";
import { ArtifactModal } from "../../../artifacts/artifact-modal";
import { buildSidebarContentsFromPageProps } from "./chat-page-view/sidebar-contents-from-page-props";
import type { ChatPageViewProps } from "./chat-page-view/types";

export const ChatPageView = memo(function ChatPageView(props: ChatPageViewProps) {
  const {
    sidebarOpen,
    setSidebarOpen,
    setSettingsOpen,
    setMcpSettingsOpen,
    setUsageOpen,
    setExportOpen,
  } = props;

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [setSidebarOpen, sidebarOpen]);

  const handleOpenSidebarMobile = useCallback(() => {
    window.dispatchEvent(new CustomEvent("vllm:toggle-sidebar", { detail: { open: true } }));
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), [setSettingsOpen]);
  const closeSettings = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);

  const openMcpSettings = useCallback(() => setMcpSettingsOpen(true), [setMcpSettingsOpen]);
  const closeMcpSettings = useCallback(
    () => setMcpSettingsOpen(false),
    [setMcpSettingsOpen],
  );

  const openUsage = useCallback(() => setUsageOpen(true), [setUsageOpen]);
  const closeUsage = useCallback(() => setUsageOpen(false), [setUsageOpen]);

  const openExport = useCallback(() => setExportOpen(true), [setExportOpen]);
  const closeExport = useCallback(() => setExportOpen(false), [setExportOpen]);

  const mobileSidebarContents = buildSidebarContentsFromPageProps("mobile", props);
  const desktopSidebarContents = buildSidebarContentsFromPageProps("desktop", props);

  return (
    <div className="relative h-full flex overflow-hidden w-full max-w-full bg-background">
      <MobileResultsDrawer
        isOpen={props.sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeTab={props.sidebarTab}
        onSetActiveTab={props.setSidebarTab}
        hasArtifacts={props.sessionArtifacts.length > 0}
        activityContent={mobileSidebarContents.activityContent}
        contextContent={mobileSidebarContents.contextContent}
        artifactsContent={mobileSidebarContents.artifactsContent}
        filesContent={mobileSidebarContents.filesContent}
      />

      <UnifiedSidebar
        isOpen={props.sidebarOpen}
        onToggle={handleToggleSidebar}
        activeTab={props.sidebarTab}
        onSetActiveTab={props.setSidebarTab}
        hasArtifacts={props.sessionArtifacts.length > 0}
        activityContent={desktopSidebarContents.activityContent}
        contextContent={desktopSidebarContents.contextContent}
        artifactsContent={desktopSidebarContents.artifactsContent}
        filesContent={desktopSidebarContents.filesContent}
        width={props.sidebarWidth}
        onWidthChange={props.setSidebarWidth}
      >
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-x-hidden">
          <div className="flex-1 flex flex-col overflow-hidden relative min-w-0 bg-background">
            <ChatConversation
              messages={props.messages}
              isLoading={props.isLoading}
              artifactsEnabled={props.artifactsEnabled}
              artifactsByMessage={props.artifactsByMessage}
              selectedModel={props.selectedModel}
              contextUsageLabel={props.contextUsageLabel}
              agentFiles={props.agentFiles}
              selectedAgentFilePath={props.selectedAgentFilePath}
              onOpenAgentFile={props.onOpenAgentFile}
              onFork={props.onForkMessage}
              onReprompt={props.onReprompt}
              onListen={props.onListenMessage}
              listeningMessageId={props.listeningMessageId}
              listeningPending={props.listeningPending}
              onOpenContext={props.openContextPanel}
              showEmptyState={props.showEmptyState}
              toolBelt={props.toolBelt}
              onScroll={props.handleScroll}
              messagesContainerRef={props.messagesContainerRef}
              messagesEndRef={props.messagesEndRef}
            />

            <ChatTopControls
              onOpenSidebar={handleOpenSidebarMobile}
              onOpenSettings={openSettings}
            />

            <ChatActionButtons
              activityCount={props.activityCount}
              onOpenActivity={props.openActivityPanel}
              onOpenContext={props.openContextPanel}
              onOpenSettings={openSettings}
              onOpenMcpSettings={openMcpSettings}
              onOpenUsage={openUsage}
              onOpenExport={openExport}
            />

            <ChatToolbeltDock toolBelt={props.toolBelt} showEmptyState={props.showEmptyState} />
          </div>
        </div>
      </UnifiedSidebar>

      <ChatModals
        settingsOpen={props.settingsOpen}
        onCloseSettings={closeSettings}
        mcpSettingsOpen={props.mcpSettingsOpen}
        onCloseMcpSettings={closeMcpSettings}
        usageOpen={props.usageOpen}
        onCloseUsage={closeUsage}
        exportOpen={props.exportOpen}
        onCloseExport={closeExport}
        systemPrompt={props.systemPrompt}
        onSystemPromptChange={props.setSystemPrompt}
        selectedModel={props.selectedModel}
        onSelectedModelChange={props.setSelectedModel}
        availableModels={props.availableModels}
        customChatModels={props.customChatModels}
        onAddCustomChatModel={props.onAddCustomChatModel}
        onRemoveCustomChatModel={props.onRemoveCustomChatModel}
        deepResearch={props.deepResearch}
        onDeepResearchChange={props.setDeepResearch}
        mcpServers={props.mcpServers}
        onAddServer={props.addMcpServer}
        onUpdateServer={props.updateMcpServer}
        onRemoveServer={props.removeMcpServer}
        onRefreshServers={props.loadMCPServers}
        sessionUsage={props.sessionUsage}
        messages={props.messages}
        onExportJson={props.onExportJson}
        onExportMarkdown={props.onExportMarkdown}
      />

      <ArtifactModal artifact={props.activeArtifact} onClose={props.onCloseArtifactModal} />
    </div>
  );
});
