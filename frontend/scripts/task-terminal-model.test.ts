import assert from "node:assert/strict";
import test from "node:test";

import { makeFreshTab } from "../src/features/agent/messages/helpers";
import type { Project } from "../src/features/agent/projects/types";
import { terminalOwnerFor, terminalKeysMatch } from "../src/features/agent/terminal-owners";
import { collectLeaves } from "../src/features/agent/workspace/layout";
import { openTerminalPane } from "../src/features/agent/workspace/pane-controller";
import {
  createInitialState,
  restorePersistedPaneState,
} from "../src/features/agent/workspace/store";

function persistedWorkspace(
  panes: Record<string, unknown>,
  layout: unknown,
  focusedPaneId: string,
) {
  return JSON.stringify({ version: 1, panes, layout, focusedPaneId });
}

test("terminal panes restore beside chat tasks", () => {
  const restored = restorePersistedPaneState(
    persistedWorkspace(
      {
        "p-chat": {
          activeTabId: "session-1",
          tabs: [{ id: "session-1", title: "Task", cwd: "/repo" }],
        },
        "p-terminal": {
          kind: "terminal",
          owner: {
            mountKey: "project:repo",
            matchKeys: ["project:repo"],
            cwd: "/repo",
            title: "Repo",
            kind: "project",
          },
        },
      },
      {
        kind: "split",
        direction: "vertical",
        ratio: 0.5,
        a: { kind: "leaf", paneId: "p-chat" },
        b: { kind: "leaf", paneId: "p-terminal" },
      },
      "p-terminal",
    ),
  );

  assert.ok(restored);
  assert.deepEqual(collectLeaves(restored.layout), ["p-chat", "p-terminal"]);
  assert.equal(restored.panesById.get("p-terminal")?.kind, "terminal");
  assert.equal(restored.focusedPaneId, "p-terminal");
});

test("terminal-only workspaces restore", () => {
  const restored = restorePersistedPaneState(
    persistedWorkspace(
      {
        "p-terminal": {
          kind: "terminal",
          owner: {
            mountKey: "project:repo",
            matchKeys: ["project:repo"],
            cwd: "/repo",
            title: "Repo",
            kind: "project",
          },
        },
      },
      { kind: "leaf", paneId: "p-terminal" },
      "p-terminal",
    ),
  );

  assert.ok(restored);
  assert.equal(restored.panesById.get("p-terminal")?.kind, "terminal");
});

test("opening a terminal creates one durable workspace pane", () => {
  const initial = createInitialState();
  const owner = {
    mountKey: "project:repo",
    matchKeys: ["project:repo"],
    cwd: "/repo",
    title: "Repo",
    kind: "project" as const,
  };
  const opened = openTerminalPane(initial, {
    paneId: initial.focusedPaneId,
    newPaneId: "p-terminal",
    owner,
  });
  const reopened = openTerminalPane(opened, {
    paneId: initial.focusedPaneId,
    newPaneId: "p-terminal-again",
    owner,
  });

  assert.deepEqual(collectLeaves(opened.layout), ["p-init", "p-terminal"]);
  assert.equal(opened.panesById.get("p-terminal")?.kind, "terminal");
  assert.deepEqual(collectLeaves(reopened.layout), ["p-init", "p-terminal"]);
  assert.equal(reopened.focusedPaneId, "p-terminal");
});

test("a task owns one stable terminal across runtime adoption", () => {
  const project: Project = {
    id: "project-1",
    name: "Studio",
    path: "/repo/studio",
    addedAt: "2026-07-10T00:00:00.000Z",
    exists: true,
    hasGit: true,
    branch: "sol",
  };
  const session = {
    ...makeFreshTab(),
    id: "task-1",
    title: "Session cleanup",
    projectId: project.id,
    cwd: project.path,
  };

  const before = terminalOwnerFor(project, session);
  const after = terminalOwnerFor(project, { ...session, piSessionId: "pi-1" });

  assert.equal(before?.mountKey, "session:task-1");
  assert.equal(after?.mountKey, before?.mountKey);
  assert.deepEqual(after?.matchKeys, ["session:task-1", "pi:pi-1"]);
  assert.equal(after?.cwd, project.path);
});

test("terminal owners keep old session terminals addressable by their keys", () => {
  const sessionA = {
    ...makeFreshTab(),
    id: "task-a",
    title: "Chat A",
    projectId: "project-a",
    cwd: "/repo/a",
    piSessionId: "pi-a",
  };
  const sessionB = {
    ...makeFreshTab(),
    id: "task-b",
    title: "Chat B",
    projectId: "project-b",
    cwd: "/repo/b",
    piSessionId: "pi-b",
  };
  const ownerA = terminalOwnerFor(null, sessionA);
  const ownerB = terminalOwnerFor(null, sessionB);

  assert.ok(ownerA);
  assert.ok(ownerB);
  assert.equal(ownerA.mountKey, "session:task-a");
  assert.equal(ownerB.mountKey, "session:task-b");
  assert.equal(terminalKeysMatch(ownerA.matchKeys, ownerB.matchKeys), false);
});
