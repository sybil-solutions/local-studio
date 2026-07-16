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
import { cx } from "@/ui/utils";

const LazyAgentBrowserPanel = lazy(() =>
  import("@/features/agent/ui/agent-browser-panel").then(({ AgentBrowserPanel }) => ({
    default: AgentBrowserPanel,
  })),
);

type AgentWorkspaceShellProps = {
  state: WorkspaceState;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
  compact?: boolean;
};

type QuickPanelMode = "composer" | "thread" | undefined;

function quickPanelMode(
  compact: boolean,
  showProjectEmptyState: boolean,
  focusedMessageCount: number,
): QuickPanelMode {
  if (!compact) return undefined;
  return showProjectEmptyState || focusedMessageCount > 0 ? "thread" : "composer";
}

function workspaceClassName(mode: QuickPanelMode): string {
  return cx(
    "agent-workspace flex h-full min-h-0 w-full flex-col text-(--fg) md:h-[100dvh]",
    mode === "composer" ? "bg-transparent" : "bg-(--agent-bg)",
    mode === "thread" && "overflow-hidden rounded-[var(--rad-xl)] shadow-[var(--shadow-2xl)]",
  );
}

function workspaceSessionIdentity(session: ReturnType<typeof focusedSession>) {
  if (!session) return { sessionId: null, viewKey: null, viewAlias: null };
  if (!session.piSessionId) {
    return { sessionId: session.id, viewKey: session.id, viewAlias: null };
  }
  return { sessionId: session.id, viewKey: session.piSessionId, viewAlias: session.id };
}

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
  const activeSessionIdentity = workspaceSessionIdentity(focusedTab);
  const activeProject = projects.resolveProject(focusedTab) ?? projects.selectedProject;
  useActiveSessionEffects({
    ...activeSessionIdentity,
    setActiveCanvasSession: tools.setActiveCanvasSession,
    setActiveComputerSession: tools.setActiveComputerSession,
  });
  const focusedModel =
    state.models.find((model) => model.id === (focusedTab?.modelId ?? state.selectedModel)) ?? null;
  const focusedGitSummary = projects.gitSummary(activeProject?.path ?? focusedTab?.cwd);
  const showProjectEmptyState = shouldShowProjectEmptyState(projects, projectParam);
  const focusedMessageCount = focusedTab?.messages.length ?? 0;
  const panelMode = quickPanelMode(compact, showProjectEmptyState, focusedMessageCount);
  const composerOnly = panelMode === "composer";
  useQuickPanelExpandEffect(compact, panelMode === "thread");
  return (
    <div data-quick-panel-state={panelMode} className={workspaceClassName(panelMode)}>
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
              hasThread={focusedMessageCount > 0}
            />
          ) : null}
          <WorkspacePaneContent
            showEmptyState={showProjectEmptyState}
            state={state}
            projects={projects}
            tools={tools}
            dispatch={dispatch}
            handles={handles}
            compact={compact}
            composerOnly={composerOnly}
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
  return (
    <Suspense fallback={open ? <ComputerPanelFallback /> : null}>
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
  composerOnly,
}: {
  showEmptyState: boolean;
  state: WorkspaceState;
  projects: ProjectsContextValue;
  tools: ReturnType<typeof useTools>;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
  compact?: boolean;
  composerOnly: boolean;
}) {
  if (showEmptyState) return <ProjectEmptyState />;
  if (compact) {
    return (
      <div className="flex min-h-0 flex-1">
        {renderWorkspacePane({
          paneId: state.focusedPaneId,
          state,
          projects,
          tools,
          dispatch,
          handles,
          compact,
          composerOnly,
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
    <aside className="relative flex w-[360px] shrink-0 flex-col bg-(--color-panel) shadow-[var(--elev-side-panel)]">
      <div className="h-[var(--h-toolbar-pane)] shrink-0 border-b border-(--border) bg-(--color-header)" />
      <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-(--dim)">
        Loading tools...
      </div>
    </aside>
  );
}

function humanizeWorkspaceNotice(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("fetch failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("econnrefused") ||
    normalized.includes("terminated") ||
    normalized.includes("socket") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out")
  ) {
    return "Can't reach the controller right now — retrying in the background. Check Settings → General if this persists.";
  }
  if (normalized.includes("unauthorized") || normalized.includes("401")) {
    return "The controller rejected the API key. Update it in Settings → General.";
  }
  return message;
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
  if (!error && !setupWarning) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex max-w-[26rem] flex-col items-end gap-2">
      {error ? (
        <WorkspaceBanner tone="error" onDismiss={onClearError}>
          {humanizeWorkspaceNotice(error)}
        </WorkspaceBanner>
      ) : null}
      {setupWarning ? <WorkspaceBanner tone="warning">{setupWarning}</WorkspaceBanner> : null}
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
  return (
    <div className="pointer-events-auto flex min-w-0 max-w-full items-start gap-2.5 rounded-xl border border-(--color-popover-border) bg-(--color-popover) px-3 py-2.5 text-[length:var(--fs-md)] text-(--fg) shadow-[0px_16px_32px_-8px_rgba(0,0,0,0.3),0px_0px_0px_0.5px_rgba(0,0,0,0.1)]">
      <span
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone === "error" ? "bg-(--err)" : "bg-(--warn)"}`}
        aria-hidden
      />
      <span className="min-w-0 flex-1 leading-5 [overflow-wrap:anywhere]">{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-0.5 shrink-0 text-(--hl2) hover:text-(--fg)"
          aria-label="Dismiss"
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
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-(--fg)/5 px-4 text-[length:var(--fs-base)] font-medium text-(--fg) hover:bg-(--fg)/10"
        >
          <PlusIcon className="h-4 w-4" />
          Add a project
        </button>
      </div>
    </div>
  );
}

function useActiveSessionEffects({
  sessionId,
  viewKey,
  viewAlias,
  setActiveCanvasSession,
  setActiveComputerSession,
}: {
  sessionId: SessionId | null;
  viewKey: string | null;
  viewAlias: string | null;
  setActiveCanvasSession: (id: SessionId | null) => void;
  setActiveComputerSession: ReturnType<typeof useTools>["setActiveComputerSession"];
}): void {
  useMountSubscription(() => {
    setActiveCanvasSession(sessionId);
    setActiveComputerSession(
      viewKey ? { key: viewKey, aliases: viewAlias ? [viewAlias] : [] } : null,
    );
  }, [sessionId, viewKey, viewAlias, setActiveCanvasSession, setActiveComputerSession]);
}

export function AgentWorkspace({ compact }: { compact?: boolean } = {}) {
  const { state, dispatch, handles } = useWorkspace({ ephemeral: Boolean(compact) });
  return (
    <AgentWorkspaceShell state={state} dispatch={dispatch} handles={handles} compact={compact} />
  );
}
