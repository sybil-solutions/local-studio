import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import type { Project } from "@/lib/agent/projects/types";
import type { Session, SessionId, SessionsMap } from "@/lib/agent/sessions/types";
import type { Layout, PaneId } from "@/lib/agent/workspace/layout";

export type { PaneId } from "@/lib/agent/workspace/layout";
export type { SessionId } from "@/lib/agent/sessions/types";

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

/**
 * Re-exports for callers still importing the old names. Project state itself
 * lives in `lib/agent/projects/`; the workspace no longer owns it.
 */
export type ProjectEntry = Project;
export type { GitSummary } from "@/lib/agent/projects/types";

/** A pane is a layout slot pointing at session ids — it doesn't carry session content. */
export type PaneState = {
  sessionIds: SessionId[];
  activeSessionId: SessionId;
  runtimeSessionId: string;
};

export type WorkspaceState = {
  /** Flat collection of all sessions referenced by any pane. */
  sessions: SessionsMap;
  models: AgentModel[];
  selectedModel: string;
  modelsLoading: boolean;
  layout: WorkspaceLayout;
  panesById: ReadonlyMap<PaneId, PaneState>;
  focusedPaneId: PaneId;
  setupWarning: string;
  error: string;
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
  | { type: "workspaceUnmounted" }
  | { type: "setModelsLoading"; loading: boolean }
  | { type: "setModels"; models: AgentModel[]; preferredModelId?: string }
  | { type: "setSelectedModel"; modelId: string }
  | { type: "setSetupWarning"; warning: string }
  | { type: "setError"; error: string }
  | { type: "setLayout"; layout: WorkspaceLayout }
  | { type: "setSplitRatio"; path: number[]; ratio: number }
  | {
      type: "restorePaneState";
      layout: WorkspaceLayout;
      panesById: ReadonlyMap<PaneId, PaneState>;
      sessions: SessionsMap;
      focusedPaneId: PaneId;
    }
  | {
      type: "openNewSession";
      project?: Project;
      tab: Session;
      /** Pre-allocated pane id used when the focused pane is busy and we split right. */
      paneId?: PaneId;
      runtimeSessionId?: string;
    }
  | { type: "replaySession"; piSessionId: string; tab: Session; sessionTitle?: string }
  | {
      type: "replaySessionInSplit";
      piSessionId: string;
      paneId: PaneId;
      runtimeSessionId: string;
      tab: Session;
      sessionTitle?: string;
    }
  | {
      type: "openSessionPayloadInPane";
      paneId: PaneId;
      payload: WorkspaceSessionPayload;
      tab: Session;
    }
  | {
      type: "splitPaneWithPayload";
      paneId: PaneId;
      direction: "vertical" | "horizontal";
      side: "a" | "b";
      payload: WorkspaceSessionPayload;
      newPaneId: PaneId;
      runtimeSessionId: string;
      tab: Session;
    }
  | { type: "focusPane"; paneId: PaneId }
  | { type: "focusTab"; paneId: PaneId; tabId: SessionId }
  | { type: "renameTab"; paneId: PaneId; tabId: SessionId; title: string }
  | {
      type: "splitTab";
      sourcePaneId: PaneId;
      sourceTabId: SessionId;
      newPaneId: PaneId;
      runtimeSessionId: string;
      tab: Session;
    }
  | { type: "closePane"; paneId: PaneId }
  /**
   * Replace the session list of a pane. The reducer writes the new sessions
   * into the flat `sessions` map and rebuilds `pane.sessionIds` to match.
   */
  | { type: "setPaneTabs"; paneId: PaneId; tabs: Session[] }
  | { type: "patchActiveTab"; paneId: PaneId; patch: Partial<Session> }
  | { type: "notifySessionsChanged" }
  | {
      type: "urlNavRequested";
      key: string;
      project: Project | null;
      sessionId?: string | null;
      sessionTitle?: string;
      newSession?: boolean;
      split?: boolean;
      paneId: PaneId;
      runtimeSessionId: string;
      tab: Session;
    }
  | {
      type: "hydrateActiveSessions";
      snapshots: ActiveAgentSessionSnapshot[];
      projects: Project[];
      hasExplicitSessionNav?: boolean;
    };
