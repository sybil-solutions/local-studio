"use client";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { AgentChatPaneHeader } from "@/features/agent/ui/agent-chat-pane-header";
import { AgentEmptyPrompt } from "@/features/agent/ui/agent-empty-prompt";
import { AgentComposerFrame } from "@/features/agent/ui/agent-composer-frame";
import { AgentPluginPicker } from "@/features/agent/ui/agent-plugin-picker";
import { type FileMentionRow } from "@/features/agent/ui/agent-composer-context";
import {
  useComposerLoadedContext,
  useComposerMentionRows,
  useComposerTextareaBehavior,
  useComposerTextareaHeightSync,
  type UpdateTab,
} from "@/features/agent/ui/chat-pane-composer";
import { useComposerAttachments } from "@/features/agent/ui/chat-pane-composer-attachments";
import { useComposerMentionSelection } from "@/features/agent/ui/chat-pane-composer-mention-selection";
import { type ComposerMention } from "@/features/agent/composer-context";
import {
  useChatPaneContextAttachEffect,
  useChatPaneDerivedState,
  useChatPaneMentionEffects,
  useChatPaneRuntimeHandle,
  useChatPaneStickToBottomEffect,
} from "@/features/agent/ui/chat-pane-hooks";
import { useChatPaneSessionTitle } from "@/features/agent/ui/chat-pane-session-title";
import { useChatPaneSendFlow } from "@/features/agent/ui/chat-pane-send-flow";
import { ChatPaneHandle, SessionTab } from "@/features/agent/messages";
import { useSessionEngine } from "@/features/agent/runtime/engine";
import { useTools } from "@/features/agent/tools/context";
import type { GitSummary } from "@/features/agent/projects/types";
import type { BrowserBackend } from "@/features/agent/tools/types";
import {
  exportFilenameFromTitle,
  sessionToMarkdown,
} from "@/features/agent/messages/export-markdown";
export type { ChatPaneHandle, SessionTab };

const Timeline = dynamic(
  () => import("@/features/agent/ui/timeline/timeline").then((mod) => mod.Timeline),
  { ssr: false, loading: () => <TimelineFallback /> },
);

function downloadTextFile(filename: string, content: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function TimelineFallback() {
  return <div className="flex min-h-0 flex-1 bg-(--agent-bg)" />;
}

type Props = {
  paneId: string;
  modelId: string;
  modelName: string | null;
  modelSupportsVision: boolean;
  modelsLoading: boolean;
  contextWindow: number;
  cwd: string;
  projectName: string | null;
  modelSelector?: ReactNode;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  onInitGit?: () => void;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  onToggleBrowserBackend: () => void;
  onToggleBrowserTool: () => void;
  canvasEnabled: boolean;
  onToggleCanvas: () => void;
  isFocused: boolean;
  onFocus: () => void;
  onPiSessionIdChange?: (sessionId: string) => void;
  tabs: SessionTab[];
  activeTabId: string;
  onTabsChange: (tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[])) => void;
  onRenameSession: (tabId: string, title: string) => void;
  onClose?: () => void;
  onForkSession?: () => void;
  onOpenTerminal?: () => void;
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
  showHeader?: boolean;
};
export function ChatPane({
  paneId,
  modelId,
  modelName,
  modelSupportsVision,
  modelsLoading,
  contextWindow,
  cwd,
  projectName,
  modelSelector,
  gitBranch,
  gitSummary,
  onInitGit,
  browserToolEnabled,
  browserBackend,
  onToggleBrowserBackend,
  onToggleBrowserTool,
  canvasEnabled,
  onToggleCanvas,
  isFocused,
  onFocus,
  onPiSessionIdChange,
  tabs,
  activeTabId,
  onTabsChange,
  onRenameSession,
  onClose,
  onForkSession,
  onOpenTerminal,
  rightPanelOpen,
  onToggleRightPanel,
  onRegisterHandle,
  showHeader = true,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAppliedComposerHeightRef = useRef(0);
  const lastComposerValueLengthRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [mention, setMention] = useState<ComposerMention | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [fileMentionRows, setFileMentionRows] = useState<FileMentionRow[]>([]);
  const tools = useTools();
  const {
    activeTab,
    currentContextTokens,
    effectiveContextWindow,
    running,
    showEmptyPrompt,
    visibleQueueItems,
  } = useChatPaneDerivedState({ activeTabId, contextWindow, tabs });
  const updateTab = useCallback(
    (tabId: string, patch: (tab: SessionTab) => SessionTab) => {
      onTabsChange((currentTabs) =>
        currentTabs.map((tab) => (tab.id === tabId ? patch(tab) : tab)),
      );
    },
    [onTabsChange],
  );
  const {
    attachments,
    setAttachments,
    readingAttachments,
    composerDragActive,
    attachFiles,
    removeAttachment,
    clearAttachments,
    handleComposerDragOver,
    handleComposerDragLeave,
    handleComposerDrop,
  } = useComposerAttachments({
    activeTab,
    running: Boolean(running),
    updateTab,
    fileInputRef,
  });
  useChatPaneStickToBottomEffect({
    activeTabId: activeTab?.id,
    setStickToBottom,
  });
  useChatPaneContextAttachEffect({
    contextAttachRequest: tools.contextAttachRequest,
    isFocused,
    setAttachments,
  });
  const mentionRows = useComposerMentionRows({
    fileMentionRows,
    mention,
    promptTemplateRows: tools.promptTemplateCatalogue,
    skillRows: tools.skillCatalogue,
  });
  useChatPaneMentionEffects({
    cwd,
    mention,
    setFileMentionRows,
    setMentionIndex,
  });
  const {
    displayedSessionTitle,
    sessionPinned,
    togglePinnedSession,
    handlePiSessionIdChange,
    renameActiveSession,
  } = useChatPaneSessionTitle({
    activeTab,
    activeTabId,
    paneId,
    running: Boolean(running),
    onPiSessionIdChange,
    onRenameSession,
  });
  const selectMentionRow = useComposerMentionSelection({
    activeTab,
    mention,
    cwd,
    tools,
    updateTab,
    setAttachments,
    setMention,
    textareaRef,
  });
  const resetComposerHeight = useCallback(() => {
    if (textareaRef.current) textareaRef.current.style.height = "";
    lastAppliedComposerHeightRef.current = 0;
    lastComposerValueLengthRef.current = 0;
  }, []);
  useComposerTextareaHeightSync({
    value: activeTab?.input ?? "",
    textareaRef,
    lastAppliedComposerHeightRef,
    lastComposerValueLengthRef,
  });
  const { selectedSkills, selectedPromptTemplates, selectedPlugins, removeLoadedContext } =
    useComposerLoadedContext({ activeTab, tools });
  const setSelectedPlugins = useCallback(
    (plugins: typeof selectedPlugins) => {
      if (!activeTab) return;
      tools.setSelection(activeTab.id, { ...tools.selectionFor(activeTab.id), plugins });
    },
    [activeTab, selectedPlugins, tools],
  );

  const engine = useSessionEngine({
    tabs,
    activeTabId,
    modelId,
    cwd,
    browserToolEnabled,
    browserBackend,
    canvasEnabled: tools.computer.canvasEnabled,
    onPiSessionIdChange: handlePiSessionIdChange,
    updateSession: updateTab,
    selectionFor: tools.selectionFor,
  });
  const { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn } =
    useChatPaneSendFlow({
      activeTab,
      attachments,
      browserToolEnabled,
      clearAttachments,
      cwd,
      engine,
      modelId,
      modelSupportsVision,
      readingAttachments,
      resetComposerHeight,
      running: Boolean(running),
      setMention,
      setStickToBottom,
      tools,
      updateTab,
    });
  const { handleComposerPaste, handleComposerChange, handleComposerKeyDown } =
    useComposerTextareaBehavior({
      activeTab,
      mention,
      mentionRows,
      mentionIndex,
      running: Boolean(running),
      textareaRef,
      lastAppliedComposerHeightRef,
      lastComposerValueLengthRef,
      resetComposerHeight,
      updateTab,
      setMention,
      setMentionIndex,
      selectMentionRow,
      queueMessage,
      abortTurn,
      attachFiles,
    });
  const openComputerStatus = useCallback(() => {
    tools.setComputerTab("status");
    tools.setComputerOpen(true);
  }, [tools]);
  useChatPaneRuntimeHandle({
    activeTab,
    activeTabId,
    engine,
    modelId,
    onRegisterHandle,
    running: Boolean(running),
  });
  const exportSession = useCallback(() => {
    if (!activeTab) return;
    const markdown = sessionToMarkdown(activeTab.messages, displayedSessionTitle);
    downloadTextFile(exportFilenameFromTitle(displayedSessionTitle), markdown);
  }, [activeTab, displayedSessionTitle]);
  const canExport = Boolean(
    activeTab?.messages.some((message) => message.role !== "system" && message.text.trim()),
  );
  const loadEarlierHistory = useCallback(
    () => (activeTabId ? engine.loadEarlier(activeTabId) : Promise.resolve()),
    [activeTabId, engine],
  );
  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-(--agent-bg) shadow-[inset_1px_0_rgba(255,255,255,0.015)]"
    >
      {showHeader ? (
        <AgentChatPaneHeader
          title={displayedSessionTitle}
          pinned={sessionPinned}
          rightPanelOpen={rightPanelOpen}
          canFork={Boolean(onForkSession)}
          canClose={Boolean(onClose)}
          canExport={canExport}
          onTogglePinned={togglePinnedSession}
          onRename={renameActiveSession}
          onFork={onForkSession}
          onOpenTerminal={onOpenTerminal}
          onExport={exportSession}
          onClose={onClose}
          onToggleRightPanel={onToggleRightPanel}
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        {showEmptyPrompt ? (
          <AgentEmptyPrompt />
        ) : (
          <Timeline
            key={activeTab?.id ?? "empty"}
            stickToBottom={stickToBottom}
            onStickToBottomChange={setStickToBottom}
            messages={activeTab?.messages ?? []}
            running={Boolean(running)}
            onForkSession={onForkSession}
            hasEarlier={activeTab?.historyCursor != null}
            onLoadEarlier={loadEarlierHistory}
          />
        )}
      </div>
      <AgentComposerFrame
        attachments={attachments}
        browserToolEnabled={browserToolEnabled}
        browserBackend={browserBackend}
        canvasEnabled={canvasEnabled}
        composerDragActive={composerDragActive}
        contextWindow={effectiveContextWindow}
        currentContextTokens={currentContextTokens}
        cwd={cwd}
        fileInputRef={fileInputRef}
        gitBranch={gitBranch}
        gitSummary={gitSummary}
        input={activeTab?.input ?? ""}
        mention={mention}
        mentionIndex={mentionIndex}
        mentionRows={mentionRows}
        modelSupportsVision={modelSupportsVision}
        modelSelector={modelSelector}
        pluginSelector={
          <AgentPluginPicker selected={selectedPlugins} onChange={setSelectedPlugins} />
        }
        onAbortTurn={() => void abortTurn()}
        onAttachFiles={(files) => void attachFiles(files)}
        onComposerChange={handleComposerChange}
        onComposerDragLeave={handleComposerDragLeave}
        onComposerDragOver={handleComposerDragOver}
        onComposerDrop={handleComposerDrop}
        onComposerKeyDown={handleComposerKeyDown}
        onComposerPaste={handleComposerPaste}
        onEditQueued={editQueued}
        onInitGit={onInitGit}
        onOpenStatus={openComputerStatus}
        onQueueExpandedChange={setQueueExpanded}
        onRemoveAttachment={removeAttachment}
        onRemoveLoadedContext={removeLoadedContext}
        onRemoveQueued={removeQueued}
        onSelectMention={(entry) => void selectMentionRow(entry)}
        onSteerQueued={(queueId) => void steerQueued(queueId)}
        onSubmit={sendMessage}
        onToggleBrowserBackend={onToggleBrowserBackend}
        onToggleBrowserTool={onToggleBrowserTool}
        onToggleCanvas={onToggleCanvas}
        promptTemplates={selectedPromptTemplates}
        queueExpanded={queueExpanded}
        queueItems={visibleQueueItems}
        readingAttachments={readingAttachments}
        running={Boolean(running)}
        selectedSkills={selectedSkills}
        selectedPlugins={selectedPlugins}
        status={activeTab?.status}
        textareaRef={textareaRef}
      />
    </section>
  );
}
