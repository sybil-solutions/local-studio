import type { AgentModel } from "@/features/agent/models";
import type { Project } from "@/features/agent/projects/types";
import type { Session, SessionId, SessionsMap } from "@/features/agent/runtime/types";
import type { Layout, PaneId } from "@/features/agent/workspace/layout";

export type { PaneId } from "@/features/agent/workspace/layout";
export type { SessionId } from "@/features/agent/runtime/types";
export type { AgentModel } from "@/features/agent/models";

export type WorkspaceLayout = Layout;

export type { GitSummary } from "@/features/agent/projects/types";

export type ChatPaneState = {
  kind?: "chat";
  sessionId: SessionId;
};

export type PaneState = ChatPaneState;

export type WorkspaceState = {
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
  | { type: "setModelsLoading"; loading: boolean }
  | { type: "setModels"; models: AgentModel[]; preferredModelId?: string }
  | { type: "setSelectedModel"; modelId: string }
  | { type: "setSetupWarning"; warning: string }
  | { type: "setError"; error: string }
  | { type: "setSplitRatio"; path: number[]; ratio: number }
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
      tab: Session;
    }
  | { type: "focusPane"; paneId: PaneId }
  | {
      type: "focusPaneSession";
      paneId: PaneId;
      sessionId: SessionId;
      replaceWorkspace?: boolean;
    }
  | { type: "renameTab"; paneId: PaneId; tabId: SessionId; title: string }
  | {
      type: "splitTab";
      sourcePaneId: PaneId;
      sourceTabId: SessionId;
      newPaneId: PaneId;
      tab: Session;
    }
  | { type: "closePane"; paneId: PaneId }
  | { type: "setPaneSession"; paneId: PaneId; session: Session }
  | { type: "setDetachedSession"; session: Session }
  | { type: "removeDetachedSession"; sessionId: SessionId }
  | {
      type: "patchSession";
      sessionId: SessionId;
      patch: Partial<Session> | ((session: Session) => Session);
    }
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
      replaceWorkspace?: boolean;
      tab: Session;
    };
