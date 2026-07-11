import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantBlocksForMessage,
  mergeConsecutiveAssistantMessages,
  messageRenders,
} from "../src/features/agent/ui/timeline/message-visibility";
import type { ChatMessage } from "../src/features/agent/messages";

test("legacy assistant text remains visible when replay has no blocks", () => {
  const message: ChatMessage = { id: "assistant-1", role: "assistant", text: "Recovered answer" };
  assert.equal(messageRenders(message), true);
  assert.deepEqual(assistantBlocksForMessage(message), [
    { kind: "text", id: "assistant-1:fallback-text", text: "Recovered answer" },
  ]);
});

test("existing assistant blocks remain authoritative", () => {
  const message: ChatMessage = {
    id: "assistant-2",
    role: "assistant",
    text: "legacy field",
    blocks: [{ kind: "event", id: "event-1", text: "terminated" }],
  };
  assert.deepEqual(assistantBlocksForMessage(message), message.blocks);
  assert.equal(messageRenders(message), true);
});

test("consecutive assistant segments retain legacy text beside live blocks", () => {
  const merged = mergeConsecutiveAssistantMessages([
    { id: "assistant-1", role: "assistant", text: "recovered lead" },
    {
      id: "assistant-2",
      role: "assistant",
      text: "live answer",
      blocks: [{ kind: "text", id: "text-2", text: "live answer" }],
    },
  ]);
  assert.deepEqual(merged[0]?.blocks, [
    { kind: "text", id: "assistant-1:fallback-text", text: "recovered lead" },
    { kind: "text", id: "text-2", text: "live answer" },
  ]);
});
