"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { AgentChatPaneHeader } from "@/features/agent/ui/agent-chat-pane-header";
import { AgentComposerFrame } from "@/features/agent/ui/agent-composer-frame";
import { type FileMentionRow, type MentionRow } from "@/features/agent/ui/agent-composer-context";
import { builtinCommandProvider } from "@/features/agent/composer/builtin-commands";
import { SessionGoalBar } from "@/features/agent/ui/session-goal-bar";
import { SubagentChips } from "@/features/agent/ui/subagent-chips";
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
import { ADD_PROJECT_EVENT } from "@/lib/workspace-events";

function diffStatPill(gitSummary: GitSummary | null | undefined, onOpenStatus: () => void) {
  if (!gitSummary?.isRepo || gitSummary.statusCount <= 0) return null;
  return (
    <div className="mx-auto mb-1.5 flex w-full max-w-[var(--composer-w)] justify-center">
      <button
        type="button"
        onClick={onOpenStatus}
        className="flex items-center gap-1.5 rounded-full bg-(--fg)/[0.05] px-3 py-1 text-[length:var(--fs-sm)] tabular-nums text-(--fg)/60 transition-colors hover:bg-(--fg)/[0.08] hover:text-(--fg)/85"
        title="Open status"
      >
        {gitSummary.statusCount} file{gitSummary.statusCount === 1 ? "" : "s"} changed
        <span className="text-(--ok,#40c977)">+{gitSummary.additions}</span>
        <span className="text-(--err)">−{gitSummary.deletions}</span>
      </button>
    </div>
  );
}

function goalBarFor(piSessionId: string | null | undefined, revision: number) {
  if (!piSessionId) return null;
  return <SessionGoalBar piSessionId={piSessionId} revision={revision} />;
}

function piSessionIdOf(tab: { piSessionId?: string | null } | null | undefined): string | null {
  return tab?.piSessionId ?? null;
}

function subagentChipsFor(piSessionId: string | null | undefined) {
  if (!piSessionId) return null;
  return <SubagentChips piSessionId={piSessionId} />;
}

function composerProjectRow(show: boolean, projectName: string | null) {
  if (!show) return null;
  return {
    label: projectName ?? "Choose project",
    onPick: () => window.dispatchEvent(new Event(ADD_PROJECT_EVENT)),
  };
}
import {
  useComposerLoadedContext,
  useComposerMentionRows,
  useComposerTextareaBehavior,
  useComposerTextareaHeightSync,
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
import { useChatPaneSendFlow } from "@/features/agent/ui/chat-pane-send-flow";
import { ChatPaneHandle, SessionTab } from "@/features/agent/messages";
import { useSessionEngine } from "@/features/agent/runtime/engine";
import type { UpdateSession } from "@/features/agent/runtime/types";
import { useTools } from "@/features/agent/tools/context";
import type { GitSummary } from "@/features/agent/projects/types";
import type { BrowserBackend } from "@/features/agent/tools/types";
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
} from "@/features/agent/ui/use-persistent-terminal-owners";
import { PersistentTerminals } from "@/features/agent/ui/persistent-terminals";
import { cx } from "@/ui/utils";
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
  onForkSession,
  loadEarlierHistory,
}: {
  composerOnly: boolean;
  terminalView: boolean;
  showEmptyPrompt: boolean;
  activeTab: SessionTab | undefined;
  stickToBottom: boolean;
  setStickToBottom: (value: boolean) => void;
  running: boolean;
  onForkSession?: () => void;
  loadEarlierHistory: () => Promise<void>;
}) {
  const viewKey = activeTab?.piSessionId ?? activeTab?.id ?? null;
  const viewAlias = activeTab?.piSessionId ? activeTab.id : null;
  if (composerOnly) return null;
  return (
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
          viewKey={viewKey}
          viewAlias={viewAlias}
          onForkSession={onForkSession}
          hasEarlier={activeTab?.historyCursor != null}
          onLoadEarlier={loadEarlierHistory}
        />
      )}
    </div>
  );
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
  const { selectedSkills, selectedPromptTemplates, removeLoadedContext } = useComposerLoadedContext(
    { activeTab, tools },
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
  const [goalRevision, setGoalRevision] = useState(0);
  const activePiSessionId = piSessionIdOf(activeTab);
  const goalAction = useCallback(
    async (args: string): Promise<string | null> => {
      const piSessionId = activePiSessionId;
      if (!piSessionId) return "Send a first message, then set a goal for this session.";
      if (!args) return "Usage: /goal <objective> — or /goal pause · resume · clear";
      const url = `/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`;
      const verb = args.split(/\s+/)[0]?.toLowerCase() ?? "";
      try {
        if (verb === "clear") {
          await fetch(url, { method: "DELETE" });
        } else if (verb === "pause" || verb === "resume") {
          await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: verb === "pause" ? "paused" : "active" }),
          });
        } else {
          await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ objective: args, status: "active", resetTurns: true }),
          });
        }
        setGoalRevision((value) => value + 1);
        return null;
      } catch {
        return "Failed to update the goal.";
      }
    },
    [activePiSessionId],
  );
  const commandRegistry = useMemo(
    () =>
      createComposerCommandRegistry([
        builtinCommandProvider({
          compact: () => void compactSession(),
          openStatus: openComputerStatus,
          toggleBrowserTool: onToggleBrowserTool,
          toggleCanvas: onToggleCanvas,
          openPlugins: () => router.push("/integrations"),
          ...(openTerminalAction ? { openTerminal: openTerminalAction } : {}),
          ...(onForkSession ? { forkSession: onForkSession } : {}),
          ...(canExport ? { exportSession } : {}),
          goal: goalAction,
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
      onToggleCanvas,
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
  const runCommandInvocation = useCallback(
    async (invocation: SlashInvocation) => {
      if (!activeTab) return;
      const execution = commandRegistry.execute(invocation, commandContext);
      if (!execution) return;
      const tabId = activeTab.id;
      const outcome = await execution;
      if (outcome.kind === "error") {
        updateTab(tabId, (tab) => ({ ...tab, error: outcome.message }));
      } else {
        const nextInput = outcome.kind === "set-input" ? outcome.input : "";
        updateTab(tabId, (tab) => ({ ...tab, input: nextInput, error: "" }));
        if (!nextInput) resetComposerHeight();
      }
      setMention(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [activeTab, commandContext, commandRegistry, resetComposerHeight, updateTab],
  );
  const handleSelectMention = useCallback(
    (entry: MentionRow): Promise<void> => {
      if (entry.kind === "command" && activeTab && mention) {
        const args = consumeComposerMention(activeTab.input, mention).trim();
        return runCommandInvocation({ name: entry.row.name, args });
      }
      return selectMentionRow(entry);
    },
    [activeTab, mention, runCommandInvocation, selectMentionRow],
  );
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
      selectMentionRow: handleSelectMention,
      queueMessage,
      abortTurn,
      attachFiles,
    });
  const handleComposerSubmit = useCallback(
    (event: FormEvent) => {
      const invocation = parseSlashInvocation(activeTab?.input ?? "");
      if (invocation && commandRegistry.find(invocation.name, commandContext)) {
        event.preventDefault();
        void runCommandInvocation(invocation);
        return;
      }
      void sendMessage(event);
    },
    [activeTab, commandContext, commandRegistry, runCommandInvocation, sendMessage],
  );
  const handleTranscript = useCallback(
    (transcript: string) => {
      if (!activeTab) return;
      const current = activeTab.input.trimEnd();
      const next = current ? `${current} ${transcript}` : transcript;
      updateTab(activeTab.id, (tab) => ({ ...tab, input: next }));
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(next.length, next.length);
      });
    },
    [activeTab, updateTab],
  );
  const loadEarlierHistory = useCallback(
    () => (activeTabId ? engine.loadEarlier(activeTabId) : Promise.resolve()),
    [activeTabId, engine],
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
          onOpenTerminal={terminalOwner ? toggleTerminalView : onOpenTerminal}
          terminalOpen={terminalView}
          onExport={exportSession}
          onClose={onClose}
          onToggleRightPanel={onToggleRightPanel}
        />
      ) : null}
      <div className={terminalView ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>
        <PersistentTerminals
          active={terminalView}
          activeOwnerKey={terminalSnapshot.activeOwnerKey}
          terminals={terminalSnapshot.owners}
        />
      </div>
      <ChatTranscript
        composerOnly={composerOnly}
        terminalView={terminalView}
        showEmptyPrompt={showEmptyPrompt}
        activeTab={activeTab}
        stickToBottom={stickToBottom}
        setStickToBottom={setStickToBottom}
        running={Boolean(running)}
        onForkSession={onForkSession}
        loadEarlierHistory={loadEarlierHistory}
      />
      <div className={terminalView ? "hidden" : "contents"}>
        {diffStatPill(gitSummary, openComputerStatus)}
        {subagentChipsFor(activePiSessionId)}
        {goalBarFor(activePiSessionId, goalRevision)}
        <AgentComposerFrame
          attachments={attachments}
          banner={composerVisual.banner}
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
          onSelectMention={(entry) => void handleSelectMention(entry)}
          onSteerQueued={(queueId) => void steerQueued(queueId)}
          onSubmit={handleComposerSubmit}
          onTranscript={handleTranscript}
          onToggleBrowserBackend={onToggleBrowserBackend}
          onToggleBrowserTool={onToggleBrowserTool}
          onToggleCanvas={onToggleCanvas}
          placeholder={composerVisual.placeholder}
          projectRow={composerProjectRow(composerVisual.showProjectRow, projectName)}
          promptTemplates={selectedPromptTemplates}
          queueExpanded={queueExpanded}
          queueItems={visibleQueueItems}
          readingAttachments={readingAttachments}
          running={Boolean(running)}
          selectedSkills={selectedSkills}
          status={activeTab?.status}
          textareaRef={textareaRef}
          floating={composerOnly}
          dense={!showHeader && !composerOnly}
        />
      </div>
    </section>
  );
}
