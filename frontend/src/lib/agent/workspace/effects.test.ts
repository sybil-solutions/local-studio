import { describe, expect, it, vi } from "vitest";
import type { SessionTab } from "@/lib/agent/session/types";
import type { ProjectEntry, WorkspaceAction, WorkspaceState } from "./types";
import {
  PANE_LAYOUT_KEY,
  PANE_STATE_KEY,
  createInitialState,
  reducer,
  type WorkspaceStorage,
} from "./store";
import { runWorkspaceEffect } from "./effects";
import { ACTIVE_AGENT_SESSIONS_EVENT, SESSIONS_CHANGED_EVENT } from "./events";

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

function memoryStorage(initial: Record<string, string> = {}): WorkspaceStorage & {
  value: (key: string) => string | undefined;
} {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    value: (key: string) => values.get(key),
  };
}

function makeDeps(storage = memoryStorage()) {
  const events: Event[] = [];
  const queueReplay = vi.fn();
  const deps: Parameters<typeof runWorkspaceEffect>[3] = {
    storage,
    window: {
      Event,
      CustomEvent,
      dispatchEvent: vi.fn((event: Event) => {
        events.push(event);
        return true;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    api: {},
    queueReplay,
  };
  return { deps, events, queueReplay, storage };
}

function hydratedProjectState(state: WorkspaceState, _selected: ProjectEntry): WorkspaceState {
  return {
    ...state,
    selectedModel: "model-1",
    hydrated: true,
  };
}

describe("runWorkspaceEffect", () => {
  it("writes pane state when opening a new session but skips sessions refresh until a real session exists", () => {
    const storage = memoryStorage();
    const { deps, events } = makeDeps(storage);
    const state = createInitialState();
    const selected = project();
    const action: WorkspaceAction = { type: "openNewSession", project: selected, tab: tab() };
    const next = reducer(state, action);

    runWorkspaceEffect(action, state, next, deps);

    expect(storage.value(PANE_STATE_KEY)).toBeTruthy();
    expect(JSON.parse(storage.value(PANE_STATE_KEY) ?? "{}")).toMatchObject({
      version: 1,
      focusedPaneId: next.focusedPaneId,
    });
    expect(storage.value(PANE_LAYOUT_KEY)).toBe(JSON.stringify(next.layout));
    expect(events.map((event) => event.type)).not.toContain(SESSIONS_CHANGED_EVENT);
  });

  it("dispatches a sessions refresh when a tab gains a pi session id", () => {
    const { deps, events } = makeDeps();
    const selected = project();
    const state = hydratedProjectState(createInitialState(), selected);
    const replayAction: WorkspaceAction = {
      type: "replaySession",
      piSessionId: "pi-1",
      tab: tab({
        id: "tab-pi-1",
        runtimeSessionId: "rt-tab-pi-1",
        piSessionId: "pi-1",
        startedAt: "2026-05-11T00:00:00.000Z",
      }),
    };
    const next = reducer(state, replayAction);

    runWorkspaceEffect(replayAction, state, next, deps);

    expect(events.map((event) => event.type)).toContain(SESSIONS_CHANGED_EVENT);
  });

  it("queues a replay when replaying a session", () => {
    const { deps, queueReplay } = makeDeps();
    const state = createInitialState();
    const action: WorkspaceAction = { type: "replaySession", piSessionId: "pi-1", tab: tab() };
    const next = reducer(state, action);

    runWorkspaceEffect(action, state, next, deps);

    expect(queueReplay).toHaveBeenCalledTimes(1);
    expect(queueReplay).toHaveBeenCalledWith("p-init", "pi-1");
  });

  it("broadcasts active sessions only when the computed payload changes", () => {
    const { deps, events } = makeDeps();
    const selected = project();
    const state = hydratedProjectState(createInitialState(), selected);
    const replayAction: WorkspaceAction = {
      type: "replaySession",
      piSessionId: "pi-1",
      tab: tab({
        id: "tab-pi-1",
        runtimeSessionId: "rt-tab-pi-1",
        piSessionId: "pi-1",
        projectId: selected.id,
        cwd: selected.path,
        startedAt: "2026-05-11T00:00:00.000Z",
      }),
    };
    const withSession = reducer(state, replayAction);

    runWorkspaceEffect(replayAction, state, withSession, deps);

    // notifySessionsChanged is a no-op for the broadcast path — we use it as
    // an "unrelated" action that doesn't mutate the sessions broadcast key.
    const unrelatedAction: WorkspaceAction = { type: "notifySessionsChanged" };
    const unchangedBroadcast = reducer(withSession, unrelatedAction);
    runWorkspaceEffect(unrelatedAction, withSession, unchangedBroadcast, deps);

    const activeSessionEvents = events.filter(
      (event) => event.type === ACTIVE_AGENT_SESSIONS_EVENT,
    );
    expect(activeSessionEvents).toHaveLength(1);
    expect((activeSessionEvents[0] as CustomEvent).detail.sessions).toMatchObject([
      {
        projectId: selected.id,
        cwd: selected.path,
        paneId: "p-init",
        piSessionId: "pi-1",
        modelId: "model-1",
        active: true,
      },
    ]);
  });
});
