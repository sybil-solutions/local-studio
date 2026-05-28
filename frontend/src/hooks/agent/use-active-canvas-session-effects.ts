import { useCallback, useSyncExternalStore } from "react";
import type { SessionId } from "@/lib/agent/sessions/types";

export function useActiveCanvasSessionEffects({
  sessionId,
  setActiveCanvasSession,
}: {
  sessionId: SessionId | null;
  setActiveCanvasSession: (id: SessionId | null) => void;
}): void {
  const subscribe = useCallback(
    (_notify: () => void) => {
      setActiveCanvasSession(sessionId);
      return () => {};
    },
    [sessionId, setActiveCanvasSession],
  );

  useSyncExternalStore(subscribe, getActiveCanvasSessionSnapshot, getActiveCanvasSessionSnapshot);
}

const getActiveCanvasSessionSnapshot = (): number => 0;
