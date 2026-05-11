import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import type { SessionTab } from "@/app/agent/_components/chat-pane";
import type { Layout, PaneId } from "@/app/agent/_components/pane-layout";

export type { PaneId } from "@/app/agent/_components/pane-layout";

export type WorkspaceLayout = Layout;

export type AgentModel = {
  id: string;
  name: string;
  provider: "vllm-studio";
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  active: boolean;
};

export type ProjectEntry = {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
};

export type GitSummary = {
  isRepo: boolean;
  branch: string | null;
  additions: number;
  deletions: number;
  statusCount: number;
};

export type PaneState = {
  tabs: SessionTab[];
  activeTabId: string;
  runtimeSessionId: string;
};

export type ComputerTab = "browser" | "files" | "diff";

export type WorkspaceState = {
  projects: ProjectEntry[];
  projectsLoaded: boolean;
  selectedProjectId: string | null;
  agentCwd: string;
  models: AgentModel[];
  selectedModel: string;
  modelsLoading: boolean;
  layout: WorkspaceLayout;
  panesById: ReadonlyMap<PaneId, PaneState>;
  focusedPaneId: PaneId;
  setupWarning: string;
  error: string;
  gitSummaries: ReadonlyMap<string, GitSummary>;
  computer: { open: boolean; tab: ComputerTab; width: number };
  browserToolEnabled: boolean;
  browserUrl: string;
  browserInput: string;
  hydrated: boolean;
  lastHandledNavKey: string;
};

export type WorkspaceSessionPayload = {
  piSessionId?: string | null;
  projectId?: string;
  cwd?: string;
  paneId?: PaneId;
  tabId?: string;
  title?: string;
};

export type WorkspaceHydration = Partial<WorkspaceState>;

export type WorkspaceAction =
  | { type: "hydrate"; state: WorkspaceHydration; hydrated?: boolean }
  | { type: "HYDRATE"; payload: WorkspaceHydration; hydrated?: boolean }
  | { type: "WORKSPACE_UNMOUNTED" }
  | { type: "PROJECTS_CHANGED" }
  | { type: "setProjects"; projects: ProjectEntry[]; storedProjectId?: string | null }
  | { type: "setProjectsLoaded"; loaded: boolean }
  | { type: "selectProject"; project: ProjectEntry | null }
  | { type: "SELECT_PROJECT"; project: ProjectEntry | null }
  | { type: "setAgentCwd"; cwd: string }
  | { type: "setModelsLoading"; loading: boolean }
  | { type: "setModels"; models: AgentModel[]; preferredModelId?: string }
  | { type: "setSelectedModel"; modelId: string }
  | { type: "setSetupWarning"; warning: string }
  | { type: "setError"; error: string }
  | { type: "setLayout"; layout: WorkspaceLayout }
  | { type: "setSplitRatio"; path: number[]; ratio: number }
  | { type: "SET_SPLIT_RATIO"; path: number[]; ratio: number }
  | {
      type: "restorePaneState";
      layout: WorkspaceLayout;
      panesById: ReadonlyMap<PaneId, PaneState>;
      focusedPaneId: PaneId;
    }
  | { type: "openNewSession"; project?: ProjectEntry; tab?: SessionTab }
  | { type: "OPEN_NEW_SESSION"; project?: ProjectEntry; projectId?: string; tab?: SessionTab }
  | { type: "replaySession"; piSessionId: string; tab?: SessionTab }
  | { type: "REPLAY_SESSION"; piSessionId: string; tab?: SessionTab }
  | {
      type: "replaySessionInSplit";
      piSessionId: string;
      paneId?: PaneId;
      runtimeSessionId?: string;
      tab?: SessionTab;
    }
  | {
      type: "REPLAY_SESSION_IN_SPLIT";
      piSessionId: string;
      paneId?: PaneId;
      runtimeSessionId?: string;
      tab?: SessionTab;
    }
  | {
      type: "openSessionPayloadInPane";
      paneId: PaneId;
      payload: WorkspaceSessionPayload;
      tab?: SessionTab;
    }
  | {
      type: "OPEN_SESSION_PAYLOAD_IN_PANE";
      paneId: PaneId;
      payload: WorkspaceSessionPayload;
      tab?: SessionTab;
    }
  | {
      type: "splitPaneWithPayload";
      paneId: PaneId;
      direction: "vertical" | "horizontal";
      side: "a" | "b";
      payload: WorkspaceSessionPayload;
      newPaneId?: PaneId;
      runtimeSessionId?: string;
      tab?: SessionTab;
    }
  | {
      type: "SPLIT_PANE_WITH_PAYLOAD";
      paneId: PaneId;
      direction: "vertical" | "horizontal";
      side: "a" | "b";
      payload: WorkspaceSessionPayload;
      newPaneId?: PaneId;
      runtimeSessionId?: string;
      tab?: SessionTab;
    }
  | { type: "focusPane"; paneId: PaneId }
  | { type: "FOCUS_PANE"; paneId: PaneId }
  | { type: "focusTab"; paneId: PaneId; tabId: string }
  | { type: "FOCUS_TAB"; paneId: PaneId; tabId: string }
  | { type: "renameTab"; paneId: PaneId; tabId: string; title: string }
  | { type: "RENAME_TAB"; paneId: PaneId; tabId: string; title: string }
  | {
      type: "splitTab";
      sourcePaneId: PaneId;
      sourceTabId: string;
      newPaneId?: PaneId;
      runtimeSessionId?: string;
      tab?: SessionTab;
    }
  | {
      type: "SPLIT_TAB";
      sourcePaneId: PaneId;
      sourceTabId: string;
      newPaneId?: PaneId;
      runtimeSessionId?: string;
      tab?: SessionTab;
    }
  | { type: "closePane"; paneId: PaneId }
  | { type: "CLOSE_PANE"; paneId: PaneId }
  | { type: "setPaneTabs"; paneId: PaneId; tabs: SessionTab[] }
  | { type: "SET_PANE_TABS"; paneId: PaneId; tabs: SessionTab[] }
  | { type: "patchActiveTab"; paneId: PaneId; patch: Partial<SessionTab> }
  | { type: "PATCH_ACTIVE_TAB"; paneId: PaneId; patch: Partial<SessionTab> }
  | { type: "setComputerOpen"; open: boolean }
  | { type: "SET_COMPUTER_OPEN"; open: boolean }
  | { type: "toggleComputerOpen" }
  | { type: "TOGGLE_COMPUTER_OPEN" }
  | { type: "setComputerTab"; tab: ComputerTab }
  | { type: "SET_COMPUTER_TAB"; tab: ComputerTab }
  | { type: "setComputerWidth"; width: number }
  | { type: "SET_COMPUTER_WIDTH"; width: number }
  | { type: "setBrowserToolEnabled"; enabled: boolean }
  | { type: "SET_BROWSER_TOOL_ENABLED"; enabled: boolean }
  | { type: "toggleBrowserTool" }
  | { type: "TOGGLE_BROWSER_TOOL" }
  | { type: "setBrowserUrl"; url: string; input?: string }
  | { type: "SET_BROWSER_URL"; url: string; input?: string }
  | { type: "setBrowserInput"; input: string }
  | { type: "SET_BROWSER_INPUT"; input: string }
  | { type: "setGitSummary"; cwd: string; summary: GitSummary | null }
  | { type: "deleteGitSummary"; cwd: string }
  | { type: "NOTIFY_SESSIONS_CHANGED" }
  | {
      type: "URL_NAV_REQUESTED";
      key: string;
      projectId?: string | null;
      sessionId?: string | null;
      newSession?: boolean;
      split?: boolean;
    }
  | {
      type: "hydrateActiveSessions";
      snapshots: ActiveAgentSessionSnapshot[];
      hasExplicitSessionNav?: boolean;
    };
