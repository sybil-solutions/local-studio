"use client";

import { memo } from "react";
import { AgentModelPicker } from "@/features/agent/ui/agent-model-picker";
import { ChatPane } from "@/features/agent/ui/chat-pane";
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
import { activeSession } from "@/features/agent/runtime/selectors";
import { terminalOwnerFor } from "@/features/agent/terminal-owners";
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
  composerOnly?: boolean;
};

export type WorkspacePaneView = {
  paneId: PaneId;
  pane: ChatPaneState;
  session: ReturnType<typeof activeSession>;
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
  if (!pane) return null;
  const session = activeSession(state, paneId);
  const project = projects.resolveProject(session);
  const modelId = resolvePaneModelId(session?.modelId, state.selectedModel, state.models);
  const gitSummary = projects.gitSummary(project?.path);
  return {
    paneId,
    pane,
    session,
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

export function sameWorkspacePaneView(
  previous: WorkspacePaneView,
  next: WorkspacePaneView,
): boolean {
  return (
    previous.paneId === next.paneId &&
    previous.pane === next.pane &&
    previous.session === next.session &&
    previous.project === next.project &&
    previous.cwd === next.cwd &&
    previous.modelId === next.modelId &&
    previous.model === next.model &&
    previous.gitSummary === next.gitSummary &&
    previous.gitBranch === next.gitBranch &&
    previous.isNewSession === next.isNewSession &&
    previous.canClose === next.canClose &&
    previous.isFocused === next.isFocused
  );
}

type WorkspacePaneProps = {
  view: WorkspacePaneView;
  models: AgentModel[];
  modelsLoading: boolean;
  defaultModel: string;
  tools: ReturnType<typeof useTools>;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
  compact: boolean;
  composerOnly: boolean;
};

function sameWorkspacePaneProps(previous: WorkspacePaneProps, next: WorkspacePaneProps): boolean {
  return (
    sameWorkspacePaneView(previous.view, next.view) &&
    previous.models === next.models &&
    previous.modelsLoading === next.modelsLoading &&
    previous.defaultModel === next.defaultModel &&
    previous.tools.browser.enabled === next.tools.browser.enabled &&
    previous.tools.browser.backend === next.tools.browser.backend &&
    previous.tools.computer.canvasEnabled === next.tools.computer.canvasEnabled &&
    previous.tools.computer.open === next.tools.computer.open &&
    previous.tools.toggleBrowserBackend === next.tools.toggleBrowserBackend &&
    previous.tools.setBrowserEnabled === next.tools.setBrowserEnabled &&
    previous.tools.closeComputerTab === next.tools.closeComputerTab &&
    previous.tools.setComputerTab === next.tools.setComputerTab &&
    previous.tools.toggleCanvas === next.tools.toggleCanvas &&
    previous.tools.toggleComputerOpen === next.tools.toggleComputerOpen &&
    previous.dispatch === next.dispatch &&
    previous.handles === next.handles &&
    previous.compact === next.compact &&
    previous.composerOnly === next.composerOnly
  );
}

const WorkspacePane = memo(function WorkspacePane({
  view,
  models,
  modelsLoading,
  defaultModel,
  tools,
  dispatch,
  handles,
  compact,
  composerOnly,
}: WorkspacePaneProps) {
  const sessions = view.session ? [view.session] : [];
  return (
    <ChatPane
      paneId={view.paneId}
      modelId={view.modelId}
      modelName={view.model?.name ?? view.modelId ?? null}
      modelSupportsVision={view.model?.vision ?? false}
      modelsLoading={modelsLoading}
      contextWindow={view.model?.contextWindow ?? 0}
      cwd={view.cwd}
      projectName={view.project?.name ?? null}
      gitBranch={view.gitBranch}
      gitSummary={view.gitSummary}
      onInitGit={handles.initGitForActiveProject}
      modelSelector={
        <AgentModelPicker
          models={models}
          selectedModel={view.modelId}
          defaultModel={defaultModel}
          onSelect={(modelId) => handles.selectPaneModel(view.paneId, modelId)}
          onSetDefault={handles.setDefaultModel}
          loading={modelsLoading}
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
      tabs={sessions}
      activeTabId={view.pane.sessionId}
      onUpdateSession={handles.updateSession}
      onRenameSession={(tabId, title) => handles.renameTab(view.paneId, tabId, title)}
      onClose={view.canClose ? () => handles.closePane(view.paneId) : undefined}
      onForkSession={() => handles.splitTabIntoNewPane(view.paneId, view.pane.sessionId)}
      terminalOwner={terminalOwnerFor(view.project, view.session)}
      onOpenTerminal={() => tools.setComputerTab("terminal")}
      rightPanelOpen={tools.computer.open}
      onToggleRightPanel={tools.toggleComputerOpen}
      onRegisterHandle={(handle) => handles.registerPaneHandle(view.paneId, handle)}
      showHeader={!compact}
      composerOnly={composerOnly}
    />
  );
}, sameWorkspacePaneProps);

export function renderWorkspacePane({
  paneId,
  state,
  projects,
  tools,
  dispatch,
  handles,
  compact = false,
  composerOnly = false,
}: WorkspacePaneRenderContext) {
  const view = selectWorkspacePaneView(paneId, state, projects);
  if (!view) return null;

  return (
    <WorkspacePane
      key={view.paneId}
      view={view}
      models={state.models}
      modelsLoading={state.modelsLoading}
      defaultModel={state.selectedModel}
      tools={tools}
      dispatch={dispatch}
      handles={handles}
      compact={compact}
      composerOnly={composerOnly}
    />
  );
}
