import assert from "node:assert/strict";
import test from "node:test";

import { makeFreshTab } from "../src/features/agent/messages/helpers";
import type { Project } from "../src/features/agent/projects/types";
import type { Session } from "../src/features/agent/runtime/types";
import { reducer } from "../src/features/agent/workspace/reducer";
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
