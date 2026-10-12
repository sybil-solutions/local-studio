"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { AgentChatPaneHeader } from "@/features/agent/ui/agent-chat-pane-header";
import { AgentComposerFrame } from "@/features/agent/ui/agent-composer-frame";
import { type FileMentionRow, type MentionRow } from "@/features/agent/ui/agent-composer-context";
import { builtinCommandProvider } from "@/features/agent/composer/builtin-commands";
import { AutomationDrawer } from "@/features/agent/ui/automation-drawer";
import { ComposerProjectDrawer } from "@/features/agent/ui/composer-project-drawer";
import { TranscriptSessionContext } from "@/features/agent/ui/timeline/subagent-row";
import { GitDiffDrawer } from "@/features/agent/ui/git-diff-drawer";
import {
  promptTemplateCommandProvider,
  skillCommandProvider,
} from "@/features/agent/composer/catalogue-commands";
import {
  createComposerCommandRegistry,
  parseSlashInvocation,
  type SlashInvocation,
} from "@/features/agent/composer/command-registry";
import { deriveComposerVisual } from "@/features/agent/composer/composer-visual-state";
import {
  useComposerAutosize,
  useComposerLoadedContext,
  useComposerMentionRows,
  useComposerTextareaBehavior,
  type UpdateTab,
} from "@/features/agent/ui/chat-pane-composer";
import { useComposerAttachments } from "@/features/agent/ui/chat-pane-composer-attachments";
import {
  applyContextRow,
  useComposerMentionSelection,
} from "@/features/agent/ui/chat-pane-composer-mention-selection";
import {
  consumeComposerMention,
  type ComposerMention,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/features/agent/composer-context";
import {
  useChatPaneContextAttachEffect,
  useChatPaneDerivedState,
  useChatPaneMentionEffects,
  useChatPaneRuntimeHandle,
} from "@/features/agent/ui/chat-pane-hooks";
import { useChatPaneSessionTitle } from "@/features/agent/ui/chat-pane-session-title";
import { useGoalCommand } from "@/features/agent/ui/use-goal-command";
import { useGoalMode } from "@/features/agent/ui/use-goal-mode";
import { useComposerCommandHandlers } from "@/features/agent/ui/use-composer-command-handlers";
import { useChatPaneSendFlow } from "@/features/agent/ui/chat-pane-send-flow";
import { ChatPaneHandle } from "@/features/agent/messages";
import { respondExtensionUi } from "@/features/agent/runtime/api";
import { useSessionEngine } from "@/features/agent/runtime/engine";
import type { Session, UpdateSession } from "@/features/agent/runtime/types";
import { useTools } from "@/features/agent/tools/context";
import type { GitSummary, Project } from "@/features/agent/projects/types";
import type { BrowserBackend } from "@/features/agent/tools/types";
import type { AgentThinkingLevel } from "@/features/agent/contracts";
import {
  loadThinkingLevelDefault,
  pickThinkingLevel,
  setThinkingLevelDefault,
} from "@/features/agent/messages/thinking-level-pref";
import {
  exportFilenameFromTitle,
  sessionToMarkdown,
} from "@/features/agent/messages/export-markdown";
import {
  OPEN_TERMINAL_EVENT,
  type OpenTerminalEventDetail,
  type TerminalOwner,
} from "@/features/agent/terminal-owners";
import {
  rememberPersistentTerminalOwner,
  selectPersistentTerminalOwner,
  usePersistentTerminalOwners,
  type TerminalOwnersSnapshot,
} from "@/features/agent/ui/use-persistent-terminal-owners";
import { PersistentTerminals } from "@/features/agent/ui/persistent-terminals";
import { cx } from "@/ui/utils";
import { ExtensionUiDialog } from "@/features/agent/ui/extension-ui-dialog";
export type { ChatPaneHandle };

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

function EmptyPromptTimeline() {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-10 pt-2">
      <div className="agent-thread-shell mx-auto flex flex-1">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="max-w-[24ch] text-[clamp(1.45rem,2.6vw,2.1rem)] font-semibold leading-[1.22] tracking-[-0.02em] text-(--fg)/90">
            A dream is something you build for yourself.
          </p>
          <p className="text-[length:var(--fs-xl)] text-(--dim)">Just talk to it.</p>
        </div>
      </div>
    </div>
  );
}

function TimelineFallback() {
  return <div className="flex min-h-0 flex-1 bg-(--agent-bg)" />;
}

function chatPaneClassName(composerOnly: boolean): string {
  return cx(
    "relative flex min-h-0 min-w-0 flex-1 flex-col",
    composerOnly
      ? "bg-transparent"
      : "bg-(--agent-bg) shadow-[inset_1px_0_rgba(255,255,255,0.015)]",
  );
}

function ChatTranscript({
  composerOnly,
  terminalView,
  showEmptyPrompt,
  activeTab,
  stickToBottom,
  setStickToBottom,
  running,
  cwd,
  onForkSession,
  loadEarlierHistory,
}: {
  composerOnly: boolean;
  terminalView: boolean;
  showEmptyPrompt: boolean;
  activeTab: Session | undefined;
  stickToBottom: boolean;
  setStickToBottom: (value: boolean) => void;
  running: boolean;
  cwd: string;
  onForkSession?: () => void;
  loadEarlierHistory: () => Promise<void>;
}) {
  const viewKey = activeTab?.piSessionId ?? activeTab?.id ?? null;
  const viewAlias = activeTab?.piSessionId ? activeTab.id : null;
  // Subagent rows inside the transcript need the parent session to look up
  // their live status; the memoized block layers between here and the row are
  // exactly why this is a context and not a prop.
  const transcriptSession = useMemo(
    () => ({ piSessionId: activeTab?.piSessionId ?? null, cwd: cwd || null }),
    [activeTab?.piSessionId, cwd],
  );
  if (composerOnly) return null;
  return (
    <TranscriptSessionContext value={transcriptSession}>
    <div className={terminalView ? "hidden" : "flex min-h-0 min-w-0 flex-1"}>
      {showEmptyPrompt ? (
        <EmptyPromptTimeline />
      ) : (
        <Timeline
          key={activeTab?.id ?? "empty"}
          stickToBottom={stickToBottom}
          onStickToBottomChange={setStickToBottom}
          messages={activeTab?.messages ?? []}
          running={running}
          cwd={cwd || null}
          viewKey={viewKey}
          viewAlias={viewAlias}
          onForkSession={onForkSession}
          hasEarlier={activeTab?.historyCursor != null}
          onLoadEarlier={loadEarlierHistory}
        />
      )}
    </div>
    </TranscriptSessionContext>
  );
}

type Props = {
  paneId: string;
  modelId: string;
  modelName: string | null;
  modelSupportsVision: boolean;
  modelThinkingLevels: readonly AgentThinkingLevel[];
  modelsLoading: boolean;
  contextWindow: number;
  cwd: string;
  projectName: string | null;
  modelSelector?: (props: ComposerModelSelectorProps) => ReactNode;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  onInitGit?: () => void;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  onToggleBrowserBackend: () => void;
  onToggleBrowserTool: () => void;
  isFocused: boolean;
  onFocus: () => void;
  onPiSessionIdChange?: (sessionId: string) => void;
  tabs: Session[];
  activeTabId: string;
  onUpdateSession: UpdateSession;
  onRenameSession: (tabId: string, title: string) => void;
  onClose?: () => void;
  onForkSession?: () => void;
  onOpenTerminal?: () => void;
  terminalOwner?: TerminalOwner | null;
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
  showHeader?: boolean;
  composerOnly?: boolean;
};

export type ComposerModelSelectorProps = {
  reasoningLevel: AgentThinkingLevel;
  reasoningLevels: readonly AgentThinkingLevel[];
  reasoningDisabled: boolean;
  onSelectReasoning: (level: AgentThinkingLevel) => void;
};

function renderComposerModelSelector(
  renderer: Props["modelSelector"],
  props: ComposerModelSelectorProps,
): ReactNode {
  return renderer ? renderer(props) : null;
}
export function ChatPane({
  paneId,
  modelId,
  modelName,
  modelSupportsVision,
  modelThinkingLevels,
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
  isFocused,
  onFocus,
  onPiSessionIdChange,
  tabs,
  activeTabId,
  onUpdateSession,
  onRenameSession,
  onClose,
  onForkSession,
  onOpenTerminal,
  terminalOwner = null,
  rightPanelOpen,
  onToggleRightPanel,
  onRegisterHandle,
  showHeader = true,
  composerOnly = false,
}: Props) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
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
  const [terminalView, setTerminalView] = useState(false);
  const terminalSnapshot = usePersistentTerminalOwners(
    terminalView,
    terminalView ? terminalOwner : null,
  );
  const toggleTerminalView = useCallback(() => {
    setTerminalView((open) => {
      const next = !open;
      if (next && terminalOwner) rememberPersistentTerminalOwner(terminalOwner, { select: true });
      return next;
    });
  }, [terminalOwner]);
  useMountSubscription(() => {
    if (!isFocused) return;
    const onOpenTerminalEvent = (event: Event) => {
      const detail = (event as CustomEvent<OpenTerminalEventDetail>).detail;
      if (!detail?.mountKey) return;
      selectPersistentTerminalOwner(detail.mountKey);
      setTerminalView(true);
    };
    window.addEventListener(OPEN_TERMINAL_EVENT, onOpenTerminalEvent);
    return () => window.removeEventListener(OPEN_TERMINAL_EVENT, onOpenTerminalEvent);
  }, [isFocused]);
  const updateTab = onUpdateSession;
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
  useChatPaneContextAttachEffect({
    contextAttachRequest: tools.contextAttachRequest,
    isFocused,
    setAttachments,
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
  const composerInput = activeTab?.input ?? "";
  const composerAutosize = useComposerAutosize({ textareaRef, value: composerInput });
  const { selectedSkills, selectedPromptTemplates, removeLoadedContext } = useComposerLoadedContext(
    { activeTab, tools },
  );
  // Per-session choice wins; a fresh session (no saved level) falls back to the
  // level the user last picked, then the model's "high" default. This stops new
  // sessions from always snapping back to High (issue #277).
  const thinkingLevel = pickThinkingLevel(
    modelThinkingLevels,
    activeTab?.thinkingLevel,
    loadThinkingLevelDefault(),
  );
  const selectThinkingLevel = useCallback(
    (level: AgentThinkingLevel) => {
      if (!activeTab || running) return;
      // Persist on the session (survives turns + reloads) and remember it as the
      // default for the next fresh session.
      updateTab(activeTab.id, (session) => ({ ...session, thinkingLevel: level }));
      setThinkingLevelDefault(level);
    },
    [activeTab, running, updateTab],
  );
  const composerModelSelector = renderComposerModelSelector(modelSelector, {
    reasoningLevel: thinkingLevel,
    reasoningLevels: modelThinkingLevels,
    reasoningDisabled: Boolean(running),
    onSelectReasoning: selectThinkingLevel,
  });

  const activePiSessionId = activeTab?.piSessionId ?? null;
  const { goalRevision, goalAction, flushPendingGoal } = useGoalCommand(
    activePiSessionId,
    activeTabId,
  );
  const handlePiSessionIdAssigned = useCallback(
    (piSessionId: string) => {
      handlePiSessionIdChange(piSessionId);
      // A goal set on a brand-new chat has no id to key its write on; the first
      // turn response is the first moment it does, so land it here — but only
      // for the tab that actually queued it.
      flushPendingGoal(piSessionId, activeTabId);
    },
    [activeTabId, flushPendingGoal, handlePiSessionIdChange],
  );

  const engine = useSessionEngine({
    tabs,
    activeTabId,
    modelId,
    thinkingLevel,
    toolAccess: "full",
    cwd,
    browserToolEnabled,
    browserBackend,
    onPiSessionIdChange: handlePiSessionIdAssigned,
    updateSession: updateTab,
    selectionFor: tools.selectionFor,
  });
  const { compacting, compactSession } = useChatPaneRuntimeHandle({
    activeTab,
    activeTabId,
    engine,
    modelId,
    isFocused,
    onRegisterHandle,
    running: Boolean(running),
  });
  const openComputerStatus = useCallback(() => {
    tools.setComputerTab("status");
    tools.setComputerOpen(true);
  }, [tools]);
  const [diffDrawerOpen, setDiffDrawerOpen] = useState(false);
  const openDiffDrawer = useCallback(() => setDiffDrawerOpen(true), []);
  const closeDiffDrawer = useCallback(() => setDiffDrawerOpen(false), []);
  const exportSession = useCallback(() => {
    if (!activeTab) return;
    const markdown = sessionToMarkdown(activeTab.messages, displayedSessionTitle);
    downloadTextFile(exportFilenameFromTitle(displayedSessionTitle), markdown);
  }, [activeTab, displayedSessionTitle]);
  const canExport = Boolean(
    activeTab?.messages.some((message) => message.role !== "system" && message.text.trim()),
  );
  const openTerminalAction = terminalOwner ? toggleTerminalView : onOpenTerminal;
  const applyTemplate = useCallback(
    (row: ComposerPromptTemplateRef) =>
      activeTab ? applyContextRow(activeTab.id, "promptTemplate", row, tools) : Promise.resolve(),
    [activeTab, tools],
  );
  const applySkill = useCallback(
    (row: ComposerSkillRef) =>
      activeTab ? applyContextRow(activeTab.id, "skill", row, tools) : Promise.resolve(),
    [activeTab, tools],
  );
  const [goalModeOn, setGoalModeOn] = useState(false);
  // Goal mode is a property of the tab it was entered on, but the state lives
  // pane-wide — without this reset, entering goal mode in one tab silently
  // converted the next message of whatever tab was switched to into its goal.
  // Render-time derived-state reset (React's "adjusting state when a prop
  // changes" pattern), since effect hooks are banned in this codebase.
  const goalModeTabId = activeTab?.id ?? null;
  const [lastGoalModeTabId, setLastGoalModeTabId] = useState(goalModeTabId);
  if (lastGoalModeTabId !== goalModeTabId) {
    setLastGoalModeTabId(goalModeTabId);
    if (goalModeOn) setGoalModeOn(false);
  }
  const [automationDrawerOpen, setAutomationDrawerOpen] = useState(false);
  // Seed the automation with the last thing the user asked for: the common case
  // is "keep doing what I just asked, on a schedule".
  const lastUserPrompt = useMemo(
    () =>
      [...(activeTab?.messages ?? [])].reverse().find((message) => message.role === "user")?.text ??
      "",
    [activeTab?.messages],
  );
  const handleProjectPicked = useCallback(
    (project: Project) => {
      if (!activeTab || activeTab.messages.length > 0) return;
      updateTab(activeTab.id, (session) => ({
        ...session,
        projectId: project.id,
        cwd: project.path,
      }));
    },
    [activeTab, updateTab],
  );
  const commandRegistry = useMemo(
    () =>
      createComposerCommandRegistry([
        builtinCommandProvider({
          compact: () => void compactSession(),
          openStatus: openComputerStatus,
          toggleBrowserTool: onToggleBrowserTool,
          // The command is `/connectors`, so it lands on the tab it names
          // rather than on whichever tab the page happens to open with.
          openIntegrations: () => router.push("/settings#mcp"),
          ...(openTerminalAction ? { openTerminal: openTerminalAction } : {}),
          ...(onForkSession ? { forkSession: onForkSession } : {}),
          ...(canExport ? { exportSession } : {}),
          goal: goalAction,
          enterGoalMode: () => setGoalModeOn(true),
          openAutomation: () => setAutomationDrawerOpen(true),
        }),
        promptTemplateCommandProvider({
          templates: tools.promptTemplateCatalogue,
          applyTemplate,
        }),
        skillCommandProvider({ skills: tools.skillCatalogue, applySkill }),
      ]),
    [
      applySkill,
      applyTemplate,
      canExport,
      compactSession,
      goalAction,
      exportSession,
      onForkSession,
      onToggleBrowserTool,
      openComputerStatus,
      openTerminalAction,
      router,
      tools.promptTemplateCatalogue,
      tools.skillCatalogue,
    ],
  );
  const commandContext = useMemo(
    () => ({ running: Boolean(running), compacting }),
    [running, compacting],
  );
  const commandMatches = useMemo(
    () => (mention?.kind === "command" ? commandRegistry.match(mention.query, commandContext) : []),
    [commandContext, commandRegistry, mention],
  );
  const mentionRows = useComposerMentionRows({
    commandRows: commandMatches,
    fileMentionRows,
    mention,
    skillRows: tools.skillCatalogue,
  });
  const { runCommandInvocation, handleSelectMention } = useComposerCommandHandlers({
    activeTab,
    commandRegistry,
    commandContext,
    mention,
    setMention,
    resetComposerHeight: composerAutosize.reset,
    textareaRef,
    updateTab,
    selectMentionRow,
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
      resetComposerHeight: composerAutosize.reset,
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
      autosize: composerAutosize,
      updateTab,
      setMention,
      setMentionIndex,
      selectMentionRow: handleSelectMention,
      queueMessage,
      abortTurn,
      attachFiles,
    });
  const reportGoalError = useCallback(
    (message: string) => {
      if (activeTab) updateTab(activeTab.id, (tab) => ({ ...tab, error: message }));
    },
    [activeTab, updateTab],
  );
  const goalModeApi = useGoalMode({
    goalAction,
    reportError: reportGoalError,
    sendMessage,
    goalMode: goalModeOn,
    setGoalMode: setGoalModeOn,
  });
  const handleComposerSubmit = useCallback(
    (event: FormEvent) => {
      if (goalModeApi.submitAsGoal(event, activeTab?.input ?? "")) return;
      const invocation = parseSlashInvocation(activeTab?.input ?? "");
      if (invocation && commandRegistry.find(invocation.name, commandContext)) {
        event.preventDefault();
        void runCommandInvocation(invocation);
        return;
      }
      void sendMessage(event);
    },
    [activeTab, commandContext, commandRegistry, goalModeApi, runCommandInvocation, sendMessage],
  );
  const loadEarlierHistory = useCallback(
    () => (activeTabId ? engine.loadEarlier(activeTabId) : Promise.resolve()),
    [activeTabId, engine],
  );
  // Clear the prompt optimistically; a failed round-trip surfaces as the
  // session error rather than leaving a dead dialog on screen.
  const handleExtensionUiResponse = useCallback(
    (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      const request = activeTab?.extensionUiRequest;
      if (!activeTab || !request) return;
      updateTab(activeTab.id, (session) => ({ ...session, extensionUiRequest: undefined }));
      void respondExtensionUi(activeTab.id, request.requestId, response).catch((error) => {
        updateTab(activeTab.id, (session) => ({
          ...session,
          error: error instanceof Error ? error.message : "Extension response failed",
        }));
      });
    },
    [activeTab, updateTab],
  );
  const composerVisual = deriveComposerVisual({
    compacting,
    hasMessages: (activeTab?.messages.length ?? 0) > 0,
  });
  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className={chatPaneClassName(composerOnly)}
    >
      <ChatPaneChrome
        extensionUiRequest={activeTab?.extensionUiRequest}
        onExtensionUiRespond={handleExtensionUiResponse}
        showHeader={showHeader}
        terminalView={terminalView}
        terminalSnapshot={terminalSnapshot}
        header={{
          title: displayedSessionTitle,
          pinned: sessionPinned,
          rightPanelOpen,
          canFork: Boolean(onForkSession),
          canClose: Boolean(onClose),
          canExport,
          onTogglePinned: togglePinnedSession,
          onRename: renameActiveSession,
          onFork: onForkSession,
          onOpenTerminal: openTerminalAction,
          terminalOpen: terminalView,
          onExport: exportSession,
          onClose,
          onToggleRightPanel,
        }}
      />
      <ChatTranscript
        composerOnly={composerOnly}
        terminalView={terminalView}
        showEmptyPrompt={showEmptyPrompt}
        activeTab={activeTab}
        stickToBottom={stickToBottom}
        setStickToBottom={setStickToBottom}
        running={Boolean(running)}
        cwd={cwd}
        onForkSession={onForkSession}
        loadEarlierHistory={loadEarlierHistory}
      />
      <div className={terminalView ? "hidden" : "contents"}>
        {diffDrawerOpen ? (
          <GitDiffDrawer
            cwd={cwd || null}
            gitBranch={gitBranch}
            gitSummary={gitSummary}
            onClose={closeDiffDrawer}
          />
        ) : null}
        {automationDrawerOpen ? (
          <AutomationDrawer
            modelId={modelId}
            cwd={cwd}
            prompt={lastUserPrompt}
            onClose={() => setAutomationDrawerOpen(false)}
          />
        ) : null}
        <AgentComposerFrame
          attachments={attachments}
          banner={composerVisual.banner}
          browserToolEnabled={browserToolEnabled}
          browserBackend={browserBackend}
          composerDragActive={composerDragActive}
          contextWindow={effectiveContextWindow}
          currentContextTokens={currentContextTokens}
          cwd={cwd}
          fileInputRef={fileInputRef}
          gitBranch={gitBranch}
          gitSummary={gitSummary}
          input={composerInput}
          mention={mention}
          mentionIndex={mentionIndex}
          mentionRows={mentionRows}
          modelSupportsVision={modelSupportsVision}
          modelSelector={composerModelSelector}
          onAbortTurn={() => void abortTurn()}
          onAttachFiles={(files) => void attachFiles(files)}
          onComposerChange={handleComposerChange}
          onComposerDragLeave={handleComposerDragLeave}
          onComposerDragOver={handleComposerDragOver}
          onComposerDrop={handleComposerDrop}
          onComposerKeyDown={(event) => {
            if (goalModeApi.interceptKeyDown(event)) return;
            handleComposerKeyDown(event);
          }}
          onComposerPaste={handleComposerPaste}
          onInitGit={onInitGit}
          onOpenStatus={openComputerStatus}
          onOpenDiff={openDiffDrawer}
          onRemoveAttachment={removeAttachment}
          onRemoveLoadedContext={removeLoadedContext}
          onSelectMention={(entry) => void handleSelectMention(entry)}
          onSubmit={handleComposerSubmit}
          onToggleBrowserBackend={onToggleBrowserBackend}
          onToggleBrowserTool={onToggleBrowserTool}
          placeholder={goalModeApi.goalPlaceholder ?? composerVisual.placeholder}
          drawer={
            <SessionProjectDrawer
              tabId={activeTabId}
              piSessionId={activePiSessionId}
              revision={goalRevision}
              projectName={projectName}
              cwd={cwd}
              gitBranch={gitBranch}
              gitSummary={gitSummary}
              onInitGit={onInitGit}
              onOpenDiff={openDiffDrawer}
              showProjectRow={composerVisual.showProjectRow}
              running={Boolean(running)}
              onProjectPicked={handleProjectPicked}
              queueItems={visibleQueueItems}
              onEditQueued={editQueued}
              onRemoveQueued={removeQueued}
              onSteerQueued={(queueId) => void steerQueued(queueId)}
            />
          }
          showStatusBar={!composerVisual.showProjectRow}
          promptTemplates={selectedPromptTemplates}
          readingAttachments={readingAttachments}
          running={Boolean(running)}
          selectedSkills={selectedSkills}
          status={activeTab?.status}
          textareaRef={textareaRef}
          goalMode={goalModeApi.goalMode}
          onExitGoalMode={goalModeApi.exitGoalMode}
          floating={composerOnly}
          dense={!showHeader && !composerOnly}
        />
      </div>
    </section>
  );
}

/** The pane's fixed furniture: a pending extension prompt, the header, and the
 *  terminal surface that swaps places with the transcript. Kept out of ChatPane
 *  so the container reads as state and wiring rather than layout. */
function ChatPaneChrome({
  extensionUiRequest,
  onExtensionUiRespond,
  showHeader,
  terminalView,
  terminalSnapshot,
  header,
}: {
  extensionUiRequest: Session["extensionUiRequest"];
  onExtensionUiRespond: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
  showHeader: boolean;
  terminalView: boolean;
  terminalSnapshot: TerminalOwnersSnapshot;
  header: ComponentProps<typeof AgentChatPaneHeader>;
}) {
  return (
    <>
      {extensionUiRequest ? (
        <ExtensionUiDialog request={extensionUiRequest} onRespond={onExtensionUiRespond} />
      ) : null}
      {showHeader ? <AgentChatPaneHeader {...header} /> : null}
      <div className={terminalView ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>
        <PersistentTerminals
          active={terminalView}
          activeOwnerKey={terminalSnapshot.activeOwnerKey}
          terminals={terminalSnapshot.owners}
        />
      </div>
    </>
  );
}

/** Remounts per session so the goal poll and project selection never carry
 *  across tabs, and hides project switching while a turn is in flight. */
// The drawer's Interrupt button has no form event of its own, and sendMessage
// only ever uses the event to cancel the browser's native submit.

function SessionProjectDrawer({
  tabId,
  piSessionId,
  showProjectRow,
  running,
  ...rest
}: Omit<ComponentProps<typeof ComposerProjectDrawer>, "canPickProject" | "piSessionId"> & {
  tabId: string | null;
  piSessionId: string | null;
  showProjectRow: boolean;
  running: boolean;
}) {
  return (
    <ComposerProjectDrawer
      key={`${tabId}:${piSessionId ?? "new"}`}
      piSessionId={piSessionId}
      canPickProject={showProjectRow && !running}
      running={running}
      {...rest}
    />
  );
}
