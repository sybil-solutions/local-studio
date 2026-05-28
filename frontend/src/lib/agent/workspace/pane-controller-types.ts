import type { Project } from "@/lib/agent/projects/types";
import type { Session, SessionId } from "@/lib/agent/sessions/types";
import type { PaneId, WorkspaceSessionPayload } from "./types";

type SessionPayload = { tab?: Session };
type RuntimePanePayload = { runtimeSessionId?: string };

export type OpenNewSessionPayload = SessionPayload &
  RuntimePanePayload & {
    project?: Project;
    paneId?: PaneId;
    /** Explicit user choice for what to do when the focused pane is busy. */
    mode?: "split" | "replace";
  };
export type ReplaySessionPayload = SessionPayload & { piSessionId: string; sessionTitle?: string };
export type ReplaySessionInSplitPayload = ReplaySessionPayload &
  RuntimePanePayload & { paneId?: PaneId };
export type OpenSessionPayloadInPanePayload = SessionPayload & {
  paneId: PaneId;
  payload: WorkspaceSessionPayload;
};
export type SplitPaneWithPayloadPayload = SessionPayload &
  RuntimePanePayload & {
    paneId: PaneId;
    newPaneId?: PaneId;
    direction: "vertical" | "horizontal";
    side: "a" | "b";
    payload: WorkspaceSessionPayload;
  };
export type SplitTabPayload = SessionPayload &
  RuntimePanePayload & { sourcePaneId: PaneId; sourceTabId: SessionId; newPaneId?: PaneId };
export type UrlNavigationPayload = SessionPayload &
  RuntimePanePayload & {
    key: string;
    project: Project | null;
    sessionId?: string | null;
    sessionTitle?: string;
    newSession?: boolean;
    split?: boolean;
    paneId?: PaneId;
  };
