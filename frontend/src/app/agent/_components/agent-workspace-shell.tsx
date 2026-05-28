"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { loadSavedControllers } from "@/lib/controllers";
import { getStoredBackendUrl } from "@/lib/backend-url";
import { useSearchParams } from "next/navigation";
import { triggerAddProjectFlow } from "@/components/projects-nav-section";
import { ChevronDownIcon, CloseIcon, PlusIcon } from "@/components/icons";
import type { WorkspaceDispatch } from "@/lib/agent/workspace/effects";
import type { AgentModel, PaneId, PaneState, WorkspaceState } from "@/lib/agent/workspace/types";
import { useProjects, type ProjectsContextValue } from "@/lib/agent/projects/context";
import { useTools } from "@/lib/agent/tools/context";
import type { Project } from "@/lib/agent/projects/types";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useAgentWorkspaceNavigationEffects } from "@/hooks/agent/use-agent-workspace-navigation-effects";
import { useActiveCanvasSessionEffects } from "@/hooks/agent/use-active-canvas-session-effects";
import { activeSession, focusedSession } from "@/lib/agent/sessions/selectors";
import { AgentBrowserPanel } from "./agent-browser-panel";
import { ChatPane } from "./chat-pane";
import { PaneGrid } from "./pane-grid";
import { collectLeaves } from "@/lib/agent/workspace/layout";
import type { WorkspaceHandles } from "./use-workspace";

type AgentWorkspaceShellProps = {
  state: WorkspaceState;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
};

export function shouldShowProjectEmptyState(
  projects: ProjectsContextValue,
  projectParam: string | null,
): boolean {
  return (
    projects.loaded &&
    !projectParam &&
    !projects.selectedProjectId &&
    projects.projects.length === 0
  );
}

export function AgentWorkspaceShell({ state, dispatch, handles }: AgentWorkspaceShellProps) {
  const projects = useProjects();
  const tools = useTools();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  useAgentWorkspaceNavigationEffects({
    lastHandledNavKey: state.lastHandledNavKey,
    projects,
    searchParams,
    dispatch,
  });

  const focusedTab = focusedSession(state);
  // The right panel (browser / files / git / terminal / status) follows the
  // FOCUSED session, not the workspace-global selectedProject. Otherwise
  // splitting/switching panes leaves the right panel pinned to whichever
  // project was active when the panel was first opened.
  const activeProject = projects.resolveProject(focusedTab) ?? projects.selectedProject;
  useActiveCanvasSessionEffects({
    sessionId: focusedTab?.id ?? null,
    setActiveCanvasSession: tools.setActiveCanvasSession,
  });
  const focusedModel =
    state.models.find((model) => model.id === (focusedTab?.modelId ?? state.selectedModel)) ?? null;
  const focusedGitSummary = projects.gitSummary(activeProject?.path ?? focusedTab?.cwd);
  return (
    <div className="agent-workspace flex h-full min-h-0 w-full flex-col bg-(--agent-bg) text-(--fg) md:h-[100dvh]">
      <div className="flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          <WorkspaceTopBar
            error={state.error}
            setupWarning={state.setupWarning}
            onClearError={() => dispatch({ type: "setError", error: "" })}
          />
          {shouldShowProjectEmptyState(projects, projectParam) ? (
            <ProjectEmptyState />
          ) : (
            <div className="min-h-0 flex-1">
              <PaneGrid
                layout={state.layout}
                renderPane={(paneId) =>
                  renderWorkspacePane({ paneId, state, projects, tools, dispatch, handles })
                }
                onSplit={handles.splitPaneWithPayload}
                onOpenTab={handles.openSessionPayloadInPane}
                onResize={handles.setSplitRatio}
              />
            </div>
          )}
        </section>
        <AgentBrowserPanel
          handles={handles}
          activeProject={activeProject}
          focusedSession={focusedTab}
          sessions={[...state.sessions.values()]}
          activeModelId={focusedTab?.modelId ?? state.selectedModel}
          activeModel={focusedModel}
          gitSummary={focusedGitSummary}
        />
      </div>
    </div>
  );
}

function WorkspaceTopBar({
  error,
  setupWarning,
  onClearError,
}: {
  error: string;
  setupWarning: string;
  onClearError: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start gap-3 px-3 pt-2">
      <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2">
        {error ? (
          <WorkspaceBanner tone="error" onDismiss={onClearError}>
            {error}
          </WorkspaceBanner>
        ) : null}
        {setupWarning ? <WorkspaceBanner tone="warning">{setupWarning}</WorkspaceBanner> : null}
      </div>
    </div>
  );
}

function WorkspaceBanner({
  tone,
  onDismiss,
  children,
}: {
  tone: "error" | "warning";
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const toneClass =
    tone === "error"
      ? "border-(--err)/35 bg-(--err)/10 text-(--err)"
      : "border-(--warn)/35 bg-(--warn)/10 text-(--fg)";
  return (
    <div
      className={`flex min-w-0 max-w-full items-center gap-2 rounded border px-2 py-1 text-xs ${toneClass}`}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-current opacity-70 hover:opacity-100"
          aria-label="Dismiss error"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function ProjectEmptyState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="text-sm font-semibold text-(--fg)">Add a project to get started</div>
        <p className="mt-2 text-xs leading-5 text-(--dim)">
          Choose a local folder so the agent can scope files and sessions to your work.
        </p>
        <button
          type="button"
          onClick={triggerAddProjectFlow}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded border border-(--border) bg-(--surface) px-3 text-sm font-medium text-(--fg) hover:bg-(--bg)"
        >
          <PlusIcon className="h-4 w-4" />
          Add a project
        </button>
      </div>
    </div>
  );
}

type WorkspacePaneRenderContext = {
  paneId: PaneId;
  state: WorkspaceState;
  projects: ProjectsContextValue;
  tools: ReturnType<typeof useTools>;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
};

type WorkspacePaneView = {
  paneId: PaneId;
  pane: PaneState;
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

function renderWorkspacePane({
  paneId,
  state,
  projects,
  tools,
  dispatch,
  handles,
}: WorkspacePaneRenderContext) {
  const view = selectWorkspacePaneView(paneId, state, projects);
  if (!view) return null;

  return (
    <ChatPane
      key={view.paneId}
      paneId={view.paneId}
      runtimeSessionId={view.pane.runtimeSessionId}
      modelId={view.modelId}
      modelName={view.model?.name ?? view.modelId ?? null}
      modelsLoading={state.modelsLoading}
      contextWindow={view.model?.contextWindow ?? 0}
      cwd={view.cwd}
      projectName={view.project?.name ?? null}
      gitBranch={view.gitBranch}
      gitSummary={view.gitSummary}
      onInitGit={handles.initGitForActiveProject}
      modelSelector={
        <ModelPicker
          models={state.models}
          selectedModel={view.modelId}
          onSelect={(modelId) => handles.selectPaneModel(view.paneId, modelId)}
          loading={state.modelsLoading}
        />
      }
      browserToolEnabled={view.isFocused && tools.browser.enabled}
      onToggleBrowserTool={() => {
        tools.setComputerTab("browser");
        if (!tools.browser.enabled) tools.setBrowserEnabled(true);
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
      rightPanelOpen={tools.computer.open}
      onToggleRightPanel={tools.toggleComputerOpen}
      onRegisterHandle={(handle) => handles.registerPaneHandle(view.paneId, handle)}
    />
  );
}

function ModelPicker({
  models,
  selectedModel,
  onSelect,
  loading,
}: {
  models: AgentModel[];
  selectedModel: string;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const controllerLabel = useActiveControllerLabel();
  const active = models.find((model) => model.id === selectedModel) || null;
  const fallbackLabel = selectedModel || "";
  const triggerLabel = loading
    ? active?.name || fallbackLabel || "Loading…"
    : active?.name || fallbackLabel || (models.length === 0 ? "No models" : "Select model");
  const disabled = loading || models.length === 0;

  return (
    <div
      className="relative shrink-0"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setOpen(false);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => {
          if (disabled) return;
          setOpen((value) => !value);
        }}
        disabled={disabled}
        className="inline-flex !h-7 !min-h-7 !min-w-0 max-w-[168px] items-center gap-1.5 rounded-md bg-transparent px-2 !text-xs text-(--fg) hover:bg-(--hover) disabled:opacity-60"
        title={active?.name || triggerLabel}
      >
        <span className="min-w-0 max-w-[136px] truncate">{triggerLabel}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0 text-(--dim)" />
      </button>
      {open ? (
        <div
          className="absolute bottom-9 right-0 z-[80] w-80 overflow-hidden rounded-md border border-(--border) bg-[#151515] shadow-[0_12px_36px_rgba(0,0,0,0.65)]"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="max-h-72 overflow-y-auto p-1.5">
            {models.map((model) => {
              const isActive = model.id === selectedModel;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onSelect(model.id);
                    setOpen(false);
                  }}
                  className={`flex w-full min-w-0 items-center gap-2 rounded px-2 py-2 text-left hover:bg-(--hover) ${
                    isActive ? "bg-(--hover)" : ""
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      isActive ? "bg-(--accent)" : "bg-(--dim)/35"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-(--fg)">{model.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-(--dim)">
                      {model.controllerName ?? controllerLabel ?? model.provider} ·{" "}
                      {formatCompactNumber(model.contextWindow)} context
                      {model.reasoning ? " · reasoning" : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

function subscribeToControllerStorage(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function computeActiveControllerLabel(): string | null {
  const url = getStoredBackendUrl();
  if (!url) return null;
  const saved = loadSavedControllers();
  if (saved.length === 0) return null;
  const match = saved.find((entry) => entry.url === url);
  return match?.name?.trim() || shortHost(url);
}

function useActiveControllerLabel(): string | null {
  return useSyncExternalStore(
    subscribeToControllerStorage,
    computeActiveControllerLabel,
    () => null,
  );
}

function shortHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host || url;
  } catch {
    return url;
  }
}
