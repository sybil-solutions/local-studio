import {
  applyAssistantPiEventToBlocks,
  assistantPiEventAffectsBlocks,
  type ChatMessage,
  messageText,
  newId,
  nowLabel,
  reconcileQueueWithPiEvent,
  usageFromEvent,
  visibleUserTextFromPi,
} from "@/lib/agent/session";
import type { Session, SessionId } from "./types";

type MutableRef<T> = { current: T };
type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;
type PatchAssistant = (
  sessionId: SessionId,
  assistantId: string,
  patch: (msg: ChatMessage) => ChatMessage,
) => void;

export type PiEventApplierDeps = {
  liveAssistantIdsRef: MutableRef<Map<SessionId, string>>;
  patchAssistant: PatchAssistant;
  tabsRef: MutableRef<Session[]>;
  updateSession: UpdateSession;
};

export function applyPiEventToSession(
  deps: PiEventApplierDeps,
  sessionId: SessionId,
  assistantId: string,
  event: Record<string, unknown>,
): void {
  if (event.type === "queue_update") {
    deps.updateSession(sessionId, (session) => ({
      ...session,
      queue: reconcileQueueWithPiEvent(session.queue ?? [], event),
    }));
    return;
  }

  if (appendUserMessageFromPiEvent(deps, sessionId, event)) return;

  const usage = usageFromEvent(event);
  if (usage) {
    deps.updateSession(sessionId, (session) => ({ ...session, tokenStats: usage }));
  }

  if (!assistantPiEventAffectsBlocks(event)) return;
  deps.patchAssistant(sessionId, currentAssistantId(deps, sessionId, assistantId), (msg) => {
    const blocks = applyAssistantPiEventToBlocks(msg.blocks ?? [], event);
    return blocks ? { ...msg, blocks } : msg;
  });
}

function currentAssistantId(
  deps: PiEventApplierDeps,
  sessionId: SessionId,
  assistantId: string,
): string {
  return deps.liveAssistantIdsRef.current.get(sessionId) ?? assistantId;
}

function appendUserMessageFromPiEvent(
  deps: PiEventApplierDeps,
  sessionId: SessionId,
  event: Record<string, unknown>,
): boolean {
  if (event.type !== "message_start" && event.type !== "message_end") return false;
  const msg = event.message as { role?: string; content?: string | Record<string, unknown>[] };
  if (msg?.role !== "user") return false;
  const text = visibleUserTextFromPi(messageText(msg.content));
  if (!text || hasMatchingLastUserMessage(deps.tabsRef.current, sessionId, text)) return true;
  deps.updateSession(sessionId, (session) => ({
    ...session,
    messages: [
      ...session.messages,
      { id: newId("user"), role: "user", text, timestamp: nowLabel() },
    ],
  }));
  ensureNextAssistant(deps, sessionId);
  return true;
}

function hasMatchingLastUserMessage(tabs: Session[], sessionId: SessionId, text: string): boolean {
  const current = tabs.find((tab) => tab.id === sessionId);
  const lastUser = [...(current?.messages ?? [])].reverse().find((entry) => entry.role === "user");
  return Boolean(lastUser && (lastUser.text === text || text.includes(lastUser.text)));
}

function ensureNextAssistant(deps: PiEventApplierDeps, sessionId: SessionId): string {
  const id = newId("assistant");
  deps.liveAssistantIdsRef.current.set(sessionId, id);
  deps.updateSession(sessionId, (session) => ({
    ...session,
    activeAssistantId: id,
    messages: [
      ...session.messages,
      { id, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
    ],
  }));
  return id;
}
