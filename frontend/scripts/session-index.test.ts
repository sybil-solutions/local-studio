import assert from "node:assert/strict";
import test from "node:test";

import {
  getSessionActivity,
  markSessionActivitySeen,
  publishRuntimeActivity,
  sessionRows,
  type OpenAgentSession,
  type SessionActivitySnapshot,
} from "../src/features/agent/session-index";
import type { SessionSummary } from "../src/features/agent/session-summary";

function openSession(patch: Partial<OpenAgentSession> = {}): OpenAgentSession {
  return {
    id: "task-1",
    threadId: null,
    projectId: "project-1",
    cwd: "/repo",
    paneId: "pane-1",
    title: "Task",
    status: "idle",
    focused: true,
    updatedAt: "2026-07-10T12:00:00.000Z",
    ...patch,
  };
}

function historySession(id: string, startedAt: string): SessionSummary {
  return {
    id,
    filename: `${id}.jsonl`,
    cwd: "/repo",
    startedAt,
    updatedAt: startedAt,
    modelId: null,
    provider: null,
    firstUserMessage: "Task",
    archived: false,
    archivedAt: null,
  };
}

test("runtime adoption resolves activity through local and thread identities", () => {
  const activity: SessionActivitySnapshot = {
    active: new Set(["thread-1"]),
    unseen: new Set(["task-1"]),
  };
  const [row] = sessionRows([openSession({ focused: true, threadId: "thread-1" })], [], activity);

  assert.equal(row.kind, "open");
  assert.equal(row.activity, "running");
});

test("focused settled sessions never render unseen", () => {
  const activity: SessionActivitySnapshot = {
    active: new Set(),
    unseen: new Set(["task-1", "thread-1"]),
  };
  const [row] = sessionRows([openSession({ focused: true, threadId: "thread-1" })], [], activity);

  assert.equal(row.activity, "idle");
});

test("runtime activity uses one alias-aware unseen lifecycle", () => {
  publishRuntimeActivity([
    {
      sessionId: "runtime-alias",
      status: { active: true, piSessionId: "thread-alias" },
    },
  ]);
  publishRuntimeActivity([]);

  assert.equal(getSessionActivity().unseen.has("runtime-alias"), true);
  assert.equal(getSessionActivity().unseen.has("thread-alias"), true);

  markSessionActivitySeen("runtime-alias", "thread-alias");
  assert.equal(getSessionActivity().unseen.has("runtime-alias"), false);
  assert.equal(getSessionActivity().unseen.has("thread-alias"), false);
});

test("open thread replaces its exact history row without changing history order", () => {
  const history = [
    historySession("thread-new", "2026-07-10T12:00:00.000Z"),
    historySession("thread-old", "2026-07-09T12:00:00.000Z"),
  ];
  const rows = sessionRows(
    [
      openSession({
        id: "task-old",
        threadId: "thread-old",
        startedAt: "2026-07-10T13:00:00.000Z",
      }),
    ],
    history,
  );

  assert.deepEqual(
    rows.map((row) => [row.kind, row.threadId]),
    [
      ["history", "thread-new"],
      ["open", "thread-old"],
    ],
  );
});

test("same-title history rows remain distinct", () => {
  const rows = sessionRows(
    [],
    [
      historySession("thread-1", "2026-07-10T12:00:00.000Z"),
      historySession("thread-2", "2026-07-10T12:00:00.000Z"),
    ],
  );

  assert.deepEqual(
    rows.map((row) => row.threadId),
    ["thread-1", "thread-2"],
  );
});

test("multiple local aliases for one open thread render one row", () => {
  const rows = sessionRows(
    [
      openSession({ id: "task-a", threadId: "thread-1", focused: false }),
      openSession({ id: "task-b", threadId: "thread-1", focused: true }),
      openSession({ id: "task-c", threadId: "thread-1", focused: false }),
    ],
    [historySession("thread-1", "2026-07-10T12:00:00.000Z")],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, "open");
  assert.equal(rows[0]?.key, "thread-1");
  assert.equal(rows[0]?.kind === "open" ? rows[0].session.id : null, "task-b");
});
