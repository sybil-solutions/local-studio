import { useMemo, useRef, type RefObject } from "react";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import { workspaceCommands } from "@/features/agent/workspace/commands";
import { loadInitialFromStorage } from "@/features/agent/workspace/persistence";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import { shouldSubscribeRuntimeEvents } from "@/features/agent/runtime/runtime-cursor";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

function currentSearchParams(): URLSearchParams {
  return typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
}

function shouldRestoreWorkspace(params: URLSearchParams): boolean {
  return params.get("restore") !== "0";
}

export function useWorkspaceHydrationEffects({
  dispatch,
  toolsRef,
  skipRestore = false,
}: {
  dispatch: WorkspaceDispatch;
  toolsRef: RefObject<ToolsContextValue>;
  skipRestore?: boolean;
}): void {
  useMountSubscription(() => {
    const params = currentSearchParams();
    const restoreWorkspace = !skipRestore && shouldRestoreWorkspace(params);
    const { workspace, selections, legacyRuntimeKeys } = restoreWorkspace
      ? loadInitialFromStorage(window.localStorage)
      : { workspace: {}, selections: new Map(), legacyRuntimeKeys: new Map() };
    for (const [sessionId, runtimeKey] of legacyRuntimeKeys) {
      sessionRuntimeController().seedConnectionKey(sessionId, runtimeKey);
    }
    dispatch({ type: "hydrate", state: workspace, hydrated: true });
    if (selections.size > 0) toolsRef.current.hydrateSelections(selections);

    workspaceCommands().bind(dispatch);
    return () => {
      workspaceCommands().unbind();
    };
  }, [dispatch, toolsRef, skipRestore]);
}

type UseWorkspaceRuntimeSyncDeps = {
  dispatch: WorkspaceDispatch;
  sessions: Session[];
};

function runtimeSubscriptionKey(sessions: Session[]): string {
  return sessions
    .filter((session) => shouldSubscribeRuntimeEvents(session.status))
    .map((session) => `${session.id}:${session.piSessionId ?? ""}`)
    .join("\n");
}

function runtimeRegistryKey(sessions: Session[]): string {
  return sessions
    .map((session) => `${session.id}:${session.piSessionId ?? ""}:${session.status}`)
    .join("\n");
}

export function useWorkspaceRuntimeSync({ dispatch, sessions }: UseWorkspaceRuntimeSyncDeps): void {
  const sessionsRef = useRef(sessions);

  useMountSubscription(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useMountSubscription(() => {
    sessionRuntimeController().bind({
      commit: (sessionId: SessionId, patch: (session: Session) => Session) => {
        dispatch({ type: "patchSession", sessionId, patch });
      },
      getSession: (sessionId) => sessionsRef.current.find((session) => session.id === sessionId),
      getSessions: () => sessionsRef.current,
    });
  }, [dispatch]);

  const subscriptionKey = useMemo(() => runtimeSubscriptionKey(sessions), [sessions]);

  useMountSubscription(() => {
    sessionRuntimeController().reconcile(sessionsRef.current);
  }, [subscriptionKey]);

  const registryKey = useMemo(() => runtimeRegistryKey(sessions), [sessions]);

  useMountSubscription(() => {
    sessionRuntimeController().pollNow();
  }, [registryKey]);

  useMountSubscription(
    () => () => {
      sessionRuntimeController().closeAll();
      sessionRuntimeController().unbind();
    },
    [],
  );
}
