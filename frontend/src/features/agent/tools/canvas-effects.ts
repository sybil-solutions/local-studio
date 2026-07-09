import type { Dispatch, SetStateAction } from "react";
import { Effect } from "effect";
import type { SessionId } from "@/features/agent/runtime/types";
import type { ComputerState } from "@/features/agent/tools/types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const canvasSessionQuery = (sessionId: SessionId | null | undefined): string =>
  sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";

export function syncCanvasEffect(
  sessionId: SessionId | null | undefined,
  payload: { enabled: boolean; text?: string },
): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () =>
      fetch(`/api/agent/canvas${canvasSessionQuery(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    catch: () => undefined,
  }).pipe(
    Effect.map(() => undefined),
    Effect.catch(() => Effect.void),
  );
}

export function runSyncCanvasEffect(
  sessionId: SessionId | null | undefined,
  payload: { enabled: boolean; text?: string },
): void {
  void Effect.runPromise(syncCanvasEffect(sessionId, payload));
}

function loadCanvasEffect(
  query: string,
): Effect.Effect<{ enabled?: boolean; text?: string }, unknown> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(`/api/agent/canvas${query}`, { cache: "no-store" }),
      catch: (error) => error,
    });
    if (!response.ok) return yield* Effect.fail(new Error("Canvas fetch failed"));
    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ enabled?: boolean; text?: string }>,
      catch: (error) => error,
    });
  });
}

export function useCanvasEffects({
  enabled,
  setComputer,
  sessionId,
}: {
  enabled: boolean;
  setComputer: Dispatch<SetStateAction<ComputerState>>;
  sessionId?: SessionId | null;
}): void {
  useMountSubscription(() => {
    if (!enabled) return;
    let cancelled = false;
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    void Effect.runPromise(
      loadCanvasEffect(query).pipe(
        Effect.map((payload) => {
          if (cancelled) return;
          setComputer((current) => ({
            ...current,
            canvasEnabled: payload.enabled ?? current.canvasEnabled,
            canvasText: typeof payload.text === "string" ? payload.text : current.canvasText,
          }));
        }),
        Effect.catch(() => Effect.void),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, setComputer, sessionId]);
}
