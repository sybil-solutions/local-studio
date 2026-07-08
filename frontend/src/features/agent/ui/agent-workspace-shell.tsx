"use client";

import { Suspense, lazy, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { triggerAddProjectFlow } from "@/features/agent/ui/projects-nav/helpers";
import {
  QuickPanelTopBar,
  useQuickPanelExpandEffect,
} from "@/features/agent/ui/quick-panel/quick-panel-top-bar";
import { CloseIcon, PlusIcon } from "@/ui/icons";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import type { AgentModel, WorkspaceState } from "@/features/agent/workspace/types";
import { useProjects, type ProjectsContextValue } from "@/features/agent/projects/context";
import { useTools } from "@/features/agent/tools/context";
import type { Project } from "@/features/agent/projects/types";
import type { SessionId } from "@/features/agent/runtime/types";
import { focusedSession } from "@/features/agent/runtime/selectors";
import { PaneGrid } from "@/features/agent/ui/pane-grid";
import { useWorkspace, type WorkspaceHandles } from "@/features/agent/ui/use-workspace";
import { renderWorkspacePane } from "@/features/agent/ui/render-workspace-pane";
import { useAgentWorkspaceNavigationEffects } from "@/features/agent/ui/agent-workspace-navigation";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const LazyAgentBrowserPanel = lazy(() =>
  import("@/features/agent/ui/agent-browser-panel").then(({ AgentBrowserPanel }) => ({
    default: AgentBrowserPanel,
  })),
);

type AgentWorkspaceShellProps = {
  state: WorkspaceState;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
  /** Chrome-free single-pane mode for the global-hotkey quick-composer panel. */
  compact?: boolean;
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

export function AgentWorkspaceShell({
  state,
  dispatch,
  handles,
  compact = false,
}: AgentWorkspaceShellProps) {
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
  useQuickPanelExpandEffect(compact, focusedTab?.messages.length ?? 0);
  return (
    <div className="agent-workspace flex h-full min-h-0 w-full flex-col bg-(--agent-bg) text-(--fg) md:h-[100dvh]">
      <div className="flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          <WorkspaceTopBar
            error={state.error}
            setupWarning={state.setupWarning}
            onClearError={() => dispatch({ type: "setError", error: "" })}
          />
          {compact ? (
            <QuickPanelTopBar
              projects={projects}
              projectId={activeProject?.id ?? null}
              sessionId={focusedTab?.piSessionId ?? null}
              hasThread={Boolean(focusedTab?.piSessionId)}
            />
          ) : null}
          <WorkspacePaneContent
            showEmptyState={shouldShowProjectEmptyState(projects, projectParam)}
            state={state}
            projects={projects}
            tools={tools}
            dispatch={dispatch}
            handles={handles}
            compact={compact}
          />
        </section>
        {!compact ? (
          <WorkspaceComputerPanel
            open={tools.computer.open}
            handles={handles}
            activeProject={activeProject}
            focusedTab={focusedTab}
            sessions={state.sessions}
            selectedModel={state.selectedModel}
            models={state.models}
            modelsLoading={state.modelsLoading}
            focusedModel={focusedModel}
            focusedGitSummary={focusedGitSummary}
          />
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceComputerPanel({
  open,
  handles,
  activeProject,
  focusedTab,
  sessions,
  selectedModel,
  models,
  modelsLoading,
  focusedModel,
  focusedGitSummary,
}: {
  open: boolean;
  handles: WorkspaceHandles;
  activeProject: Project | null;
  focusedTab: ReturnType<typeof focusedSession>;
  sessions: WorkspaceState["sessions"];
  selectedModel: string;
  models: AgentModel[];
  modelsLoading: boolean;
  focusedModel: AgentModel | null;
  focusedGitSummary: ReturnType<ProjectsContextValue["gitSummary"]>;
}) {
  if (!open) return null;
  return (
    <Suspense fallback={<ComputerPanelFallback />}>
      <LazyAgentBrowserPanel
        handles={handles}
        activeProject={activeProject}
        focusedSession={focusedTab}
        sessions={[...sessions.values()]}
        activeModelId={focusedTab?.modelId ?? selectedModel}
        activeModel={focusedModel}
        gitSummary={focusedGitSummary}
        models={models}
        modelsLoading={modelsLoading}
      />
    </Suspense>
  );
}

function WorkspacePaneContent({
  showEmptyState,
  state,
  projects,
  tools,
  dispatch,
  handles,
  compact,
}: {
  showEmptyState: boolean;
  state: WorkspaceState;
  projects: ProjectsContextValue;
  tools: ReturnType<typeof useTools>;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
  compact?: boolean;
}) {
  if (showEmptyState) return <ProjectEmptyState />;
  if (compact) {
    return (
      <div className="min-h-0 flex-1">
        {renderWorkspacePane({
          paneId: state.focusedPaneId,
          state,
          projects,
          tools,
          dispatch,
          handles,
          compact,
        })}
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1">
      <PaneGrid
        layout={state.layout}
        renderPane={(paneId) =>
          renderWorkspacePane({ paneId, state, projects, tools, dispatch, handles, compact })
        }
        onSplit={handles.splitPaneWithPayload}
        onOpenTab={handles.openSessionPayloadInPane}
        onResize={handles.setSplitRatio}
      />
    </div>
  );
}

function ComputerPanelFallback() {
  return (
    <aside className="relative flex w-[360px] shrink-0 flex-col border-l border-(--border) bg-(--color-panel)">
      <div className="h-10 shrink-0 border-b border-(--border)/85 bg-(--color-header)" />
      <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-(--dim)">
        Loading tools...
      </div>
    </aside>
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

function useActiveCanvasSessionEffects({
  sessionId,
  setActiveCanvasSession,
}: {
  sessionId: SessionId | null;
  setActiveCanvasSession: (id: SessionId | null) => void;
}): void {
  useMountSubscription(() => {
    setActiveCanvasSession(sessionId);
  }, [sessionId, setActiveCanvasSession]);
}

export function AgentWorkspace({ compact }: { compact?: boolean } = {}) {
  // The quick panel is a throwaway surface: fresh session each time, never
  // restoring (or overwriting) the main window's persisted workspace.
  const { state, dispatch, handles } = useWorkspace({ ephemeral: Boolean(compact) });
  return (
    <AgentWorkspaceShell state={state} dispatch={dispatch} handles={handles} compact={compact} />
  );
}
