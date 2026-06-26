// Characterization tests for the workspace/pane layer ahead of its ownership
// consolidation. These pin CURRENT behavior of persistence round-trips, the
// legacy layout fallback, the active-sessions broadcast, the hydration
// one-shot guard, the sessions-refresh double fire, and URL-nav dedup — so the
// refactor can verify against a fixed contract instead of live users.
import assert from "node:assert/strict";
import test from "node:test";

import { runWorkspaceEffect, type WorkspaceEffectDeps } from "@/features/agent/workspace/effects";
import { ACTIVE_AGENT_SESSIONS_EVENT, SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";
import { loadInitialFromStorage, writePaneState } from "@/features/agent/workspace/persistence";
import { reducer } from "@/features/agent/workspace/reducer";
import {
  PANE_LAYOUT_KEY,
  PANE_STATE_KEY,
  restorePersistedPaneState,
  type WorkspaceStorage,
} from "@/features/agent/workspace/store";
import type { WorkspaceState } from "@/features/agent/workspace/types";
import { makeFreshTab } from "@/features/agent/messages/helpers";
import { createSessionReplayQueue } from "@/features/agent/workspace/replay-queue";
import { readTranscriptSnapshot } from "@/features/agent/workspace/transcript-cache";
import type { Session } from "@/features/agent/runtime/types";
import type { ToolSelection } from "@/features/agent/tools/types";

function makeSession(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    runtimeSessionId: `rt-${id}`,
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
    ...patch,
  };
}

function makeState(session = makeSession("s-main")): WorkspaceState {
  return {
    sessions: new Map([[session.id, session]]),
    models: [],
    selectedModel: "",
    modelsLoading: false,
    layout: { kind: "leaf", paneId: "p-main" },
    panesById: new Map([["p-main", { sessionId: session.id }]]),
    focusedPaneId: "p-main",
    setupWarning: "",
    error: "",
    hydrated: true,
    lastHandledNavKey: "",
  };
}

function makeStorage(): WorkspaceStorage & { writes: string[]; map: Map<string, string> } {
  const map = new Map<string, string>();
  const writes: string[] = [];
  return {
    map,
    writes,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      map.set(key, value);
    },
    removeItem: (key) => void map.delete(key),
  };
}

type TimerRecord = { handler: () => void; delay: number };

function makeWindowHarness() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const fired: { type: string; detail?: unknown }[] = [];
  const timers: TimerRecord[] = [];
  class HarnessCustomEvent<T> extends Event {
    detail: T;
    constructor(type: string, init: { detail: T }) {
      super(type);
      this.detail = init.detail;
    }
  }
  const window = {
    Event,
    CustomEvent: HarnessCustomEvent as typeof CustomEvent,
    dispatchEvent: (event: Event) => {
      fired.push({ type: event.type, detail: "detail" in event ? event.detail : undefined });
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
    addEventListener: ((type: string, listener: EventListenerOrEventListenerObject) => {
      const set = listeners.get(type) ?? new Set<(event: Event) => void>();
      set.add(
        typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event),
      );
      listeners.set(type, set);
    }) as Window["addEventListener"],
    removeEventListener: (() => undefined) as Window["removeEventListener"],
    setTimeout: (handler: () => void, timeout: number) => {
      timers.push({ handler, delay: timeout });
      return timers.length;
    },
  };
  return { window, fired, timers };
}

function makeEffectDeps(overrides: Partial<WorkspaceEffectDeps> = {}) {
  const storage = makeStorage();
  const harness = makeWindowHarness();
  const replays: { paneId: string; piSessionId: string }[] = [];
  const deps: WorkspaceEffectDeps = {
    storage,
    window: harness.window,
    api: {},
    queueReplay: (paneId, piSessionId) => replays.push({ paneId, piSessionId }),
    ...overrides,
  };
  return { deps, storage, harness, replays };
}

// ----- persistence round-trip (writePaneState -> loadInitialFromStorage) -----

test("pane state round-trips durable session metadata and drops transcripts", () => {
  const rich = makeSession("s-rich", {
    runtimeSessionId: "rt-rich",
    piSessionId: "pi-rich",
    title: "GPU planning",
    input: "draft text",
    lastEventSeq: 17,
    status: "running",
    startedAt: "2026-06-09T10:00:00.000Z",
    tokenStats: { read: 10, write: 5, current: 15 },
    queue: [{ id: "q-1", mode: "follow_up", text: "next", sent: true }],
    messages: [{ id: "m-1", role: "user", text: "hello" }],
  });
  const starter = makeSession("s-starter");
  const state: WorkspaceState = {
    ...makeState(rich),
    sessions: new Map([
      [rich.id, rich],
      [starter.id, starter],
    ]),
    layout: {
      kind: "split",
      direction: "vertical",
      ratio: 0.5,
      a: { kind: "leaf", paneId: "p-main" },
      b: { kind: "leaf", paneId: "p-side" },
    },
    panesById: new Map([
      ["p-main", { sessionId: rich.id }],
      ["p-side", { sessionId: starter.id }],
    ]),
    focusedPaneId: "p-side",
  };
  const storage = makeStorage();
  const selection: ToolSelection = {
    plugins: [{ id: "plug-1" } as ToolSelection["plugins"][number]],
    skills: [],
    promptTemplates: [],
  };

  writePaneState(storage, state, (sessionId) => (sessionId === rich.id ? selection : null));
  const loaded = loadInitialFromStorage(storage);

  assert.deepEqual(loaded.workspace.layout, state.layout);
  assert.equal(loaded.workspace.focusedPaneId, "p-side");
  const restoredRich = loaded.workspace.sessions?.get("s-rich");
  assert.equal(restoredRich?.piSessionId, "pi-rich");
  assert.equal(restoredRich?.runtimeSessionId, "rt-rich");
  assert.equal(restoredRich?.title, "GPU planning");
  assert.equal(restoredRich?.input, "draft text");
  assert.equal(restoredRich?.lastEventSeq, 17);
  assert.deepEqual(restoredRich?.queue, [{ id: "q-1", mode: "follow_up", text: "next", sent: true }]);
  // Transcripts live in canonical session storage, never pane-state.
  assert.deepEqual(restoredRich?.messages, []);
  assert.equal(loaded.workspace.panesById?.get("p-main")?.sessionId, "s-rich");
  assert.deepEqual(loaded.selections.get("s-rich"), selection);
});

test("restore uses the session's durable runtime id and ignores pane-level copies", () => {
  // The session-level runtimeSessionId is the only runtime identity: a
  // crash/reload reattaches to the still-running runtime instead of minting a
  // fresh orphan (the old pane-level fresh-mint bug). Legacy persisted
  // pane-level ids are ignored on read.
  const tab = { id: "s-1", runtimeSessionId: "rt-tab-1", title: "T" };
  const persisted = (paneRuntime: string | undefined) =>
    JSON.stringify({
      version: 1,
      layout: { kind: "leaf", paneId: "p-1" },
      focusedPaneId: "p-1",
      panes: {
        "p-1": { activeTabId: "s-1", tabs: [tab], ...(paneRuntime ? { runtimeSessionId: paneRuntime } : {}) },
      },
    });

  const restored = restorePersistedPaneState(persisted(undefined));
  assert.equal(restored?.sessions.get("s-1")?.runtimeSessionId, "rt-tab-1");

  const withLegacyPaneId = restorePersistedPaneState(persisted("rt-stale-pane"));
  assert.equal(withLegacyPaneId?.sessions.get("s-1")?.runtimeSessionId, "rt-tab-1");

  // A legacy tab missing its own runtime id gets a fresh mint, not a crash.
  const legacyTab = restorePersistedPaneState(
    JSON.stringify({
      version: 1,
      layout: { kind: "leaf", paneId: "p-1" },
      focusedPaneId: "p-1",
      panes: { "p-1": { activeTabId: "s-legacy", tabs: [{ id: "s-legacy", title: "Old" }] } },
    }),
  );
  assert.match(legacyTab?.sessions.get("s-legacy")?.runtimeSessionId ?? "", /^rt-/);
});

test("legacy PANE_LAYOUT_KEY fallback restores layout with fresh starters", () => {
  const storage = makeStorage();
  storage.setItem(
    PANE_LAYOUT_KEY,
    JSON.stringify({
      kind: "split",
      direction: "vertical",
      ratio: 0.5,
      a: { kind: "leaf", paneId: "p-a" },
      b: { kind: "leaf", paneId: "p-b" },
    }),
  );

  const loaded = loadInitialFromStorage(storage);
  assert.deepEqual(
    [...(loaded.workspace.panesById?.keys() ?? [])],
    ["p-a", "p-b"],
  );
  for (const pane of loaded.workspace.panesById?.values() ?? []) {
    const session = loaded.workspace.sessions?.get(pane.sessionId);
    assert.equal(session?.piSessionId, null);
    assert.equal(session?.messages.length, 0);
    assert.match(session?.runtimeSessionId ?? "", /^rt-/);
  }

  // Corrupt legacy data degrades to an empty workspace, not a crash.
  const broken = makeStorage();
  broken.setItem(PANE_LAYOUT_KEY, "{not json");
  assert.deepEqual(loadInitialFromStorage(broken).workspace, {});

  // PANE_STATE_KEY always wins over the legacy key.
  const both = makeStorage();
  both.setItem(PANE_LAYOUT_KEY, JSON.stringify({ kind: "leaf", paneId: "p-legacy" }));
  both.setItem(
    PANE_STATE_KEY,
    JSON.stringify({
      version: 1,
      layout: { kind: "leaf", paneId: "p-modern" },
      focusedPaneId: "p-modern",
      panes: { "p-modern": { activeTabId: "s-m", tabs: [{ id: "s-m", runtimeSessionId: "rt-m" }] } },
    }),
  );
  assert.equal(loadInitialFromStorage(both).workspace.focusedPaneId, "p-modern");
});

// ----- active sessions broadcast (effects.ts) -----

test("active-session broadcasts persist before the event and dedup by content", () => {
  const session = makeSession("s-live", { runtimeSessionId: "rt-live" });
  const prev = makeState(session);
  const withPi = { ...session, piSessionId: "pi-live", title: "Live chat" };
  const next: WorkspaceState = {
    ...prev,
    sessions: new Map([[withPi.id, withPi]]),
  };
  const { deps, storage, harness } = makeEffectDeps();
  const order: string[] = [];
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === "local-studio.agent.activeSessions.snapshot") order.push("persist");
    originalSet(key, value);
  };
  harness.window.addEventListener(ACTIVE_AGENT_SESSIONS_EVENT, () => order.push("event"));

  const action = {
    type: "patchSession",
    sessionId: "s-live",
    patch: { piSessionId: "pi-live" },
  } as const;
  runWorkspaceEffect(action, prev, next, deps);

  const broadcasts = harness.fired.filter((entry) => entry.type === ACTIVE_AGENT_SESSIONS_EVENT);
  assert.equal(broadcasts.length, 1);
  const detail = broadcasts[0]?.detail as { sessions: { tabId: string; focused: boolean }[] };
  assert.equal(detail.sessions.length, 1);
  assert.equal(detail.sessions[0]?.tabId, "s-live");
  assert.equal(detail.sessions[0]?.focused, true);
  assert.deepEqual(order, ["persist", "event"]);

  // Identical prev/next: content key unchanged -> no second broadcast.
  runWorkspaceEffect(action, next, next, deps);
  assert.equal(
    harness.fired.filter((entry) => entry.type === ACTIVE_AGENT_SESSIONS_EVENT).length,
    1,
  );
});

test("broadcasts surface running sessions that lost their pane as background entries", () => {
  const pane = makeSession("s-pane", {
    piSessionId: "pi-pane",
    runtimeSessionId: "rt-pane",
    title: "Pane chat",
    startedAt: "2026-06-19T10:00:00.000Z",
  });
  const background = makeSession("s-bg", {
    piSessionId: "pi-bg",
    runtimeSessionId: "rt-bg",
    status: "running",
    title: "Background chat",
    startedAt: "2026-06-19T09:00:00.000Z",
  });
  const prev = makeState(pane);
  // The background turn is alive in the store (pruneSessions kept it) but no
  // pane references it — the user navigated to s-pane.
  const next: WorkspaceState = {
    ...prev,
    sessions: new Map([
      [pane.id, pane],
      [background.id, background],
    ]),
  };
  const { deps, harness } = makeEffectDeps();

  runWorkspaceEffect(
    { type: "patchSession", sessionId: "s-bg", patch: { status: "running" } },
    prev,
    next,
    deps,
  );

  const detail = harness.fired.find((entry) => entry.type === ACTIVE_AGENT_SESSIONS_EVENT)
    ?.detail as {
    sessions: { tabId: string; paneId: string; focused: boolean; status: string }[];
  };
  const bg = detail.sessions.find((entry) => entry.tabId === "s-bg");
  assert.ok(bg, "background session should be broadcast");
  // Orphan entries carry no pane and are never focused, but keep their status.
  assert.equal(bg.paneId, "");
  assert.equal(bg.focused, false);
  assert.equal(bg.status, "running");
  // The pane session is still broadcast and focused.
  const focused = detail.sessions.find((entry) => entry.tabId === "s-pane");
  assert.equal(focused?.focused, true);
});

test("settled sessions outside a pane are not broadcast as background entries", () => {
  const pane = makeSession("s-pane2", {
    piSessionId: "pi-pane2",
    title: "Pane chat",
    startedAt: "2026-06-19T10:00:00.000Z",
  });
  const settled = makeSession("s-old", {
    piSessionId: "pi-old",
    status: "done",
    title: "Old chat",
    startedAt: "2026-06-19T08:00:00.000Z",
  });
  // prev: pane session not yet broadcastable (no piSessionId), settled orphan
  // present. next: pane session gains its piSessionId — this is what changes the
  // broadcast key and fires the event. The settled orphan must stay absent
  // throughout.
  const prevPane = { ...pane, piSessionId: null };
  const prev: WorkspaceState = {
    ...makeState(prevPane),
    sessions: new Map([
      [prevPane.id, prevPane],
      [settled.id, settled],
    ]),
  };
  const next: WorkspaceState = {
    ...prev,
    sessions: new Map([
      [pane.id, pane],
      [settled.id, settled],
    ]),
  };
  const { deps, harness } = makeEffectDeps();

  runWorkspaceEffect(
    { type: "patchSession", sessionId: "s-pane2", patch: { piSessionId: "pi-pane2" } },
    prev,
    next,
    deps,
  );

  const detail = harness.fired.find((entry) => entry.type === ACTIVE_AGENT_SESSIONS_EVENT)
    ?.detail as { sessions: { tabId: string }[] } | undefined;
  // Only the pane session — the settled orphan stays out of the active list.
  assert.deepEqual(
    (detail?.sessions ?? []).map((entry) => entry.tabId),
    ["s-pane2"],
  );
});

test("broadcasts skip loading placeholders, carry session runtime ids, and wait for hydration", () => {
  const loading = makeSession("s-loading", { piSessionId: "pi-x", status: "loading" });
  const ready = makeSession("s-ready", { piSessionId: "pi-y", runtimeSessionId: "rt-ready" });
  const base = makeState(ready);
  const next: WorkspaceState = {
    ...base,
    sessions: new Map([
      [ready.id, ready],
      [loading.id, loading],
    ]),
    layout: {
      kind: "split",
      direction: "vertical",
      ratio: 0.5,
      a: { kind: "leaf", paneId: "p-main" },
      b: { kind: "leaf", paneId: "p-loading" },
    },
    panesById: new Map([
      ["p-main", { sessionId: ready.id }],
      ["p-loading", { sessionId: loading.id }],
    ]),
  };
  const prev: WorkspaceState = { ...next, sessions: new Map([[ready.id, { ...ready, piSessionId: null }]]) };
  const { deps, harness } = makeEffectDeps();

  runWorkspaceEffect(
    { type: "patchSession", sessionId: "s-ready", patch: { piSessionId: "pi-y" } },
    prev,
    next,
    deps,
  );
  const detail = harness.fired.find((entry) => entry.type === ACTIVE_AGENT_SESSIONS_EVENT)
    ?.detail as { sessions: { tabId: string; runtimeSessionId: string }[] };
  assert.deepEqual(
    detail.sessions.map((entry) => entry.tabId),
    ["s-ready"],
  );
  // The broadcast carries the session's own runtime id.
  assert.equal(detail.sessions[0]?.runtimeSessionId, "rt-ready");

  // Unhydrated workspaces never broadcast (placeholder titles must not
  // overwrite the snapshot store before replay completes).
  const { deps: deps2, harness: harness2 } = makeEffectDeps();
  runWorkspaceEffect(
    { type: "patchSession", sessionId: "s-ready", patch: { piSessionId: "pi-y" } },
    { ...prev, hydrated: false },
    { ...next, hydrated: false },
    deps2,
  );
  assert.equal(
    harness2.fired.filter((entry) => entry.type === ACTIVE_AGENT_SESSIONS_EVENT).length,
    0,
  );
});

// ----- hydration one-shot guard (reducer.ts) -----

function snapshotFor(paneId: string, tabId: string) {
  return {
    projectId: "",
    cwd: "/workspace/demo",
    paneId,
    tabId,
    runtimeSessionId: `rt-${tabId}`,
    piSessionId: `pi-${tabId}`,
    title: "Restored chat",
    status: "idle",
    focused: true,
    updatedAt: "2026-06-09T10:00:00.000Z",
  };
}

test("any session content anywhere blocks the entire snapshot restore", () => {
  // CURRENT (deliberately too-broad) behavior: one pane with content causes
  // hydrateActiveSessions to skip restoring EVERY pane and just latch
  // hydrated. The consolidation will narrow this per-pane; update this test
  // when that lands.
  const withContent = makeSession("s-content", { piSessionId: "pi-content" });
  const state = { ...makeState(withContent), hydrated: false };

  const next = reducer(state, {
    type: "hydrateActiveSessions",
    snapshots: [snapshotFor("p-other", "s-restored")],
    projects: [],
    hasExplicitSessionNav: false,
  });

  assert.equal(next.hydrated, true);
  assert.equal(next.sessions, state.sessions);
  assert.equal(next.panesById, state.panesById);
});

test("url navigation latches hydration so late restores cannot clobber a fresh chat", () => {
  const state = { ...makeState(), hydrated: false };
  const fresh = makeFreshTab();

  const opened = reducer(state, {
    type: "urlNavRequested",
    key: "nav-1",
    project: null,
    newSession: true,
    paneId: "p-url",
    runtimeSessionId: "rt-url",
    tab: fresh,
  });
  assert.equal(opened.hydrated, true);
  assert.equal(opened.sessions.has(fresh.id), true);

  // The '+ opens an old chat' guard: a late-arriving snapshot restore is a
  // full no-op once hydrated.
  const afterRestore = reducer(opened, {
    type: "hydrateActiveSessions",
    snapshots: [snapshotFor("p-old", "s-old")],
    projects: [],
    hasExplicitSessionNav: false,
  });
  assert.equal(afterRestore, opened);

  // A deduped (no-op) navigation must NOT latch hydration.
  const unhydrated = { ...makeState(), hydrated: false, lastHandledNavKey: "nav-dup" };
  const deduped = reducer(unhydrated, {
    type: "urlNavRequested",
    key: "nav-dup",
    project: null,
    newSession: true,
    paneId: "p-x",
    runtimeSessionId: "rt-x",
    tab: makeFreshTab(),
  });
  assert.equal(deduped, unhydrated);
  assert.equal(deduped.hydrated, false);
});

test("explicit session navigation skips the snapshot restore entirely", () => {
  const state = { ...makeState(), hydrated: false };
  const next = reducer(state, {
    type: "hydrateActiveSessions",
    snapshots: [snapshotFor("p-old", "s-old")],
    projects: [],
    hasExplicitSessionNav: true,
  });
  assert.equal(next.hydrated, true);
  assert.equal(next.sessions, state.sessions);
});

// ----- sessions-changed refresh double fire (effects.ts) -----

test("session list refreshes fire immediately and again after the settle delay", () => {
  const session = makeSession("s-named", { piSessionId: "pi-named", title: "Before" });
  const prev = makeState(session);
  const renamed = { ...session, title: "After" };
  const next = { ...prev, sessions: new Map([[renamed.id, renamed]]) };
  const { deps, harness } = makeEffectDeps();

  runWorkspaceEffect(
    { type: "renameTab", paneId: "p-main", tabId: "s-named", title: "After" },
    prev,
    next,
    deps,
  );

  const countFired = () =>
    harness.fired.filter((entry) => entry.type === SESSIONS_CHANGED_EVENT).length;
  assert.equal(countFired(), 1);
  // The delayed re-fire exists because pi flushes session files (titles)
  // AFTER the workspace action; removing it leaves ghost "New session" rows.
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0]?.delay, 1_500);
  harness.timers[0]?.handler();
  assert.equal(countFired(), 2);

  // No content change -> no fire at all.
  const { deps: deps2, harness: harness2 } = makeEffectDeps();
  runWorkspaceEffect({ type: "focusPane", paneId: "p-main" }, prev, prev, deps2);
  assert.equal(
    harness2.fired.filter((entry) => entry.type === SESSIONS_CHANGED_EVENT).length,
    0,
  );
});

// ----- session replay queue (workspace/replay-queue.ts) -----

type ReplayHarness = {
  queue: ReturnType<typeof createSessionReplayQueue>;
  replays: { paneId: string; piSessionId: string }[];
  timers: TimerRecord[];
  runTimers: () => void;
  setHandle: (paneId: string, present: boolean) => void;
  setSession: (paneId: string, session: Session | undefined) => void;
};

function makeReplayHarness(): ReplayHarness {
  const handles = new Set<string>();
  const replays: ReplayHarness["replays"] = [];
  const timers: TimerRecord[] = [];
  const panesById = new Map<string, { sessionId: string; runtimeSessionId: string }>();
  const sessions = new Map<string, Session>();
  const queue = createSessionReplayQueue({
    getHandle: (paneId) =>
      handles.has(paneId)
        ? { loadAndReplay: (piSessionId: string) => void replays.push({ paneId, piSessionId }) }
        : undefined,
    getState: () => ({ panesById, sessions }),
    setTimeout: (handler, delay) => void timers.push({ handler, delay }),
  });
  return {
    queue,
    replays,
    timers,
    runTimers: () => {
      // Run timers as they accumulate (drain can schedule retries).
      for (let i = 0; i < timers.length; i += 1) timers[i]?.handler();
    },
    setHandle: (paneId, present) => {
      if (present) handles.add(paneId);
      else handles.delete(paneId);
    },
    setSession: (paneId, session) => {
      if (!session) {
        panesById.delete(paneId);
        return;
      }
      panesById.set(paneId, { sessionId: session.id, runtimeSessionId: "rt-pane" });
      sessions.set(session.id, session);
    },
  };
}

test("queued replays drop onto fresh starters instead of resurrecting old chats", () => {
  const harness = makeReplayHarness();
  harness.setHandle("p-1", true);
  // The '+' guard: the pane's session was swapped to a fresh starter between
  // queue and drain — replaying would overwrite the new chat.
  harness.setSession("p-1", makeSession("s-fresh"));

  harness.queue.queue("p-1", "pi-old");
  harness.runTimers();

  assert.deepEqual(harness.replays, []);
  // The pending entry is consumed, not retried forever.
  harness.setSession("p-1", makeSession("s-restored", { piSessionId: "pi-old", status: "loading" }));
  harness.queue.notifyHandleRegistered("p-1");
  harness.runTimers();
  assert.deepEqual(harness.replays, []);
});

test("replays onto restored loading sessions fire exactly once when the handle registers", () => {
  const harness = makeReplayHarness();
  harness.setSession("p-1", makeSession("s-restored", { piSessionId: "pi-keep", status: "loading" }));

  // Queued before the pane mounted: nothing fires yet.
  harness.queue.queue("p-1", "pi-keep");
  harness.runTimers();
  assert.deepEqual(harness.replays, []);

  // Mount drains it exactly once.
  harness.setHandle("p-1", true);
  harness.queue.notifyHandleRegistered("p-1");
  harness.runTimers();
  assert.deepEqual(harness.replays, [{ paneId: "p-1", piSessionId: "pi-keep" }]);

  // A registration with nothing pending is a no-op.
  harness.queue.notifyHandleRegistered("p-1");
  harness.runTimers();
  assert.equal(harness.replays.length, 1);
});

test("replay queue is last-wins per pane and immediate when the handle exists", () => {
  const harness = makeReplayHarness();
  harness.setHandle("p-1", true);
  harness.setSession("p-1", makeSession("s-a", { piSessionId: "pi-a", status: "loading" }));

  harness.queue.queue("p-1", "pi-a");
  harness.queue.queue("p-1", "pi-b");
  harness.runTimers();

  // Two drains ran but the pending slot was consumed by the first; only the
  // newest queued id replays.
  assert.deepEqual(harness.replays, [{ paneId: "p-1", piSessionId: "pi-b" }]);
});

test("a replay queued for a pane that never mounts stays inert", () => {
  const harness = makeReplayHarness();
  harness.setSession("p-ghost", makeSession("s-ghost", { piSessionId: "pi-ghost" }));

  harness.queue.queue("p-ghost", "pi-ghost");
  harness.runTimers();

  // No handle ever registers: nothing fires, nothing retries, nothing throws.
  assert.deepEqual(harness.replays, []);
  assert.equal(harness.timers.length, 1);
});

// ----- crash-recovery transcript cache (settle-time write) -----

test("a settled turn writes its transcript to the crash-recovery cache", () => {
  const { deps, storage } = makeEffectDeps();
  const running = makeSession("s-1", {
    piSessionId: "pi-1",
    status: "running",
    messages: [{ id: "u1", role: "user", text: "plan the migration" }],
  });
  const settled = makeSession("s-1", {
    piSessionId: "pi-1",
    status: "idle",
    title: "Migration",
    messages: [
      { id: "u1", role: "user", text: "plan the migration" },
      { id: "a1", role: "assistant", text: "Here is the plan." },
    ],
  });
  const prev: WorkspaceState = { ...makeState(running) };
  const next: WorkspaceState = { ...makeState(settled) };

  runWorkspaceEffect({ type: "patchSession", sessionId: "s-1", patch: {} }, prev, next, deps);

  const restored = readTranscriptSnapshot("pi-1", storage);
  assert.equal(restored?.length, 2);
  assert.equal(restored?.[1].text, "Here is the plan.");
});

test("an in-flight (running) turn is not cached until it settles", () => {
  const { deps, storage } = makeEffectDeps();
  const idle = makeSession("s-1", { piSessionId: "pi-1", status: "idle", messages: [] });
  const running = makeSession("s-1", {
    piSessionId: "pi-1",
    status: "running",
    messages: [{ id: "u1", role: "user", text: "streaming…" }],
  });
  const prev: WorkspaceState = { ...makeState(idle) };
  const next: WorkspaceState = { ...makeState(running) };

  runWorkspaceEffect({ type: "patchSession", sessionId: "s-1", patch: {} }, prev, next, deps);

  assert.equal(readTranscriptSnapshot("pi-1", storage), null);
});
