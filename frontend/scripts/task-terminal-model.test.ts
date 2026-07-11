import assert from "node:assert/strict";
import test from "node:test";

import { makeFreshTab } from "../src/features/agent/messages/helpers";
import type { Project } from "../src/features/agent/projects/types";
import { terminalOwnerFor, terminalKeysMatch } from "../src/features/agent/terminal-owners";
import { terminalResumeNotice } from "../src/features/agent/ui/terminal-panel";
import { collectLeaves } from "../src/features/agent/workspace/layout";
import {
  applyUrlNavigation,
  openSessionPayloadInPane,
  openTerminalPane,
} from "../src/features/agent/workspace/pane-controller";
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

test("restored terminals explain whether their PTY was resumed", () => {
  assert.equal(terminalResumeNotice(true, true), "[resumed terminal session]");
  assert.equal(
    terminalResumeNotice(false, true),
    "[previous terminal process is no longer running; started a new shell]",
  );
  assert.equal(terminalResumeNotice(false, false), null);
});

test("task navigation preserves a focused terminal pane", () => {
  const initial = createInitialState();
  const withTerminal = openTerminalPane(initial, {
    paneId: initial.focusedPaneId,
    newPaneId: "p-terminal",
    owner: {
      mountKey: "project:repo",
      matchKeys: ["project:repo"],
      cwd: "/repo",
      title: "Repo",
      kind: "project",
    },
  });
  const navigated = applyUrlNavigation(withTerminal, {
    key: "new-task",
    project: null,
    newSession: true,
    replaceWorkspace: true,
    paneId: "p-new",
    tab: makeFreshTab(),
  });

  assert.equal(navigated.panesById.get("p-terminal")?.kind, "terminal");
  assert.equal(navigated.focusedPaneId, "p-init");
  const chatPane = navigated.panesById.get("p-init");
  assert.ok(chatPane && chatPane.kind !== "terminal" && chatPane.sessionId);
});

test("dropping a task on a terminal preserves the terminal pane", () => {
  const initial = createInitialState();
  const withTerminal = openTerminalPane(initial, {
    paneId: initial.focusedPaneId,
    newPaneId: "p-terminal",
    owner: {
      mountKey: "project:repo",
      matchKeys: ["project:repo"],
      cwd: "/repo",
      title: "Repo",
      kind: "project",
    },
  });
  const opened = openSessionPayloadInPane(withTerminal, {
    paneId: "p-terminal",
    payload: { piSessionId: "pi-new", title: "Dropped task" },
    tab: makeFreshTab(),
  });
  const chatPane = opened.panesById.get("p-init");

  assert.equal(opened.panesById.get("p-terminal")?.kind, "terminal");
  assert.ok(chatPane && chatPane.kind !== "terminal");
  assert.equal(opened.sessions.get(chatPane.sessionId)?.piSessionId, "pi-new");
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
