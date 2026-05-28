import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
} from "@/lib/agent/active-sessions";
import { controlTargetHasActiveTurn } from "@/lib/agent/control-routing";
import {
  detectComposerMention,
  selectedContextInstructions,
  selectedContextPrompt,
} from "@/lib/agent/composer-context";
import { piStatusFromEvents } from "@/lib/agent/pi-runtime-state";
import { applyAssistantPiEventToBlocks } from "@/lib/agent/session/block-event";
import {
  runtimeStatusLooksActive,
  statusAfterControlPhase,
} from "@/lib/agent/session/helpers";
import { replaySessionEvents } from "@/lib/agent/session/replay";
import {
  applyPiEventToSession,
  type PiEventApplierDeps,
} from "@/lib/agent/sessions/pi-event-applier";
import { drainQueuedTurnAfterAgentEnd } from "@/lib/agent/sessions/queue-drain";
import {
  createTextDeltaCoalescer,
  textDeltaFromPiEvent,
} from "@/lib/agent/sessions/text-delta-coalescer";
import { isEmptyStarterSession } from "@/lib/agent/sessions/store";
import { beginSessionSubmit, endSessionSubmit } from "@/lib/agent/sessions/submit-guard";
import type { Session } from "@/lib/agent/sessions/types";
import { reducer } from "@/lib/agent/workspace/reducer";
import type { WorkspaceState } from "@/lib/agent/workspace/types";
import { collectLeaves } from "@/lib/agent/workspace/layout";

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
    panesById: new Map([
      ["p-main", { sessionId: session.id, runtimeSessionId: "rt-pane-main" }],
    ]),
    focusedPaneId: "p-main",
    setupWarning: "",
    error: "",
    hydrated: true,
    lastHandledNavKey: "",
  };
}

function makePiEventApplierHarness(
  initialSession: Session,
  assistantId = "a-main",
): { deps: PiEventApplierDeps; session: () => Session } {
  let session = initialSession;
  const tabsRef = { current: [session] };
  const sync = () => {
    tabsRef.current = [session];
  };
  const deps: PiEventApplierDeps = {
    liveAssistantIdsRef: {
      current: new Map([[initialSession.id, assistantId]]),
    },
    patchAssistant: (sessionId, targetAssistantId, patch) => {
      if (sessionId !== session.id) return;
      session = {
        ...session,
        messages: session.messages.map((message) =>
          message.id === targetAssistantId ? patch(message) : message,
        ),
      };
      sync();
    },
    tabsRef,
    updateSession: (sessionId, patch) => {
      if (sessionId !== session.id) return;
      session = patch(session);
      sync();
    },
  };
  return { deps, session: () => session };
}

test("new chat url navigation replaces the focused chat with a fresh runtime", () => {
  const oldSession = makeSession("s-old", {
    runtimeSessionId: "rt-old",
    piSessionId: "pi-old",
    title: "Old debugging chat",
    status: "running",
    startedAt: "2026-05-28T12:00:00.000Z",
    activeAssistantId: "a-old",
    lastEventSeq: 12,
    input: "draft stuck on old chat",
  });
  const freshSession = makeSession("s-fresh", {
    runtimeSessionId: "rt-fresh",
    title: "New session",
  });
  const state: WorkspaceState = {
    ...makeState(oldSession),
    selectedModel: "model-a",
  };

  const next = reducer(state, {
    type: "urlNavRequested",
    key: "project-a||1|",
    project: null,
    newSession: true,
    paneId: "p-url-new",
    runtimeSessionId: "rt-url-new",
    tab: freshSession,
  });

  const pane = next.panesById.get("p-main");
  assert.equal(pane?.sessionId, "s-fresh");
  assert.equal(pane?.runtimeSessionId, "rt-fresh");
  assert.equal(next.sessions.has("s-old"), false);
  const active = next.sessions.get("s-fresh");
  assert.equal(active?.title, "New session");
  assert.equal(active?.piSessionId, null);
  assert.equal(active?.status, "idle");
  assert.equal(active?.input, "");
  assert.equal(active?.modelId, "model-a");
});

test("empty starter reuse clears stale title and transient runtime metadata", () => {
  const starter = makeSession("s-starter", {
    title: "Old chat title",
    status: "done",
    error: "old error",
    tokenStats: { read: 1, write: 2, current: 3 },
    contextUsage: { tokens: 3, contextWindow: 10, percent: 30, shouldCompact: false },
    usedSkills: [{ id: "skill-old", name: "Old skill" }],
  });

  assert.equal(isEmptyStarterSession(starter), true);

  const next = reducer(makeState(starter), {
    type: "openNewSession",
    tab: makeSession("s-fresh"),
    paneId: "p-new",
    runtimeSessionId: "rt-new",
    mode: "replace",
  });

  const active = next.sessions.get(next.panesById.get("p-main")?.sessionId ?? "");
  assert.equal(active?.id, "s-starter");
  assert.equal(active?.title, "New session");
  assert.equal(active?.status, "idle");
  assert.equal(active?.error, "");
  assert.equal(active?.tokenStats, undefined);
  assert.equal(active?.contextUsage, null);
  assert.equal(active?.usedSkills, undefined);
});

test("empty starter detection rejects cleared live sessions", () => {
  const clearedLive = makeSession("s-cleared-live", {
    status: "running",
    startedAt: "2026-05-28T12:00:00.000Z",
    activeAssistantId: "a-old",
    lastEventSeq: 9,
    queue: [{ id: "q-old", mode: "follow_up", text: "later", sent: true }],
  });

  assert.equal(isEmptyStarterSession(clearedLive), false);
});

test("session submit guards block duplicate sends only within the same session", () => {
  const guard = new Set<string>();

  assert.equal(beginSessionSubmit(guard, "s-old"), true);
  assert.equal(beginSessionSubmit(guard, "s-old"), false);
  assert.equal(beginSessionSubmit(guard, "s-new"), true);
  endSessionSubmit(guard, "s-old");
  assert.equal(beginSessionSubmit(guard, "s-old"), true);
});

test("agent session navigation restores active SDK sessions with skills and model selection", () => {
  const state = makeState();
  const usedSkills = [
    { id: "skill-browser", name: "browser", path: "/skills/browser" },
  ];

  const next = reducer(state, {
    type: "hydrateActiveSessions",
    projects: [
      { id: "personal", name: "personal", path: "/workspace/personal" },
    ],
    snapshots: [
      {
        projectId: "personal",
        cwd: "/workspace/personal",
        paneId: "p-main",
        tabId: "tab-deepseek",
        piSessionId: "pi-deepseek",
        modelId: "deepseek-v4-flash",
        title: "Still running",
        status: "running",
        active: true,
        updatedAt: "2026-05-26T12:00:00.000Z",
        usedSkills,
      },
    ],
  });

  const restoredPane = next.panesById.get("p-main");
  assert.equal(next.hydrated, true);
  assert.equal(next.focusedPaneId, "p-main");
  assert.equal(restoredPane?.sessionId, "tab-deepseek");
  const restored = next.sessions.get("tab-deepseek");
  assert.equal(restored?.piSessionId, "pi-deepseek");
  assert.equal(restored?.modelId, "deepseek-v4-flash");
  assert.deepEqual(restored?.usedSkills, usedSkills);
});

test("agent session merge upgrades tab identity to pi identity without dropping active state", () => {
  const previous: ActiveAgentSessionSnapshot[] = [
    {
      projectId: "personal",
      cwd: "/workspace/personal",
      paneId: "p-main",
      tabId: "tab-1",
      piSessionId: null,
      title: "Draft",
      status: "starting",
      active: true,
      updatedAt: "2026-05-26T12:00:00.000Z",
    },
  ];

  const incoming: ActiveAgentSessionSnapshot[] = [
    {
      projectId: "personal",
      cwd: "/workspace/personal",
      paneId: "p-main",
      tabId: "tab-1",
      piSessionId: "pi-live",
      modelId: "deepseek-v4-flash",
      title: "Live",
      status: "running",
      updatedAt: "2026-05-26T12:00:01.000Z",
      usedSkills: [{ id: "skill-code", name: "code" }],
    },
  ];

  const merged = mergeActiveAgentSessions(previous, incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.piSessionId, "pi-live");
  assert.equal(merged[0]?.active, true);
  assert.equal(merged[0]?.modelId, "deepseek-v4-flash");
  assert.deepEqual(merged[0]?.usedSkills, [{ id: "skill-code", name: "code" }]);
});

test("agent session merge preserves model metadata when active snapshots absorb inactive updates", () => {
  const incoming: ActiveAgentSessionSnapshot[] = [
    {
      projectId: "personal",
      cwd: "/workspace/personal",
      paneId: "p-main",
      tabId: "tab-live",
      piSessionId: "pi-live",
      title: "Live",
      status: "running",
      active: true,
      updatedAt: "2026-05-26T12:00:02.000Z",
    },
    {
      projectId: "personal",
      cwd: "/workspace/personal",
      paneId: "p-main",
      tabId: "tab-live",
      piSessionId: "pi-live",
      modelId: "deepseek-v4-flash",
      title: "Live with model",
      status: "running",
      active: false,
      updatedAt: "2026-05-26T12:00:03.000Z",
    },
  ];

  const merged = mergeActiveAgentSessions([], incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.active, true);
  assert.equal(merged[0]?.modelId, "deepseek-v4-flash");
  assert.equal(merged[0]?.title, "Live with model");
});

test("completed runtime remains running but not active after the prompt promise settles", () => {
  const status = piStatusFromEvents({
    running: true,
    activePromptCount: 0,
    modelId: "deepseek-v4-flash",
    cwd: "/workspace",
    piSessionId: "pi-done",
    agentDir: "/tmp/pi",
    eventSeq: 3,
    lastError: null,
    eventLog: [
      {
        seq: 3,
        event: {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "done" },
        },
      },
    ],
  });

  assert.equal(status.running, true);
  assert.equal(status.active, false);
  assert.equal(runtimeStatusLooksActive(status), false);
});

test("runtime status stays active while a prompt is in flight", () => {
  const status = piStatusFromEvents({
    running: true,
    activePromptCount: 1,
    modelId: "deepseek-v4-flash",
    cwd: "/workspace",
    piSessionId: "pi-live",
    agentDir: "/tmp/pi",
    eventSeq: 2,
    lastError: null,
    eventLog: [
      {
        seq: 2,
        event: {
          type: "message_update",
          assistantMessageEvent: { type: "reasoning_delta", delta: "thinking" },
        },
      },
    ],
  });

  assert.equal(status.active, true);
  assert.equal(runtimeStatusLooksActive(status), true);
});

test("control routing uses active turn state, not runtime process existence", () => {
  assert.equal(
    controlTargetHasActiveTurn({ active: true, running: true }),
    true,
  );
  assert.equal(
    controlTargetHasActiveTurn({ active: false, running: true }),
    false,
  );
});

test("control status returns idle when a stale control is promoted to a prompt", () => {
  assert.equal(statusAfterControlPhase("idle", "starting"), "starting");
  assert.equal(statusAfterControlPhase("starting", "running"), "running");
  assert.equal(statusAfterControlPhase("running", "done"), "idle");
  assert.equal(
    statusAfterControlPhase("running", "done", { queuedControlAccepted: true }),
    "running",
  );
});

test("splitting a session is idempotent when navigating to an already open pi session", () => {
  const state = makeState(
    makeSession("s-main", {
      title: "Main",
      messages: [{ id: "u1", role: "user", text: "hi" }],
    }),
  );

  const split = reducer(state, {
    type: "splitPaneWithPayload",
    paneId: "p-main",
    direction: "vertical",
    side: "b",
    newPaneId: "p-side",
    runtimeSessionId: "rt-side",
    payload: {
      projectId: "personal",
      cwd: "/workspace/personal",
      piSessionId: "pi-live",
      title: "Live session",
    },
    tab: makeSession("s-side", { title: "Live session" }),
  });

  assert.deepEqual(collectLeaves(split.layout), ["p-main", "p-side"]);
  assert.equal(split.focusedPaneId, "p-side");
  assert.equal(split.sessions.get("s-side")?.piSessionId, "pi-live");

  const navigatedAgain = reducer(split, {
    type: "splitPaneWithPayload",
    paneId: "p-main",
    direction: "vertical",
    side: "b",
    newPaneId: "p-third",
    runtimeSessionId: "rt-third",
    payload: {
      projectId: "personal",
      cwd: "/workspace/personal",
      piSessionId: "pi-live",
      title: "Live session",
    },
    tab: makeSession("s-third"),
  });

  assert.deepEqual(collectLeaves(navigatedAgain.layout), ["p-main", "p-side"]);
  assert.equal(navigatedAgain.focusedPaneId, "p-side");
  assert.equal(navigatedAgain.panesById.has("p-third"), false);
});

test("forking a tab into a split pane copies session content with fresh identity", () => {
  const state = makeState(
    makeSession("s-main", {
      projectId: "personal",
      cwd: "/workspace/personal",
      modelId: "deepseek-v4-flash",
      piSessionId: "pi-source",
      title: "Source session",
      messages: [
        { id: "u1", role: "user", text: "build a thing" },
        { id: "a1", role: "assistant", text: "working" },
      ],
      queue: [{ id: "q1", mode: "follow_up", text: "continue" }],
      status: "running",
    }),
  );

  const forked = reducer(state, {
    type: "splitTab",
    sourcePaneId: "p-main",
    sourceTabId: "s-main",
    newPaneId: "p-fork",
    runtimeSessionId: "rt-fork-pane",
    tab: makeSession("s-fork", { runtimeSessionId: "rt-fork-session" }),
  });

  assert.deepEqual(collectLeaves(forked.layout), ["p-main", "p-fork"]);
  assert.equal(forked.focusedPaneId, "p-fork");
  assert.equal(forked.panesById.get("p-main")?.sessionId, "s-main");
  assert.equal(forked.panesById.get("p-fork")?.sessionId, "s-fork");

  const source = forked.sessions.get("s-main");
  const copy = forked.sessions.get("s-fork");
  assert.equal(copy?.id, "s-fork");
  assert.equal(copy?.runtimeSessionId, "rt-fork-session");
  assert.equal(copy?.piSessionId, "pi-source");
  assert.equal(copy?.projectId, source?.projectId);
  assert.equal(copy?.cwd, source?.cwd);
  assert.equal(copy?.modelId, source?.modelId);
  assert.deepEqual(copy?.messages, source?.messages);
  assert.deepEqual(copy?.queue, source?.queue);
});

test("forking while already split replaces the sibling pane instead of adding a third", () => {
  const split = reducer(
    makeState(
      makeSession("s-main", {
        title: "Main",
        messages: [{ id: "u1", role: "user", text: "hi" }],
      }),
    ),
    {
      type: "splitTab",
      sourcePaneId: "p-main",
      sourceTabId: "s-main",
      newPaneId: "p-side",
      runtimeSessionId: "rt-side-pane",
      tab: makeSession("s-side", { runtimeSessionId: "rt-side-session" }),
    },
  );

  const forkedAgain = reducer(split, {
    type: "splitTab",
    sourcePaneId: "p-side",
    sourceTabId: "s-side",
    newPaneId: "p-third",
    runtimeSessionId: "rt-third-pane",
    tab: makeSession("s-third", { runtimeSessionId: "rt-third-session" }),
  });

  assert.deepEqual(collectLeaves(forkedAgain.layout), ["p-main", "p-side"]);
  assert.equal(forkedAgain.focusedPaneId, "p-main");
  assert.equal(forkedAgain.panesById.has("p-third"), false);
  assert.equal(forkedAgain.panesById.get("p-main")?.sessionId, "s-third");
  assert.equal(forkedAgain.sessions.has("s-main"), false);
  assert.equal(
    forkedAgain.sessions.get("s-third")?.runtimeSessionId,
    "rt-third-session",
  );
});

test("follow-up queue drains after agent end while steer messages stay out of the next turn", async () => {
  let session = makeSession("s-main", {
    queue: [
      { id: "q-steer", mode: "steer", text: "adjust course" },
      { id: "q-next", mode: "follow_up", text: "next prompt" },
      { id: "q-after", mode: "follow_up", text: "after that" },
    ],
  });
  const scheduled: Array<() => void> = [];
  const submitted: unknown[] = [];

  drainQueuedTurnAfterAgentEnd(
    {
      tabsRef: {
        get current() {
          return [session];
        },
      },
      updateSession: (_sessionId, patch) => {
        session = patch(session);
      },
      schedule: (callback) => scheduled.push(callback),
      submitPromptRef: {
        current: async (args) => {
          submitted.push(args);
        },
      },
    },
    "s-main",
  );

  assert.deepEqual(session.queue, [
    { id: "q-after", mode: "follow_up", text: "after that" },
  ]);
  assert.equal(scheduled.length, 1);
  scheduled[0]?.();
  await Promise.resolve();
  assert.deepEqual(submitted, [
    {
      text: "next prompt",
      prompt: "next prompt",
      displayText: "next prompt",
      userText: "next prompt",
      targetSessionId: "s-main",
    },
  ]);
});

test("compaction events render as assistant event blocks", () => {
  const blocks = applyAssistantPiEventToBlocks([], {
    type: "context_compaction",
    summary: "Compacted the current plan and selected skills.",
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind, "event");
  assert.equal(
    blocks[0]?.text,
    "Compacted the current plan and selected skills.",
  );
});

test("text deltas stay visible answer text when partial history already has reasoning", () => {
  const event = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Here is the final answer.",
      contentIndex: 1,
      partial: {
        role: "assistant",
        reasoning_content: "I should inspect this first.",
        content: [
          {
            type: "reasoning",
            reasoning_content: "I should inspect this first.",
          },
          {
            type: "text",
            text: "Here is the final answer.",
          },
        ],
      },
    },
  };

  const blocks = applyAssistantPiEventToBlocks([], event);
  assert.equal(blocks?.[0]?.kind, "text");
  assert.equal(blocks?.[0]?.text, "Here is the final answer.");
  assert.deepEqual(textDeltaFromPiEvent(event), {
    kind: "text",
    delta: "Here is the final answer.",
  });
});

test("text deltas always render as visible text regardless of partial reasoning shape", () => {
  const event = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "I should inspect this first.",
      partial: {
        type: "reasoning",
        reasoning_content: "I should inspect this first.",
      },
    },
  };

  const blocks = applyAssistantPiEventToBlocks([], event);
  assert.equal(blocks?.[0]?.kind, "text");
  assert.equal(blocks?.[0]?.text, "I should inspect this first.");
  assert.deepEqual(textDeltaFromPiEvent(event), {
    kind: "text",
    delta: "I should inspect this first.",
  });
});

test("text deltas indexed to a reasoning content part still render as visible text", () => {
  const event = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "I should inspect this first.",
      contentIndex: 0,
      partial: {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            reasoning_content: "I should inspect this first.",
          },
        ],
      },
    },
  };

  const blocks = applyAssistantPiEventToBlocks([], event);
  assert.equal(blocks?.[0]?.kind, "text");
  assert.equal(blocks?.[0]?.text, "I should inspect this first.");
  assert.deepEqual(textDeltaFromPiEvent(event), {
    kind: "text",
    delta: "I should inspect this first.",
  });
});

test("explicit reasoning deltas render under reasoning", () => {
  const event = {
    type: "message_update",
    assistantMessageEvent: {
      type: "reasoning_delta",
      delta: "I should inspect this first.",
    },
  };

  const blocks = applyAssistantPiEventToBlocks([], event);
  assert.equal(blocks?.[0]?.kind, "thinking");
  assert.equal(blocks?.[0]?.text, "I should inspect this first.");
  assert.deepEqual(textDeltaFromPiEvent(event), {
    kind: "thinking",
    delta: "I should inspect this first.",
  });
});

test("text delta coalescer preserves alternating text and reasoning order", () => {
  const applied: Record<string, unknown>[] = [];
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, _assistantId, event) => {
      applied.push(event);
    },
    scheduleFrame: () => ({ cancel: () => {} }),
  });

  const event = (type: string, delta: string) => ({
    type: "message_update",
    assistantMessageEvent: { type, delta },
  });

  coalescer.enqueuePiEvent(
    "s-main",
    "a-main",
    event("text_delta", "Visible A."),
  );
  coalescer.enqueuePiEvent(
    "s-main",
    "a-main",
    event("reasoning_delta", "Thinking B."),
  );
  coalescer.enqueuePiEvent(
    "s-main",
    "a-main",
    event("text_delta", "Visible C."),
  );
  coalescer.flushNow("s-main");

  assert.deepEqual(
    applied.map((entry) => {
      const ame = entry.assistantMessageEvent as
        | Record<string, unknown>
        | undefined;
      return { type: ame?.type, delta: ame?.delta };
    }),
    [
      { type: "text_delta", delta: "Visible A." },
      { type: "thinking_delta", delta: "Thinking B." },
      { type: "text_delta", delta: "Visible C." },
    ],
  );
});

test("live pre-tool text stays visible when a tool call follows", () => {
  const textEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Let me inspect that first.",
      contentIndex: 0,
      partial: {
        role: "assistant",
        content: [{ type: "text", text: "Let me inspect that first." }],
      },
    },
  };
  const toolEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 1,
      toolCall: {
        id: "call-read",
        name: "read",
        arguments: { path: "/workspace/package.json" },
      },
    },
  };

  const textBlocks = applyAssistantPiEventToBlocks([], textEvent) ?? [];
  assert.equal(textBlocks[0]?.kind, "text");

  const blocks = applyAssistantPiEventToBlocks(textBlocks, toolEvent);
  assert.equal(blocks?.[0]?.kind, "text");
  assert.equal(blocks?.[0]?.text, "Let me inspect that first.");
  assert.equal(blocks?.[1]?.kind, "tool");
});

test("reasoning then content then tool keeps blocks in [thinking, text, tool] order", () => {
  const reasoningEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "reasoning_delta",
      delta: "Internal reasoning before the answer.",
    },
  };
  const textEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Here is the answer.",
    },
  };
  const toolEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      toolCall: {
        id: "call-read",
        name: "read",
        arguments: { path: "/workspace/file.txt" },
      },
    },
  };

  const afterReasoning =
    applyAssistantPiEventToBlocks([], reasoningEvent) ?? [];
  const afterText =
    applyAssistantPiEventToBlocks(afterReasoning, textEvent) ?? [];
  const blocks = applyAssistantPiEventToBlocks(afterText, toolEvent) ?? [];

  assert.equal(blocks[0]?.kind, "thinking");
  assert.equal(blocks[0]?.text, "Internal reasoning before the answer.");
  assert.equal(blocks[1]?.kind, "text");
  assert.equal(blocks[1]?.text, "Here is the answer.");
  assert.equal(blocks[2]?.kind, "tool");
});

test("late reasoning deltas move before visible text without splitting the answer", () => {
  const textStart = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Spec",
    },
  };
  const reasoningEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "reasoning_delta",
      delta: "The model reasoned before answering.",
    },
  };
  const textRest = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "ulative decoding optimizes inference latency.",
    },
  };

  const afterStart = applyAssistantPiEventToBlocks([], textStart) ?? [];
  const afterReasoning =
    applyAssistantPiEventToBlocks(afterStart, reasoningEvent) ?? [];
  const blocks = applyAssistantPiEventToBlocks(afterReasoning, textRest) ?? [];

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.kind, "thinking");
  assert.equal(blocks[0]?.text, "The model reasoned before answering.");
  assert.equal(blocks[1]?.kind, "text");
  assert.equal(
    blocks[1]?.text,
    "Speculative decoding optimizes inference latency.",
  );
});

test("tool_execution_start does not bury visible text into thinking", () => {
  const textBlocks =
    applyAssistantPiEventToBlocks([], {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "I'll run a quick check.",
      },
    }) ?? [];

  const blocks = applyAssistantPiEventToBlocks(textBlocks, {
    type: "tool_execution_start",
    toolCallId: "call-bash",
    toolName: "bash",
  });

  assert.equal(blocks?.[0]?.kind, "text");
  assert.equal(blocks?.[0]?.text, "I'll run a quick check.");
  assert.equal(blocks?.[1]?.kind, "tool");
});

test("replayed tool-use narration renders as reasoning, not visible answer text", () => {
  const { messages } = replaySessionEvents([
    {
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: "inspect the project" }],
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          {
            type: "text",
            text: "Now I need to inspect the package files before answering.",
          },
          {
            type: "toolCall",
            id: "call-read",
            name: "read",
            arguments: { path: "/workspace/package.json" },
          },
        ],
      },
    },
  ]);

  const assistant = messages.find((message) => message.role === "assistant");
  assert.equal(assistant?.text, "");
  assert.equal(assistant?.blocks?.[0]?.kind, "thinking");
  assert.match(assistant?.blocks?.[0]?.text ?? "", /inspect the package files/);
  assert.equal(assistant?.blocks?.[1]?.kind, "tool");
});

test("replay patches streamed assistant final messages instead of duplicating them", () => {
  const { messages } = replaySessionEvents([
    {
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: "inspect the project" }],
      },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "I will inspect first.",
      },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        toolCall: {
          id: "call-read",
          name: "read",
          arguments: { path: "/workspace/package.json" },
        },
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "text", text: "I will inspect first." },
          {
            type: "toolCall",
            id: "call-read",
            name: "read",
            arguments: { path: "/workspace/package.json" },
          },
        ],
      },
    },
  ]);

  const assistantMessages = messages.filter(
    (message) => message.role === "assistant",
  );
  assert.equal(assistantMessages.length, 1);
  assert.equal(assistantMessages[0]?.blocks?.[0]?.kind, "thinking");
  assert.equal(assistantMessages[0]?.blocks?.[1]?.kind, "tool");
});

test("live final assistant messages hydrate placeholders when no deltas streamed", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "define kv cache" },
        {
          id: "a-main",
          role: "assistant",
          text: "",
          blocks: [{ kind: "text", id: "text-loading", text: "…" }],
        },
      ],
      activeAssistantId: "a-main",
    }),
  );

  applyPiEventToSession(harness.deps, "s-main", "a-main", {
    type: "message",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "A KV cache stores prior attention keys and values so generation can reuse them.",
        },
      ],
    },
  });

  const assistant = harness
    .session()
    .messages.find((message) => message.id === "a-main");
  assert.equal(
    assistant?.text,
    "A KV cache stores prior attention keys and values so generation can reuse them.",
  );
  assert.equal(assistant?.blocks?.[0]?.kind, "text");
  assert.equal(
    assistant?.blocks?.[0]?.text,
    "A KV cache stores prior attention keys and values so generation can reuse them.",
  );
});

test("live final assistant messages do not duplicate streamed blocks", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "explain attention" },
        {
          id: "a-main",
          role: "assistant",
          text: "",
          blocks: [{ kind: "text", id: "text-1", text: "Already streamed." }],
        },
      ],
      activeAssistantId: "a-main",
    }),
  );

  applyPiEventToSession(harness.deps, "s-main", "a-main", {
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Already streamed." }],
    },
  });

  const assistant = harness
    .session()
    .messages.find((message) => message.id === "a-main");
  assert.equal(assistant?.blocks?.length, 1);
  assert.equal(assistant?.blocks?.[0]?.kind, "text");
  assert.equal(assistant?.blocks?.[0]?.text, "Already streamed.");
});

test("live final assistant messages reconcile partial streamed text", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "define speculative decoding" },
        {
          id: "a-main",
          role: "assistant",
          text: "",
          blocks: [{ kind: "text", id: "text-1", text: "Spec" }],
        },
      ],
      activeAssistantId: "a-main",
    }),
  );

  applyPiEventToSession(harness.deps, "s-main", "a-main", {
    type: "message",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Speculative decoding optimizes inference latency.",
        },
        {
          type: "thinking",
          thinking:
            "The model reasoned before answering, even if the final payload listed it second.",
        },
      ],
    },
  });

  const assistant = harness
    .session()
    .messages.find((message) => message.id === "a-main");
  assert.equal(assistant?.blocks?.length, 2);
  assert.equal(assistant?.blocks?.[0]?.kind, "thinking");
  assert.equal(
    assistant?.blocks?.[0]?.text,
    "The model reasoned before answering, even if the final payload listed it second.",
  );
  assert.equal(assistant?.blocks?.[1]?.kind, "text");
  assert.equal(
    assistant?.blocks?.[1]?.text,
    "Speculative decoding optimizes inference latency.",
  );
});

test("skill mentions and selected skill context survive composer prompt construction", () => {
  const mention = detectComposerMention("use $browser", "use $browser".length);
  const skills = [
    {
      id: "skill-browser",
      name: "browser",
      path: "/skills/browser",
      instructions: "Use browser tools.",
    },
  ];

  assert.deepEqual(mention, {
    kind: "skill",
    query: "browser",
    start: 4,
    end: 12,
  });
  assert.match(
    selectedContextPrompt("open the page", [], skills),
    /Loaded skills:/,
  );
  assert.match(
    selectedContextPrompt("open the page", [], skills),
    /Use browser tools/,
  );
  assert.match(
    selectedContextInstructions([], skills),
    /Preserve this selected composer context/,
  );
});
