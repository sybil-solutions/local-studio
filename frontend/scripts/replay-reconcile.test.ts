import assert from "node:assert/strict";
import test from "node:test";

import { reconcileReplayMessages } from "../src/features/agent/messages/helpers";
import type { ChatMessage } from "../src/features/agent/messages/types";

function msg(id: string, text: string): ChatMessage {
  return { id, role: "user", text };
}

test("reconcileReplayMessages keeps current when canonical is shorter", () => {
  const current = [msg("a", "1"), msg("b", "2"), msg("c", "3")];
  const canonical = [msg("b", "2"), msg("c", "3")];
  assert.equal(reconcileReplayMessages(current, canonical), current);
});

test("reconcileReplayMessages takes canonical when it reaches at least as far", () => {
  const current = [msg("a", "1")];
  const canonical = [msg("a", "1"), msg("b", "2"), msg("c", "3")];
  assert.equal(reconcileReplayMessages(current, canonical), canonical);
});

test("reconcileReplayMessages takes canonical at equal length", () => {
  const current = [msg("a", "1"), msg("b", "2")];
  const canonical = [msg("a", "1"), msg("b", "2 fresh")];
  assert.equal(reconcileReplayMessages(current, canonical), canonical);
});

test("reconcileReplayMessages keeps current when canonical is empty", () => {
  const current = [msg("a", "1"), msg("b", "2")];
  assert.equal(reconcileReplayMessages(current, []), current);
});

test("reconcileReplayMessages returns current when both are empty", () => {
  assert.deepEqual(reconcileReplayMessages([], []), []);
});
