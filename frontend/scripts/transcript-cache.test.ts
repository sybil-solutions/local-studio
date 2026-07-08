import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantBlock, ChatMessage } from "../src/features/agent/messages/types";
import {
  TRANSCRIPT_CACHE_PREFIX,
  boundMessagesForCache,
  purgeLegacyTranscriptCache,
  readTranscriptSnapshot,
  writeTranscriptSnapshot,
} from "../src/features/agent/workspace/transcript-cache";

type FakeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;

const MAX_CHARS = 512 * 1024;
const BLOCK_LIMIT = 16 * 1024;
const LEGACY_KEY = "local-studio.agent.transcripts.v1";

function fakeStorage(opts: { failSetTimes?: number } = {}): {
  storage: FakeStorage;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  let fails = opts.failSetTimes ?? 0;
  const storage: FakeStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (fails > 0) {
        fails -= 1;
        throw new Error("QuotaExceededError");
      }
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    get length() {
      return map.size;
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
  };
  return { storage, map };
}

function transcriptKeyCount(map: Map<string, string>): number {
  let count = 0;
  for (const key of map.keys()) {
    if (key.startsWith(TRANSCRIPT_CACHE_PREFIX)) count += 1;
  }
  return count;
}

function userMessage(id: string, text: string): ChatMessage {
  return { id, role: "user", text };
}

function blockHeavyMessage(id: string, blockCount: number, blockLength: number): ChatMessage {
  const blocks: AssistantBlock[] = [];
  for (let index = 0; index < blockCount; index += 1) {
    blocks.push({ kind: "text", id: `${id}-b${index}`, text: "y".repeat(blockLength) });
  }
  return { id, role: "assistant", text: "", blocks };
}

test("writes and reads a session transcript through its per-session key", () => {
  const { storage, map } = fakeStorage();
  const messages: ChatMessage[] = [
    userMessage("u1", "hello"),
    { id: "a1", role: "assistant", text: "hi" },
  ];
  writeTranscriptSnapshot("pi-1", messages, "Greeting", storage, 1000);
  assert.equal(map.has(`${TRANSCRIPT_CACHE_PREFIX}pi-1`), true);
  assert.equal(transcriptKeyCount(map), 1);
  const restored = readTranscriptSnapshot("pi-1", storage);
  assert.equal(restored?.length, 2);
  assert.equal(restored?.[0].text, "hello");
  assert.equal(restored?.[1].text, "hi");
});

test("write ignores empty and idless sessions; read returns null for unknown, null, and empty", () => {
  const { storage, map } = fakeStorage();
  writeTranscriptSnapshot("pi-1", [], "t", storage, 1000);
  assert.equal(map.has(`${TRANSCRIPT_CACHE_PREFIX}pi-1`), false);
  writeTranscriptSnapshot(null, [userMessage("u", "x")], "t", storage, 1000);
  assert.equal(transcriptKeyCount(map), 0);
  assert.equal(readTranscriptSnapshot(null, storage), null);
  assert.equal(readTranscriptSnapshot(undefined, storage), null);
  assert.equal(readTranscriptSnapshot("pi-unknown", storage), null);
  map.set(
    `${TRANSCRIPT_CACHE_PREFIX}pi-empty`,
    JSON.stringify({ version: 2, updatedAt: 1, messages: [] }),
  );
  assert.equal(readTranscriptSnapshot("pi-empty", storage), null);
});

test("sanitization drops transient streaming state and strips attachment bodies", () => {
  const { storage } = fakeStorage();
  const message: ChatMessage = {
    id: "a1",
    role: "assistant",
    text: "answer",
    blocks: [{ kind: "text", id: "b1", text: "answer" }],
    streamCalls: [[{ type: "text" }]],
    pending: true,
    attachments: [
      {
        id: "att1",
        name: "big.png",
        type: "image/png",
        size: 999,
        mode: "data-url",
        content: "data:image/png;base64,AAAAHUGE",
        previewKind: "image",
        previewUrl: "blob:huge",
        path: "/tmp/big.png",
      },
    ],
  };
  writeTranscriptSnapshot("pi-1", [message], undefined, storage, 1000);
  const cached = readTranscriptSnapshot("pi-1", storage)?.[0];
  assert.equal(cached?.streamCalls, undefined);
  assert.equal(cached?.pending, undefined);
  const attachment = cached?.attachments?.[0];
  assert.equal(attachment?.content, "");
  assert.equal(attachment?.name, "big.png");
  assert.equal(attachment?.size, 999);
  assert.equal(attachment?.mode, "data-url");
  assert.equal(attachment?.previewKind, "image");
  assert.equal(attachment?.path, "/tmp/big.png");
  assert.equal("previewUrl" in (attachment ?? {}), false);
});

test("long block text is truncated with the marker while short text is preserved", () => {
  const { storage } = fakeStorage();
  const longText = "y".repeat(BLOCK_LIMIT + 500);
  const marker = "\n…[truncated]";
  const message: ChatMessage = {
    id: "a1",
    role: "assistant",
    text: "answer",
    blocks: [
      { kind: "text", id: "long", text: longText },
      { kind: "tool", id: "tool", name: "run", status: "done", text: "", resultText: longText },
      { kind: "text", id: "short", text: "still short" },
    ],
  };
  writeTranscriptSnapshot("pi-1", [message], undefined, storage, 1000);
  const blocks = readTranscriptSnapshot("pi-1", storage)?.[0].blocks;
  const truncated = blocks?.[0];
  assert.equal(truncated?.text.endsWith(marker), true);
  assert.equal(truncated?.text.length, BLOCK_LIMIT + marker.length);
  assert.equal(truncated?.text.startsWith("yyyy"), true);
  const toolBlock = blocks?.[1];
  assert.equal(toolBlock?.kind === "tool" ? toolBlock.resultText?.endsWith(marker) : false, true);
  assert.equal(blocks?.[2].text, "still short");
});

test("boundMessagesForCache drops the oldest messages until the payload fits 512KB", () => {
  const messages = Array.from({ length: 5 }, (_, index) =>
    blockHeavyMessage(`m${index}`, 10, BLOCK_LIMIT),
  );
  const bounded = boundMessagesForCache(messages);
  assert.equal(JSON.stringify(bounded).length <= MAX_CHARS, true);
  assert.equal(bounded.length < messages.length, true);
  assert.equal(bounded[bounded.length - 1].id, "m4");
  assert.equal(bounded[0].id === "m0", false);
});

test("boundMessagesForCache keeps the last message even when it alone exceeds 512KB", () => {
  const bounded = boundMessagesForCache([blockHeavyMessage("big", 40, BLOCK_LIMIT)]);
  assert.equal(bounded.length, 1);
  assert.equal(bounded[0].id, "big");
  assert.equal(JSON.stringify(bounded).length > MAX_CHARS, true);
});

test("boundMessagesForCache keeps only the most recent 200 messages", () => {
  const messages = Array.from({ length: 250 }, (_, index) =>
    userMessage(`m${index}`, `line ${index}`),
  );
  const bounded = boundMessagesForCache(messages);
  assert.equal(bounded.length, 200);
  assert.equal(bounded[0].id, "m50");
  assert.equal(bounded[bounded.length - 1].id, "m249");
});

test("writing a 25th session evicts the single oldest session by updatedAt", () => {
  const { storage, map } = fakeStorage();
  for (let index = 0; index < 24; index += 1) {
    writeTranscriptSnapshot(
      `pi-${index}`,
      [userMessage(`u${index}`, "hi")],
      undefined,
      storage,
      index,
    );
  }
  assert.equal(transcriptKeyCount(map), 24);
  writeTranscriptSnapshot("pi-24", [userMessage("u24", "hi")], undefined, storage, 24);
  assert.equal(transcriptKeyCount(map), 24);
  assert.equal(readTranscriptSnapshot("pi-0", storage), null);
  assert.equal(readTranscriptSnapshot("pi-1", storage)?.[0].text, "hi");
  assert.equal(readTranscriptSnapshot("pi-24", storage)?.[0].text, "hi");
});

test("eviction never removes the just-written session even if it is the oldest", () => {
  const { storage, map } = fakeStorage();
  for (let index = 1; index <= 24; index += 1) {
    writeTranscriptSnapshot(
      `pi-${index}`,
      [userMessage(`u${index}`, "hi")],
      undefined,
      storage,
      index,
    );
  }
  writeTranscriptSnapshot("pi-new", [userMessage("un", "fresh")], undefined, storage, 0);
  assert.equal(transcriptKeyCount(map), 24);
  assert.equal(readTranscriptSnapshot("pi-new", storage)?.[0].text, "fresh");
  assert.equal(readTranscriptSnapshot("pi-1", storage), null);
});

test("a quota failure clears other transcript keys and persists the fresh entry", () => {
  const { storage, map } = fakeStorage({ failSetTimes: 1 });
  const stale = JSON.stringify({ version: 2, updatedAt: 1, messages: [userMessage("o", "old")] });
  map.set(`${TRANSCRIPT_CACHE_PREFIX}pi-a`, stale);
  map.set(`${TRANSCRIPT_CACHE_PREFIX}pi-b`, stale);
  writeTranscriptSnapshot("pi-new", [userMessage("u1", "keep me")], "t", storage, 1000);
  assert.equal(map.has(`${TRANSCRIPT_CACHE_PREFIX}pi-a`), false);
  assert.equal(map.has(`${TRANSCRIPT_CACHE_PREFIX}pi-b`), false);
  assert.equal(map.has(`${TRANSCRIPT_CACHE_PREFIX}pi-new`), true);
  assert.equal(readTranscriptSnapshot("pi-new", storage)?.[0].text, "keep me");
});

test("purgeLegacyTranscriptCache removes the v1 key and leaves v2 sessions intact", () => {
  const { storage, map } = fakeStorage();
  map.set(LEGACY_KEY, "legacy-blob");
  map.set(
    `${TRANSCRIPT_CACHE_PREFIX}pi-1`,
    JSON.stringify({ version: 2, updatedAt: 1, messages: [userMessage("u", "hi")] }),
  );
  purgeLegacyTranscriptCache(storage);
  assert.equal(map.has(LEGACY_KEY), false);
  assert.equal(map.has(`${TRANSCRIPT_CACHE_PREFIX}pi-1`), true);
});
