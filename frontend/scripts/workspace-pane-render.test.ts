import assert from "node:assert/strict";
import test from "node:test";

import type { Session } from "../src/features/agent/runtime/types";
import {
  sameWorkspacePaneView,
  type WorkspacePaneView,
} from "../src/features/agent/ui/render-workspace-pane";

function session(id: string): Session {
  return {
    id,
    piSessionId: null,
    title: "Session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  };
}

function view(active: Session): WorkspacePaneView {
  return {
    paneId: "p-one",
    pane: { sessionId: active.id },
    session: active,
    project: null,
    cwd: "/repo",
    modelId: "model",
    model: null,
    gitSummary: null,
    gitBranch: null,
    isNewSession: true,
    canClose: true,
    isFocused: false,
  };
}

test("unrelated workspace updates preserve an inactive pane render", () => {
  const current = view(session("session-a"));
  assert.equal(sameWorkspacePaneView(current, { ...current }), true);
});

test("session and focus updates invalidate only the affected pane render", () => {
  const current = view(session("session-a"));
  assert.equal(
    sameWorkspacePaneView(current, { ...current, session: session("session-a") }),
    false,
  );
  assert.equal(sameWorkspacePaneView(current, { ...current, isFocused: true }), false);
});
