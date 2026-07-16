import assert from "node:assert/strict";
import test from "node:test";

import type { Session } from "../src/features/agent/runtime/types";
import { reducer } from "../src/features/agent/workspace/reducer";
import {
  loadSessionDrafts,
  restoreSessionDraft,
  SESSION_DRAFTS_KEY,
  updateSessionDrafts,
  writeSessionDrafts,
} from "../src/features/agent/workspace/session-drafts";
import { createInitialState } from "../src/features/agent/workspace/store";

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    piSessionId: null,
    title: "Session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
    ...patch,
  };
}

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  };
}

test("draft ownership migrates from the local id to the durable thread id", () => {
  const local = session("runtime-a", { input: "draft A" });
  const drafts = updateSessionDrafts(new Map(), session("runtime-a"), local);
  const adopted = { ...local, piSessionId: "thread-a" };
  const migrated = updateSessionDrafts(drafts, local, adopted);

  assert.equal(migrated.get("runtime-a"), undefined);
  assert.equal(migrated.get("thread-a"), "draft A");
  assert.equal(updateSessionDrafts(migrated, adopted, { ...adopted, input: "" }).size, 0);
});

test("draft storage validates, bounds, and restores durable state", () => {
  const target = storage();
  writeSessionDrafts(target, new Map([["thread-a", "draft A"]]));
  const loaded = loadSessionDrafts(target);

  assert.equal(loaded.get("thread-a"), "draft A");
  assert.equal(
    restoreSessionDraft(session("runtime-a", { piSessionId: "thread-a" }), loaded).input,
    "draft A",
  );
  target.setItem(SESSION_DRAFTS_KEY, JSON.stringify({ version: 1, drafts: { bad: 42 } }));
  assert.equal(loadSessionDrafts(target).size, 0);
});

test("a draft survives session replacement and a later reopen", () => {
  const initial = createInitialState();
  const firstId = initial.panesById.get("p-init")?.sessionId;
  assert.ok(firstId);
  const drafted = reducer(initial, {
    type: "patchSession",
    sessionId: firstId,
    patch: (current) => ({ ...current, piSessionId: "thread-a", input: "unfinished" }),
  });
  const switched = reducer(drafted, {
    type: "urlNavRequested",
    key: "project-1|thread-b||||1",
    project: null,
    sessionId: "thread-b",
    replaceWorkspace: true,
    paneId: "p-b",
    tab: session("runtime-b"),
  });
  const reopened = reducer(switched, {
    type: "urlNavRequested",
    key: "project-1|thread-a||||1",
    project: null,
    sessionId: "thread-a",
    replaceWorkspace: true,
    paneId: "p-a",
    tab: session("runtime-a-2"),
  });

  assert.equal(reopened.sessions.get("runtime-a-2")?.input, "unfinished");
  assert.equal(reopened.sessions.get("runtime-a-2")?.piSessionId, "thread-a");
});
