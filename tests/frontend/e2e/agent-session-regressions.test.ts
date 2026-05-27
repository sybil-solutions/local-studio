import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
} from "@/lib/agent/active-sessions";
import {
  detectComposerMention,
  selectedContextInstructions,
  selectedContextPrompt,
} from "@/lib/agent/composer-context";
import { applyAssistantPiEventToBlocks } from "@/lib/agent/session/block-event";
import { drainQueuedTurnAfterAgentEnd } from "@/lib/agent/sessions/queue-drain";
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
