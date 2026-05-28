import { useCallback, useSyncExternalStore, type RefObject } from "react";

import type { Session, SessionId } from "@/lib/agent/sessions/types";
import { loadRuntimeStatus, subscribeRuntimeEvents } from "@/lib/agent/sessions/api";
import {
  subscribeResumeRuntimeSession,
  type RuntimeResumeDeps,
} from "@/lib/agent/sessions/runtime-resume";
import { hasRuntimePromptStream } from "@/lib/agent/sessions/stream-ownership";
import type { TextDeltaCoalescer } from "@/lib/agent/sessions/text-delta-coalescer";

type PiEventBatch = {
  timer?: ReturnType<typeof setTimeout> | null;
};

type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;

const getSessionEngineSnapshot = (): number => 0;

export function useSessionEngineBatchCleanupEffect({
  piEventBatchesRef,
}: {
  piEventBatchesRef: RefObject<Map<SessionId, PiEventBatch>>;
}): void {
  const subscribeBatchCleanup = useCallback(
    () => () => {
      for (const batch of piEventBatchesRef.current.values()) {
        if (batch.timer) clearTimeout(batch.timer);
      }
      piEventBatchesRef.current.clear();
    },
    [piEventBatchesRef],
  );

  useSyncExternalStore(subscribeBatchCleanup, getSessionEngineSnapshot, getSessionEngineSnapshot);
}

export function useSessionEngineTextDeltaCleanupEffect({
  textDeltaCoalescerRef,
}: {
  textDeltaCoalescerRef: RefObject<TextDeltaCoalescer | null>;
}): void {
  const subscribeTextDeltaCleanup = useCallback(
    () => () => {
      textDeltaCoalescerRef.current?.flushAll();
      textDeltaCoalescerRef.current?.dispose();
    },
    [textDeltaCoalescerRef],
  );

  useSyncExternalStore(
    subscribeTextDeltaCleanup,
    getSessionEngineSnapshot,
    getSessionEngineSnapshot,
  );
}

export function useSessionEnginePromptStreamCleanupEffect({
  promptStreamControllersRef,
}: {
  promptStreamControllersRef: RefObject<Map<string, AbortController>>;
}): void {
  const subscribePromptStreamCleanup = useCallback(
    () => () => {
      for (const controller of promptStreamControllersRef.current.values()) {
        controller.abort();
      }
      promptStreamControllersRef.current.clear();
    },
    [promptStreamControllersRef],
  );

  useSyncExternalStore(
    subscribePromptStreamCleanup,
    getSessionEngineSnapshot,
    getSessionEngineSnapshot,
  );
}

export function useSessionEngineRuntimeResumeEffect({
  after,
  applyPiEvent,
  flushPiEvents,
  localStreamRef,
  onPiSessionIdChange,
  runtime,
  piSessionId,
  sessionId,
  shouldApplySeq,
  submitPromptRef,
  tabsRef,
  updateSession,
}: {
  after: number;
  applyPiEvent: RuntimeResumeDeps["applyPiEvent"];
  flushPiEvents: (sessionId: SessionId) => void;
  localStreamRef: RefObject<Set<SessionId>>;
  onPiSessionIdChange?: (piSessionId: string) => void;
  runtime: string | null;
  piSessionId?: string | null;
  sessionId: SessionId | null;
  shouldApplySeq?: RuntimeResumeDeps["shouldApplySeq"];
  submitPromptRef: RuntimeResumeDeps["submitPromptRef"];
  tabsRef: RefObject<Session[]>;
  updateSession: UpdateSession;
}): void {
  const subscribeRuntimeResume = useCallback(() => {
    if (!sessionId || !runtime) return () => undefined;
    if (localStreamRef.current.has(sessionId)) return () => undefined;
    if (hasRuntimePromptStream(runtime)) return () => undefined;

    const sub = subscribeResumeRuntimeSession({
      after,
      api: { loadRuntimeStatus, subscribeRuntimeEvents },
      applyPiEvent,
      flushPiEvents,
      onPiSessionIdChange,
      piSessionId,
      runtime,
      sessionId,
      shouldApplySeq,
      submitPromptRef,
      tabsRef,
      updateSession,
    });
    return sub.close;
  }, [
    after,
    applyPiEvent,
    flushPiEvents,
    localStreamRef,
    onPiSessionIdChange,
    piSessionId,
    runtime,
    sessionId,
    shouldApplySeq,
    submitPromptRef,
    tabsRef,
    updateSession,
  ]);

  useSyncExternalStore(subscribeRuntimeResume, getSessionEngineSnapshot, getSessionEngineSnapshot);
}
