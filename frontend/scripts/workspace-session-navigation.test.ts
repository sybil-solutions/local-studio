import assert from "node:assert/strict";
import test from "node:test";

import { makeFreshTab } from "../src/features/agent/messages/helpers";
import type { Project } from "../src/features/agent/projects/types";
import type { Session } from "../src/features/agent/runtime/types";
import { reducer } from "../src/features/agent/workspace/reducer";
import { supersededNavigationIntent } from "../src/features/agent/workspace/pane-controller";
import { createInitialState } from "../src/features/agent/workspace/store";

const project: Project = {
  id: "project-1",
  name: "Project",
  path: "/repo",
  addedAt: "2026-07-16T00:00:00.000Z",
  exists: true,
  hasGit: true,
  branch: "main",
};

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    piSessionId: null,
    projectId: project.id,
    cwd: project.path,
    title: "Session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
    ...patch,
  };
}

test("replace navigation retains the mounted pane identity", () => {
  const initial = createInitialState();
  const next = reducer(initial, {
    type: "urlNavRequested",
    key: "project-1||new|||1",
    project,
    sessionId: null,
    newSession: true,
    split: false,
    replaceWorkspace: true,
    paneId: "p-throwaway",
    tab: makeFreshTab(),
  });

  assert.equal(next.focusedPaneId, "p-init");
  assert.deepEqual(next.layout, { kind: "leaf", paneId: "p-init" });
  assert.notEqual(
    next.panesById.get("p-init")?.sessionId,
    initial.panesById.get("p-init")?.sessionId,
  );
});

test("history navigation reattaches the running workspace session and removes aliases", () => {
  const initial = createInitialState();
  const starterId = initial.panesById.get("p-init")?.sessionId;
  assert.ok(starterId);
  const running = session("runtime-original", {
    piSessionId: "thread-1",
    status: "running",
    messages: [{ id: "user-1", role: "user", text: "hello" }],
  });
  const duplicate = session("runtime-alias", {
    piSessionId: "thread-1",
    status: "idle",
  });
  const state = {
    ...initial,
    hydrated: true,
    sessions: new Map([
      [starterId, initial.sessions.get(starterId)!],
      [duplicate.id, duplicate],
      [running.id, running],
    ]),
  };
  const next = reducer(state, {
    type: "urlNavRequested",
    key: "project-1|thread-1||open||1",
    project,
    sessionId: "thread-1",
    newSession: false,
    split: false,
    replaceWorkspace: true,
    paneId: "p-throwaway",
    tab: makeFreshTab(),
  });

  assert.equal(next.focusedPaneId, "p-init");
  assert.equal(next.panesById.get("p-init")?.sessionId, running.id);
  assert.deepEqual([...next.sessions.keys()], [running.id]);
  assert.equal(next.sessions.get(running.id)?.messages[0]?.text, "hello");
});

test("an async completion stays owned by its session after the pane switches", () => {
  const initial = createInitialState();
  const originalId = initial.panesById.get("p-init")?.sessionId;
  assert.ok(originalId);
  const started = reducer(initial, {
    type: "patchSession",
    sessionId: originalId,
    patch: (current) => ({
      ...current,
      status: "starting",
      messages: [{ id: "user-a", role: "user", text: "from A" }],
    }),
  });
  const switched = reducer(started, {
    type: "urlNavRequested",
    key: "project-1||new-next|||1",
    project,
    sessionId: null,
    newSession: true,
    split: false,
    replaceWorkspace: true,
    paneId: "p-throwaway",
    tab: session("session-b"),
  });
  const next = reducer(switched, {
    type: "patchSession",
    sessionId: originalId,
    patch: (current) => ({
      ...current,
      status: "running",
      messages: [...current.messages, { id: "assistant-a", role: "assistant", text: "for A" }],
    }),
  });

  assert.equal(next.panesById.get("p-init")?.sessionId, "session-b");
  assert.deepEqual(
    next.sessions.get(originalId)?.messages.map((message) => message.text),
    ["from A", "for A"],
  );
  assert.deepEqual(next.sessions.get("session-b")?.messages, []);
});

test("a superseded route completion cannot reopen the previous session", () => {
  const initial = createInitialState();
  const latest = reducer(initial, {
    type: "urlNavRequested",
    key: "project-1|thread-b||later||1",
    intent: "mzzzzz.2",
    project,
    sessionId: "thread-b",
    replaceWorkspace: true,
    paneId: "p-later",
    tab: session("runtime-b"),
  });
  const stale = reducer(latest, {
    type: "urlNavRequested",
    key: "project-1|thread-a||earlier||1",
    intent: "mzzzzz.1",
    project,
    sessionId: "thread-a",
    replaceWorkspace: true,
    paneId: "p-earlier",
    tab: session("runtime-a"),
  });

  assert.equal(stale.panesById.get("p-init")?.sessionId, "runtime-b");
  assert.equal(stale.sessions.get("runtime-b")?.piSessionId, "thread-b");
});

test("browser history navigation remains authoritative without a click intent", () => {
  const initial = createInitialState();
  const clicked = reducer(initial, {
    type: "urlNavRequested",
    key: "project-1|thread-b||later||1",
    intent: "mzzzzz.2",
    project,
    sessionId: "thread-b",
    replaceWorkspace: true,
    paneId: "p-later",
    tab: session("runtime-b"),
  });
  const back = reducer(clicked, {
    type: "urlNavRequested",
    key: "project-1|thread-a||||1",
    project,
    sessionId: "thread-a",
    replaceWorkspace: true,
    paneId: "p-back",
    tab: session("runtime-a"),
  });

  assert.equal(back.panesById.get("p-init")?.sessionId, "runtime-a");
  assert.equal(back.sessions.get("runtime-a")?.piSessionId, "thread-a");
});

test("navigation intent ordering is monotonic within one timestamp", () => {
  assert.equal(supersededNavigationIntent("mzzzzz.1", "mzzzzz.2"), true);
  assert.equal(supersededNavigationIntent("mzzzzz.3", "mzzzzz.2"), false);
  assert.equal(supersededNavigationIntent(undefined, "mzzzzz.2"), false);
});
