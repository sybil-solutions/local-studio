"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { triggerAddProjectFlow } from "@/components/projects-nav-section";
import { ChevronDownIcon, CloseIcon, ComputerIcon, PlusIcon } from "@/components/icons";
import type { AgentModel, PaneId, ProjectEntry } from "@/lib/agent/workspace/types";
import { AgentBrowser } from "./agent-browser";
import { ChatPane } from "./chat-pane";
import { FilesystemPanel } from "./filesystem-panel";
import { GitDiffPanel } from "./git-diff-panel";
import { PaneGrid } from "./pane-grid";
import { collectLeaves } from "./pane-layout";
import { useWorkspace } from "./use-workspace";

export function AgentWorkspace() {
  const { state, dispatch, handles } = useWorkspace();
  const searchParams = useSearchParams();
  const {
    models,
    selectedModel,
    agentCwd,
    modelsLoading,
    projects,
    projectsLoaded,
    selectedProjectId,
    browserToolEnabled,
    browserUrl,
    browserInput,
    gitSummaries,
    layout,
    panesById,
    focusedPaneId,
    computer,
  } = state;
  const {
    registerComputerAside,
    startComputerResize,
    registerBrowserHandle,
    setBrowserInput,
    submitBrowserUrl,
  } = handles;

  const projectParam = searchParams.get("project");
  const sessionParam = searchParams.get("session");
  const newParam = searchParams.get("new");
  const splitParam = searchParams.get("split");
  const navKey =
    projectParam || sessionParam || newParam
      ? `${projectParam ?? ""}|${sessionParam ?? ""}|${newParam ?? ""}|${splitParam ?? ""}`
      : "";
  const urlProjectReady = !projectParam || projects.some((project) => project.id === projectParam);
  if (navKey && state.lastHandledNavKey !== navKey && urlProjectReady) {
    dispatch({
      type: "URL_NAV_REQUESTED",
      key: navKey,
      projectId: projectParam,
      sessionId: sessionParam,
      newSession: newParam === "1",
      split: splitParam === "1",
    });
  }

  const isElectron = typeof window !== "undefined" && /electron/i.test(navigator.userAgent);
  const rightPanelOpen = computer.open;
  const activeComputerTab = computer.tab;
  const computerWidth = computer.width;

  const activeProject = useMemo(
    () => projects.find((entry) => entry.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const focusedPane = panesById.get(focusedPaneId) ?? panesById.values().next().value ?? null;
  const focusedTab = focusedPane?.tabs.find((tab) => tab.id === focusedPane.activeTabId) ?? null;
  const focusedComputerUseLoaded = (focusedTab?.plugins ?? []).some((plugin) =>
    [plugin.id, plugin.name, plugin.path].some((value) =>
      value?.toLowerCase().includes("computer-use"),
    ),
  );
  const focusedProject =
    projects.find((entry) => entry.id === focusedTab?.projectId) ??
    projects.find((entry) => entry.path === focusedTab?.cwd) ??
    activeProject;
  const shouldShowProjectEmptyState =
    projectsLoaded && !projectParam && !selectedProjectId && projects.length === 0;

  return (
    <div className="agent-workspace flex h-full min-h-0 w-full flex-col bg-(--bg) text-(--fg) md:h-[100dvh]">
      <div className="flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={handles.toggleComputerOpen}
            aria-pressed={rightPanelOpen}
            className={`absolute right-3 top-3 z-20 inline-flex !h-8 !min-h-8 !w-8 !min-w-8 items-center justify-center rounded-md border-0 backdrop-blur ${
              rightPanelOpen
                ? "bg-(--accent)/10 text-(--accent)"
                : "bg-transparent text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
            }`}
            title={rightPanelOpen ? "Hide computer" : "Show computer"}
            aria-label={rightPanelOpen ? "Hide computer" : "Show computer"}
          >
            <span className="relative inline-flex">
              <ComputerIcon className="h-4 w-4" />
              {focusedComputerUseLoaded ? (
                <span
                  className="absolute -right-1.5 -top-1 inline-flex h-2.5 w-2.5 items-center justify-center"
                  aria-hidden="true"
                >
                  <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-(--accent)/35" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-(--accent)" />
                </span>
              ) : null}
            </span>
          </button>
          {shouldShowProjectEmptyState ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6">
              <div className="max-w-sm text-center">
                <div className="text-sm font-semibold text-(--fg)">
                  Add a project to get started
                </div>
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
          ) : (
            <div className="min-h-0 flex-1">
              <PaneGrid
                layout={layout}
                renderPane={(paneId) => {
                  const pane = panesById.get(paneId);
                  if (!pane) return null;
                  const onlyOne = collectLeaves(layout).length === 1;
                  const paneActiveTab =
                    pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0] ?? null;
                  const paneProject =
                    projects.find((project) => project.id === paneActiveTab?.projectId) ??
                    projects.find((project) => project.path === paneActiveTab?.cwd) ??
                    activeProject;
                  const paneCwd = paneActiveTab?.cwd ?? paneProject?.path ?? agentCwd;
                  const paneModelId = paneActiveTab?.modelId ?? selectedModel;
                  const paneModel = models.find((model) => model.id === paneModelId) ?? null;
                  const paneGitSummary = paneProject?.path
                    ? (gitSummaries.get(paneProject.path) ?? null)
                    : null;
                  const paneGitBranch =
                    paneGitSummary?.isRepo === false
                      ? null
                      : (paneGitSummary?.branch ?? paneProject?.branch ?? null);
                  const paneTabIsNew =
                    Boolean(paneActiveTab) &&
                    !paneActiveTab?.piSessionId &&
                    (paneActiveTab?.messages.length ?? 0) === 0;
                  return (
                    <ChatPane
                      key={paneId}
                      paneId={paneId}
                      runtimeSessionId={pane.runtimeSessionId}
                      modelId={paneModelId}
                      modelName={paneModel?.name ?? null}
                      modelsLoading={modelsLoading}
                      contextWindow={paneModel?.contextWindow ?? 0}
                      cwd={paneCwd}
                      projectName={paneProject?.name ?? null}
                      projectSelector={
                        paneProject && projects.length > 0 ? (
                          <select
                            value={paneProject.id}
                            onChange={(event) => {
                              const project = projects.find(
                                (entry) => entry.id === event.target.value,
                              );
                              if (project) handles.selectPaneProject(paneId, project);
                            }}
                            disabled={!paneTabIsNew}
                            className="!h-7 !min-h-7 max-w-full min-w-0 truncate rounded-md border-0 bg-transparent px-2 py-0 font-mono !text-[11px] text-(--dim) outline-none hover:bg-(--surface) hover:text-(--fg) disabled:opacity-100"
                            style={{
                              width: `${Math.min(Math.max(paneProject.path.length + 3, 12), 54)}ch`,
                            }}
                            title={
                              paneTabIsNew
                                ? "Change directory for this new session"
                                : paneProject.path
                            }
                            aria-label="Session directory"
                          >
                            {projects.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.path}
                              </option>
                            ))}
                          </select>
                        ) : null
                      }
                      gitBranch={paneGitBranch}
                      gitSummary={paneGitSummary}
                      onInitGit={handles.initGitForActiveProject}
                      modelSelector={
                        <ModelPicker
                          models={models}
                          selectedModel={paneModelId}
                          onSelect={(modelId) => handles.selectPaneModel(paneId, modelId)}
                          loading={modelsLoading}
                        />
                      }
                      browserToolEnabled={focusedPaneId === paneId && browserToolEnabled}
                      onToggleBrowserTool={handles.toggleBrowserTool}
                      onPiSessionIdChange={handles.notifySessionsChanged}
                      isFocused={focusedPaneId === paneId}
                      onFocus={() => dispatch({ type: "FOCUS_PANE", paneId })}
                      tabs={pane.tabs}
                      activeTabId={pane.activeTabId}
                      onTabsChange={(nextTabsOrUpdater) =>
                        handles.setPaneTabs(paneId, nextTabsOrUpdater)
                      }
                      onClose={onlyOne ? undefined : () => handles.closePane(paneId)}
                      onRegisterHandle={(handle) => handles.registerPaneHandle(paneId, handle)}
                    />
                  );
                }}
                onSplit={handles.splitPaneWithPayload}
                onOpenTab={handles.openSessionPayloadInPane}
                onResize={handles.setSplitRatio}
              />
            </div>
          )}
        </section>

        {rightPanelOpen ? (
          <aside
            className="relative flex shrink-0 flex-col border-l border-(--border) bg-(--bg)"
            ref={registerComputerAside}
            style={{ width: `min(${computerWidth}px, 48vw)` }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              title="Resize computer"
              onMouseDown={startComputerResize}
              className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-(--accent)/20"
            />
            <div className="flex h-9 shrink-0 items-center gap-3 px-3 text-xs text-(--dim)">
              <span
                className="min-w-0 flex-1 truncate px-1 text-[10px] uppercase tracking-wide"
                title={`Computer follows focused session: ${focusedTab?.title ?? "New session"}`}
              >
                {focusedTab?.title ?? "Focused session"}
              </span>
              <ComputerTabButton
                active={activeComputerTab === "browser"}
                onClick={() => handles.setComputerTab("browser")}
              >
                Browser
              </ComputerTabButton>
              <ComputerTabButton
                active={activeComputerTab === "files"}
                onClick={() => handles.setComputerTab("files")}
              >
                Files
              </ComputerTabButton>
              <ComputerTabButton
                active={activeComputerTab === "diff"}
                onClick={() => handles.setComputerTab("diff")}
              >
                Diff
              </ComputerTabButton>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => handles.setComputerOpen(false)}
                className="ml-1 inline-flex h-7 w-7 items-center justify-center hover:text-(--fg)"
                title="Close"
                aria-label="Close computer"
              >
                <CloseIcon className="h-3.5 w-3.5 pointer-events-none" />
              </button>
            </div>

            {activeComputerTab === "browser" ? (
              <AgentBrowser
                ref={registerBrowserHandle}
                url={browserUrl}
                inputValue={browserInput}
                onInputChange={setBrowserInput}
                onSubmit={submitBrowserUrl}
                onClose={() => handles.setComputerOpen(false)}
                isElectron={isElectron}
              />
            ) : activeComputerTab === "files" ? (
              <section className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1">
                  <FilesystemPanel cwd={activeProject?.path ?? null} />
                </div>
              </section>
            ) : (
              <GitDiffPanel cwd={activeProject?.path ?? null} />
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function ComputerTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-6 shrink-0 font-medium uppercase tracking-wide ${
        active ? "text-(--fg)" : "hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
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
  const active = models.find((model) => model.id === selectedModel) || null;
  const triggerLabel = loading
    ? "Loading…"
    : active?.name || (models.length === 0 ? "No models" : "Select model");
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
        className="inline-flex !h-7 !min-h-7 !min-w-0 max-w-[150px] items-center gap-1.5 bg-transparent px-2 !text-xs text-(--fg) hover:text-(--accent) disabled:opacity-60"
        title={active?.name || triggerLabel}
      >
        <span className="min-w-0 max-w-[118px] truncate">{triggerLabel}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0 text-(--dim)" />
      </button>
      {open ? (
        <div
          className="absolute bottom-9 right-0 z-[80] w-72 border border-(--border) bg-(--surface) shadow-lg"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="max-h-72 overflow-y-auto p-1">
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
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-xs hover:bg-(--bg) ${
                    isActive ? "bg-(--bg)" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-left text-(--fg)">
                    {model.name}
                  </span>
                  {model.reasoning ? (
                    <span className="shrink-0 text-[10px] text-(--dim)">· reasoning</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
