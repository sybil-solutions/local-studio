import type { BrowserCommandResult } from "@/lib/agent/browser/command";
import type { BrowserEventsSubscription } from "@/lib/agent/workspace/effects";
import type { WorkspaceState } from "@/lib/agent/workspace/types";
import type { AgentBrowserHandle } from "./agent-browser";

type BrowserCommand = {
  id: string;
  verb: string;
  sessionId?: string;
  payload: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseBrowserCommand(raw: string): BrowserCommand | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const id = parsed.id;
    const verb = parsed.verb;
    const payload = parsed.payload;
    const sessionId = parsed.sessionId;
    if (typeof id !== "string" || typeof verb !== "string" || !isRecord(payload)) return null;
    return {
      id,
      verb,
      payload,
      ...(typeof sessionId === "string" && sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
    };
  } catch {
    return null;
  }
}

export function focusedBrowserSessionId(state: WorkspaceState): string | null {
  const pane = state.panesById.get(state.focusedPaneId);
  if (!pane) return null;
  const activeSession = state.sessions.get(pane.sessionId);
  return activeSession?.runtimeSessionId || pane.runtimeSessionId || null;
}

export function browserSessionIsKnown(state: WorkspaceState, sessionId: string): boolean {
  if (!sessionId) return false;
  for (const pane of state.panesById.values()) {
    if (pane.runtimeSessionId === sessionId) return true;
  }
  for (const session of state.sessions.values()) {
    if (session.runtimeSessionId === sessionId) return true;
  }
  return false;
}

function postBrowserResult(id: string, result: BrowserCommandResult) {
  return fetch("/api/agent/browser/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...result }),
  });
}

export function browserHostIsReady(
  handle: AgentBrowserHandle | null,
  isElectron: boolean,
): boolean {
  return isElectron ? Boolean(handle?.webview) : Boolean(handle?.iframe);
}

export function waitForBrowserHost(
  getHandle: () => AgentBrowserHandle | null,
  isElectron: boolean,
  timeoutMs = 2_500,
): Promise<void> {
  if (browserHostIsReady(getHandle(), isElectron) || typeof window === "undefined") {
    return Promise.resolve();
  }
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (browserHostIsReady(getHandle(), isElectron) || Date.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, 40);
    };
    tick();
  });
}

export function createBrowserEvents(
  runBrowserCommand: (
    verb: string,
    payload: Record<string, unknown>,
  ) => Promise<BrowserCommandResult>,
  resolveSession: (sessionId: string) => { focused: string | null; known: boolean },
): BrowserEventsSubscription {
  let source: EventSource | null = null;
  let enabled = false;

  const close = () => {
    source?.close();
    source = null;
  };

  return {
    setEnabled(nextEnabled) {
      if (enabled === nextEnabled && source) return;
      enabled = nextEnabled;
      close();
      if (!enabled || typeof EventSource === "undefined") return;
      source = new EventSource("/api/agent/browser/events");
      source.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data !== "string") return;
        const command = parseBrowserCommand(event.data);
        if (!command || typeof fetch !== "function") return;
        const session = command.sessionId
          ? resolveSession(command.sessionId)
          : { focused: null, known: true };
        if (command.sessionId && (!session.known || session.focused !== command.sessionId)) {
          void postBrowserResult(command.id, {
            ok: false,
            error:
              session.known && session.focused
                ? `Browser is connected to focused session ${session.focused}; the requesting session ${command.sessionId} is not focused.`
                : `Browser is not connected to the requesting session (${command.sessionId}).`,
          });
          return;
        }
        void runBrowserCommand(command.verb, command.payload)
          .then((result) => postBrowserResult(command.id, result))
          .catch((error) => {
            console.warn("[agent] browser bridge dispatch failed", error);
          });
      };
    },
    close() {
      enabled = false;
      close();
    },
  };
}
