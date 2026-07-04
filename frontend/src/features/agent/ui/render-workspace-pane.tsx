"use client";

import { AgentModelPicker } from "@/features/agent/ui/agent-model-picker";
import { ChatPane } from "@/features/agent/ui/chat-pane";
import { TerminalPane } from "@/features/agent/ui/terminal-pane";
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
import { collectLeaves } from "@/features/agent/workspace/layout";
import { canRestoreTerminalOwner } from "@/features/agent/workspace/pane-controller";
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
    return (
      <TerminalPane
        key={paneId}
        paneId={paneId}
        pane={pane}
        canClose={collectLeaves(state.layout).length > 1 || canRestoreTerminalOwner(state, paneId)}
        onFocus={() => dispatch({ type: "focusPane", paneId })}
        onClose={() => handles.closePane(paneId)}
      />
    );
  }
  const view = selectWorkspacePaneView(paneId, state, projects);
  if (!view) return null;
  const browserPanelOpen =
    view.isFocused &&
    tools.browser.enabled &&
    tools.computer.open &&
    tools.computer.tab === "browser";

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
      browserToolEnabled={browserPanelOpen}
      browserBackend={tools.browser.backend}
      onToggleBrowserBackend={tools.toggleBrowserBackend}
      onToggleBrowserTool={() => {
        if (browserPanelOpen) {
          tools.closeComputerTab("browser");
          tools.setBrowserEnabled(false);
          return;
        }
        tools.setComputerTab("browser");
        tools.setBrowserEnabled(true);
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
      onOpenTerminal={() => handles.openTerminalPane(view.paneId)}
      rightPanelOpen={tools.computer.open}
      onToggleRightPanel={tools.toggleComputerOpen}
      onRegisterHandle={(handle) => handles.registerPaneHandle(view.paneId, handle)}
      showHeader={!compact}
    />
  );
}
