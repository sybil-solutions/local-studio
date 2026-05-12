import { describe, expect, it } from "vitest";
import type { Session } from "./types";
import { applyPiEventToSession, type PiEventApplierDeps } from "./pi-event-applier";

const session = (patch: Partial<Session>): Session => ({
  id: "session-1",
  runtimeSessionId: "runtime-1",
  piSessionId: null,
  title: "Session",
  messages: [],
  status: "idle",
  error: "",
  input: "",
  ...patch,
});

function harness(initial: Session[]) {
  const tabsRef = { current: initial };
  const liveAssistantIdsRef = { current: new Map<string, string>() };
  const deps: PiEventApplierDeps = {
    tabsRef,
    liveAssistantIdsRef,
    updateSession: (sessionId, patch) => {
      tabsRef.current = tabsRef.current.map((tab) => (tab.id === sessionId ? patch(tab) : tab));
    },
    patchAssistant: (sessionId, assistantId, patch) => {
      deps.updateSession(sessionId, (tab) => ({
        ...tab,
        messages: tab.messages.map((message) =>
          message.id === assistantId ? patch(message) : message,
        ),
      }));
    },
  };
  return deps;
}

describe("applyPiEventToSession", () => {
  it("appends visible Pi user messages and opens the next assistant", () => {
    const deps = harness([session({ id: "s1" })]);

    applyPiEventToSession(deps, "s1", "assistant-1", {
      type: "message_start",
      message: { role: "user", content: "User prompt:\nignored\n\nUser prompt:\nHello agent" },
    });

    const messages = deps.tabsRef.current[0].messages;
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0].text).toBe("Hello agent");
    expect(deps.liveAssistantIdsRef.current.get("s1")).toBe(messages[1].id);
  });

  it("dedupes echoed Pi user messages already optimistically rendered", () => {
    const deps = harness([
      session({ id: "s1", messages: [{ id: "user-1", role: "user", text: "Hello agent" }] }),
    ]);

    applyPiEventToSession(deps, "s1", "assistant-1", {
      type: "message_end",
      message: { role: "user", content: "Hello agent" },
    });

    expect(deps.tabsRef.current[0].messages).toHaveLength(1);
  });

  it("routes assistant block events to the current live assistant", () => {
    const deps = harness([
      session({
        id: "s1",
        messages: [{ id: "assistant-live", role: "assistant", text: "", blocks: [] }],
      }),
    ]);
    deps.liveAssistantIdsRef.current.set("s1", "assistant-live");

    applyPiEventToSession(deps, "s1", "assistant-fallback", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    });

    expect(deps.tabsRef.current[0].messages[0].blocks).toMatchObject([
      { kind: "text", text: "hello" },
    ]);
  });

  it("records assistant token usage without requiring a block event", () => {
    const deps = harness([session({ id: "s1" })]);

    applyPiEventToSession(deps, "s1", "assistant-1", {
      type: "message_end",
      message: { role: "assistant", usage: { input_tokens: 3, output_tokens: 5 } },
    });

    expect(deps.tabsRef.current[0].tokenStats).toEqual({ read: 3, write: 5, current: 8 });
  });
});
