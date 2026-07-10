import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileOpenSessions,
  sessionRows,
  type OpenAgentSession,
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
    unseen: false,
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

test("runtime adoption keeps one stable open task and clears unseen when focused", () => {
  const previous = [
    openSession({ status: "running", focused: false, unseen: true, threadId: null }),
  ];
  const next = reconcileOpenSessions(previous, [
    openSession({ status: "running", focused: true, threadId: "thread-1" }),
  ]);

  assert.equal(next.length, 1);
  assert.equal(next[0].id, "task-1");
  assert.equal(next[0].threadId, "thread-1");
  assert.equal(next[0].unseen, false);
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
