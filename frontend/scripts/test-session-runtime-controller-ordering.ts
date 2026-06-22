import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionRuntimeController,
  type SessionRuntimeBinding,
} from "../src/features/agent/runtime/session-runtime-controller";
import type {
  RuntimeEventPayload,
  RuntimeEventSubscription,
} from "../src/features/agent/runtime/api";
import type { Session } from "../src/features/agent/runtime/types";

test("new turn stream events target the optimistic assistant bubble despite stale snapshots", async () => {
  const sessionId = "tab-1";
  const oldAssistantId = "assistant-old";
  const newAssistantId = "assistant-new";
  const previousMessages: Session["messages"] = [
    { id: "user-old", role: "user", text: "first prompt" },
    {
      id: oldAssistantId,
      role: "assistant",
      text: "first response",
      blocks: [{ kind: "text", id: "old-text", text: "first response" }],
    },
  ];
  let liveSession: Session = {
    id: sessionId,
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    title: "Ordering test",
    messages: [
      ...previousMessages,
      { id: "user-new", role: "user", text: "second prompt" },
      { id: newAssistantId, role: "assistant", text: "", blocks: [] },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: newAssistantId,
  };
  const staleSnapshot: Session = {
    ...liveSession,
    messages: previousMessages,
    activeAssistantId: oldAssistantId,
  };
  const payloadSink: { current?: (payload: RuntimeEventPayload) => void } = {};
  const controller = createSessionRuntimeController({
    idleReconnectMs: 0,
    api: {
      listRuntimeSessions: async () => [],
      loadRuntimeStatus: async () => null,
      subscribeRuntimeEvents: (
        _runtime,
        _after,
        _piSessionId,
        handlers,
      ): RuntimeEventSubscription => {
        payloadSink.current = handlers.onPayload;
        return { close: () => undefined };
      },
    },
  });
  const binding: SessionRuntimeBinding = {
    commit: (targetSessionId, patch) => {
      assert.equal(targetSessionId, sessionId);
      liveSession = patch(liveSession);
    },
    getSession: () => staleSnapshot,
    getSessions: () => [liveSession],
  };

  controller.bind(binding);
  controller.reconcile([liveSession]);
  controller.noteTurnAccepted(sessionId, newAssistantId);

  const sendPayload = payloadSink.current;
  if (!sendPayload) throw new Error("runtime subscription was not opened");
  sendPayload({
    type: "pi",
    seq: 1,
    event: {
      type: "message_start",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "second response" }],
      },
    },
  });

  const oldAssistant = liveSession.messages.find((message) => message.id === oldAssistantId);
  const newAssistant = liveSession.messages.find((message) => message.id === newAssistantId);
  assert.equal(oldAssistant?.text, "first response");
  assert.equal(newAssistant?.text, "second response");

  controller.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
