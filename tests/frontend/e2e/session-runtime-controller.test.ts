// Characterization tests for the session event ordering path. These pin the
// CURRENT behavior of the cursor gate, replay-cursor hydration, the
// canonical/runtime event merge, the text-delta coalescer, batch replay, and
// the resume subscription lifecycle — so the session-runtime-controller
// consolidation can refactor against a fixed contract instead of live users.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mergeCanonicalAndRuntimeEvents,
  replayCursorAfterRuntimeHydration,
} from "@/features/agent/messages/helpers";
import { replaySessionEvents } from "@/features/agent/messages/replay";
import type { RuntimeLoggedEvent } from "@/features/agent/messages";
import type {
  RuntimeEventPayload,
  RuntimeEventSubscription,
  RuntimeSessionSummary,
  RuntimeStatus,
} from "@/features/agent/runtime/api";
import {
  acceptRuntimeSeq,
  adoptExternalCursor,
  commitRuntimeSeq,
  reconnectAfter,
} from "@/features/agent/runtime/runtime-cursor";
import { createSessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import { createTextDeltaCoalescer } from "@/features/agent/runtime/text-delta-coalescer";
import type { Session, SessionId } from "@/features/agent/runtime/types";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/session-event-log.json", import.meta.url), "utf8"),
) as {
  canonical: Record<string, unknown>[];
  runtimeTail: RuntimeLoggedEvent[];
};

// ----- cursor gate (runtime-cursor.ts) -----

test("cursor gate passes seq-less payloads through without advancing", () => {
  const cursor = adoptExternalCursor();
  assert.deepEqual(acceptRuntimeSeq(cursor, undefined), { accept: true, cursor });
  const at7 = adoptExternalCursor(7);
  assert.deepEqual(acceptRuntimeSeq(at7, undefined), { accept: true, cursor: at7 });
});

test("cursor gate rejects equal and stale seqs, accepts strictly newer", () => {
  const at5 = adoptExternalCursor(5);
  assert.deepEqual(acceptRuntimeSeq(at5, 5), { accept: false, cursor: at5 });
  assert.deepEqual(acceptRuntimeSeq(at5, 4), { accept: false, cursor: at5 });
  assert.equal(acceptRuntimeSeq(at5, 6).accept, true);
  assert.equal(acceptRuntimeSeq(at5, 6).cursor.receivedSeq, 6);
  // No persisted cursor behaves as 0.
  assert.equal(acceptRuntimeSeq(adoptExternalCursor(), 1).accept, true);
});

test("adopting an external cursor moves the in-memory gate backwards", () => {
  // Deliberately non-monotonic: a lastEventSeq reset (new prompt on the same
  // Pi session) or replay hydration must move the gate BACKWARDS, while
  // acceptRuntimeSeq alone is monotonic.
  const reset = adoptExternalCursor(0);
  assert.equal(acceptRuntimeSeq(reset, 1).accept, true);
  assert.deepEqual(adoptExternalCursor(undefined), {
    receivedSeq: undefined,
    committedSeq: undefined,
  });
  assert.equal(adoptExternalCursor(43).receivedSeq, 43);
});

test("committed cursor lags received and reconnect resumes from received", () => {
  const cursor = acceptRuntimeSeq(adoptExternalCursor(2), 5).cursor;
  assert.equal(cursor.receivedSeq, 5);
  assert.equal(cursor.committedSeq, 2);
  // Reconnect must use the highest RECEIVED seq: an unflushed coalesced delta
  // is still in memory, so replaying it would double-apply.
  assert.equal(reconnectAfter(cursor), 5);
  const committed = commitRuntimeSeq(cursor, 5);
  assert.equal(committed.committedSeq, 5);
  // Commit is monotonic.
  assert.equal(commitRuntimeSeq(committed, 3).committedSeq, 5);
  assert.equal(reconnectAfter(adoptExternalCursor()), 0);
});

// ----- replay cursor after navigation hydration (session/helpers.ts) -----

test("replay hydration reattaches from the runtime cursor only when the runtime is active", () => {
  assert.equal(replayCursorAfterRuntimeHydration(true, 42), 42);
  assert.equal(replayCursorAfterRuntimeHydration(true, undefined), undefined);
  assert.equal(replayCursorAfterRuntimeHydration(false, 42), undefined);
  assert.equal(replayCursorAfterRuntimeHydration(false, undefined), undefined);
});

// ----- canonical + runtime merge (session/helpers.ts) -----

function userEvent(text: string): Record<string, unknown> {
  return { type: "message", message: { role: "user", content: text } };
}

function assistantEvent(text: string): Record<string, unknown> {
  return {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

test("merge cuts the canonical tail at the runtime's first user message", () => {
  const canonical = [
    userEvent("first question"),
    assistantEvent("first answer"),
    userEvent("second question"),
    assistantEvent("settled second answer"),
  ];
  const runtime: RuntimeLoggedEvent[] = [
    { seq: 1, event: userEvent("second question") },
    { seq: 2, event: assistantEvent("live second answer") },
  ];

  const merged = mergeCanonicalAndRuntimeEvents(canonical, runtime);
  // Canonical keeps only the first turn; the runtime owns the covered tail —
  // the settled copy of the second turn must NOT appear (duplicate-bubble bug).
  assert.deepEqual(merged, [
    userEvent("first question"),
    assistantEvent("first answer"),
    userEvent("second question"),
    assistantEvent("live second answer"),
  ]);
});

test("merge dedupes identical events and sorts the runtime log by seq", () => {
  const canonical = [userEvent("only question")];
  const runtime: RuntimeLoggedEvent[] = [
    { seq: 2, event: assistantEvent("answer") },
    { seq: 1, event: userEvent("only question") },
    { seq: 3, event: assistantEvent("answer") },
  ];

  const merged = mergeCanonicalAndRuntimeEvents(canonical, runtime);
  assert.deepEqual(merged, [userEvent("only question"), assistantEvent("answer")]);
});

test("merge without runtime events returns the canonical log untouched", () => {
  const canonical = [userEvent("q"), assistantEvent("a")];
  assert.deepEqual(mergeCanonicalAndRuntimeEvents(canonical), canonical);
});

// ----- batch replay over the golden event log (session/replay.ts) -----

test("golden event log replays to the expected transcript", () => {
  const { messages, title, startedAt, modelId } = replaySessionEvents(fixture.canonical);

  assert.equal(title, "Summarize the GPU fleet");
  assert.equal(startedAt, "2026-06-09T10:00:00.000Z");
  assert.equal(modelId, "deepseek-v4-flash");

  assert.deepEqual(
    messages.map((message) => message.role),
    ["user", "assistant", "assistant"],
  );
  assert.equal(messages[0]?.text, "Summarize the GPU fleet");

  const toolTurn = messages[1];
  assert.deepEqual(
    (toolTurn?.blocks ?? []).map((block) => block.kind),
    ["thinking", "tool"],
  );
  const toolBlock = toolTurn?.blocks?.find((block) => block.kind === "tool");
  assert.equal(toolBlock?.kind === "tool" && toolBlock.status, "done");
  assert.equal(
    toolBlock?.kind === "tool" && toolBlock.text,
    "4x RTX PRO 6000 Blackwell + 1x RTX 3090",
  );

  assert.equal(
    messages[2]?.text,
    "The fleet has four Blackwell cards and one RTX 3090.\n\n- Blackwells capped at 275W.\n- 3090 capped at 150W.",
  );
});

// ----- text delta coalescer (text-delta-coalescer.ts) -----

type FrameHarness = {
  callbacks: (() => void)[];
  cancelled: number;
  schedule: (callback: () => void) => { cancel: () => void };
  runAll: () => void;
};

function frameHarness(): FrameHarness {
  const harness: FrameHarness = {
    callbacks: [],
    cancelled: 0,
    schedule: (callback) => {
      harness.callbacks.push(callback);
      return { cancel: () => (harness.cancelled += 1) };
    },
    runAll: () => {
      const pending = harness.callbacks.splice(0);
      for (const callback of pending) callback();
    },
  };
  return harness;
}

function deltaEvent(type: string, delta: string): Record<string, unknown> {
  return { type: "message_update", assistantMessageEvent: { type, delta } };
}

function appliedDelta(event: Record<string, unknown>): unknown {
  return (event.assistantMessageEvent as Record<string, unknown> | undefined)?.delta;
}

test("coalescer concatenates same-kind deltas including standalone newlines", () => {
  const applied: Record<string, unknown>[] = [];
  const frames = frameHarness();
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, _assistantId, event) => applied.push(event),
    scheduleFrame: frames.schedule,
  });

  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "Row 1"));
  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "\n"));
  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "Row 2"));
  assert.equal(applied.length, 0);

  frames.runAll();
  // One merged event; dropping the standalone "\n" delta was the table/paragraph
  // whitespace bug (d9ede391).
  assert.equal(applied.length, 1);
  assert.equal(appliedDelta(applied[0]), "Row 1\nRow 2");
});

test("coalescer flushNow applies pending once and a stale frame is harmless", () => {
  const applied: Record<string, unknown>[] = [];
  const frames = frameHarness();
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, _assistantId, event) => applied.push(event),
    scheduleFrame: frames.schedule,
  });

  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "Hello"));
  coalescer.flushNow("s-1");
  assert.equal(applied.length, 1);
  assert.equal(frames.cancelled, 1);

  // A frame callback firing after the explicit flush must not double-apply.
  frames.runAll();
  assert.equal(applied.length, 1);
});

test("coalescer discard drops a session's pending deltas without applying them", () => {
  // Cursor epoch resets (new prompt, replay hydration) discard stale pending
  // merges instead of flushing them into the new epoch's transcript.
  const applied: Record<string, unknown>[] = [];
  const frames = frameHarness();
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, _assistantId, event) => applied.push(event),
    scheduleFrame: frames.schedule,
  });

  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "lost"));
  coalescer.discard("s-1");
  frames.runAll();
  assert.equal(applied.length, 0);
  assert.equal(frames.cancelled, 1);
});

test("coalescer flushes pending work when the assistant id changes", () => {
  const applied: { assistantId: string; event: Record<string, unknown> }[] = [];
  const frames = frameHarness();
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, assistantId, event) => applied.push({ assistantId, event }),
    scheduleFrame: frames.schedule,
  });

  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "first"));
  coalescer.enqueuePiEvent("s-1", "a-2", deltaEvent("text_delta", "second"));

  assert.equal(applied.length, 1);
  assert.equal(applied[0]?.assistantId, "a-1");
  assert.equal(appliedDelta(applied[0].event), "first");

  frames.runAll();
  assert.equal(applied.length, 2);
  assert.equal(applied[1]?.assistantId, "a-2");
});

// ----- live attachment lifecycle (session-runtime-controller.ts) -----

type ControllerHarness = {
  session: () => Session;
  subscribeCalls: { after: number; piSessionId: string | null | undefined }[];
  order: string[];
  frames: FrameHarness;
  controller: ReturnType<typeof createSessionRuntimeController>;
  emit: (payload: RuntimeEventPayload) => void;
  fail: () => void;
  close: () => void;
};

function createControllerHarness(
  options: {
    lastEventSeq?: number;
    status?: RuntimeStatus | null;
  } = {},
): ControllerHarness {
  let session: Session = {
    id: "s-1",
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    title: "New session",
    messages: [],
    status: "running",
    error: "",
    input: "",
    lastEventSeq: options.lastEventSeq,
  };
  const subscribeCalls: ControllerHarness["subscribeCalls"] = [];
  const handlers: { onPayload: (payload: RuntimeEventPayload) => void; onError: () => void }[] = [];
  const order: string[] = [];
  const frames = frameHarness();

  const controller = createSessionRuntimeController({
    api: {
      loadRuntimeStatus: async () => options.status ?? null,
      subscribeRuntimeEvents: (_runtime, after, piSessionId, eventHandlers) => {
        subscribeCalls.push({ after, piSessionId });
        handlers.push(eventHandlers);
        return { close: () => order.push("transport-close") };
      },
    },
    scheduleFrame: frames.schedule,
  });
  controller.bind({
    commit: (sessionId, patch) => {
      if (sessionId !== session.id) return;
      const prev = session;
      session = patch(session);
      if (session === prev) return;
      if (prev.status !== "idle" && session.status === "idle") order.push("idle-patch");
      const joinedBlocks = (entry: Session) =>
        (entry.messages.at(-1)?.blocks ?? []).map((block) => block.text).join("");
      if (joinedBlocks(session) !== joinedBlocks(prev)) order.push(`blocks:${joinedBlocks(session)}`);
    },
    getSession: (sessionId) => (sessionId === session.id ? session : undefined),
    getSessions: () => [session],
  });
  controller.reconcile([session]);

  return {
    session: () => session,
    subscribeCalls,
    order,
    frames,
    controller,
    emit: (payload) => handlers.at(-1)?.onPayload(payload),
    fail: () => handlers.at(-1)?.onError(),
    close: () => {
      controller.closeAll();
      controller.unbind();
    },
  };
}

function partialDeltaEvent(delta: string, full: string): Record<string, unknown> {
  return {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta,
      contentIndex: 0,
      partial: { role: "assistant", content: [{ type: "text", text: full }] },
    },
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("controller reconnects from the highest received seq, not the configured start", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const harness = createControllerHarness({ status: { active: true } });

  harness.emit({ type: "pi", seq: 5, event: partialDeltaEvent("a", "a") });
  harness.emit({ type: "pi", seq: 3, event: partialDeltaEvent("b", "b") });
  harness.fail();
  await settle();
  t.mock.timers.tick(1_000);

  assert.deepEqual(
    harness.subscribeCalls.map((call) => call.after),
    [0, 5],
  );
  harness.close();
});

test("controller applies agent_end immediately and settles the session idle", () => {
  const harness = createControllerHarness();

  harness.emit({ type: "pi", seq: 1, event: { type: "agent_end" } });

  assert.equal(harness.session().status, "idle");
  assert.equal(harness.session().activeAssistantId, undefined);
  // The controller ensured an assistant bubble before applying the event.
  assert.equal(harness.session().messages.at(-1)?.role, "assistant");
  assert.equal(harness.session().lastEventSeq, 1);
  harness.close();
});

test("controller drops payloads the seq gate rejects without touching state", () => {
  const harness = createControllerHarness({ lastEventSeq: 5 });
  const before = harness.session();

  harness.emit({ type: "pi", seq: 3, event: { type: "agent_end" } });

  assert.equal(harness.session(), before);
  // The attachment also resumed from the persisted cursor.
  assert.deepEqual(
    harness.subscribeCalls.map((call) => call.after),
    [5],
  );
  harness.close();
});

test("closing attachments flushes pending coalesced deltas before the transport", () => {
  const harness = createControllerHarness();

  harness.emit({ type: "pi", seq: 1, event: partialDeltaEvent("abc", "abc") });
  assert.equal(harness.order.includes("blocks:abc"), false);

  harness.close();

  const flushedAt = harness.order.indexOf("blocks:abc");
  const closedAt = harness.order.indexOf("transport-close");
  assert.notEqual(flushedAt, -1);
  assert.notEqual(closedAt, -1);
  assert.ok(flushedAt < closedAt, `flush must precede transport close: ${harness.order.join(",")}`);
});

test("inconclusive liveness probe reconnects and never idles the session", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const harness = createControllerHarness({ status: null });

  harness.fail();
  await settle();
  assert.equal(harness.session().status, "running");
  assert.equal(harness.order.includes("idle-patch"), false);

  t.mock.timers.tick(1_000);
  assert.equal(harness.subscribeCalls.length, 2);
  harness.close();
});

test("definitively inactive runtime closes, flushes pending text, then idles", async () => {
  const harness = createControllerHarness({ status: { active: false } });

  harness.emit({ type: "pi", seq: 1, event: partialDeltaEvent("tail", "tail") });
  harness.fail();
  await settle();

  const closedAt = harness.order.indexOf("transport-close");
  const flushedAt = harness.order.indexOf("blocks:tail");
  const idledAt = harness.order.indexOf("idle-patch");
  assert.ok(closedAt !== -1 && flushedAt !== -1 && idledAt !== -1, harness.order.join(","));
  assert.ok(closedAt < flushedAt && flushedAt < idledAt, harness.order.join(","));
  assert.equal(harness.session().status, "idle");
  harness.close();
});

test("done status payloads settle the session idle and keep the pi session id", () => {
  const harness = createControllerHarness();

  harness.emit({
    type: "status",
    phase: "done",
    session: { piSessionId: "pi-from-status" },
  });

  assert.equal(harness.session().status, "idle");
  assert.equal(harness.session().piSessionId, "pi-from-status");
  assert.equal(harness.session().activeAssistantId, undefined);
  harness.close();
});

// ----- received/committed cursor split (step 6 behavior guards) -----

test("reconnect mid-coalesce replays nothing and commits the merged text exactly once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const harness = createControllerHarness({ status: { active: true } });

  // Three deltas received, none flushed (no frame has run).
  harness.emit({ type: "pi", seq: 1, event: partialDeltaEvent("a", "a") });
  harness.emit({ type: "pi", seq: 2, event: partialDeltaEvent("b", "ab") });
  harness.emit({ type: "pi", seq: 3, event: partialDeltaEvent("c", "abc") });

  // Committed cursor lags received: nothing persisted yet.
  assert.equal(harness.session().lastEventSeq, undefined);

  // Transport error: must resubscribe AFTER the highest RECEIVED seq.
  harness.fail();
  await settle();
  t.mock.timers.tick(1_000);
  assert.deepEqual(
    harness.subscribeCalls.map((call) => call.after),
    [0, 3],
  );

  // Server replays the same seqs anyway (overlap) — the gate rejects them all.
  const blocksBefore = harness.order.filter((entry) => entry.startsWith("blocks:")).length;
  harness.emit({ type: "pi", seq: 1, event: partialDeltaEvent("a", "a") });
  harness.emit({ type: "pi", seq: 2, event: partialDeltaEvent("b", "ab") });
  harness.emit({ type: "pi", seq: 3, event: partialDeltaEvent("c", "abc") });
  assert.equal(
    harness.order.filter((entry) => entry.startsWith("blocks:")).length,
    blocksBefore,
  );

  // The frame fires: exactly one commit applies "abc" and stamps the cursor.
  harness.frames.runAll();
  assert.deepEqual(
    harness.order.filter((entry) => entry.startsWith("blocks:")),
    ["blocks:abc"],
  );
  assert.equal(harness.session().lastEventSeq, 3);
  harness.close();
});

test("flushed deltas stamp the committed cursor in the same commit as their content", () => {
  const harness = createControllerHarness();
  let stampedWithContent = false;

  harness.emit({ type: "pi", seq: 7, event: partialDeltaEvent("hello", "hello") });
  assert.equal(harness.session().lastEventSeq, undefined);

  // Inspect the commit that lands the text: it must already carry the cursor.
  const before = harness.order.length;
  harness.frames.runAll();
  stampedWithContent =
    harness.order.slice(before).includes("blocks:hello") && harness.session().lastEventSeq === 7;
  assert.equal(stampedWithContent, true);
  harness.close();
});

test("noteTurnAccepted resets the cursor, drops stale pending deltas, and persists 0", () => {
  const harness = createControllerHarness({ lastEventSeq: 43 });

  // A leftover delta from the previous epoch is pending but unflushed.
  harness.emit({ type: "pi", seq: 44, event: partialDeltaEvent("stale", "stale") });

  harness.controller.noteTurnAccepted("s-1");
  assert.equal(harness.session().lastEventSeq, 0);

  // The stale pending delta must NOT leak into the new epoch.
  harness.frames.runAll();
  assert.equal(harness.order.includes("blocks:stale"), false);

  // The new prompt's restarted seq numbering is accepted from 1.
  harness.emit({ type: "pi", seq: 1, event: partialDeltaEvent("fresh", "fresh") });
  harness.frames.runAll();
  assert.equal(harness.order.includes("blocks:fresh"), true);
  assert.equal(harness.session().lastEventSeq, 1);
  harness.close();
});

test("agent_end lands tool finalization, idle status, and cursor in one commit", () => {
  const harness = createControllerHarness();
  const commits: Session[] = [];

  harness.emit({ type: "pi", seq: 1, event: partialDeltaEvent("answer", "answer") });
  harness.frames.runAll();

  // Track the exact commits produced by agent_end.
  const sessionBefore = harness.session();
  harness.emit({ type: "pi", seq: 2, event: { type: "agent_end" } });
  const sessionAfter = harness.session();
  commits.push(sessionBefore, sessionAfter);

  assert.equal(sessionAfter.status, "idle");
  assert.equal(sessionAfter.activeAssistantId, undefined);
  assert.equal(sessionAfter.lastEventSeq, 2);
  harness.close();
});

// ----- runtime-list poll (session-runtime-controller.ts pollNow) -----

type PollHarness = {
  controller: ReturnType<typeof createSessionRuntimeController>;
  sessions: () => Session[];
  fetchCount: () => number;
  resolveFetch: (index: number, entries: RuntimeSessionSummary[]) => Promise<void>;
};

function pollSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    title: "New session",
    messages: [],
    status: "running",
    error: "",
    input: "",
    ...overrides,
  };
}

function createPollHarness(initial: Session[]): PollHarness {
  let sessions = initial;
  const pendingFetches: ((entries: RuntimeSessionSummary[]) => void)[] = [];

  const controller = createSessionRuntimeController({
    api: {
      listRuntimeSessions: () =>
        new Promise<RuntimeSessionSummary[]>((resolve) => {
          pendingFetches.push(resolve);
        }),
      loadRuntimeStatus: async () => null,
      subscribeRuntimeEvents: () => ({ close: () => undefined }),
    },
  });
  controller.bind({
    commit: (sessionId, patch) => {
      sessions = sessions.map((entry) => (entry.id === sessionId ? patch(entry) : entry));
    },
    getSession: (sessionId) => sessions.find((entry) => entry.id === sessionId),
    getSessions: () => sessions,
  });

  return {
    controller,
    sessions: () => sessions,
    fetchCount: () => pendingFetches.length,
    resolveFetch: async (index, entries) => {
      pendingFetches[index]?.(entries);
      await settle();
    },
  };
}

test("poll promotes an active runtime to running and adopts its id via the pi match", async () => {
  const harness = createPollHarness([
    pollSession({ status: "idle", runtimeSessionId: "rt-old", piSessionId: "pi-1" }),
  ]);
  harness.controller.pollNow();
  assert.equal(harness.fetchCount(), 1);

  await harness.resolveFetch(0, [
    {
      sessionId: "rt-new",
      status: { active: true, piSessionId: "pi-1", modelId: "deepseek-v4-flash" },
    },
  ]);

  const session = harness.sessions()[0];
  assert.equal(session.status, "running");
  assert.equal(session.runtimeSessionId, "rt-new");
  assert.equal(session.modelId, "deepseek-v4-flash");
  harness.controller.closeAll();
  harness.controller.unbind();
});

test("poll never idles a starting session; a running one it may settle", async () => {
  const harness = createPollHarness([
    pollSession({ id: "s-starting", runtimeSessionId: "rt-a", status: "starting" }),
    pollSession({ id: "s-running", runtimeSessionId: "rt-b", piSessionId: "pi-b" }),
  ]);
  harness.controller.pollNow();
  await harness.resolveFetch(0, [
    { sessionId: "rt-a", status: { active: false } },
    { sessionId: "rt-b", status: { active: false } },
  ]);

  // The optimistic "starting" phase is owned by the prompt stream — the
  // runtime list not knowing the turn yet must not hide the working spinner.
  assert.equal(harness.sessions()[0].status, "starting");
  assert.equal(harness.sessions()[1].status, "idle");
  assert.equal(harness.sessions()[1].activeAssistantId, undefined);
  harness.controller.closeAll();
  harness.controller.unbind();
});

test("poll ignores sessions absent from the runtime list", async () => {
  const harness = createPollHarness([pollSession({ status: "running" })]);
  harness.controller.pollNow();
  await harness.resolveFetch(0, []);
  assert.equal(harness.sessions()[0].status, "running");
  harness.controller.closeAll();
  harness.controller.unbind();
});

test("a stale in-flight poll snapshot is dropped after pollNow restarts the epoch", async () => {
  const harness = createPollHarness([pollSession({ status: "running" })]);
  harness.controller.pollNow(); // fetch 0 — will resolve LAST with a stale idle list
  harness.controller.pollNow(); // fetch 1 — fresher snapshot, runtime active
  assert.equal(harness.fetchCount(), 2);

  await harness.resolveFetch(1, [{ sessionId: "rt-1", status: { active: true } }]);
  assert.equal(harness.sessions()[0].status, "running");

  // The pre-restart snapshot must not idle the session it no longer speaks for.
  await harness.resolveFetch(0, [{ sessionId: "rt-1", status: { active: false } }]);
  assert.equal(harness.sessions()[0].status, "running");
  harness.controller.closeAll();
  harness.controller.unbind();
});

test("poll keeps firing on its interval and stops on unbind", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const harness = createPollHarness([pollSession()]);
  harness.controller.pollNow();
  assert.equal(harness.fetchCount(), 1);

  t.mock.timers.tick(5_000);
  assert.equal(harness.fetchCount(), 2);

  harness.controller.unbind();
  t.mock.timers.tick(15_000);
  assert.equal(harness.fetchCount(), 2);
  harness.controller.closeAll();
});

test("pollNow with no sessions does not start a poll", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const harness = createPollHarness([]);
  harness.controller.pollNow();
  t.mock.timers.tick(15_000);
  assert.equal(harness.fetchCount(), 0);
  harness.controller.unbind();
});

test("poll-idle is suppressed inside the accept grace window, allowed after it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const harness = createPollHarness([pollSession({ status: "running" })]);

  // /turn was just accepted; a snapshot fetched moments later may still lag
  // the new turn and must not idle the session.
  harness.controller.noteTurnAccepted("s-1");
  harness.controller.pollNow();
  await harness.resolveFetch(0, [{ sessionId: "rt-1", status: { active: false } }]);
  assert.equal(harness.sessions()[0].status, "running");

  // Two poll periods later the runtime list speaks for the turn again.
  t.mock.timers.setTime(12_000);
  harness.controller.pollNow();
  await harness.resolveFetch(1, [{ sessionId: "rt-1", status: { active: false } }]);
  assert.equal(harness.sessions()[0].status, "idle");

  harness.controller.closeAll();
  harness.controller.unbind();
});

// Regression: a mid-stream user message (steer / follow-up) opens a new bubble
// and installs a liveAssistantIds redirect so later same-tick events find it
// before React commits. That redirect MUST be dropped when the turn ends — left
// set, the NEXT turn's events retarget the prior (settled) bubble, leaving the
// new bubble empty: tool calls + reasoning render off-screen and no final
// content appears. This is the "browser-open follow-ups fail in weird ways"
// report — the browser_context prefix makes the steer echo mismatch, which is
// what installs the redirect in the first place.
test("agent_end clears the mid-stream redirect so the next turn targets its own bubble", () => {
  let session: Session = {
    id: "s-1",
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    title: "t",
    messages: [
      { id: "user-1", role: "user", text: "turn one", timestamp: "" },
      { id: "assistant-A", role: "assistant", text: "", blocks: [], timestamp: "" },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: "assistant-A",
  };
  const handlers: { onPayload: (payload: RuntimeEventPayload) => void; onError: () => void }[] = [];
  const controller = createSessionRuntimeController({
    api: {
      loadRuntimeStatus: async () => null,
      subscribeRuntimeEvents: (_runtime, _after, _piSessionId, eventHandlers) => {
        handlers.push(eventHandlers);
        return { close: () => undefined };
      },
    },
  });
  controller.bind({
    commit: (sessionId, patch) => {
      if (sessionId === session.id) session = patch(session);
    },
    getSession: (sessionId) => (sessionId === session.id ? session : undefined),
    getSessions: () => [session],
  });
  controller.reconcile([session]);
  const emit = (payload: RuntimeEventPayload) => handlers.at(-1)?.onPayload(payload);
  const userEcho = (text: string): Record<string, unknown> => ({
    type: "message_start",
    message: { role: "user", content: [{ type: "text", text }] },
  });
  const assistantMessage = (text: string): Record<string, unknown> => ({
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
  const blockText = (id: string) =>
    (session.messages.find((m) => m.id === id)?.blocks ?? []).map((b) => b.text).join("");

  // Turn 1: the prompt echo matches the optimistic bubble (no redirect yet),
  // then the assistant answers into bubble A.
  emit({ type: "pi", seq: 1, event: userEcho("turn one") });
  emit({ type: "pi", seq: 2, event: assistantMessage("answer one") });
  assert.equal(blockText("assistant-A"), "answer one");

  // A mid-stream steer arrives — no optimistic bubble, so it opens bubble B and
  // installs the liveAssistantIds redirect.
  emit({ type: "pi", seq: 3, event: userEcho("steer text") });
  const bubbleB = session.activeAssistantId;
  assert.ok(bubbleB && bubbleB !== "assistant-A");
  emit({ type: "pi", seq: 4, event: assistantMessage("answer steer") });
  assert.equal(blockText(bubbleB!), "answer steer");

  // Turn 1 ends.
  emit({ type: "pi", seq: 5, event: { type: "agent_end" } });
  assert.equal(session.status, "idle");

  // Client optimistically appends turn 2 (mirrors appendOptimisticPrompt).
  session = {
    ...session,
    status: "running",
    activeAssistantId: "assistant-C",
    messages: [
      ...session.messages,
      { id: "user-2", role: "user", text: "turn two", timestamp: "" },
      { id: "assistant-C", role: "assistant", text: "", blocks: [], timestamp: "" },
    ],
  };

  // Pi echoes "turn two" (matches the optimistic bubble → early return, redirect
  // untouched), then streams the answer. It must land in bubble C — not the
  // stale steer bubble B.
  emit({ type: "pi", seq: 6, event: userEcho("turn two") });
  emit({ type: "pi", seq: 7, event: assistantMessage("answer two") });

  assert.equal(blockText("assistant-C"), "answer two");
  assert.equal(blockText(bubbleB!), "answer steer");
  assert.equal(blockText("assistant-A"), "answer one");

  controller.closeAll();
  controller.unbind();
});
