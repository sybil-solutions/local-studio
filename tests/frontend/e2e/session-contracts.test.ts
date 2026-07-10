import assert from "node:assert/strict";
import test from "node:test";

import { indexOpenByThreadId, type ActiveSession } from "@/features/agent/session-contracts";

function activeSession(overrides: Partial<ActiveSession>): ActiveSession {
  return {
    projectId: "p",
    cwd: "/tmp",
    paneId: "pane",
    id: "tab",
    threadId: null,
    title: "t",
    status: "idle",
    focused: false,
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

test("indexes open sessions by thread id", () => {
  const a = activeSession({ threadId: "pi-a", paneId: "1" });
  const b = activeSession({ threadId: "pi-b", paneId: "2" });
  const map = indexOpenByThreadId([a, b]);
  assert.equal(map.size, 2);
  assert.equal(map.get("pi-a"), a);
  assert.equal(map.get("pi-b"), b);
});

test("skips sessions without a thread id", () => {
  const withId = activeSession({ threadId: "pi-a" });
  const withoutId = activeSession({ threadId: null });
  const map = indexOpenByThreadId([withId, withoutId]);
  assert.equal(map.size, 1);
  assert.ok(map.has("pi-a"));
});

test("last session wins when two share a thread id", () => {
  const first = activeSession({ threadId: "dup", paneId: "first" });
  const second = activeSession({ threadId: "dup", paneId: "second" });
  const map = indexOpenByThreadId([first, second]);
  assert.equal(map.size, 1);
  assert.equal(map.get("dup")?.paneId, "second");
});

test("returns an empty map for no active sessions", () => {
  assert.equal(indexOpenByThreadId([]).size, 0);
});
