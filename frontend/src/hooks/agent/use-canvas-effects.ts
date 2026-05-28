import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

import type { ComputerState } from "@/lib/agent/tools/types";
import type { SessionId } from "@/lib/agent/sessions/types";

export function useCanvasEffects({
  setComputer,
  sessionId,
}: {
  setComputer: Dispatch<SetStateAction<ComputerState>>;
  sessionId?: SessionId | null;
}): void {
  const subscribe = useCallback(
    (_notify: () => void) => {
      let cancelled = false;
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      fetch(`/api/agent/canvas${query}`, { cache: "no-store" })
        .then((res) =>
          res.ok
            ? (res.json() as Promise<{ enabled?: boolean; text?: string }>)
            : Promise.reject(new Error("Canvas fetch failed")),
        )
        .then((payload) => {
          if (cancelled) return;
          setComputer((current) => ({
            ...current,
            canvasEnabled: payload.enabled ?? current.canvasEnabled,
            canvasText: typeof payload.text === "string" ? payload.text : current.canvasText,
          }));
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    },
    [setComputer, sessionId],
  );

  useSyncExternalStore(subscribe, getCanvasSnapshot, getCanvasSnapshot);
}

const getCanvasSnapshot = (): number => 0;
