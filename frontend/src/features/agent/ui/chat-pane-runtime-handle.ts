import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Effect } from "effect";
import { ChatPaneHandle, type SessionTab } from "@/features/agent/messages";
import type { SessionEngine } from "@/features/agent/runtime/engine";
import { getChatPaneSnapshot } from "@/features/agent/ui/chat-pane-snapshot";

function useChatPaneRegisterHandleEffect({
  handle,
  onRegisterHandle,
}: {
  handle: ChatPaneHandle;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
}): void {
  const subscribeHandle = useCallback(() => {
    if (!onRegisterHandle) return () => undefined;
    onRegisterHandle(handle);
    return () => onRegisterHandle(null);
  }, [handle, onRegisterHandle]);

  useSyncExternalStore(subscribeHandle, getChatPaneSnapshot, getChatPaneSnapshot);
}

export function useChatPaneRuntimeHandle({
  activeTab,
  activeTabId,
  engine,
  modelId,
  onRegisterHandle,
  running,
}: {
  activeTab: SessionTab | null;
  activeTabId: string;
  engine: SessionEngine;
  modelId: string;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
  running: boolean;
}) {
  const [compacting, setCompacting] = useState(false);
  const loadAndReplay = useCallback(
    (piSessionId: string) =>
      activeTabId ? engine.loadAndReplay(piSessionId, activeTabId) : Promise.resolve(),
    [activeTabId, engine],
  );
  const compactSession = useCallback(() => {
    if (!activeTab || running || compacting || !modelId) return Promise.resolve();
    setCompacting(true);
    return Effect.runPromise(
      Effect.tryPromise({ try: () => engine.compact(activeTab.id), catch: (error) => error }).pipe(
        Effect.ensuring(Effect.sync(() => setCompacting(false))),
      ),
    );
  }, [activeTab, compacting, engine, modelId, running]);
  const handle = useMemo<ChatPaneHandle>(
    () => ({ loadAndReplay, compact: compactSession }),
    [compactSession, loadAndReplay],
  );
  useChatPaneRegisterHandleEffect({ handle, onRegisterHandle });
}
