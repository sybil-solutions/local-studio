import assert from "node:assert/strict";
import test from "node:test";

import { runWorkspaceEffect, type WorkspaceEffectDeps } from "@/features/agent/workspace/effects";
import { SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";
import { loadInitialFromStorage, writePaneState } from "@/features/agent/workspace/persistence";
import { reducer } from "@/features/agent/workspace/reducer";
import {
  PANE_LAYOUT_KEY,
  PANE_STATE_KEY,
  restorePersistedPaneState,
  type WorkspaceStorage,
} from "@/features/agent/workspace/store";
import type { WorkspaceState } from "@/features/agent/workspace/types";
import { createSessionReplayQueue } from "@/features/agent/workspace/replay-queue";
import { readTranscriptSnapshot } from "@/features/agent/workspace/transcript-cache";
import type { Session } from "@/features/agent/runtime/types";
import type { ToolSelection } from "@/features/agent/tools/types";

function makeSession(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
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
    skills: [{ id: "skill-1", name: "Skill One" }],
    promptTemplates: [],
  };

  writePaneState(storage, state, (sessionId) => (sessionId === rich.id ? selection : null));
  const loaded = loadInitialFromStorage(storage);

  assert.deepEqual(loaded.workspace.layout, state.layout);
  assert.equal(loaded.workspace.focusedPaneId, "p-side");
  const restoredRich = loaded.workspace.sessions?.get("s-rich");
  assert.equal(restoredRich?.piSessionId, "pi-rich");
  assert.equal(restoredRich?.title, "GPU planning");
  assert.equal(restoredRich?.input, "draft text");
  assert.equal(restoredRich?.lastEventSeq, 17);
  assert.equal(restoredRich?.status, "idle");
  assert.equal(restoredRich?.activeAssistantId, undefined);
  assert.deepEqual(restoredRich?.queue, [
    { id: "q-1", mode: "follow_up", text: "next", sent: true },
  ]);
  // Transcripts live in canonical session storage, never pane-state.
  assert.deepEqual(restoredRich?.messages, []);
  assert.equal(loaded.workspace.panesById?.get("p-main")?.sessionId, "s-rich");
  assert.deepEqual(loaded.selections.get("s-rich"), selection);
});

test("restore surfaces a legacy tab-level runtime key and ignores pane-level copies", () => {
  // The session id IS the runtime key now. A pre-alias tab persisted with its
  // own rt-* runtimeSessionId surfaces that key as a legacy connection-key
  // seed (so a session RUNNING across the upgrade reattaches); legacy
  // pane-level ids are ignored on read.
  const tab = { id: "s-1", runtimeSessionId: "rt-tab-1", title: "T" };
  const persisted = (paneRuntime: string | undefined) =>
    JSON.stringify({
      version: 1,
      layout: { kind: "leaf", paneId: "p-1" },
      focusedPaneId: "p-1",
      panes: {
        "p-1": {
          activeTabId: "s-1",
          tabs: [tab],
          ...(paneRuntime ? { runtimeSessionId: paneRuntime } : {}),
        },
      },
    });

  const restored = restorePersistedPaneState(persisted(undefined));
  assert.equal(restored?.legacyRuntimeKeys.get("s-1"), "rt-tab-1");

  const withLegacyPaneId = restorePersistedPaneState(persisted("rt-stale-pane"));
  assert.equal(withLegacyPaneId?.legacyRuntimeKeys.get("s-1"), "rt-tab-1");

  // A legacy tab missing its own runtime id needs no seed, and doesn't crash.
  const legacyTab = restorePersistedPaneState(
    JSON.stringify({
      version: 1,
      layout: { kind: "leaf", paneId: "p-1" },
      focusedPaneId: "p-1",
      panes: { "p-1": { activeTabId: "s-legacy", tabs: [{ id: "s-legacy", title: "Old" }] } },
    }),
  );
  assert.equal(legacyTab?.sessions.get("s-legacy")?.id, "s-legacy");
  assert.equal(legacyTab?.legacyRuntimeKeys.size, 0);
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
  assert.deepEqual([...(loaded.workspace.panesById?.keys() ?? [])], ["p-a", "p-b"]);
  for (const pane of loaded.workspace.panesById?.values() ?? []) {
    const session = loaded.workspace.sessions?.get(pane.sessionId);
    assert.equal(session?.piSessionId, null);
    assert.equal(session?.messages.length, 0);
    assert.match(session?.id ?? "", /^tab-/);
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
      panes: {
        "p-modern": { activeTabId: "s-m", tabs: [{ id: "s-m", runtimeSessionId: "rt-m" }] },
      },
    }),
  );
  assert.equal(loadInitialFromStorage(both).workspace.focusedPaneId, "p-modern");
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
  assert.equal(harness2.fired.filter((entry) => entry.type === SESSIONS_CHANGED_EVENT).length, 0);
});

test("url navigation does not replay an already-open session", () => {
  const session = makeSession("s-open", {
    piSessionId: "pi-open",
    messages: [{ id: "u-1", role: "user", text: "keep this transcript" }],
    status: "running",
  });
  const prev = makeState(session);
  const next = { ...prev, lastHandledNavKey: "open-existing" };
  const { deps, replays } = makeEffectDeps();

  runWorkspaceEffect(
    {
      type: "urlNavRequested",
      key: "open-existing",
      project: null,
      sessionId: "pi-open",
      paneId: "p-unused",
      tab: makeSession("s-unused"),
    },
    prev,
    next,
    deps,
  );

  assert.deepEqual(replays, []);
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
  const panesById = new Map<string, { sessionId: string }>();
  const sessions = new Map<string, Session>();
  const queue = createSessionReplayQueue({
    getHandle: (paneId) =>
      handles.has(paneId)
        ? {
            // Real ChatPaneHandles carry the session they were mounted for; the
            // drain guard refuses handles whose session no longer matches.
            sessionId: panesById.get(paneId)?.sessionId ?? "",
            loadAndReplay: (piSessionId: string) => void replays.push({ paneId, piSessionId }),
          }
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
      panesById.set(paneId, { sessionId: session.id });
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
  harness.setSession(
    "p-1",
    makeSession("s-restored", { piSessionId: "pi-old", status: "loading" }),
  );
  harness.queue.notifyHandleRegistered("p-1");
  harness.runTimers();
  assert.deepEqual(harness.replays, []);
});

test("replays onto restored loading sessions fire exactly once when the handle registers", () => {
  const harness = makeReplayHarness();
  harness.setSession(
    "p-1",
    makeSession("s-restored", { piSessionId: "pi-keep", status: "loading" }),
  );

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
  // Loading session not yet bound to a canonical id — a bound session would
  // (correctly) reject a replay for a different piSessionId.
  harness.setSession("p-1", makeSession("s-a", { status: "loading" }));

  harness.queue.queue("p-1", "pi-a");
  harness.queue.queue("p-1", "pi-b");
  harness.runTimers();

  // Two drains ran but the pending slot was consumed by the first; only the
  // newest queued id replays.
  assert.deepEqual(harness.replays, [{ paneId: "p-1", piSessionId: "pi-b" }]);
});

test("replay queue preserves a populated live transcript", () => {
  const harness = makeReplayHarness();
  harness.setHandle("p-1", true);
  harness.setSession(
    "p-1",
    makeSession("s-live", {
      piSessionId: "pi-live",
      messages: [{ id: "u-1", role: "user", text: "keep this transcript" }],
      status: "running",
    }),
  );

  harness.queue.queue("p-1", "pi-live");
  harness.runTimers();

  assert.deepEqual(harness.replays, []);
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

test("detached side chats remain patchable by the runtime controller", () => {
  const sideChat = makeSession("side-chat", { status: "running" });
  const registered = reducer(makeState(), { type: "setDetachedSession", session: sideChat });
  const streamed = reducer(registered, {
    type: "patchSession",
    sessionId: sideChat.id,
    patch: (session) => ({
      ...session,
      messages: [{ id: "a1", role: "assistant", text: "Visible immediately" }],
    }),
  });

  assert.equal(streamed.sessions.get(sideChat.id)?.messages[0]?.text, "Visible immediately");

  const removed = reducer(streamed, {
    type: "removeDetachedSession",
    sessionId: sideChat.id,
  });
  assert.equal(removed.sessions.has(sideChat.id), false);
});
