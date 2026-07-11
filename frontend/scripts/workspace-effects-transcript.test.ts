import assert from "node:assert/strict";
import test from "node:test";
import { makeFreshTab } from "../src/features/agent/messages/helpers";
import {
  runWorkspaceEffect,
  type WorkspaceEffectDeps,
} from "../src/features/agent/workspace/effects";
import type { WorkspaceState } from "../src/features/agent/workspace/types";

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function workspace(session: ReturnType<typeof makeFreshTab>): WorkspaceState {
  return {
    sessions: new Map([[session.id, session]]),
    models: [],
    selectedModel: "",
    modelsLoading: false,
    layout: { kind: "leaf", paneId: "pane" },
    panesById: new Map([["pane", { sessionId: session.id }]]),
    focusedPaneId: "pane",
    setupWarning: "",
    error: "",
    hydrated: true,
    lastHandledNavKey: "",
  };
}

function depsFor(store: ReturnType<typeof storage>): WorkspaceEffectDeps {
  return {
    storage: store,
    window: { Event, dispatchEvent: () => true },
    api: {},
    queueReplay: () => undefined,
  };
}

function persistedText(store: ReturnType<typeof storage>, piSessionId: string): string {
  const raw = store.values.get(`local-studio.agent.transcript.v2.${piSessionId}`);
  assert.ok(raw);
  const parsed = JSON.parse(raw) as { messages: Array<{ text: string }> };
  return parsed.messages.at(-1)?.text ?? "";
}

test("settled transcript persistence detects same-length assistant output changes", () => {
  const store = storage();
  const first = makeFreshTab();
  const session = {
    ...first,
    piSessionId: "pi-signature",
    status: "idle" as const,
    messages: [
      { id: "user", role: "user" as const, text: "prompt" },
      {
        id: "assistant",
        role: "assistant" as const,
        text: "old",
        blocks: [{ kind: "text" as const, id: "text", text: "old" }],
      },
    ],
  };
  const previous = workspace(session);
  const nextSession = {
    ...session,
    messages: session.messages.map((message) =>
      message.role === "assistant"
        ? { ...message, text: "new", blocks: [{ kind: "text" as const, id: "text", text: "new" }] }
        : message,
    ),
  };
  const next = workspace(nextSession);
  runWorkspaceEffect(
    { type: "patchSession", sessionId: session.id, patch: {} },
    previous,
    next,
    depsFor(store),
  );
  assert.equal(persistedText(store, "pi-signature"), "new");
});

test("settled transcript persistence detects changes before the last message", () => {
  const store = storage();
  const first = makeFreshTab();
  const session = {
    ...first,
    piSessionId: "pi-earlier",
    status: "idle" as const,
    messages: [
      { id: "user", role: "user" as const, text: "old prompt" },
      {
        id: "assistant",
        role: "assistant" as const,
        text: "answer",
        blocks: [{ kind: "text" as const, id: "text", text: "answer" }],
      },
    ],
  };
  const previous = workspace(session);
  const nextSession = {
    ...session,
    messages: [{ ...session.messages[0], text: "new prompt" }, session.messages[1]],
  };
  const next = workspace(nextSession);
  runWorkspaceEffect(
    { type: "patchSession", sessionId: session.id, patch: {} },
    previous,
    next,
    depsFor(store),
  );
  const raw = store.values.get("local-studio.agent.transcript.v2.pi-earlier");
  assert.ok(raw);
  const parsed = JSON.parse(raw) as { messages: Array<{ text: string }> };
  assert.equal(parsed.messages[0]?.text, "new prompt");
});
