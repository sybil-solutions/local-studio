import assert from "node:assert/strict";
import test from "node:test";
import { convertMessages } from "@earendil-works/pi-ai/openai-completions";
import {
  initialRuntimeStatusPhase,
  replayAfterCursor,
  shouldSendTrailingIdleStatus,
} from "@local-studio/agent-runtime/http/stream-order";
import {
  detectComposerMention,
  selectedContextInstructions,
  selectedContextPrompt,
} from "@/features/agent/composer-context";
import { parseAgentTurnCommandResult } from "@/features/agent/contracts";
import { findRuntimeSessionForLookup } from "@local-studio/agent-runtime/pi-runtime-state";
import { piStatusFromEvents } from "@local-studio/agent-runtime/pi-runtime-state";
import { shouldRestartAfterPromptError } from "@local-studio/agent-runtime/pi-runtime";
import { inferVisionSupport, normalizeOpenAIModels } from "@/features/agent/models";
import { modelsToPiModels } from "@local-studio/agent-runtime/pi-runtime-models";
import { applyAssistantPiEventToBlocks } from "@/features/agent/messages/block-event";
import { runtimeStatusLooksActive, visibleUserTextFromPi } from "@/features/agent/messages/helpers";
import {
  foldSessionEvents,
  reduceSessionEvent,
  type SessionStreamContext,
} from "@/features/agent/runtime/pi-event-applier";
import type { Session } from "@/features/agent/runtime/types";
import { blocksFromTurnSnapshots } from "@/features/agent/messages/message-content";
import { drainQueueAfterAgentEnd } from "@/features/agent/messages/helpers";
import {
  createEffectTextDeltaCoalescer as createTextDeltaCoalescer,
  textDeltaFromPiEvent,
} from "@/features/agent/runtime/effect-coalescer";
import { isEmptyStarterSession, pruneSessions } from "@/features/agent/runtime/store";
import { beginSessionSubmit, endSessionSubmit } from "@/features/agent/runtime/prompt-stream";
import {
  controlTargetHasActiveTurn,
  referencedSessionIds,
} from "@/features/agent/runtime/selectors";
import {
  acceptRuntimeSeq,
  adoptExternalCursor,
  shouldSubscribeRuntimeEvents,
} from "@/features/agent/runtime/runtime-cursor";
import { workspaceCommands } from "@/features/agent/workspace/commands";
import { reducer } from "@/features/agent/workspace/reducer";
import type { WorkspaceAction, WorkspaceState } from "@/features/agent/workspace/types";
import { collectLeaves } from "@/features/agent/workspace/layout";
import { groupAssistantBlocks } from "@/features/agent/ui/timeline/activity-grouping";
import { resolveStatusSectionView } from "@/features/dashboard/control-panel/status-section-view";
import { makePiEventApplierHarness, makeSession, makeState } from "./agent-fixtures";

test("status metrics fall back to stored peaks when current session peaks are absent", () => {
  const view = resolveStatusSectionView({
    currentProcess: {
      pid: 123,
      backend: "vllm",
      model_path: "/models/nemotron-3-ultra",
      served_model_name: "nemotron-3-ultra",
      port: 8000,
    },
    currentRecipe: null,
    gpus: [],
    metrics: {
      generation_throughput: 0,
      prompt_throughput: 0,
      avg_ttft_ms: 102_704.8,
      best_session_generation_tps: 137.4226,
      best_session_prefill_tps: 62_245.2748,
      best_session_ttft_ms: 931.115,
      peak_generation_tps: 137.4226,
      peak_prefill_tps: 62_245.2748,
      peak_ttft_ms: 78.58,
    },
  });

  assert.equal(view.metricColumns[0]?.value, "0.0");
  assert.equal(view.metricColumns[0]?.detail, "max 137.4");
  assert.equal(view.metricColumns[2]?.detail, "max 62245.3");
  assert.equal(view.metricColumns[1]?.detail, "best 931 ms");
  assert.match(view.metricColumns[1]?.detailTitle ?? "", /all-time best: 79 ms/);
  assert.equal(view.sampleInput.generationPeak, 137.4226);
  assert.equal(view.sampleInput.prefillPeak, 62_245.2748);
  assert.equal(view.sampleInput.ttftPeak, 931.115);
});

test("turn command result parser preserves runtime status", () => {
  const payload = parseAgentTurnCommandResult({
    type: "command",
    outcome: "accepted",
    // Wire field of the /turn response (server echoes the opaque runtime key).
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    active: true,
    status: {
      active: true,
      piSessionId: "pi-1",
      contextUsage: null,
    },
  });

  assert.equal(payload?.outcome, "accepted");
  assert.equal(payload?.runtimeSessionId, "rt-1");
  assert.equal(payload?.status?.active, true);
  assert.equal(payload?.status?.contextUsage, null);
});

test("invalid assistant continuations restart with a fresh Pi session", () => {
  assert.equal(
    shouldRestartAfterPromptError(new Error("Cannot continue from message role: assistant")),
    true,
  );
  assert.equal(shouldRestartAfterPromptError(new Error("Upstream connection failed")), false);
});

test("new chat url navigation opens a fresh runtime in a new split pane", () => {
  const oldSession = makeSession("s-old", {
    piSessionId: "pi-old",
    title: "Old debugging chat",
    status: "running",
    startedAt: "2026-05-28T12:00:00.000Z",
    activeAssistantId: "a-old",
    lastEventSeq: 12,
    input: "draft stuck on old chat",
  });
  const freshSession = makeSession("s-fresh", {
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
    tab: freshSession,
  });

  // The focused pane held a real (non-starter) chat, so the new chat must
  // appear on a visibly NEW surface: a split pane that takes focus. Replacing
  // the focused pane in place looked like the + button did nothing.
  const newPane = next.panesById.get("p-url-new");
  assert.equal(newPane?.sessionId, "s-fresh");
  assert.equal(next.focusedPaneId, "p-url-new");
  assert.equal(next.sessions.get("s-fresh")?.id, "s-fresh");
  // The previous chat was mid-turn (status: running). Starting a new chat must
  // NOT destroy it — it keeps streaming in its own pane and stays reachable.
  assert.equal(next.panesById.get("p-main")?.sessionId, "s-old");
  assert.equal(next.sessions.has("s-old"), true);
  assert.equal(next.sessions.get("s-old")?.status, "running");
  const active = next.sessions.get("s-fresh");
  assert.equal(active?.title, "New session");
  assert.equal(active?.piSessionId, null);
  assert.equal(active?.status, "idle");
  assert.equal(active?.input, "");
  assert.equal(active?.modelId, "model-a");
});

test("active local sidebar rows focus by pane and tab without cloning identity", () => {
  // Sidebar commands dispatch directly into the bound workspace; while
  // unbound (workspace unmounted) they no-op silently, matching the old
  // no-listener window-event semantics.
  const actions: WorkspaceAction[] = [];
  workspaceCommands().focusSession("p-unbound", "s-unbound");
  assert.equal(actions.length, 0);

  workspaceCommands().bind((action) => actions.push(action));
  workspaceCommands().focusSession("p-main", "s-local");
  workspaceCommands().renameSession("p-main", "s-local", "Renamed chat");
  workspaceCommands().renameSession("p-main", "s-local", "   ");
  workspaceCommands().unbind();
  workspaceCommands().focusSession("p-main", "s-local");

  assert.deepEqual(actions, [
    {
      type: "focusPaneSession",
      paneId: "p-main",
      sessionId: "s-local",
      replaceWorkspace: undefined,
    },
    {
      type: "renameTab",
      paneId: "p-main",
      tabId: "s-local",
      title: "Renamed chat",
    },
  ]);
});

test("focus session can collapse split panes for sidebar replacement opens", () => {
  const main = makeSession("s-main", { piSessionId: "pi-main" });
  const side = makeSession("s-side", { piSessionId: "pi-side" });
  const state: WorkspaceState = {
    ...makeState(main),
    sessions: new Map([
      [main.id, main],
      [side.id, side],
    ]),
    layout: {
      kind: "split",
      direction: "vertical",
      ratio: 0.5,
      a: { kind: "leaf", paneId: "p-main" },
      b: { kind: "leaf", paneId: "p-side" },
    },
    panesById: new Map([
      ["p-main", { sessionId: main.id }],
      ["p-side", { sessionId: side.id }],
    ]),
    focusedPaneId: "p-main",
  };

  const next = reducer(state, {
    type: "focusPaneSession",
    paneId: "p-side",
    sessionId: "s-side",
    replaceWorkspace: true,
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-side"]);
  assert.equal(next.focusedPaneId, "p-side");
  assert.equal(next.panesById.size, 1);
  assert.equal(next.panesById.get("p-side")?.sessionId, "s-side");
  assert.equal(next.sessions.has("s-main"), false);
  assert.equal(next.sessions.has("s-side"), true);
});

test("new chat replaces an empty starter with fresh identity", () => {
  const starter = makeSession("s-starter", {
    title: "Old chat title",
    status: "done",
    error: "old error",
    tokenStats: { read: 1, write: 2, current: 3 },
    contextUsage: {
      tokens: 3,
      contextWindow: 10,
      percent: 30,
      shouldCompact: false,
    },
    usedSkills: [{ id: "skill-old", name: "Old skill" }],
  });

  assert.equal(isEmptyStarterSession(starter), true);

  const next = reducer(makeState(starter), {
    type: "urlNavRequested",
    key: "nav-new-chat",
    project: null,
    newSession: true,
    paneId: "p-new",
    tab: makeSession("s-fresh"),
  });

  const active = next.sessions.get(next.panesById.get("p-main")?.sessionId ?? "");
  assert.equal(active?.id, "s-fresh");
  assert.equal(next.sessions.has("s-starter"), false);
  assert.equal(active?.title, "New session");
  assert.equal(active?.status, "idle");
  assert.equal(active?.error, "");
  assert.equal(active?.tokenStats, undefined);
  assert.equal(active?.contextUsage, undefined);
  assert.equal(active?.usedSkills, undefined);
});

test("pruning keeps still-working sessions that lost their pane but drops settled ones", () => {
  const running = makeSession("s-running", { status: "running" });
  const starting = makeSession("s-starting", { status: "starting" });
  const settled = makeSession("s-settled", { status: "done" });
  const inPane = makeSession("s-inpane", { status: "idle" });
  const sessions = new Map([
    [running.id, running],
    [starting.id, starting],
    [settled.id, settled],
    [inPane.id, inPane],
  ]);

  // Only the pane session is referenced — the others were navigated away from.
  const pruned = pruneSessions(sessions, new Set([inPane.id]));

  assert.equal(pruned.has("s-inpane"), true);
  // Background turns survive the prune so they keep streaming and stay
  // re-openable from the sidebar.
  assert.equal(pruned.has("s-running"), true);
  assert.equal(pruned.has("s-starting"), true);
  // A settled orphan is still collected.
  assert.equal(pruned.has("s-settled"), false);

  // Once a kept background session settles, a later pass removes it.
  const afterSettle = pruneSessions(
    new Map([...pruned, ["s-running", { ...running, status: "done" as const }]]),
    new Set([inPane.id]),
  );
  assert.equal(afterSettle.has("s-running"), false);
  assert.equal(afterSettle.has("s-starting"), true);
});

test("referenced session ids reflect only sessions mounted in panes", () => {
  const state = makeState(makeSession("s-main"));
  assert.deepEqual([...referencedSessionIds(state)], ["s-main"]);
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

test("session replay into a starter adopts cwd and model metadata", () => {
  const next = reducer(makeState(), {
    type: "urlNavRequested",
    key: "nav-replay",
    project: null,
    sessionId: "pi-replay",
    paneId: "p-replay",
    tab: makeSession("tab-replay", {
      cwd: "/Users/sero/.local-studio",
      modelId: "nemotron-3-ultra",
      title: "Persisted replay",
      startedAt: "2026-06-08T04:00:00.000Z",
    }),
  });

  const active = next.sessions.get(next.panesById.get("p-main")?.sessionId ?? "");
  assert.equal(active?.piSessionId, "pi-replay");
  assert.equal(active?.cwd, "/Users/sero/.local-studio");
  assert.equal(active?.modelId, "nemotron-3-ultra");
  assert.equal(active?.startedAt, "2026-06-08T04:00:00.000Z");
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

test("runtime status stays active while SDK is streaming after prompt handoff", () => {
  const status = piStatusFromEvents({
    running: true,
    activePromptCount: 0,
    sdkActive: true,
    modelId: "deepseek-v4-flash",
    cwd: "/workspace",
    piSessionId: "pi-live",
    agentDir: "/tmp/pi",
    eventSeq: 2,
    lastError: null,
    eventLog: [],
  });

  assert.equal(status.active, true);
  assert.equal(runtimeStatusLooksActive(status), true);
});

test("runtime lookup by unknown pi session does not create an empty runtime", () => {
  const sessions = [
    {
      sessionId: "rt-existing",
      session: { status: { piSessionId: "pi-existing" } },
    },
  ];
  const before = sessions.length;
  const resolved = findRuntimeSessionForLookup(
    sessions,
    "rt-missing-for-test",
    "pi-missing-for-test",
  );
  const after = sessions.length;

  assert.equal(resolved, null);
  assert.equal(after, before);
});

test("runtime lookup prefers the exact local session over an older pi match", () => {
  const sessions = [
    {
      sessionId: "rt-old",
      session: { status: { piSessionId: "pi-shared" }, marker: "old" },
    },
    {
      sessionId: "rt-current",
      session: { status: { piSessionId: "pi-shared" }, marker: "current" },
    },
  ];

  const resolved = findRuntimeSessionForLookup(sessions, "rt-current", "pi-shared");

  assert.equal(resolved?.session.marker, "current");
});

test("runtime lookup prefers an active pi match over an idle local alias", () => {
  const sessions = [
    {
      sessionId: "rt-current",
      session: { status: { piSessionId: "pi-shared", active: false }, marker: "idle" },
    },
    {
      sessionId: "rt-live",
      session: { status: { piSessionId: "pi-shared", active: true }, marker: "live" },
    },
  ];

  const resolved = findRuntimeSessionForLookup(sessions, "rt-current", "pi-shared");

  assert.equal(resolved?.session.marker, "live");
});

test("runtime lookup never routes a persistent thread to an exact alias for another thread", () => {
  const sessions = [
    {
      sessionId: "rt-current",
      session: { status: { piSessionId: "pi-old", active: true }, marker: "wrong" },
    },
    {
      sessionId: "rt-other",
      session: { status: { piSessionId: "pi-target", active: false }, marker: "target" },
    },
  ];

  const resolved = findRuntimeSessionForLookup(sessions, "rt-current", "pi-target");

  assert.equal(resolved?.session.marker, "target");
});

test("finished runtime event streams replay missed pi events before idle status", () => {
  assert.equal(initialRuntimeStatusPhase(false, 3), null);
  assert.equal(
    shouldSendTrailingIdleStatus({
      active: false,
      replayBacklogCount: 3,
      sentTerminalStatus: false,
    }),
    true,
  );
  assert.equal(initialRuntimeStatusPhase(false, 0), "idle");
  assert.equal(initialRuntimeStatusPhase(true, 3), "running");
  assert.equal(
    shouldSendTrailingIdleStatus({
      active: false,
      replayBacklogCount: 3,
      sentTerminalStatus: true,
    }),
    false,
  );
});

test("runtime event streams restart replay when SDK event sequence resets", () => {
  assert.equal(replayAfterCursor(42, 38), 0);
  assert.equal(replayAfterCursor(42, 42), 42);
  assert.equal(replayAfterCursor(0, 38), 0);
});

test("runtime event subscriptions wait for accepted running turns", () => {
  assert.equal(shouldSubscribeRuntimeEvents("starting"), false);
  assert.equal(shouldSubscribeRuntimeEvents("running"), true);
  assert.equal(shouldSubscribeRuntimeEvents("idle"), false);
});

test("runtime event cursor resets for a new prompt on the same Pi session", () => {
  const staleCursor = adoptExternalCursor(43);
  assert.equal(acceptRuntimeSeq(staleCursor, 28).accept, false);

  const resetCursor = adoptExternalCursor(0);
  const decision = acceptRuntimeSeq(resetCursor, 1);
  assert.equal(decision.accept, true);
  assert.equal(decision.cursor.receivedSeq, 1);
});

test("control routing uses active turn state, not runtime process existence", () => {
  assert.equal(controlTargetHasActiveTurn({ active: true, running: true }), true);
  assert.equal(controlTargetHasActiveTurn({ active: false, running: true }), false);
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
    tab: makeSession("s-fork"),
  });

  assert.deepEqual(collectLeaves(forked.layout), ["p-main", "p-fork"]);
  assert.equal(forked.focusedPaneId, "p-fork");
  assert.equal(forked.panesById.get("p-main")?.sessionId, "s-main");
  assert.equal(forked.panesById.get("p-fork")?.sessionId, "s-fork");

  const source = forked.sessions.get("s-main");
  const copy = forked.sessions.get("s-fork");
  assert.equal(copy?.id, "s-fork");
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
      tab: makeSession("s-side"),
    },
  );

  const forkedAgain = reducer(split, {
    type: "splitTab",
    sourcePaneId: "p-side",
    sourceTabId: "s-side",
    newPaneId: "p-third",
    tab: makeSession("s-third"),
  });

  assert.deepEqual(collectLeaves(forkedAgain.layout), ["p-main", "p-side"]);
  assert.equal(forkedAgain.focusedPaneId, "p-main");
  assert.equal(forkedAgain.panesById.has("p-third"), false);
  assert.equal(forkedAgain.panesById.get("p-main")?.sessionId, "s-third");
  assert.equal(forkedAgain.sessions.has("s-main"), false);
  assert.equal(forkedAgain.sessions.get("s-third")?.id, "s-third");
});

test("follow-up queue drains after agent end while steer messages stay out of the next turn", () => {
  // Pi drains its own follow_up queue server-side; the client reconciles the
  // visible queue: the drained head leaves, later unsent follow-ups stay, and
  // steer items never carry into the next turn.
  const { next, remaining } = drainQueueAfterAgentEnd([
    { id: "q-steer", mode: "steer", text: "adjust course" },
    { id: "q-next", mode: "follow_up", text: "next prompt" },
    { id: "q-after", mode: "follow_up", text: "after that" },
  ]);

  assert.equal(next?.text, "next prompt");
  assert.deepEqual(remaining, [{ id: "q-after", mode: "follow_up", text: "after that" }]);
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

test("incremental text deltas keep markdown table separators (no prefix-drop)", () => {
  // Reproduces the table-mangling bug: when the model streams a markdown table
  // as per-token deltas, row-leading "| " and repeated "| --- |" pieces are
  // prefixes of the already-accumulated text. The old prefix-drop heuristic in
  // appendToTextLikeBlock silently swallowed them, collapsing the table so
  // remark-gfm no longer parsed it. Every delta must now survive verbatim.
  const table = "| Name | Age |\n| --- | --- |\n| Al | 30 |\n";
  const deltas = [
    "| Name ",
    "| Age ",
    "|\n",
    "| ", // prefix of accumulated "| Name ..." — old code dropped this
    "--- ",
    "| ",
    "--- ",
    "|\n",
    "| Al ",
    "| 30 ",
    "|\n",
  ];
  assert.equal(deltas.join(""), table, "test deltas must reconstruct the table");

  let blocks = applyAssistantPiEventToBlocks([], {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: deltas[0] },
  });
  for (const delta of deltas.slice(1)) {
    blocks = applyAssistantPiEventToBlocks(blocks ?? [], {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta },
    });
  }
  assert.equal(blocks?.[0]?.kind, "text");
  assert.equal(blocks?.[0]?.text, table);
});

test("incremental text deltas never drop a repeated leading word (no mid-line loss)", () => {
  // "Total" recurs as the first token of a later line while still a prefix of
  // the whole accumulated block; the old dedup dropped it, turning
  // "Total sales\nTotal = 9" into "Total sales\n = 9".
  const deltas = ["Total", " sales\n", "Total", " = 9"];
  let blocks: ReturnType<typeof applyAssistantPiEventToBlocks> = [];
  for (const delta of deltas) {
    blocks = applyAssistantPiEventToBlocks(blocks ?? [], {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta },
    });
  }
  assert.equal(blocks?.[0]?.text, "Total sales\nTotal = 9");
});

test("foldSessionEvents reattaching a streaming table preserves every pipe and newline", () => {
  // Replay (reload/navigate onto a still-streaming turn) routes runtime-log
  // message_update events through appendDelta, the only path that reaches the
  // formerly-buggy code. The reattached table must be byte-identical.
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
  const deltas = ["| A ", "| B ", "|\n", "| ", "--- ", "| ", "--- ", "|\n", "| 1 ", "| 2 ", "|\n"];
  assert.equal(deltas.join(""), table);
  const events = deltas.map((delta) => ({
    type: "message_update" as const,
    assistantMessageEvent: { type: "text_delta", delta },
  }));

  const { messages } = foldSessionEvents(events);
  const assistant = messages.find((message) => message.role === "assistant");
  const textBlock = assistant?.blocks?.find((block) => block.kind === "text");
  assert.equal(textBlock?.text, table);
});

test("replay rebuilds a streaming table from message snapshots, matching its settled form", () => {
  // The realistic pi shape: every message_update carries the FULL accumulated
  // assistant message in event.message.content. Replay must rebuild the bubble
  // from that snapshot (lossless) and produce the SAME result as the settled
  // `message` event — proving the reattach path and the settled path converge.
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
  const growing = [
    "| A | B |\n",
    "| A | B |\n| --- | --- |\n",
    "| A | B |\n| --- | --- |\n| 1 | 2 |\n",
  ];
  const streamingEvents = growing.map((accumulated) => ({
    type: "message_update" as const,
    assistantMessageEvent: { type: "text_delta", delta: "…" },
    message: { role: "assistant", content: [{ type: "text", text: accumulated }] },
  }));

  const reattached = foldSessionEvents(streamingEvents);
  const reattachedText = reattached.messages
    .find((message) => message.role === "assistant")
    ?.blocks?.find((block) => block.kind === "text")?.text;
  assert.equal(reattachedText, table, "reattached streaming table must be lossless");

  const settled = foldSessionEvents([
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: table }] } },
  ]);
  const settledText = settled.messages
    .find((message) => message.role === "assistant")
    ?.blocks?.find((block) => block.kind === "text")?.text;
  assert.equal(reattachedText, settledText, "reattach path must equal the settled path");
});

test("text delta coalescer preserves alternating text and reasoning order", () => {
  const applied: Record<string, unknown>[] = [];
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, event) => {
      applied.push(event);
    },
    scheduleFrame: () => ({ cancel: () => {} }),
  });

  const event = (type: string, delta: string) => ({
    type: "message_update",
    assistantMessageEvent: { type, delta },
  });

  coalescer.enqueuePiEvent("s-main", event("text_delta", "Visible A."));
  coalescer.enqueuePiEvent("s-main", event("reasoning_delta", "Thinking B."));
  coalescer.enqueuePiEvent("s-main", event("text_delta", "Visible C."));
  coalescer.flushNow("s-main");

  assert.deepEqual(
    applied.map((entry) => {
      const ame = entry.assistantMessageEvent as Record<string, unknown> | undefined;
      return { type: ame?.type, delta: ame?.delta };
    }),
    [
      { type: "text_delta", delta: "Visible A." },
      { type: "thinking_delta", delta: "Thinking B." },
      { type: "text_delta", delta: "Visible C." },
    ],
  );
});

test("final answer snapshots preserve paragraph and list boundaries between text parts", () => {
  // Snapshots now carry the model's whitespace verbatim (the controller no
  // longer drops repeated-prefix tokens), so adjacent text parts concatenate
  // exactly — no boundary guessing.
  const parts = [
    "The lamp looks static.\n\n",
    "Specific things that feel wrong:\n",
    "- The wax is one continuous blob.\n",
    "- There is no visible liquid medium.\n\n",
    "So: the wax behavior is the biggest problem.",
  ];
  const blocks = blocksFromTurnSnapshots([parts.map((text) => ({ type: "text", text }))]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind === "text" ? blocks[0].text : "", parts.join(""));
});

test("final answer snapshots concatenate text parts verbatim without synthesizing whitespace", () => {
  const parts = ["Examples:\n- ", "General software engineering skills.\n- ", "UI/docs skills."];
  const blocks = blocksFromTurnSnapshots([parts.map((text) => ({ type: "text", text }))]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind === "text" ? blocks[0].text : "", parts.join(""));
});

test("final answer snapshot merge keeps word continuations together", () => {
  const blocks = blocksFromTurnSnapshots([
    [
      { type: "text", text: "Spec" },
      { type: "text", text: "ulative decoding optimizes inference latency." },
    ],
  ]);

  assert.equal(
    blocks[0]?.kind === "text" ? blocks[0].text : "",
    "Speculative decoding optimizes inference latency.",
  );
});

test("live pre-tool text collapses with the following tool call", () => {
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
  assert.equal(blocks?.[0]?.kind, "thinking");
  assert.equal(blocks?.[0]?.text, "Let me inspect that first.");
  assert.equal(blocks?.[1]?.kind, "tool");
});

test("tool call deltas use pi-provided partial arguments", () => {
  const findTool = (blocks: NonNullable<ReturnType<typeof applyAssistantPiEventToBlocks>>) =>
    blocks.find((block) => block.kind === "tool");
  let blocks =
    applyAssistantPiEventToBlocks([], {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        toolCallId: "call-write",
        toolName: "write_file",
        delta: '{"path":"/tmp',
        partial: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-write",
              name: "write_file",
              arguments: { path: "/tmp" },
            },
          ],
        },
      },
    }) ?? [];

  let tool = findTool(blocks);
  assert.equal(tool?.kind, "tool");
  assert.equal(tool?.kind === "tool" ? tool.args?.path : undefined, "/tmp");

  blocks =
    applyAssistantPiEventToBlocks(blocks, {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        toolCallId: "call-write",
        toolName: "write_file",
        delta: '/file.txt","content":"hello',
        partial: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-write",
              name: "write_file",
              arguments: { path: "/tmp/file.txt", content: "hello" },
            },
          ],
        },
      },
    }) ?? [];

  tool = findTool(blocks);
  assert.equal(tool?.kind, "tool");
  assert.equal(tool?.kind === "tool" ? tool.args?.path : undefined, "/tmp/file.txt");
  assert.equal(tool?.kind === "tool" ? tool.args?.content : undefined, "hello");
});

test("live assistant snapshots keep streaming file tool previews from partial tool calls", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "create a file" },
        { id: "a-main", role: "assistant", text: "", blocks: [] },
      ],
      activeAssistantId: "a-main",
    }),
  );

  harness.apply("s-main", "a-main", {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "I'll create it." }],
    },
    assistantMessageEvent: {
      type: "toolcall_delta",
      toolCallId: "call-create",
      toolName: "createfile",
      delta: '{"path":"/tmp/demo.txt","content":"hel',
      partial: {
        role: "assistant",
        content: [
          { type: "text", text: "I'll create it." },
          {
            type: "toolCall",
            id: "call-create",
            name: "createfile",
            arguments: { path: "/tmp/demo.txt", content: "hel" },
          },
        ],
      },
    },
  });

  harness.apply("s-main", "a-main", {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "I'll create it." }],
    },
    assistantMessageEvent: {
      type: "toolcall_delta",
      toolCallId: "call-create",
      toolName: "createfile",
      delta: 'lo"}',
      partial: {
        role: "assistant",
        content: [
          { type: "text", text: "I'll create it." },
          {
            type: "toolCall",
            id: "call-create",
            name: "createfile",
            arguments: { path: "/tmp/demo.txt", content: "hello" },
          },
        ],
      },
    },
  });

  const assistant = harness.session().messages.find((message) => message.id === "a-main");
  const tool = assistant?.blocks?.find((block) => block.kind === "tool");
  assert.equal(tool?.kind, "tool");
  assert.equal(tool?.kind === "tool" ? tool.name : undefined, "createfile");
  assert.equal(tool?.kind === "tool" ? tool.args?.path : undefined, "/tmp/demo.txt");
  assert.equal(tool?.kind === "tool" ? tool.args?.content : undefined, "hello");
});

test("live assistant snapshots preserve legacy tool-call argument deltas", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "create a file" },
        { id: "a-main", role: "assistant", text: "", blocks: [] },
      ],
      activeAssistantId: "a-main",
    }),
  );

  for (const delta of ['{"path":"/tmp/demo.txt","content":"hel', 'lo"}']) {
    harness.apply("s-main", "a-main", {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "I'll create it." }],
      },
      assistantMessageEvent: {
        type: "toolcall_delta",
        toolCallId: "call-create",
        toolName: "createfile",
        delta,
      },
    });
  }

  const assistant = harness.session().messages.find((message) => message.id === "a-main");
  const tool = assistant?.blocks?.find((block) => block.kind === "tool");
  assert.equal(tool?.kind, "tool");
  assert.equal(
    tool?.kind === "tool" ? tool.argsText : undefined,
    '{"path":"/tmp/demo.txt","content":"hello"}',
  );
});

test("vllm pi model config uses pi openai-compatible parsing without reasoning controls", () => {
  const [model] = modelsToPiModels([
    {
      id: "step-3.7-flash",
      name: "Step 3.7 Flash",
      provider: "local-studio",
      contextWindow: 262_144,
      maxTokens: 65_536,
      reasoning: true,
      vision: true,
      active: true,
    },
  ]);

  assert.equal(model?.compat?.supportsDeveloperRole, false);
  assert.equal(model?.compat?.supportsReasoningEffort, false);
  assert.equal(model?.compat?.maxTokensField, "max_tokens");
  assert.equal(model?.compat?.supportsUsageInStreaming, true);
});

test("nex n2 models infer vision support from sparse openai model rows", () => {
  const [model] = normalizeOpenAIModels({
    data: [
      {
        id: "nex-n2-pro",
        object: "model",
        max_model_len: 262_144,
      },
    ],
  });

  assert.equal(model?.vision, true);
  assert.deepEqual(modelsToPiModels(model ? [model] : [])[0]?.input, ["text", "image"]);
});

test("step 3.7 flash models infer vision support from sparse openai model rows", () => {
  const [model] = normalizeOpenAIModels({
    data: [
      {
        id: "step-3.7-flash",
        object: "model",
        max_model_len: 262_144,
      },
    ],
  });

  assert.equal(inferVisionSupport("step-3.7-flash"), true);
  assert.equal(model?.vision, true);
  assert.deepEqual(modelsToPiModels(model ? [model] : [])[0]?.input, ["text", "image"]);
});

test("vllm pi openai serialization keeps tool calls out of assistant content", () => {
  const [model] = modelsToPiModels([
    {
      id: "nex-n2-pro",
      name: "Nex N2 Pro",
      provider: "local-studio",
      contextWindow: 262_144,
      maxTokens: 65_536,
      reasoning: true,
      vision: false,
      active: true,
    },
  ]);
  assert.ok(model);

  const compat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    maxTokensField: "max_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    requiresReasoningContentOnAssistantMessages: false,
    thinkingFormat: "openai",
    openRouterRouting: {},
    vercelGatewayRouting: {},
    zaiToolStream: false,
    supportsStrictMode: false,
    sendSessionAffinityHeaders: false,
    supportsLongCacheRetention: true,
  } as Parameters<typeof convertMessages>[2];

  const messages = convertMessages(
    model as Parameters<typeof convertMessages>[0],
    {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-write",
              name: "write",
              arguments: { path: "/tmp/file.txt", content: "hello" },
            },
          ],
          api: "openai-completions",
          provider: "local-studio",
          model: "nex-n2-pro",
          stopReason: "toolUse",
          timestamp: Date.now(),
        },
        {
          role: "toolResult",
          toolCallId: "call-write",
          toolName: "write",
          content: [{ type: "text", text: "Successfully wrote /tmp/file.txt" }],
          isError: false,
          timestamp: Date.now(),
        },
        {
          role: "user",
          content: "What did you change?",
          timestamp: Date.now(),
        },
      ],
    } as Parameters<typeof convertMessages>[1],
    compat,
  );

  assert.equal(messages.length, 3);
  const assistant = messages[0] as Record<string, unknown>;
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.content, null);
  assert.deepEqual(assistant.tool_calls, [
    {
      id: "call-write",
      type: "function",
      function: {
        name: "write",
        arguments: JSON.stringify({ path: "/tmp/file.txt", content: "hello" }),
      },
    },
  ]);
  assert.equal((messages[1] as Record<string, unknown>).role, "tool");
  assert.equal((messages[1] as Record<string, unknown>).tool_call_id, "call-write");
  assert.equal((messages[2] as Record<string, unknown>).role, "user");
});

test("vllm pi openai serialization preserves assistant text part boundaries", () => {
  const [model] = modelsToPiModels([
    {
      id: "nex-n2-pro",
      name: "Nex N2 Pro",
      provider: "local-studio",
      contextWindow: 262_144,
      maxTokens: 65_536,
      reasoning: false,
      vision: false,
      active: true,
    },
  ]);
  assert.ok(model);

  const compat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    maxTokensField: "max_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    requiresReasoningContentOnAssistantMessages: false,
    thinkingFormat: "openai",
    openRouterRouting: {},
    vercelGatewayRouting: {},
    zaiToolStream: false,
    supportsStrictMode: false,
    sendSessionAffinityHeaders: false,
    supportsLongCacheRetention: true,
  } as Parameters<typeof convertMessages>[2];

  const messages = convertMessages(
    model as Parameters<typeof convertMessages>[0],
    {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "The lamp looks static." },
            { type: "text", text: "Specific things that feel wrong:" },
            { type: "text", text: "- The wax is one continuous blob." },
            { type: "text", text: "-There is no visible liquid medium." },
            {
              type: "text",
              text: "So: the wax behavior is the biggest problem.",
            },
          ],
          api: "openai-completions",
          provider: "local-studio",
          model: "nex-n2-pro",
          stopReason: "stop",
          timestamp: Date.now(),
        },
        {
          role: "user",
          content: "Keep going.",
          timestamp: Date.now(),
        },
      ],
    } as Parameters<typeof convertMessages>[1],
    compat,
  );

  assert.equal(
    (messages[0] as Record<string, unknown>).content,
    [
      "The lamp looks static.",
      "",
      "Specific things that feel wrong:",
      "- The wax is one continuous blob.",
      "- There is no visible liquid medium.",
      "",
      "So: the wax behavior is the biggest problem.",
    ].join("\n"),
  );
});

test("reasoning then pre-tool narration then tool keeps activity together", () => {
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

  const afterReasoning = applyAssistantPiEventToBlocks([], reasoningEvent) ?? [];
  const afterText = applyAssistantPiEventToBlocks(afterReasoning, textEvent) ?? [];
  const blocks = applyAssistantPiEventToBlocks(afterText, toolEvent) ?? [];

  assert.equal(blocks[0]?.kind, "thinking");
  assert.match(blocks[0]?.text ?? "", /Internal reasoning before the answer/);
  assert.match(blocks[0]?.text ?? "", /Here is the answer/);
  assert.equal(blocks[1]?.kind, "tool");
});

test("visible answer text after a tool call stays after the collapsed activity", () => {
  const narrationEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Let me inspect that first.",
    },
  };
  const toolStartEvent = {
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
  const answerEvent = {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Here is the answer.",
    },
  };

  const afterNarration = applyAssistantPiEventToBlocks([], narrationEvent) ?? [];
  const afterTool = applyAssistantPiEventToBlocks(afterNarration, toolStartEvent) ?? [];
  const blocks = applyAssistantPiEventToBlocks(afterTool, answerEvent) ?? [];

  assert.equal(blocks[0]?.kind, "thinking");
  assert.equal(blocks[0]?.text, "Let me inspect that first.");
  assert.equal(blocks[1]?.kind, "tool");
  assert.equal(blocks[2]?.kind, "text");
  assert.equal(blocks[2]?.text, "Here is the answer.");
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
  const afterReasoning = applyAssistantPiEventToBlocks(afterStart, reasoningEvent) ?? [];
  const blocks = applyAssistantPiEventToBlocks(afterReasoning, textRest) ?? [];

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.kind, "thinking");
  assert.equal(blocks[0]?.text, "The model reasoned before answering.");
  assert.equal(blocks[1]?.kind, "text");
  assert.equal(blocks[1]?.text, "Speculative decoding optimizes inference latency.");
});

test("tool_execution_start collapses pending narration with tool activity", () => {
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

  assert.equal(blocks?.[0]?.kind, "thinking");
  assert.equal(blocks?.[0]?.text, "I'll run a quick check.");
  assert.equal(blocks?.[1]?.kind, "tool");
});

test("replayed tool-use narration renders as reasoning, not visible answer text", () => {
  const { messages } = foldSessionEvents([
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
  const { messages } = foldSessionEvents([
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

  const assistantMessages = messages.filter((message) => message.role === "assistant");
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

  harness.apply("s-main", "a-main", {
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

  const assistant = harness.session().messages.find((message) => message.id === "a-main");
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

  harness.apply("s-main", "a-main", {
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Already streamed." }],
    },
  });

  const assistant = harness.session().messages.find((message) => message.id === "a-main");
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

  harness.apply("s-main", "a-main", {
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

  const assistant = harness.session().messages.find((message) => message.id === "a-main");
  assert.equal(assistant?.blocks?.length, 2);
  assert.equal(assistant?.blocks?.[0]?.kind, "thinking");
  assert.equal(
    assistant?.blocks?.[0]?.text,
    "The model reasoned before answering, even if the final payload listed it second.",
  );
  assert.equal(assistant?.blocks?.[1]?.kind, "text");
  assert.equal(assistant?.blocks?.[1]?.text, "Speculative decoding optimizes inference latency.");
});

test("assistant message_end error becomes visible without replay navigation", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "continue" },
        {
          id: "a-main",
          role: "assistant",
          text: "",
          blocks: [],
        },
      ],
      activeAssistantId: "a-main",
    }),
  );

  harness.apply("s-main", "a-main", {
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "error",
      errorMessage: "fetch failed",
      content: [{ type: "text", text: "Partial answer" }],
    },
  });

  const assistant = harness.session().messages.find((message) => message.id === "a-main");
  assert.equal(harness.session().error, "fetch failed");
  assert.equal(assistant?.blocks?.at(-1)?.kind, "event");
  assert.equal(assistant?.blocks?.at(-1)?.text, "fetch failed");
});

test("settled assistant error messages hydrate visible error blocks", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "continue" },
        {
          id: "a-main",
          role: "assistant",
          text: "",
          blocks: [],
        },
      ],
      activeAssistantId: "a-main",
    }),
  );

  harness.apply("s-main", "a-main", {
    type: "message",
    message: {
      role: "assistant",
      stopReason: "error",
      errorMessage: "provider overloaded",
      content: [],
    },
  });

  const assistant = harness.session().messages.find((message) => message.id === "a-main");
  assert.equal(harness.session().error, "provider overloaded");
  assert.equal(assistant?.blocks?.[0]?.kind, "event");
  assert.equal(assistant?.blocks?.[0]?.text, "provider overloaded");
});

test("aborted turns settle cleanly without an error block or session error", () => {
  const harness = makePiEventApplierHarness(
    makeSession("s-main", {
      messages: [
        { id: "u1", role: "user", text: "write an essay" },
        { id: "a-main", role: "assistant", text: "", blocks: [] },
      ],
      activeAssistantId: "a-main",
    }),
  );

  // User pressed Stop mid-answer: the call ends with stopReason "aborted" and
  // whatever partial content had streamed. This is a deliberate stop, NOT a
  // failure — no error block, no session error, partial content preserved.
  harness.apply("s-main", "a-main", {
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "aborted",
      content: [{ type: "text", text: "Partial answer so far" }],
    },
  });

  const assistant = harness.session().messages.find((message) => message.id === "a-main");
  assert.equal(harness.session().error ?? "", "");
  assert.equal(
    (assistant?.blocks ?? []).some((block) => block.kind === "event"),
    false,
    "aborted turn must not append an error/event block",
  );
  assert.equal(
    (assistant?.blocks ?? []).find((block) => block.kind === "text")?.text,
    "Partial answer so far",
  );
});

test("activity group ids stay stable as streaming blocks append", () => {
  const first = groupAssistantBlocks([
    { kind: "thinking", id: "0:0:thinking", text: "Thinking" },
    {
      kind: "tool",
      id: "call-read",
      name: "read",
      status: "running",
      text: "{}",
      argsText: "{}",
    },
  ]);
  const second = groupAssistantBlocks([
    { kind: "thinking", id: "0:0:thinking", text: "Thinking" },
    { kind: "thinking", id: "0:1:thinking", text: " more" },
    {
      kind: "tool",
      id: "call-read",
      name: "read",
      status: "running",
      text: "{}",
      argsText: "{}",
    },
    {
      kind: "tool",
      id: "call-write",
      name: "write",
      status: "running",
      text: "{}",
      argsText: "{}",
    },
  ]);

  const firstActivity = first.find((item) => item.kind === "activity-group");
  const secondActivity = second.find((item) => item.kind === "activity-group");
  if (firstActivity?.kind !== "activity-group" || secondActivity?.kind !== "activity-group") {
    throw new Error("expected activity groups");
  }
  assert.equal(firstActivity.id, secondActivity.id);
  // Reasoning and tools between two content blocks fold into ONE activity-group
  // (a single collapsible), reasoning as the first segment — not a separate
  // top-level row.
  assert.equal(first.length, 1);
  assert.equal(first[0]?.kind, "activity-group");
  assert.equal(firstActivity.segments[0]?.kind, "reasoning");
  assert.equal(firstActivity.segments[1]?.kind, "tools");
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
  assert.match(selectedContextPrompt("open the page", skills), /Loaded skills:/);
  assert.match(selectedContextPrompt("open the page", skills), /Use browser tools/);
  assert.match(
    selectedContextInstructions(skills) ?? "",
    /Preserve this selected composer context/,
  );
});

// Regression: with the Browser panel open the prompt is prefixed with a
// <browser_context>…</browser_context> block. When a turn reaches the
// transcript via Pi's echo (steer/follow-up) or replay, that block must be
// stripped — otherwise the user bubble renders the raw machine context and the
// echoed text no longer matches the optimistic bubble (spawning a duplicate
// bubble + a stale liveAssistantIds redirect).
test("visibleUserTextFromPi strips a leading browser_context block", () => {
  const browserBlock = [
    "<browser_context>",
    "The in-app Browser is open for this turn.",
    "Active URL: http://localhost:8765/neon-drift.html.",
    "</browser_context>",
  ].join("\n");

  assert.equal(visibleUserTextFromPi(`${browserBlock}\n\ngo on`), "go on");
  // Also when the prompt is wrapped with Pi's "User prompt:" marker.
  assert.equal(
    visibleUserTextFromPi(`some env context\n\nUser prompt:\n${browserBlock}\n\ngo on`),
    "go on",
  );
  // Untouched when there is no browser_context block.
  assert.equal(visibleUserTextFromPi("just a normal prompt"), "just a normal prompt");
  // A stray "<browser_context>" mid-text is NOT stripped (anchored to start).
  assert.equal(
    visibleUserTextFromPi("explain <browser_context> as a concept"),
    "explain <browser_context> as a concept",
  );
});

// Regression: a tool-heavy turn ends with the model's closing summary arriving
// as its own tool-free settled `message`. The bubble already holds tool blocks,
// so the old reconcile rejected the summary wholesale (to avoid clobbering the
// tools) — the turn rendered a trailing tool call and NO final words. Confirmed
// against a real session log (cerebras/kimi): the 435-char final message was
// persisted but never shown. The summary must now be appended, tools intact.
test("a tool-free final settled message appends its summary instead of being dropped", () => {
  const ctx: SessionStreamContext = { liveAssistantIds: new Map() };
  let session: Session = {
    id: "s-1",
    piSessionId: "pi-1",
    title: "t",
    messages: [
      { id: "u1", role: "user", text: "build it", timestamp: "" },
      { id: "a1", role: "assistant", text: "", blocks: [], timestamp: "" },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: "a1",
  };
  const ev = (event: Record<string, unknown>) => {
    session = reduceSessionEvent(session, ctx, event);
  };

  // A tool call settles into the bubble, then its result.
  ev({
    type: "message",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "editing" },
        { type: "toolCall", id: "tc1", name: "edit_file", arguments: {} },
      ],
    },
  });
  ev({
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "edit_file",
      content: [{ type: "text", text: "ok" }],
    },
  });
  // The closing summary arrives as its own tool-free settled message.
  ev({
    type: "message",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "thinking", thinking: "wrapping up" },
        { type: "text", text: "All set — the canvas renders cleanly." },
      ],
    },
  });

  const bubble = session.messages.find((m) => m.id === "a1");
  const blocks = bubble?.blocks ?? [];
  assert.ok(
    blocks.some((b) => b.kind === "tool" && b.id === "tc1"),
    "tool block preserved",
  );
  assert.ok(
    blocks.some((b) => b.kind === "text" && b.text.includes("canvas renders cleanly")),
    "final summary text rendered",
  );

  // Idempotent: re-delivering the same settled message (reconnect/replay) does
  // not duplicate the summary.
  const before = bubble?.blocks?.length ?? 0;
  ev({
    type: "message",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "thinking", thinking: "wrapping up" },
        { type: "text", text: "All set — the canvas renders cleanly." },
      ],
    },
  });
  assert.equal(session.messages.find((m) => m.id === "a1")?.blocks?.length ?? 0, before);
});

// Steer UX: the message is dropped into the transcript dimmed (pending) the
// instant it's sent; when Pi echoes it (the model is now seeing it) the dim
// clears and the steered reply opens its own bubble — without duplicating the
// user message.
test("a steer echo clears the optimistic pending bubble and opens the reply bubble", () => {
  const ctx: SessionStreamContext = { liveAssistantIds: new Map() };
  let session: Session = {
    id: "s-1",
    piSessionId: "pi-1",
    title: "t",
    messages: [
      { id: "u1", role: "user", text: "do a thing", timestamp: "" },
      { id: "a1", role: "assistant", text: "", blocks: [], timestamp: "" },
      {
        id: "steer1",
        role: "user",
        text: "actually, do it differently",
        pending: true,
        timestamp: "",
      },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: "a1",
  };

  session = reduceSessionEvent(session, ctx, {
    type: "message_start",
    message: { role: "user", content: [{ type: "text", text: "actually, do it differently" }] },
  });

  assert.equal(
    session.messages.find((m) => m.id === "steer1")?.pending,
    false,
    "pending dim cleared",
  );
  // No duplicate user bubble for the steered text.
  assert.equal(
    session.messages.filter((m) => m.role === "user" && m.text === "actually, do it differently")
      .length,
    1,
  );
  // A fresh assistant bubble opened for the reply and became the live target.
  const lastAssistant = [...session.messages].reverse().find((m) => m.role === "assistant");
  assert.ok(lastAssistant && lastAssistant.id !== "a1", "new reply bubble opened");
  assert.equal(session.activeAssistantId, lastAssistant!.id);
  assert.equal(ctx.liveAssistantIds.get("s-1"), lastAssistant!.id);
});

test("agent_end un-dims a steer that was never echoed", () => {
  const ctx: SessionStreamContext = { liveAssistantIds: new Map() };
  let session: Session = {
    id: "s-1",
    piSessionId: "pi-1",
    title: "t",
    messages: [
      { id: "a1", role: "assistant", text: "", blocks: [], timestamp: "" },
      { id: "steer1", role: "user", text: "late steer", pending: true, timestamp: "" },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: "a1",
  };

  session = reduceSessionEvent(session, ctx, { type: "agent_end" });
  assert.equal(session.messages.find((m) => m.id === "steer1")?.pending, false);
});

// Regression for finding [4]: a tool block created live from tool_execution_*
// events (so it lives only in the bubble's blocks, never in a content snapshot)
// must survive the model's closing text-only message_update. The snapshot rebuild
// drops tools absent from the latest content; preservation was previously gated
// to toolcall_* updates only, so a pure text summary made completed tools vanish.
test("a text-only live message_update after a tool-heavy turn keeps the tool blocks", () => {
  const ctx: SessionStreamContext = { liveAssistantIds: new Map() };
  let session: Session = {
    id: "s-1",
    piSessionId: "pi-1",
    title: "t",
    messages: [
      { id: "u1", role: "user", text: "build it", timestamp: "" },
      { id: "a1", role: "assistant", text: "", blocks: [], timestamp: "" },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: "a1",
  };
  const ev = (event: Record<string, unknown>) => {
    session = reduceSessionEvent(session, ctx, event);
  };

  // Tool runs live, created from a tool_execution_start event (never enters streamCalls).
  ev({ type: "tool_execution_start", toolCallId: "call-bash", toolName: "bash" });
  const created = session.messages.find((m) => m.id === "a1")?.blocks ?? [];
  assert.ok(
    created.some((b) => b.kind === "tool" && b.id === "call-bash"),
    "tool block created from tool_execution_start",
  );

  // Closing summary arrives as a pure text message_update — its content snapshot
  // has NO tool part, so the snapshot rebuild would drop the tool without the fix.
  ev({
    type: "message_update",
    message: {
      role: "assistant",
      stopReason: "",
      content: [{ type: "text", text: "Done — the build succeeded." }],
    },
  });

  const blocks = session.messages.find((m) => m.id === "a1")?.blocks ?? [];
  assert.ok(
    blocks.some((b) => b.kind === "tool" && b.id === "call-bash"),
    "tool block must survive a text-only message_update",
  );
  assert.ok(
    blocks.some((b) => b.kind === "text" && b.text.includes("build succeeded")),
    "closing summary text rendered",
  );
});
