import type { AssistantBlock, ChatMessage } from "@/features/agent/messages";

/**
 * The pure derivation behind the timeline: which messages render, and how a
 * turn's assistant segments are stitched back into a single bubble.
 *
 * Split out from the component because it runs on every streamed frame and its
 * caching behaviour is load-bearing enough to test and benchmark directly —
 * a regression here shows up only as the whole transcript re-rendering per
 * token, which no rendering assertion would catch.
 */

// Mirrors `groupAssistantBlocks`: a message renders something only if it has a
// non-empty text block or any tool/thinking/event block. Assistant messages
// that produce nothing (e.g. only whitespace text from a stream) would still
// emit an empty article plus the wrapper's top padding, leaving a blank gap.
export function messageRenders(message: ChatMessage): boolean {
  if (message.role === "system") return false;
  if (message.role === "user") {
    return message.text.trim().length > 0 || Boolean(message.attachments?.length);
  }
  return (message.blocks ?? []).some((block: AssistantBlock) =>
    block.kind === "text" ? block.text.trim() !== "" : true,
  );
}

export type MergedRun = { segments: ChatMessage[]; merged: ChatMessage };

// Streaming commits a fresh `messages` array every animation frame, so this
// merge runs per frame. The per-run cache keeps a merged turn's object
// identity stable while its segments are unchanged — otherwise every settled
// multi-segment turn would get a new identity each frame and its MemoMessage
// would re-render for the whole stream.
//
// The cache is therefore scoped to the transcript, not to a fixed number of
// entries: every run that is still on screen must have one. A count-based
// bound quietly inverted the whole point past that count — a conversation with
// more runs than the bound could never hold them all, so every frame missed on
// some of them and handed React a new identity for EVERY settled turn. Measured
// at 600 turns: 600 turns re-rendering per streamed token instead of 1.
// (An LRU bound is no better; a sequential walk longer than the cache evicts
// exactly the entries it is about to ask for.)
//
// Dropping what this pass did not see keeps it exact: entries leave because
// their run left the transcript, never because a counter filled.
export function mergeConsecutiveAssistantMessages(
  messages: ChatMessage[],
  cache: Map<string, MergedRun>,
): ChatMessage[] {
  const merged: ChatMessage[] = [];
  const seen = new Set<string>();
  let run: ChatMessage[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      merged.push(run[0]);
    } else {
      seen.add(run[0].id);
      merged.push(mergeRun(run, cache));
    }
    run = [];
  };
  for (const message of messages) {
    if (message.role === "assistant") {
      run.push(message);
      continue;
    }
    flushRun();
    merged.push(message);
  }
  flushRun();
  for (const key of cache.keys()) {
    if (!seen.has(key)) cache.delete(key);
  }
  return merged;
}

function mergeRun(run: ChatMessage[], cache: Map<string, MergedRun>): ChatMessage {
  const first = run[0];
  const cached = cache.get(first.id);
  if (
    cached &&
    cached.segments.length === run.length &&
    cached.segments.every((segment, index) => segment === run[index])
  ) {
    return cached.merged;
  }
  const combined: ChatMessage = {
    ...first,
    // Anchor the merged id on the first segment (already unique). Concatenating
    // each new segment's id grew the id — and thus the React key — on every
    // tool boundary within a turn, remounting the whole assistant <article>
    // mid-stream and collapsing expanded reasoning/tool disclosures.
    id: first.id,
    text: run
      .map((segment) => segment.text)
      .filter(Boolean)
      .join("\n"),
    blocks: run.flatMap((segment) => segment.blocks ?? []),
    streamCalls: run.flatMap((segment) => segment.streamCalls ?? []),
    timestamp: run.reduce<string | undefined>(
      (timestamp, segment) => segment.timestamp ?? timestamp,
      undefined,
    ),
  };
  cache.set(first.id, { segments: run, merged: combined });
  return combined;
}
