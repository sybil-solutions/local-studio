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
import { isTerminalOwnerVisible } from "../src/features/agent/terminal-owners";
import {
  applyUrlNavigation,
  canRestoreTerminalOwner,
  closePane,
  focusPane,
  openTerminalPane,
} from "../src/features/agent/workspace/pane-controller";
import { reducer } from "../src/features/agent/workspace/reducer";
import {
  ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY,
  PANE_STATE_KEY,
  createInitialState,
  loadPersistedActiveAgentSessions,
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

function effectDeps(): {
  deps: WorkspaceEffectDeps;
  closed: string[];
  remembered: Array<{ mountKey: string; matchKeys: string[] }>;
} {
  const closed: string[] = [];
  const remembered: Array<{ mountKey: string; matchKeys: string[] }> = [];
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
    rememberTerminalOwner: (owner) => {
      remembered.push({ mountKey: owner.mountKey, matchKeys: owner.matchKeys });
    },
  };
  return { deps, closed, remembered };
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

test("closing a terminal leaf in a split triggers closeTerminalOwner exactly once with its mountKey", () => {
  const a = chatSession({ piSessionId: "pi-a" });
  const b = chatSession({ piSessionId: "pi-b" });
  const prev = openTerminalPane(twoChatPaneState(a, b), { sourcePaneId: "p-a" });
  const next = closePane(prev, { paneId: "p-a" });
  const { deps, closed } = effectDeps();

  runWorkspaceEffect({ type: "closePane", paneId: "p-a" }, prev, next, deps);

  assert.deepEqual(collectLeaves(next.layout), ["p-b"]);
  assert.deepEqual(closed, [`pane-session:${a.id}`]);
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

test("url ?new=1 splits a fresh chat beside a focused single-leaf terminal", () => {
  const original = chatSession({ cwd: "/repo/orig", piSessionId: "pi-original" });
  const withTerminal = openTerminalPane(stateWithChatPane(original), { sourcePaneId: "p-init" });
  assert.equal(withTerminal.focusedPaneId, "p-init");
  const fresh = chatSession();

  const next = applyUrlNavigation(withTerminal, {
    key: "nav-new-1",
    project: null,
    newSession: true,
    tab: fresh,
    paneId: "p-new",
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-init", "p-new"]);
  asTerminal(next.panesById.get("p-init"));
  assert.equal(asChat(next.panesById.get("p-new")).sessionId, fresh.id);
  assert.equal(next.focusedPaneId, "p-new");
  assert.ok(next.sessions.has(fresh.id));

  const { deps, closed } = effectDeps();
  runWorkspaceEffect(
    {
      type: "urlNavRequested",
      key: "nav-new-1",
      project: null,
      newSession: true,
      paneId: "p-new",
      tab: fresh,
    },
    withTerminal,
    next,
    deps,
  );
  assert.deepEqual(closed, []);
});

test("url session replay splits beside a focused terminal instead of clobbering it", () => {
  const original = chatSession({ cwd: "/repo/orig", piSessionId: "pi-original" });
  const withTerminal = openTerminalPane(stateWithChatPane(original), { sourcePaneId: "p-init" });
  const replayTab = chatSession();

  const next = applyUrlNavigation(withTerminal, {
    key: "nav-replay-keep",
    project: null,
    sessionId: "pi-replay",
    paneId: "p-replay",
    tab: replayTab,
  });

  // The terminal pane survives untouched; the chat opens in the split pane.
  assert.equal(next.panesById.get("p-init")?.kind, "terminal");
  assert.equal(asChat(next.panesById.get("p-replay")).sessionId, replayTab.id);
  assert.equal(next.sessions.get(replayTab.id)?.piSessionId, "pi-replay");
  assert.equal(next.focusedPaneId, "p-replay");

  const { deps, closed } = effectDeps();
  runWorkspaceEffect(
    {
      type: "urlNavRequested",
      key: "nav-replay-keep",
      project: null,
      sessionId: "pi-replay",
      paneId: "p-replay",
      tab: replayTab,
    },
    withTerminal,
    next,
    deps,
  );
  assert.deepEqual(closed, []);
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

test("url ?new keeps a focused terminal pane and opens the chat in the sibling pane", () => {
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
  asTerminal(next.panesById.get("p-a"));
  assert.equal(asChat(next.panesById.get("p-b")).sessionId, fresh.id);
  assert.equal(next.focusedPaneId, "p-b");
  assert.ok(next.sessions.has(fresh.id));
  assert.equal(next.sessions.has(b.id), false);
});

test("url session replay keeps a focused terminal pane and lands in the sibling chat pane", () => {
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
  asTerminal(next.panesById.get("p-a"));
  assert.equal(asChat(next.panesById.get("p-b")).sessionId, replayTab.id);
  assert.equal(next.sessions.get(replayTab.id)?.piSessionId, "pi-replay");
  assert.equal(next.focusedPaneId, "p-b");
  assert.equal(next.sessions.has(b.id), false);
});

test("chat row replay replaces a terminal split with just the selected chat", () => {
  const a = chatSession({ piSessionId: "pi-a" });
  const b = chatSession({ piSessionId: "pi-b" });
  const withTerminal = openTerminalPane(twoChatPaneState(a, b), { sourcePaneId: "p-a" });
  const replayTab = chatSession();

  const next = applyUrlNavigation(withTerminal, {
    key: "nav-term-replay-replace",
    project: null,
    sessionId: "pi-replay",
    tab: replayTab,
    replaceWorkspace: true,
    paneId: "p-replay",
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-replay"]);
  assert.equal(asChat(next.panesById.get("p-replay")).sessionId, replayTab.id);
  assert.equal(next.sessions.get(replayTab.id)?.piSessionId, "pi-replay");
  assert.equal(next.focusedPaneId, "p-replay");
});

test("past session replay keeps replace navigation single-pane even with a restored terminal", () => {
  const a = chatSession({ piSessionId: "pi-a" });
  const b = chatSession({ piSessionId: "pi-b" });
  const withTerminal = openTerminalPane(twoChatPaneState(a, b), { sourcePaneId: "p-a" });
  const action = {
    type: "urlNavRequested",
    key: "proj-1|pi-replay|||||1",
    project: null,
    sessionId: "pi-replay",
    tab: chatSession(),
    replaceWorkspace: true,
    paneId: "p-replay",
  } as const;

  const next = reducer(withTerminal, action);

  assert.deepEqual(collectLeaves(next.layout), ["p-replay"]);
  assert.equal(asChat(next.panesById.get("p-replay")).sessionId, action.tab.id);
  assert.equal(next.panesById.size, 1);
});

test("chat row replay remembers detached terminal panes without closing their owners", () => {
  const a = chatSession({ piSessionId: "pi-a", projectId: "project-a" });
  const b = chatSession({ piSessionId: "pi-b" });
  const withTerminal = openTerminalPane(twoChatPaneState(a, b), { sourcePaneId: "p-a" });
  const replayTab = chatSession();
  const action = {
    type: "urlNavRequested",
    key: "nav-term-replay-remember",
    project: null,
    sessionId: "pi-replay",
    tab: replayTab,
    replaceWorkspace: true,
    paneId: "p-replay",
  } as const;
  const next = reducer(withTerminal, action);
  const { deps, closed, remembered } = effectDeps();

  runWorkspaceEffect(action, withTerminal, next, deps);

  assert.deepEqual(closed, []);
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0]?.mountKey, `pane-session:${a.id}`);
  assert.ok(remembered[0]?.matchKeys.includes(`pane-session:${a.id}`));
  assert.ok(remembered[0]?.matchKeys.includes(`session:${a.id}`));
  assert.ok(remembered[0]?.matchKeys.includes("pi:pi-a"));
  assert.ok(remembered[0]?.matchKeys.includes("project:project-a"));
});

test("chat row replay replaces a terminal-only workspace with just the selected chat", () => {
  const withTerminal = openTerminalPane(stateWithChatPane(chatSession()), {
    sourcePaneId: "p-init",
  });
  const replayTab = chatSession();

  const next = applyUrlNavigation(withTerminal, {
    key: "nav-terminal-only-replace",
    project: null,
    sessionId: "pi-replay",
    tab: replayTab,
    replaceWorkspace: true,
    paneId: "p-replay",
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-replay"]);
  assert.equal(asChat(next.panesById.get("p-replay")).sessionId, replayTab.id);
  assert.equal(next.sessions.get(replayTab.id)?.piSessionId, "pi-replay");
  assert.equal(next.focusedPaneId, "p-replay");
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

test("terminal panes register terminal owners without broadcasting project session rows", () => {
  const chat = chatSession({ cwd: "/repo/proj", piSessionId: "pi-live", projectId: "proj-1" });
  const base: WorkspaceState = { ...stateWithChatPane(chat), hydrated: true };
  const action = {
    type: "openProjectTerminal",
    cwd: "/repo/proj",
    newPaneId: "p-term",
    projectId: "proj-1",
  } as const;
  const next = reducer(base, action);

  const broadcasts: unknown[] = [];
  const { deps, remembered } = effectDeps();
  runWorkspaceEffect(action, base, next, {
    ...deps,
    window: {
      ...deps.window,
      dispatchEvent: (event: Event) => {
        if ("detail" in event) broadcasts.push((event as CustomEvent).detail);
        return true;
      },
    },
  });

  const sessions = (
    broadcasts.find(
      (detail): detail is { sessions: Array<Record<string, unknown>> } =>
        typeof detail === "object" && detail !== null && "sessions" in detail,
    ) ?? assert.fail("no active-sessions broadcast fired")
  ).sessions;
  assert.equal(
    sessions.some((row) => row.kind === "terminal"),
    false,
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.piSessionId, "pi-live");
  assert.deepEqual(
    remembered.map((owner) => owner.mountKey),
    ["pane:p-term"],
  );
  assert.ok(remembered[0]?.matchKeys.includes("pane:p-term"));
  assert.ok(remembered[0]?.matchKeys.includes("project:proj-1"));
});

test("project terminal tab shows persisted terminals after switching to a different chat", () => {
  assert.equal(
    isTerminalOwnerVisible(
      {
        mountKey: "pane-session:a",
        matchKeys: ["pane-session:a", "session:a", "pi:pi-a", "project:proj-1"],
        cwd: "/repo/proj",
        title: "Terminal",
        kind: "session",
        sessionId: "a",
        piSessionId: "pi-a",
        projectId: "proj-1",
      },
      { id: "b", piSessionId: "pi-b", projectId: "proj-1" },
      "proj-1",
    ),
    true,
  );
  assert.equal(
    isTerminalOwnerVisible(
      {
        mountKey: "pane-session:a",
        matchKeys: ["pane-session:a", "session:a", "pi:pi-a", "project:proj-1"],
        cwd: "/repo/proj",
        title: "Terminal",
        kind: "session",
        sessionId: "a",
        piSessionId: "pi-a",
        projectId: "proj-1",
      },
      { id: "b", piSessionId: "pi-b", projectId: "proj-2" },
      "proj-2",
    ),
    false,
  );
});

test("legacy terminal active-session snapshots are ignored when loading project rows", () => {
  const { storage } = fakeStorage();
  storage.setItem(
    ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY,
    JSON.stringify([
      {
        kind: "terminal",
        mountKey: "pane:p-old",
        projectId: "proj-1",
        cwd: "/repo/proj",
        paneId: "p-old",
        tabId: "pane:p-old",
        piSessionId: null,
        title: "Terminal",
        status: "idle",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
      {
        projectId: "proj-1",
        cwd: "/repo/proj",
        paneId: "p-chat",
        tabId: "tab-chat",
        piSessionId: "pi-chat",
        title: "Chat",
        status: "idle",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
    ]),
  );

  const sessions = loadPersistedActiveAgentSessions(storage);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.piSessionId, "pi-chat");
});
