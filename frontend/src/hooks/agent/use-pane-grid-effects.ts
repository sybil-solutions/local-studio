import { useSyncExternalStore } from "react";

let sessionDragActiveSnapshot = false;
const sessionDragActiveListeners = new Set<() => void>();

const notifySessionDragActiveListeners = (): void => {
  for (const listener of sessionDragActiveListeners) {
    listener();
  }
};

const setSessionDragActiveSnapshot = (active: boolean): void => {
  if (sessionDragActiveSnapshot === active) return;
  sessionDragActiveSnapshot = active;
  notifySessionDragActiveListeners();
};

const getSessionDragActiveSnapshot = (): boolean => sessionDragActiveSnapshot;

const subscribeSessionDragActive = (listener: () => void): (() => void) => {
  sessionDragActiveListeners.add(listener);
  if (typeof document === "undefined") {
    return () => sessionDragActiveListeners.delete(listener);
  }

  const onDragStart = (event: DragEvent) => {
    const types = event.dataTransfer?.types;
    if (!types) return;
    const hasSession = Array.from(types).some(
      (type) =>
        type === "application/x-vllm-session" || type === "application/x-vllm-agent-session",
    );
    if (hasSession) setSessionDragActiveSnapshot(true);
  };
  const stop = () => setSessionDragActiveSnapshot(false);
  document.addEventListener("dragstart", onDragStart);
  document.addEventListener("dragend", stop);
  document.addEventListener("drop", stop);
  return () => {
    sessionDragActiveListeners.delete(listener);
    document.removeEventListener("dragstart", onDragStart);
    document.removeEventListener("dragend", stop);
    document.removeEventListener("drop", stop);
  };
};

/**
 * Tracks whether a session row is currently being dragged anywhere in the
 * document. The pane grid uses this to gate its invisible edge drop targets so
 * they don't steal clicks from the chat-pane header (e.g. the "..." menu and
 * the right sidebar toggle, both of which sit underneath the top strip).
 */
export function useSessionDragActive(): boolean {
  return useSyncExternalStore(
    subscribeSessionDragActive,
    getSessionDragActiveSnapshot,
    getSessionDragActiveSnapshot,
  );
}
