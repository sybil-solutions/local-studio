"use client";

import { AgentModelPicker } from "@/features/agent/ui/agent-model-picker";
import { ChatPane } from "@/features/agent/ui/chat-pane";
import { TerminalPanel } from "@/features/agent/ui/terminal-panel";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import type { useTools } from "@/features/agent/tools/context";
import type { Project } from "@/features/agent/projects/types";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import type {
  AgentModel,
  ChatPaneState,
  PaneId,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import { terminalOwnerFor } from "@/features/agent/terminal-owners";
import { CloseIcon } from "@/ui/icons";
import { TerminalSquare } from "@/ui/icon-registry";
import { activeSession } from "@/features/agent/runtime/selectors";
import { collectLeaves } from "@/features/agent/workspace/layout";
import type { WorkspaceHandles } from "@/features/agent/ui/use-workspace";

export type WorkspacePaneRenderContext = {
  paneId: PaneId;
  state: WorkspaceState;
  projects: ProjectsContextValue;
  tools: ReturnType<typeof useTools>;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
  compact?: boolean;
};

type WorkspacePaneView = {
  paneId: PaneId;
  pane: ChatPaneState;
  session: ReturnType<typeof activeSession>;
  sessionList: NonNullable<ReturnType<typeof activeSession>>[];
  project: Project | null;
  cwd: string;
  modelId: string;
  model: AgentModel | null;
  gitSummary: ReturnType<ProjectsContextValue["gitSummary"]>;
  gitBranch: string | null;
  isNewSession: boolean;
  canClose: boolean;
  isFocused: boolean;
};

function paneGitBranch(
  summary: ReturnType<ProjectsContextValue["gitSummary"]>,
  project: Project | null,
): string | null {
  return summary?.isRepo === false ? null : (summary?.branch ?? project?.branch ?? null);
}

function resolvePaneModelId(
  sessionModelId: string | undefined,
  selectedModelId: string,
  models: AgentModel[],
): string {
  const candidates = [sessionModelId, selectedModelId].filter((value): value is string =>
    Boolean(value?.trim()),
  );
  for (const candidate of candidates) {
    const exact = models.find((model) => model.id === candidate);
    if (exact) return exact.id;
    const alias = models.find(
      (model) =>
        model.rawId === candidate || model.name === candidate || model.id.endsWith(`/${candidate}`),
    );
    if (alias) return alias.id;
  }
  return (
    selectedModelId ||
    sessionModelId ||
    models.find((model) => model.active)?.id ||
    models[0]?.id ||
    ""
  );
}

function selectWorkspacePaneView(
  paneId: PaneId,
  state: WorkspaceState,
  projects: ProjectsContextValue,
): WorkspacePaneView | null {
  const pane = state.panesById.get(paneId);
  if (!pane || pane.kind === "terminal") return null;
  const session = activeSession(state, paneId);
  const project = projects.resolveProject(session);
  const modelId = resolvePaneModelId(session?.modelId, state.selectedModel, state.models);
  const gitSummary = projects.gitSummary(project?.path);
  return {
    paneId,
    pane,
    session,
    sessionList: session ? [session] : [],
    project,
    cwd: session?.cwd ?? project?.path ?? projects.agentCwd,
    modelId,
    model: state.models.find((model) => model.id === modelId) ?? null,
    gitSummary,
    gitBranch: paneGitBranch(gitSummary, project),
    isNewSession: Boolean(session && !session.piSessionId && session.messages.length === 0),
    canClose: collectLeaves(state.layout).length > 1,
    isFocused: state.focusedPaneId === paneId,
  };
}

function TerminalWorkspacePane({
  paneId,
  title,
  cwd,
  ownerKey,
  focused,
  canClose,
  onFocus,
  onClose,
}: {
  paneId: PaneId;
  title: string;
  cwd: string | null;
  ownerKey: string;
  focused: boolean;
  canClose: boolean;
  onFocus: () => void;
  onClose: () => void;
}) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-1 flex-col bg-(--color-terminal-bg) ${
        focused ? "ring-1 ring-inset ring-(--accent)/45" : ""
      }`}
      onMouseDown={onFocus}
      data-pane-id={paneId}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-(--border)/85 bg-(--color-header) px-3 text-xs">
        <TerminalSquare className="h-3.5 w-3.5 text-(--dim)" />
        <span className="min-w-0 flex-1 truncate font-medium text-(--fg)" title={title}>
          {title}
        </span>
        {canClose ? (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
            onClick={onClose}
            aria-label="Close terminal pane"
            title="Close terminal pane"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        ) : null}
      </header>
      <TerminalPanel cwd={cwd} ownerKey={ownerKey} />
    </section>
  );
}

export function renderWorkspacePane({
  paneId,
  state,
  projects,
  tools,
  dispatch,
  handles,
  compact = false,
}: WorkspacePaneRenderContext) {
  const pane = state.panesById.get(paneId);
  if (pane?.kind === "terminal") {
    const canClose = collectLeaves(state.layout).length > 1;
    return (
      <TerminalWorkspacePane
        paneId={paneId}
        title={pane.owner.title}
        cwd={pane.owner.cwd}
        ownerKey={pane.owner.mountKey}
        focused={state.focusedPaneId === paneId}
        canClose={canClose}
        onFocus={() => dispatch({ type: "focusPane", paneId })}
        onClose={() => handles.closePane(paneId)}
      />
    );
  }
  const view = selectWorkspacePaneView(paneId, state, projects);
  if (!view) return null;

  return (
    <ChatPane
      key={view.paneId}
      paneId={view.paneId}
      modelId={view.modelId}
      modelName={view.model?.name ?? view.modelId ?? null}
      modelSupportsVision={view.model?.vision ?? false}
      modelsLoading={state.modelsLoading}
      contextWindow={view.model?.contextWindow ?? 0}
      cwd={view.cwd}
      projectName={view.project?.name ?? null}
      gitBranch={view.gitBranch}
      gitSummary={view.gitSummary}
      onInitGit={handles.initGitForActiveProject}
      modelSelector={
        <AgentModelPicker
          models={state.models}
          selectedModel={view.modelId}
          onSelect={(modelId) => handles.selectPaneModel(view.paneId, modelId)}
          loading={state.modelsLoading}
        />
      }
      browserToolEnabled={tools.browser.enabled}
      browserBackend={tools.browser.backend}
      onToggleBrowserBackend={tools.toggleBrowserBackend}
      onToggleBrowserTool={() => {
        if (tools.browser.enabled) {
          tools.setBrowserEnabled(false);
          tools.closeComputerTab("browser");
          return;
        }
        tools.setBrowserEnabled(true);
        tools.setComputerTab("browser");
      }}
      canvasEnabled={view.isFocused && tools.computer.canvasEnabled}
      onToggleCanvas={tools.toggleCanvas}
      onPiSessionIdChange={handles.notifySessionsChanged}
      isFocused={view.isFocused}
      onFocus={() => dispatch({ type: "focusPane", paneId: view.paneId })}
      tabs={view.sessionList}
      activeTabId={view.pane.sessionId}
      onTabsChange={(nextTabsOrUpdater) => handles.setPaneTabs(view.paneId, nextTabsOrUpdater)}
      onRenameSession={(tabId, title) => handles.renameTab(view.paneId, tabId, title)}
      onClose={view.canClose ? () => handles.closePane(view.paneId) : undefined}
      onForkSession={() => handles.splitTabIntoNewPane(view.paneId, view.pane.sessionId)}
      onOpenTerminal={() => {
        const owner = terminalOwnerFor(view.project, view.session);
        if (owner) handles.openTerminalPane(view.paneId, owner);
      }}
      rightPanelOpen={tools.computer.open}
      onToggleRightPanel={tools.toggleComputerOpen}
      onRegisterHandle={(handle) => handles.registerPaneHandle(view.paneId, handle)}
      showHeader={!compact}
    />
  );
}
