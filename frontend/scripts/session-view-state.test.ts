import assert from "node:assert/strict";
import test from "node:test";

import {
  patchSessionView,
  readSessionView,
  SESSION_VIEW_STATE_KEY,
  sessionViewIdentity,
} from "../src/features/agent/workspace/session-view-state";

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  };
}

test("session view state migrates from a local id to the durable thread id", () => {
  const target = storage();
  const local = sessionViewIdentity({ id: "runtime-a", piSessionId: null });
  const durable = sessionViewIdentity({ id: "runtime-a", piSessionId: "thread-a" });
  assert.ok(local);
  assert.ok(durable);

  patchSessionView(target, local, { scrollTop: 480, stickToBottom: false });
  patchSessionView(target, durable, {
    computer: { open: true, tab: "plan", tabs: ["status", "plan"], width: 520 },
  });

  assert.deepEqual(readSessionView(target, durable), {
    scrollTop: 480,
    stickToBottom: false,
    computer: { open: true, tab: "plan", tabs: ["status", "plan"], width: 520 },
  });
  assert.equal(
    JSON.parse(target.getItem(SESSION_VIEW_STATE_KEY) ?? "{}").views["runtime-a"],
    undefined,
  );
});

test("session view state validates corrupted panel data", () => {
  const target = storage();
  target.setItem(
    SESSION_VIEW_STATE_KEY,
    JSON.stringify({
      version: 1,
      views: {
        "thread-a": {
          scrollTop: -20,
          stickToBottom: false,
          computer: { open: true, tab: "missing", tabs: ["missing"], width: 800 },
        },
      },
    }),
  );
  const identity = sessionViewIdentity({ id: "runtime-a", piSessionId: "thread-a" });
  assert.ok(identity);
  assert.deepEqual(readSessionView(target, identity), { scrollTop: 0, stickToBottom: false });
});
