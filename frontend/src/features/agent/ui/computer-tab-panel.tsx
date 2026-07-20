"use client";

import { Suspense, lazy, useCallback, type ReactNode } from "react";
import {
  FolderTree,
  GitBranch,
  Globe2,
  ListChecks,
  MessageSquarePlus,
  ScanSearch,
  TerminalSquare,
} from "@/ui/icon-registry";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import type { ComputerTab } from "@/features/agent/tools/types";
import type { Project, GitSummary } from "@/features/agent/projects/types";
import type { Session, UpdateSession } from "@/features/agent/runtime/types";
import type { AgentModel } from "@/features/agent/workspace/types";
import { AgentModelPicker } from "@/features/agent/ui/agent-model-picker";
import { ChatPane } from "@/features/agent/ui/chat-pane";

const LazyAgentBrowser = lazy(() =>
  import("@/features/agent/ui/agent-browser").then(({ AgentBrowser }) => ({
    default: AgentBrowser,
  })),
);
const LazyCanvasPanel = lazy(() =>
  import("@/features/agent/ui/canvas-panel").then(({ CanvasPanel }) => ({
    default: CanvasPanel,
  })),
);
const LazyComputerStatusPanel = lazy(() =>
  import("@/features/agent/ui/computer-status-panel").then(({ ComputerStatusPanel }) => ({
    default: ComputerStatusPanel,
  })),
);
const LazyFilesystemPanel = lazy(() =>
  import("@/features/agent/ui/filesystem-panel").then(({ FilesystemPanel }) => ({
    default: FilesystemPanel,
  })),
);
const LazyGitDiffPanel = lazy(() =>
  import("@/features/agent/ui/git-diff-panel").then(({ GitDiffPanel }) => ({
    default: GitDiffPanel,
  })),
);
const LazyPlanPanel = lazy(() =>
  import("@/features/agent/ui/plan-panel").then(({ PlanPanel }) => ({
    default: PlanPanel,
  })),
);
const LazyInspectorPanel = lazy(() =>
  import("@/features/agent/ui/inspector-panel").then(({ InspectorPanel }) => ({
    default: InspectorPanel,
  })),
);

export type SideChatTabsUpdater = Session[] | ((tabs: Session[]) => Session[]);

export type SideChatDraft = {
  title: string;
  input: string;
};

type ComputerTabPanelProps = {
  activeModel: AgentModel | null;
  activeModelId: string;
  activeProject: Project | null;
  focusedSession: Session | null;
  gitSummary?: GitSummary | null;
  models: AgentModel[];
  modelsLoading: boolean;
  isElectron: boolean;
  onCloseSideChat: () => void;
  onCompactSession?: () => Promise<void>;
  onNavigateBrowser: (value: string) => void;
  onOpenSideChat: (draft?: SideChatDraft) => void;
  onOpenTerminal: () => void;
  onRenameSideChat: (tabId: string, title: string) => void;
  onUpdateSideChatTabs: (nextTabsOrUpdater: SideChatTabsUpdater) => void;
  sessions: Session[];
  sideChatSession: Session;
  tools: ToolsContextValue;
};

export function ComputerTabPanel(props: ComputerTabPanelProps) {
  const focusedCwd = props.focusedSession?.cwd ?? props.activeProject?.path ?? null;
  const panels: Record<ComputerTab, ReactNode> = {
    status: <StatusTab {...props} />,
    tools: <ComputerLauncherPanel activeTab={props.tools.computer.tab} {...props} />,
    canvas: <LazyCanvasPanel />,
    "side-chat": <SideChatTab {...props} />,
    browser: <BrowserTab {...props} />,
    files: <FilesTab cwd={focusedCwd} />,
    diff: <LazyGitDiffPanel cwd={focusedCwd} />,
    plan: (
      <LazyPlanPanel
        sessionId={props.focusedSession?.id ?? null}
        onOpenTaskSideChat={(todo) =>
          props.onOpenSideChat({
            title: todo.content || "Plan task",
            input: buildPlanTaskPrompt(todo.content),
          })
        }
      />
    ),
    inspector: <LazyInspectorPanel session={props.focusedSession} />,
    terminal: null,
  };
  return <Suspense fallback={<ComputerTabFallback />}>{panels[props.tools.computer.tab]}</Suspense>;
}

function buildPlanTaskPrompt(task: string): string {
  const title = task.trim() || "this plan task";
  return `Help me complete this plan task:\n\n${title}\n\nFocus only on this task. Start by checking the relevant project context, then either make the smallest correct change or explain the next concrete step.`;
}

function StatusTab({
  activeModel,
  activeProject,
  focusedSession,
  gitSummary,
  onCompactSession,
  sessions,
}: ComputerTabPanelProps) {
  return (
    <LazyComputerStatusPanel
      activeProject={activeProject}
      activeModel={activeModel}
      focusedSession={focusedSession}
      sessions={sessions}
      gitSummary={gitSummary}
      onCompactSession={onCompactSession}
    />
  );
}

function SideChatTab({
  activeModel,
  activeModelId,
  activeProject,
  focusedSession,
  models,
  modelsLoading,
  onCloseSideChat,
  onRenameSideChat,
  onUpdateSideChatTabs,
  sideChatSession,
  tools,
}: ComputerTabPanelProps) {
  const modelId = sideChatSession.modelId ?? focusedSession?.modelId ?? activeModelId;
  const selectedModel = models.find((model) => model.id === modelId) ?? activeModel;
  const cwd = sideChatSession.cwd ?? focusedSession?.cwd ?? activeProject?.path ?? "";
  const updateSession = useCallback<UpdateSession>(
    (sessionId, patch) =>
      onUpdateSideChatTabs((tabs) => tabs.map((tab) => (tab.id === sessionId ? patch(tab) : tab))),
    [onUpdateSideChatTabs],
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <ChatPane
        paneId="computer-side-chat"
        modelId={modelId}
        modelName={selectedModel?.name ?? modelId}
        modelSupportsVision={selectedModel?.vision ?? false}
        modelsLoading={modelsLoading}
        contextWindow={selectedModel?.contextWindow ?? 0}
        cwd={cwd}
        projectName={activeProject?.name ?? null}
        modelSelector={
          <AgentModelPicker
            models={models}
            selectedModel={modelId}
            onSelect={(nextModelId) =>
              onUpdateSideChatTabs((tabs) => tabs.map((tab) => ({ ...tab, modelId: nextModelId })))
            }
            loading={modelsLoading}
          />
        }
        browserToolEnabled={false}
        browserBackend={tools.browser.backend}
        onToggleBrowserBackend={tools.toggleBrowserBackend}
        onToggleBrowserTool={() => tools.setComputerTab("browser")}
        canvasEnabled={false}
        onToggleCanvas={tools.toggleCanvas}
        isFocused
        onFocus={() => undefined}
        tabs={[sideChatSession]}
        activeTabId={sideChatSession.id}
        onUpdateSession={updateSession}
        onRenameSession={onRenameSideChat}
        onClose={onCloseSideChat}
        rightPanelOpen
        onToggleRightPanel={() => tools.setComputerOpen(false)}
        showHeader={false}
      />
    </section>
  );
}

function BrowserTab({ isElectron, onNavigateBrowser, tools }: ComputerTabPanelProps) {
  return (
    <LazyAgentBrowser
      url={tools.browser.url}
      inputValue={tools.browser.input}
      onInputChange={tools.setBrowserInput}
      onNavigate={onNavigateBrowser}
      onLocationChange={(next) => tools.setBrowserUrl(next, next)}
      onClose={() => tools.setComputerOpen(false)}
      isElectron={isElectron}
      visible={tools.computer.open}
    />
  );
}

function FilesTab({ cwd }: { cwd: string | null }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <LazyFilesystemPanel cwd={cwd} />
      </div>
    </section>
  );
}

function ComputerTabFallback() {
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center bg-(--color-panel) text-xs text-(--dim)">
      Loading...
    </section>
  );
}

function ComputerLauncherPanel({
  activeTab,
  onOpenSideChat,
  onOpenTerminal,
  tools,
}: ComputerTabPanelProps & { activeTab: ComputerTab }) {
  const cards = [
    {
      key: "files",
      title: "Files",
      description: "Browse project files",
      icon: FolderTree,
      onClick: () => tools.setComputerTab("files"),
    },
    {
      key: "side-chat",
      title: "Side chat",
      description: "Start a side conversation",
      icon: MessageSquarePlus,
      onClick: () => onOpenSideChat(),
    },
    {
      key: "plan",
      title: "Plan",
      description: "Plan and track to-dos",
      icon: ListChecks,
      onClick: () => tools.setComputerTab("plan"),
    },
    {
      key: "browser",
      title: "Browser",
      description: "Open a website",
      icon: Globe2,
      onClick: () => tools.setComputerTab("browser"),
    },
    {
      key: "diff",
      title: "Review",
      description: "View code changes",
      icon: GitBranch,
      onClick: () => tools.setComputerTab("diff"),
    },
    {
      key: "inspector",
      title: "Inspector",
      description: "Per-turn tools, files, and context",
      icon: ScanSearch,
      onClick: () => tools.setComputerTab("inspector"),
    },
    {
      key: "terminal",
      title: "Terminal",
      description: "Start an interactive shell",
      icon: TerminalSquare,
      onClick: onOpenTerminal,
    },
  ] as const;
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-(--color-panel) px-3 py-3">
      <div className="flex flex-col gap-1">
        {cards.map((card) => {
          const Icon = "icon" in card ? card.icon : null;
          const selected = card.key !== "side-chat" && activeTab === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={card.onClick}
              className={`group flex min-h-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                selected
                  ? "bg-(--color-surface-hover) text-(--fg)"
                  : "text-(--fg)/75 hover:bg-(--hover) hover:text-(--fg)"
              }`}
            >
              {Icon ? (
                <Icon className="h-4 w-4 shrink-0 text-(--dim)/75 transition-colors group-hover:text-(--fg)/80" />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--fs-lg)] font-medium">
                  {card.title}
                </span>
                <span className="block truncate text-[length:var(--fs-sm)] text-(--dim)">
                  {card.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
