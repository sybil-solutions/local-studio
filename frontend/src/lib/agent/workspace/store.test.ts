import { describe, expect, it } from "vitest";
import { collectLeaves } from "@/lib/agent/workspace/layout";
import type { SessionTab } from "@/lib/agent/session/types";
import { makeFreshTab } from "@/lib/agent/session/helpers";
import type { ProjectEntry, WorkspaceState } from "./types";
import {
  createInitialState,
  normalizePersistedTab,
  reducer,
  setupWarningFromPiCheck,
} from "./store";

function project(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    id: "proj-1",
    name: "Project",
    path: "/tmp/project",
    addedAt: "2026-05-11T00:00:00.000Z",
    exists: true,
    hasGit: true,
    branch: "main",
    ...overrides,
  };
}

function tab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    id: "tab-1",
    runtimeSessionId: "rt-tab-1",
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
    ...overrides,
  };
}

function pane(state: WorkspaceState, paneId = state.focusedPaneId) {
  const value = state.panesById.get(paneId);
  if (!value) throw new Error(`missing pane ${paneId}`);
  return value;
}

describe("normalizePersistedTab", () => {
  it("preserves selected plugin and skill tabs across pane-state restore", () => {
    const restored = normalizePersistedTab({
      id: "tab-1",
      runtimeSessionId: "rt-1",
      piSessionId: "pi-1",
      title: "With context",
      messages: [],
      status: "idle",
      input: "",
      plugins: [{ id: "browser", name: "browser-use", enabled: true }],
      skills: [{ id: "agent-browser", name: "agent-browser", path: "/skills/agent-browser" }],
    });

    expect(restored).toMatchObject({
      id: "tab-1",
      runtimeSessionId: "rt-1",
      plugins: [{ id: "browser", name: "browser-use", enabled: true }],
      skills: [{ id: "agent-browser", name: "agent-browser", path: "/skills/agent-browser" }],
    });
  });
});

describe("setupWarningFromPiCheck", () => {
  it("does not show a missing-pi warning once usable models are loaded", () => {
    expect(
      setupWarningFromPiCheck(
        { ok: false, guidance: "Install @mariozechner/pi-coding-agent" },
        true,
      ),
    ).toBe("");
  });

  it("shows guidance when Pi is missing and no models are usable", () => {
    expect(setupWarningFromPiCheck({ ok: false, guidance: "Install Pi" }, false)).toBe(
      "Install Pi",
    );
  });
});

function paneSessionList(state: WorkspaceState, paneId = state.focusedPaneId) {
  const p = pane(state, paneId);
  return p.sessionIds.map((id) => state.sessions.get(id)!);
}

describe("workspace reducer", () => {
  it("opens a new session by reusing the empty starter pane", () => {
    const state = createInitialState();
    const starterTabId = pane(state).activeSessionId;
    const selected = project();

    const next = reducer(state, { type: "openNewSession", project: selected, tab: makeFreshTab() });
    const nextPane = pane(next, "p-init");

    expect(nextPane.sessionIds).toHaveLength(1);
    expect(nextPane.activeSessionId).toBe(starterTabId);
    expect(paneSessionList(next, "p-init")[0]).toMatchObject({
      projectId: selected.id,
      cwd: selected.path,
    });
  });

  it("replays a session into the focused empty starter pane", () => {
    const state = createInitialState();

    const next = reducer(state, {
      type: "replaySession",
      piSessionId: "pi-1",
      tab: makeFreshTab(),
    });
    const nextPane = pane(next, "p-init");
    const sessions = paneSessionList(next, "p-init");

    expect(nextPane.sessionIds).toHaveLength(1);
    expect(nextPane.activeSessionId).toBe(sessions[0].id);
    expect(sessions[0].piSessionId).toBe("pi-1");
    expect(next.focusedPaneId).toBe("p-init");
  });

  it("uses a provided session title while replay loads", () => {
    const state = createInitialState();

    const next = reducer(state, {
      type: "replaySession",
      piSessionId: "pi-1",
      sessionTitle: "Saved session",
      tab: makeFreshTab(),
    });

    expect(paneSessionList(next, "p-init")[0]).toMatchObject({
      piSessionId: "pi-1",
      title: "Saved session",
    });
  });

  it("replays a session into a split pane", () => {
    const state = createInitialState();

    const next = reducer(state, {
      type: "replaySessionInSplit",
      piSessionId: "pi-2",
      paneId: "p-sibling",
      runtimeSessionId: "rt-sibling",
      tab: tab({ id: "tab-sibling", runtimeSessionId: "rt-tab-sibling" }),
    });

    expect(collectLeaves(next.layout)).toEqual(["p-init", "p-sibling"]);
    expect(next.focusedPaneId).toBe("p-sibling");
    expect(pane(next, "p-sibling")).toMatchObject({
      activeSessionId: "tab-sibling",
      runtimeSessionId: "rt-sibling",
    });
    expect(paneSessionList(next, "p-sibling")[0]).toMatchObject({
      id: "tab-sibling",
      piSessionId: "pi-2",
      title: "Loading session",
    });
  });

  it("renames a tab", () => {
    const state = createInitialState();
    const tabId = pane(state).activeSessionId;

    const next = reducer(state, {
      type: "renameTab",
      paneId: "p-init",
      tabId,
      title: "Renamed session",
    });

    expect(paneSessionList(next, "p-init")[0].title).toBe("Renamed session");
  });

  it("focuses a tab and its pane", () => {
    const split = reducer(createInitialState(), {
      type: "replaySessionInSplit",
      piSessionId: "pi-2",
      paneId: "p-sibling",
      runtimeSessionId: "rt-sibling",
      tab: tab({ id: "tab-sibling", runtimeSessionId: "rt-tab-sibling" }),
    });
    const starterTabId = pane(split, "p-init").activeSessionId;

    const next = reducer(split, {
      type: "focusTab",
      paneId: "p-init",
      tabId: starterTabId,
    });

    expect(next.focusedPaneId).toBe("p-init");
    expect(pane(next, "p-init").activeSessionId).toBe(starterTabId);
  });

  it("opens a brand-new tab when + is clicked while on an existing session", () => {
    // Simulates the user's flow: replay an existing pi session into the focused
    // pane (so the starter tab becomes the OLD session with messages), then
    // click + and assert a fresh empty tab is active — not the old session.
    let state = createInitialState();
    state = reducer(state, {
      type: "replaySession",
      piSessionId: "pi-OLD",
      sessionTitle: "Old session",
      tab: makeFreshTab(),
    });
    // Promote the replayed tab so it's no longer an empty starter.
    const oldTabId = pane(state, "p-init").activeSessionId;
    state = reducer(state, {
      type: "setPaneTabs",
      paneId: "p-init",
      tabs: paneSessionList(state, "p-init").map((session) =>
        session.id === oldTabId
          ? {
              ...session,
              messages: [{ id: "m-1", role: "user", text: "hello", timestamp: "now" }],
            }
          : session,
      ),
    });

    const selected = project();
    const next = reducer(state, { type: "openNewSession", project: selected, tab: makeFreshTab() });

    const nextPane = pane(next, "p-init");
    const sessions = paneSessionList(next, "p-init");
    expect(sessions).toHaveLength(2);
    expect(nextPane.activeSessionId).not.toBe(oldTabId);
    const activeTab = sessions.find((s) => s.id === nextPane.activeSessionId);
    expect(activeTab?.piSessionId).toBeNull();
    expect(activeTab?.messages).toHaveLength(0);
    expect(activeTab?.projectId).toBe(selected.id);
  });

  it("reuses a stale empty starter rather than stacking up empty tabs", () => {
    // If the user clicks + twice in a row (or there's already a fresh empty
    // tab), the second + should reuse the existing empty rather than spawning
    // another. Same project requirement applies.
    const selected = project();
    let state = createInitialState();
    state = reducer(state, { type: "openNewSession", project: selected, tab: makeFreshTab() });
    const firstNewTabId = pane(state, "p-init").activeSessionId;

    const next = reducer(state, { type: "openNewSession", project: selected, tab: makeFreshTab() });

    expect(pane(next, "p-init").sessionIds).toHaveLength(1);
    expect(pane(next, "p-init").activeSessionId).toBe(firstNewTabId);
  });

  it("does not reuse an empty starter from a different project", () => {
    // If the empty starter is stamped with project A but + is clicked from
    // project B, we must spawn a fresh tab — not silently switch the existing
    // tab's project.
    const projectA = project({ id: "proj-a", path: "/tmp/a" });
    const projectB = project({ id: "proj-b", path: "/tmp/b" });
    let state = createInitialState();
    state = reducer(state, { type: "openNewSession", project: projectA, tab: makeFreshTab() });
    const tabA = pane(state, "p-init").activeSessionId;

    const next = reducer(state, { type: "openNewSession", project: projectB, tab: makeFreshTab() });

    const sessions = paneSessionList(next, "p-init");
    expect(sessions).toHaveLength(2);
    expect(pane(next, "p-init").activeSessionId).not.toBe(tabA);
    const activeTab = sessions.find((s) => s.id === pane(next, "p-init").activeSessionId);
    expect(activeTab?.projectId).toBe(projectB.id);
  });

  it("auto-splits to a new pane when + is clicked while the focused session is running", () => {
    // The user explicitly asked: if a session is currently streaming, "new
    // chat" must NOT clobber it — open the new chat in a split pane instead.
    let state = createInitialState();
    const starterTabId = pane(state, "p-init").activeSessionId;
    // Promote the starter into a running session.
    state = reducer(state, {
      type: "setPaneTabs",
      paneId: "p-init",
      tabs: [
        {
          ...paneSessionList(state, "p-init")[0],
          status: "running",
          messages: [{ id: "m-1", role: "user", text: "hi", timestamp: "now" }],
        },
      ],
    });

    const next = reducer(state, {
      type: "openNewSession",
      tab: makeFreshTab(),
      paneId: "p-split",
      runtimeSessionId: "rt-split",
    });

    expect(collectLeaves(next.layout)).toEqual(["p-init", "p-split"]);
    expect(next.focusedPaneId).toBe("p-split");
    // Original running session is untouched.
    expect(pane(next, "p-init").activeSessionId).toBe(starterTabId);
    expect(next.sessions.get(starterTabId)?.status).toBe("running");
    // New blank session lives in the new pane.
    const splitPane = pane(next, "p-split");
    expect(splitPane.sessionIds).toHaveLength(1);
    expect(next.sessions.get(splitPane.activeSessionId)?.messages).toHaveLength(0);
  });

  it("drops the new chat into the existing sibling pane when one is already running", () => {
    // If we already have two panes and the focused one is busy, the new chat
    // should land in the other leaf (not stack a third pane).
    let state = reducer(createInitialState(), {
      type: "replaySessionInSplit",
      piSessionId: "pi-2",
      paneId: "p-sibling",
      runtimeSessionId: "rt-sibling",
      tab: tab({ id: "tab-sibling", runtimeSessionId: "rt-tab-sibling" }),
    });
    // Mark the focused (newly split) pane as running.
    state = reducer(state, {
      type: "setPaneTabs",
      paneId: "p-sibling",
      tabs: [
        {
          ...paneSessionList(state, "p-sibling")[0],
          status: "running",
          messages: [{ id: "m-1", role: "user", text: "still going", timestamp: "now" }],
        },
      ],
    });

    const next = reducer(state, {
      type: "openNewSession",
      tab: makeFreshTab(),
      paneId: "p-third",
      runtimeSessionId: "rt-third",
    });

    expect(collectLeaves(next.layout)).toEqual(["p-init", "p-sibling"]);
    // The new fresh tab lands in the *other* leaf (p-init).
    const initSessions = paneSessionList(next, "p-init");
    expect(initSessions.length).toBeGreaterThan(1);
    const newest = initSessions.find((s) => s.id === pane(next, "p-init").activeSessionId);
    expect(newest?.messages).toHaveLength(0);
  });

  it("focuses the sibling when closing the focused pane", () => {
    const split = reducer(createInitialState(), {
      type: "replaySessionInSplit",
      piSessionId: "pi-2",
      paneId: "p-sibling",
      runtimeSessionId: "rt-sibling",
      tab: tab({ id: "tab-sibling", runtimeSessionId: "rt-tab-sibling" }),
    });

    const next = reducer(split, { type: "closePane", paneId: "p-sibling" });

    expect(collectLeaves(next.layout)).toEqual(["p-init"]);
    expect(next.panesById.has("p-sibling")).toBe(false);
    expect(next.focusedPaneId).toBe("p-init");
    // Closing the sibling pane prunes its sessions from the flat map too.
    expect(next.sessions.has("tab-sibling")).toBe(false);
  });
});
