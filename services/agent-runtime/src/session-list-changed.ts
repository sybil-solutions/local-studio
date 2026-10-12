import type { SessionListChangedEvent } from "../../../shared/agent/session-list-changed";

type Listener = (event: SessionListChangedEvent) => void;

const listeners = new Set<Listener>();
let version = 0;

export function notifySessionListChanged(): void {
  version += 1;
  const event: SessionListChangedEvent = { type: "session_list_changed", version };
  for (const listener of [...listeners]) listener(event);
}

export function subscribeSessionListChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sessionListChangedVersion(): number {
  return version;
}
