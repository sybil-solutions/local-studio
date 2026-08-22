import { useMemo, useRef, type RefObject } from "react";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import { workspaceCommands } from "@/features/agent/workspace/commands";
import { loadInitialFromStorage } from "@/features/agent/workspace/persistence";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import { shouldSubscribeRuntimeEvents } from "@/features/agent/runtime/runtime-cursor";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import { openSessionListChangedSubscription } from "@/features/agent/runtime/session-list-changed";
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
}: {
  dispatch: WorkspaceDispatch;
  toolsRef: RefObject<ToolsContextValue>;
}): void {
  useMountSubscription(() => {
    const restoreWorkspace = shouldRestoreWorkspace(currentSearchParams());
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
  }, [dispatch, toolsRef]);
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
      getSessions: () => sessionsRef.current,
    });
    return openSessionListChangedSubscription(() => {
      sessionRuntimeController().pollNow();
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

  useMountSubscription(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const controller = sessionRuntimeController();
    let lastWakeAt = 0;
    const wake = () => {
      const now = Date.now();
      if (now - lastWakeAt < 500) return;
      lastWakeAt = now;
      controller.reconcile(sessionsRef.current);
      controller.pollNow();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") wake();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted || document.visibilityState === "visible") wake();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", wake);
    };
  }, []);

  useMountSubscription(
    () => () => {
      sessionRuntimeController().closeAll();
      sessionRuntimeController().unbind();
    },
    [],
  );
}
