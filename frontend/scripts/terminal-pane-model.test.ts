import assert from "node:assert/strict";
import test from "node:test";

import { makeFreshTab } from "../src/features/agent/messages/helpers";
import type { Session } from "../src/features/agent/runtime/types";
import {
  activeSession,
  findPaneByPiSessionId,
  paneSessionId,
  referencedSessionIds,
} from "../src/features/agent/runtime/selectors";
import { collectLeaves } from "../src/features/agent/workspace/layout";
import {
  applyUrlNavigation,
  canRestoreTerminalOwner,
  closePane,
  focusPane,
  openTerminalPane,
} from "../src/features/agent/workspace/pane-controller";
import { reducer } from "../src/features/agent/workspace/reducer";
import {
  PANE_STATE_KEY,
  createInitialState,
  restorePersistedPaneState,
  type WorkspaceStorage,
} from "../src/features/agent/workspace/store";
import { writePaneState } from "../src/features/agent/workspace/persistence";
import {
  runWorkspaceEffect,
  type WorkspaceEffectDeps,
} from "../src/features/agent/workspace/effects";
import type {
  ChatPaneState,
  PaneState,
  TerminalPaneState,
  WorkspaceState,
} from "../src/features/agent/workspace/types";

function chatSession(patch: Partial<Session> = {}): Session {
  return { ...makeFreshTab(), ...patch };
}

function stateWithChatPane(session: Session): WorkspaceState {
  return {
    ...createInitialState(),
    sessions: new Map([[session.id, session]]),
    panesById: new Map<string, PaneState>([["p-init", { sessionId: session.id }]]),
    focusedPaneId: "p-init",
  };
}

function stateWithSessionlessPane(): WorkspaceState {
  return {
    ...createInitialState(),
    sessions: new Map(),
    panesById: new Map<string, PaneState>([["p-init", { sessionId: "ghost" }]]),
    focusedPaneId: "p-init",
  };
}

function twoChatPaneState(a: Session, b: Session): WorkspaceState {
  return {
    ...createInitialState(),
    sessions: new Map([
      [a.id, a],
      [b.id, b],
    ]),
    layout: {
      kind: "split",
      direction: "vertical",
      ratio: 0.5,
      a: { kind: "leaf", paneId: "p-a" },
      b: { kind: "leaf", paneId: "p-b" },
    },
    panesById: new Map<string, PaneState>([
      ["p-a", { sessionId: a.id }],
      ["p-b", { sessionId: b.id }],
    ]),
    focusedPaneId: "p-a",
  };
}

function asTerminal(pane: PaneState | undefined): TerminalPaneState {
  if (!pane || pane.kind !== "terminal") assert.fail("expected a terminal pane");
  return pane;
}

function asChat(pane: PaneState | undefined): ChatPaneState {
  if (!pane || pane.kind === "terminal") assert.fail("expected a chat pane");
  return pane;
}

function fakeStorage(): { storage: WorkspaceStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    },
    map,
  };
}

function effectDeps(): { deps: WorkspaceEffectDeps; closed: string[] } {
  const closed: string[] = [];
  const deps: WorkspaceEffectDeps = {
    storage: fakeStorage().storage,
    window: {
      Event,
      CustomEvent,
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    api: {},
    queueReplay: () => {},
    closeTerminalOwner: (mountKey) => {
      closed.push(mountKey);
    },
  };
  return { deps, closed };
}

test("openTerminalPane replaces the source chat pane in place and inherits the owner identity", () => {
  const session = chatSession({ cwd: "/repo/demo", piSessionId: "pi-source" });
  const state = stateWithChatPane(session);

  const next = openTerminalPane(state, { sourcePaneId: "p-init" });

  assert.deepEqual(collectLeaves(next.layout), ["p-init"]);
  const term = asTerminal(next.panesById.get("p-init"));
  assert.equal(term.mountKey, `pane-session:${session.id}`);
  assert.equal(term.cwd, "/repo/demo");
  assert.equal(term.title, "Terminal");
  assert.equal(term.ownerSessionId, session.id);
  assert.equal(term.ownerPiSessionId, "pi-source");
  assert.equal(next.focusedPaneId, "p-init");
  assert.equal(next.sessions.get(session.id), session);
});

test("openTerminalPane without a backing session falls back to the pane mountKey and null ownership", () => {
  const next = openTerminalPane(stateWithSessionlessPane(), { sourcePaneId: "p-init" });

  assert.deepEqual(collectLeaves(next.layout), ["p-init"]);
  const term = asTerminal(next.panesById.get("p-init"));
  assert.equal(term.mountKey, "pane:p-init");
  assert.equal(term.cwd, null);
  assert.equal(term.ownerSessionId, null);
  assert.equal(term.ownerPiSessionId, null);
  assert.equal(next.focusedPaneId, "p-init");
});

test("openTerminalPane on an existing terminal pane only moves focus and keeps the mountKey stable", () => {
  const a = chatSession({ cwd: "/repo/a", piSessionId: "pi-a" });
  const b = chatSession({ piSessionId: "pi-b" });
  const first = openTerminalPane(twoChatPaneState(a, b), { sourcePaneId: "p-a" });
  const shifted = focusPane(first, { paneId: "p-b" });

  const again = openTerminalPane(shifted, { sourcePaneId: "p-a" });

  assert.equal(again.focusedPaneId, "p-a");
  assert.deepEqual(asTerminal(again.panesById.get("p-a")), asTerminal(first.panesById.get("p-a")));
  assert.equal(asTerminal(again.panesById.get("p-a")).mountKey, `pane-session:${a.id}`);
  assert.deepEqual(collectLeaves(again.layout), ["p-a", "p-b"]);
  assert.equal(asChat(again.panesById.get("p-b")).sessionId, b.id);
  assert.equal(again.sessions.get(a.id), a);
  assert.equal(again.sessions.get(b.id), b);
});

test("openTerminalPane with an unknown source pane returns the same state object", () => {
  const state = stateWithChatPane(chatSession());
  assert.equal(openTerminalPane(state, { sourcePaneId: "p-missing" }), state);
});

test("reducer openTerminalPane targets the focused pane by default and an explicit source pane otherwise", () => {
  const session = chatSession({ cwd: "/repo/red", piSessionId: "pi-red" });
  const byDefault = reducer(stateWithChatPane(session), { type: "openTerminalPane" });
  assert.equal(
    asTerminal(byDefault.panesById.get("p-init")).mountKey,
    `pane-session:${session.id}`,
  );
  assert.equal(byDefault.focusedPaneId, "p-init");

  const a = chatSession();
  const b = chatSession({ cwd: "/repo/b" });
  const explicit = reducer(twoChatPaneState(a, b), {
    type: "openTerminalPane",
    sourcePaneId: "p-b",
  });
  assert.equal(asTerminal(explicit.panesById.get("p-b")).mountKey, `pane-session:${b.id}`);
  assert.equal(asChat(explicit.panesById.get("p-a")).sessionId, a.id);
  assert.equal(explicit.focusedPaneId, "p-b");
});

test("referencedSessionIds counts terminal owners while chat selectors treat terminals as sessionless", () => {
  const session = chatSession({ piSessionId: "pi-chat" });
  const terminal: TerminalPaneState = {
    kind: "terminal",
    mountKey: "pane-session:owner-b",
    cwd: "/repo/demo",
    title: "Terminal",
    ownerSessionId: "owner-b",
    ownerPiSessionId: "pi-owner-b",
  };
  const state: WorkspaceState = {
    ...stateWithChatPane(session),
    layout: {
      kind: "split",
      direction: "vertical",
      ratio: 0.5,
      a: { kind: "leaf", paneId: "p-init" },
      b: { kind: "leaf", paneId: "p-term" },
    },
    panesById: new Map<string, PaneState>([
      ["p-init", { sessionId: session.id }],
      ["p-term", terminal],
    ]),
    focusedPaneId: "p-term",
  };

  assert.deepEqual(referencedSessionIds(state), new Set([session.id, "owner-b"]));
  assert.equal(paneSessionId(terminal), null);
  assert.equal(activeSession(state, "p-term"), null);
  assert.equal(activeSession(state, "p-init")?.id, session.id);
  assert.equal(findPaneByPiSessionId(state, "pi-owner-b"), null);
  assert.equal(findPaneByPiSessionId(state, "pi-chat")?.paneId, "p-init");
});

test("closing a sibling pane keeps the terminal's owner session alive for restore", () => {
  const a = chatSession({ piSessionId: "pi-a" });
  const owner = chatSession({ cwd: "/repo/own", piSessionId: "pi-owner" });
  const withTerm = openTerminalPane(twoChatPaneState(a, owner), { sourcePaneId: "p-b" });

  const next = closePane(withTerm, { paneId: "p-a" });

  assert.deepEqual(collectLeaves(next.layout), ["p-b"]);
  assert.equal(next.sessions.get(owner.id), owner);
  assert.equal(next.sessions.has(a.id), false);
  assert.equal(canRestoreTerminalOwner(next, "p-b"), true);
});

test("closing a single-leaf terminal restores the owner chat session in place", () => {
  const session = chatSession({ cwd: "/repo/demo", piSessionId: "pi-owner" });
  const withTerm = openTerminalPane(stateWithChatPane(session), { sourcePaneId: "p-init" });

  const next = closePane(withTerm, { paneId: "p-init" });

  assert.deepEqual(collectLeaves(next.layout), ["p-init"]);
  assert.equal(asChat(next.panesById.get("p-init")).sessionId, session.id);
  assert.equal(next.focusedPaneId, "p-init");
  assert.equal(next.sessions.get(session.id), session);
});

test("closing a single-leaf terminal without a restorable owner returns the same state object", () => {
  const ghostTerm = openTerminalPane(stateWithSessionlessPane(), { sourcePaneId: "p-init" });
  assert.equal(closePane(ghostTerm, { paneId: "p-init" }), ghostTerm);

  const session = chatSession({ piSessionId: "pi-stuck" });
  const owned = openTerminalPane(stateWithChatPane(session), { sourcePaneId: "p-init" });
  const pruned: WorkspaceState = { ...owned, sessions: new Map() };
  assert.equal(closePane(pruned, { paneId: "p-init" }), pruned);
});

test("canRestoreTerminalOwner is true only for terminal panes whose owner is still stored", () => {
  const session = chatSession({ piSessionId: "pi-owner" });
  const chatState = stateWithChatPane(session);
  const term = openTerminalPane(chatState, { sourcePaneId: "p-init" });
  const orphaned: WorkspaceState = { ...term, sessions: new Map() };
  const ghostTerm = openTerminalPane(stateWithSessionlessPane(), { sourcePaneId: "p-init" });

  assert.equal(canRestoreTerminalOwner(term, "p-init"), true);
  assert.equal(canRestoreTerminalOwner(chatState, "p-init"), false);
  assert.equal(canRestoreTerminalOwner(term, "p-missing"), false);
  assert.equal(canRestoreTerminalOwner(orphaned, "p-init"), false);
  assert.equal(canRestoreTerminalOwner(ghostTerm, "p-init"), false);
});

test("closing one of several panes removes the leaf and prunes its orphaned session", () => {
  const a = chatSession({ piSessionId: "pi-a" });
  const b = chatSession({ piSessionId: "pi-b" });
  const state: WorkspaceState = { ...twoChatPaneState(a, b), focusedPaneId: "p-b" };

  const next = closePane(state, { paneId: "p-b" });

  assert.deepEqual(collectLeaves(next.layout), ["p-a"]);
  assert.equal(next.panesById.has("p-b"), false);
  assert.equal(next.focusedPaneId, "p-a");
  assert.equal(next.sessions.has(b.id), false);
  assert.equal(next.sessions.get(a.id), a);
});

test("restoring the owner via closePane triggers closeTerminalOwner exactly once with the removed mountKey", () => {
  const session = chatSession({ cwd: "/repo/demo", piSessionId: "pi-owner" });
  const prev = openTerminalPane(stateWithChatPane(session), { sourcePaneId: "p-init" });
  const next = closePane(prev, { paneId: "p-init" });
  const { deps, closed } = effectDeps();

  runWorkspaceEffect({ type: "closePane", paneId: "p-init" }, prev, next, deps);

  assert.deepEqual(closed, [`pane-session:${session.id}`]);
});

test("opening a terminal and unrelated dispatches never trigger closeTerminalOwner", () => {
  const session = chatSession({ cwd: "/repo/demo", piSessionId: "pi-owner" });
  const prev = stateWithChatPane(session);
  const opened = openTerminalPane(prev, { sourcePaneId: "p-init" });
  const open = effectDeps();
  runWorkspaceEffect({ type: "openTerminalPane", sourcePaneId: "p-init" }, prev, opened, open.deps);
  assert.deepEqual(open.closed, []);

  const a = chatSession();
  const b = chatSession();
  const withTerm = openTerminalPane(twoChatPaneState(a, b), { sourcePaneId: "p-a" });
  const shifted = focusPane(withTerm, { paneId: "p-b" });
  const focus = effectDeps();
  runWorkspaceEffect({ type: "focusPane", paneId: "p-b" }, withTerm, shifted, focus.deps);
  assert.deepEqual(focus.closed, []);
});

test("url ?new=1 replaces a focused single-leaf terminal with the fresh chat tab", () => {
  const original = chatSession({ cwd: "/repo/orig", piSessionId: "pi-original" });
  const withTerminal = openTerminalPane(stateWithChatPane(original), { sourcePaneId: "p-init" });
  assert.equal(withTerminal.focusedPaneId, "p-init");
  const fresh = chatSession();

  const next = applyUrlNavigation(withTerminal, {
    key: "nav-new-1",
    project: null,
    newSession: true,
    tab: fresh,
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-init"]);
  assert.equal(asChat(next.panesById.get("p-init")).sessionId, fresh.id);
  assert.equal(next.focusedPaneId, "p-init");
  assert.ok(next.sessions.has(fresh.id));
  assert.equal(next.sessions.has(original.id), false);

  const { deps, closed } = effectDeps();
  runWorkspaceEffect(
    {
      type: "urlNavRequested",
      key: "nav-new-1",
      project: null,
      newSession: true,
      paneId: "p-init",
      tab: fresh,
    },
    withTerminal,
    next,
    deps,
  );
  assert.deepEqual(closed, [`pane-session:${original.id}`]);
});

test("writePaneState/restorePersistedPaneState round-trips a single-leaf terminal workspace", () => {
  const session = chatSession({
    cwd: "/repo/work",
    piSessionId: "pi-round",
    title: "Round trip",
  });
  const state = openTerminalPane(stateWithChatPane(session), { sourcePaneId: "p-init" });
  const { storage, map } = fakeStorage();

  writePaneState(storage, state);
  const raw = map.get(PANE_STATE_KEY) ?? assert.fail("pane state was not persisted");

  const persisted = JSON.parse(raw) as { panes: Record<string, unknown> };
  assert.deepEqual(persisted.panes["p-init"], state.panesById.get("p-init"));

  const restored = restorePersistedPaneState(raw) ?? assert.fail("restore returned null");
  assert.deepEqual(collectLeaves(restored.layout), ["p-init"]);
  assert.equal(restored.focusedPaneId, "p-init");
  assert.deepEqual(restored.panesById.get("p-init"), state.panesById.get("p-init"));
});

test("legacy chat-only persisted payloads still restore as chat panes", () => {
  const raw = JSON.stringify({
    version: 1,
    layout: { kind: "leaf", paneId: "p-legacy" },
    focusedPaneId: "p-legacy",
    panes: {
      "p-legacy": {
        activeTabId: "tab-old",
        tabs: [
          {
            id: "tab-old",
            piSessionId: "pi-old",
            title: "Old chat",
            status: "idle",
            cwd: "/old-project",
          },
        ],
      },
    },
  });

  const restored = restorePersistedPaneState(raw) ?? assert.fail("restore returned null");

  assert.equal(asChat(restored.panesById.get("p-legacy")).sessionId, "tab-old");
  const session =
    restored.sessions.get("tab-old") ?? assert.fail("legacy session was not restored");
  assert.equal(session.piSessionId, "pi-old");
  assert.equal(session.cwd, "/old-project");
  assert.equal(session.title, "Old chat");
});

test("url ?new=1 replaces a focused terminal pane even when a sibling chat pane exists", () => {
  const a = chatSession({ piSessionId: "pi-a" });
  const b = chatSession({ piSessionId: "pi-b" });
  const withTerminal = openTerminalPane(twoChatPaneState(a, b), { sourcePaneId: "p-a" });
  assert.equal(withTerminal.focusedPaneId, "p-a");
  const fresh = chatSession();

  const next = applyUrlNavigation(withTerminal, {
    key: "nav-term-new",
    project: null,
    newSession: true,
    tab: fresh,
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-a", "p-b"]);
  assert.equal(asChat(next.panesById.get("p-a")).sessionId, fresh.id);
  assert.equal(asChat(next.panesById.get("p-b")).sessionId, b.id);
  assert.equal(next.focusedPaneId, "p-a");
  assert.ok(next.sessions.has(fresh.id));
  assert.ok(next.sessions.has(b.id));
  assert.equal(next.sessions.has(a.id), false);
});

test("url session replay lands in the focused terminal pane instead of the sibling chat pane", () => {
  const a = chatSession({ piSessionId: "pi-a" });
  const b = chatSession({ piSessionId: "pi-b" });
  const withTerminal = openTerminalPane(twoChatPaneState(a, b), { sourcePaneId: "p-a" });
  const replayTab = chatSession();

  const next = applyUrlNavigation(withTerminal, {
    key: "nav-term-replay",
    project: null,
    sessionId: "pi-replay",
    tab: replayTab,
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-a", "p-b"]);
  assert.equal(asChat(next.panesById.get("p-a")).sessionId, replayTab.id);
  assert.equal(next.sessions.get(replayTab.id)?.piSessionId, "pi-replay");
  assert.equal(asChat(next.panesById.get("p-b")).sessionId, b.id);
  assert.equal(next.sessions.get(b.id)?.piSessionId, "pi-b");
  assert.equal(next.focusedPaneId, "p-a");
  assert.equal(next.sessions.has(a.id), false);
});

test("url replay of a session already open in the sibling pane focuses it and keeps the terminal", () => {
  const a = chatSession({ piSessionId: "pi-a" });
  const b = chatSession({ piSessionId: "pi-b" });
  const withTerminal = openTerminalPane(twoChatPaneState(a, b), { sourcePaneId: "p-a" });

  const next = applyUrlNavigation(withTerminal, {
    key: "nav-term-sibling",
    project: null,
    sessionId: "pi-b",
    tab: chatSession(),
  });

  assert.equal(next.focusedPaneId, "p-b");
  assert.deepEqual(collectLeaves(next.layout), ["p-a", "p-b"]);
  const terminal = asTerminal(next.panesById.get("p-a"));
  assert.equal(terminal.mountKey, `pane-session:${a.id}`);
  assert.equal(terminal.ownerSessionId, a.id);
  assert.equal(asChat(next.panesById.get("p-b")).sessionId, b.id);
  assert.ok(next.sessions.has(a.id));
  assert.ok(next.sessions.has(b.id));
});
