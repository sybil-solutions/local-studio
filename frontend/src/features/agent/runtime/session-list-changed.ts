import { Schema } from "effect";
import { SessionListChangedEventSchema } from "@shared/agent/session-list-changed";
import { SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";

const decodeSessionListChangedEvent = Schema.decodeUnknownOption(SessionListChangedEventSchema, {
  onExcessProperty: "preserve",
});

function isSessionListChangedEvent(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return decodeSessionListChangedEvent(raw)._tag === "Some";
}

export function openSessionListChangedSubscription(onChanged: () => void): () => void {
  const source = new EventSource("/api/agent/session-list-changed");
  source.onmessage = (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!isSessionListChangedEvent(parsed)) return;
    window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
    onChanged();
  };
  return () => {
    source.close();
  };
}
