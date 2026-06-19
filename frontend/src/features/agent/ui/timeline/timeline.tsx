"use client";

import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AssistantBlock, ChatMessage } from "@/features/agent/messages";
import { SessionPaneBlockRouter } from "@/features/agent/ui/timeline/session-pane-block-router";
import { ChevronDownIcon } from "@/ui/icons";

// Mirrors `groupAssistantBlocks`: a message renders something only if it has a
// non-empty text block or any tool/thinking/event block. Assistant messages
// that produce nothing (e.g. only whitespace text from a stream) would still
// emit an empty article plus the wrapper's top padding, leaving a blank gap.
function messageRenders(message: ChatMessage): boolean {
  if (message.role === "system") return false;
  if (message.role === "user") {
    return message.text.trim().length > 0 || Boolean(message.attachments?.length);
  }
  return (message.blocks ?? []).some((block: AssistantBlock) =>
    block.kind === "text" ? block.text.trim() !== "" : true,
  );
}

type TimelineProps = {
  messages: ChatMessage[];
  running: boolean;
  onForkSession?: () => void;
  emptyPrompt?: boolean;
  stickToBottom?: boolean;
  onStickToBottomChange?: (value: boolean) => void;
};

const MemoMessage = memo(
  function MemoMessage({
    message,
    live,
    running,
    onForkSession,
  }: {
    message: ChatMessage;
    live: boolean;
    running: boolean;
    onForkSession?: () => void;
  }) {
    return (
      <MessageView message={message} live={live} running={running} onForkSession={onForkSession} />
    );
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.live === next.live &&
    prev.running === next.running &&
    prev.onForkSession === next.onForkSession,
);

export function Timeline({
  messages,
  running,
  onForkSession,
  emptyPrompt = false,
  stickToBottom = true,
  onStickToBottomChange,
}: TimelineProps) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [bottom, setBottom] = useState<HTMLDivElement | null>(null);

  const visibleMessages = useMemo(
    () => mergeConsecutiveAssistantMessages(messages.filter(messageRenders)),
    [messages],
  );

  useTimelineScrollEffects({
    scroller,
    bottom,
    stickToBottom,
    onStickToBottomChange,
  });

  if (emptyPrompt) {
    return (
      <div className="flex min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-10 pt-2">
        <div className="agent-thread-shell mx-auto flex flex-1">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="max-w-[24ch] text-[clamp(1.45rem,2.6vw,2.1rem)] font-semibold leading-[1.22] tracking-[-0.02em] text-(--fg)/90">
              A dream is something you build for yourself.
            </p>
            <p className="text-[length:var(--fs-xl)] text-(--dim)">Just talk to it.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={setScroller}
        data-timeline-scroller
        className="agent-chat-scroller min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-1 pt-2 [overflow-anchor:none] [overscroll-behavior:contain] [scroll-behavior:auto] [scrollbar-gutter:stable_both-edges]"
      >
        <div data-timeline-list className="agent-thread-shell mx-auto flex flex-col">
          {visibleMessages.map((message, index) => {
            const isLast = index === visibleMessages.length - 1;
            const prevRole = index > 0 ? visibleMessages[index - 1].role : null;
            const isGrouped = message.role === prevRole;
            return (
              <div
                key={message.id}
                className={`[overflow-anchor:none] ${isGrouped ? "pt-2" : "pt-6"} ${isLast ? "pb-4" : ""}`}
              >
                <MemoMessage
                  message={message}
                  live={isLast && running}
                  running={running}
                  onForkSession={onForkSession}
                />
              </div>
            );
          })}
          {running && visibleMessages[visibleMessages.length - 1]?.role !== "assistant" ? (
            // Codex waiting state: a cadenced text shimmer, no spinner. Only shown
            // before the assistant produces its first block — once blocks stream,
            // the activity rows carry their own live states.
            <div className="pt-6 pb-4 [overflow-anchor:none]">
              <span className="codex-shimmer-text text-[13px] font-medium leading-5">Thinking</span>
            </div>
          ) : null}
          <div ref={setBottom} aria-hidden="true" className="[overflow-anchor:none]" />
        </div>
      </div>
      {!stickToBottom && visibleMessages.length > 0 ? (
        <ScrollToBottomButton
          running={running}
          onClick={() => {
            scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
            onStickToBottomChange?.(true);
          }}
        />
      ) : null}
    </div>
  );
}

/** Floating "jump to latest" affordance, shown only when the user has scrolled
 * up off the bottom. Nudges to "New messages" while a turn is streaming. */
function ScrollToBottomButton({ running, onClick }: { running: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-(--border) bg-(--surface) px-3 py-1 text-[length:var(--fs-xs)] text-(--fg)/85 shadow-[0_6px_20px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-colors hover:text-(--fg)"
      aria-label="Scroll to latest"
    >
      {running ? "New messages" : "Latest"}
      <ChevronDownIcon className="h-3 w-3" />
    </button>
  );
}

function mergeConsecutiveAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (message.role !== "assistant" || previous?.role !== "assistant") {
      merged.push(message);
      continue;
    }
    merged[merged.length - 1] = {
      ...previous,
      id: `${previous.id}:${message.id}`,
      text: [previous.text, message.text].filter(Boolean).join("\n"),
      blocks: [...(previous.blocks ?? []), ...(message.blocks ?? [])],
      streamCalls: [...(previous.streamCalls ?? []), ...(message.streamCalls ?? [])],
      timestamp: message.timestamp ?? previous.timestamp,
    };
  }
  return merged;
}

const AT_BOTTOM_THRESHOLD_PX = 80;
const USER_HOLD_MS = 700;

const getTimelineScrollSnapshot = (): number => 0;

/**
 * Keeps the chat locked to the latest message while streaming and re-pins after
 * any layout growth (new tokens, expanded reasoning, async-loaded history), so
 * the view never drifts off the bottom or shifts under the user.
 *
 * Proximity to the bottom is the single source of truth: if the viewport is at
 * the bottom we follow new content, otherwise we leave the user where they are.
 * Content growth neither moves `scrollTop` nor fires a scroll event, so it can
 * never be misread as "the user scrolled up"; only genuine user scrolls and our
 * own pin writes change `scrollTop`, and both classify correctly via `atBottom`.
 *
 * Upward gestures (wheel/touch/keys) detach synchronously with a short hold
 * window, so the user can still escape mid-stream even when a synchronous DOM
 * mutation would otherwise re-pin before the async scroll event is delivered.
 *
 * The scroller and bottom-sentinel are passed as DOM nodes (not refs) so the
 * observers re-attach whenever the elements mount — critical when a session
 * mounts empty (history loads async) and the scroller appears after first paint.
 */
function useTimelineScrollEffects({
  scroller,
  bottom,
  stickToBottom,
  onStickToBottomChange,
}: {
  scroller: HTMLDivElement | null;
  bottom: HTMLDivElement | null;
  stickToBottom: boolean;
  onStickToBottomChange?: (value: boolean) => void;
}) {
  // Synchronous source of truth the handlers read. The parent's `stickToBottom`
  // prop is the eventually-consistent mirror (drives chrome and lets submit /
  // tab-change force a re-stick); `onChangeRef` reports our changes back to it.
  const stickRef = useRef(stickToBottom);
  const onChangeRef = useRef(onStickToBottomChange);
  // While set, honor a deliberate upward scroll instead of snapping back to the
  // bottom (e.g. the user grazes the threshold while reading recent history).
  const userHoldUntilRef = useRef(0);

  // Mirror prop + callback into refs in the commit phase (never during render).
  const subscribeStickRef = useCallback(() => {
    stickRef.current = stickToBottom;
    return () => undefined;
  }, [stickToBottom]);
  const subscribeOnChangeRef = useCallback(() => {
    onChangeRef.current = onStickToBottomChange;
    return () => undefined;
  }, [onStickToBottomChange]);

  const subscribeScroll = useCallback(() => {
    const el = scroller;
    if (!el) return () => undefined;

    const distanceFromBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = () => distanceFromBottom() <= AT_BOTTOM_THRESHOLD_PX;

    const pinToBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    const setStick = (next: boolean) => {
      if (stickRef.current === next) return;
      stickRef.current = next;
      onChangeRef.current?.(next);
    };

    const onScroll = () => {
      if (atBottom()) {
        // Briefly respect a deliberate scroll-up near the bottom instead of
        // immediately re-locking and fighting the user.
        if (Date.now() < userHoldUntilRef.current) return;
        setStick(true);
        return;
      }
      setStick(false);
    };

    const holdAndDetach = () => {
      userHoldUntilRef.current = Date.now() + USER_HOLD_MS;
      setStick(false);
    };
    const releaseHold = () => {
      userHoldUntilRef.current = 0;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) holdAndDetach();
      else if (event.deltaY > 0) releaseHold();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) holdAndDetach();
      else if (["ArrowDown", "PageDown", "End"].includes(event.key)) releaseHold();
    };
    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? null;
      if (touchY !== null && y !== null) {
        if (y - touchY > 2) holdAndDetach();
        else if (touchY - y > 2) releaseHold();
      }
      touchY = y;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });

    // Follow content + viewport growth while pinned. Running synchronously in the
    // observer callback (before paint) means streaming text and expanding a
    // reasoning block re-pin without a visible shift.
    const listEl = bottom?.parentElement ?? el;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (stickRef.current) pinToBottom();
          });
    resizeObserver?.observe(el);
    if (listEl !== el) resizeObserver?.observe(listEl);

    // Streamed text mutates existing nodes without resizing the observed boxes;
    // keep following those too while pinned.
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            if (stickRef.current) pinToBottom();
          });
    mutationObserver?.observe(listEl, { childList: true, subtree: true, characterData: true });

    // Initial alignment (also covers async-loaded history once it renders, via
    // the ResizeObserver above).
    if (stickRef.current) pinToBottom();

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [bottom, scroller]);

  // When the parent forces stick=true (submit, tab change, session load), snap
  // back to the bottom and clear any lingering hold.
  const subscribeForceStick = useCallback(() => {
    if (stickToBottom && scroller) {
      stickRef.current = true;
      userHoldUntilRef.current = 0;
      scroller.scrollTop = scroller.scrollHeight;
    }
    return () => undefined;
  }, [stickToBottom, scroller]);

  useSyncExternalStore(subscribeStickRef, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeOnChangeRef, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeScroll, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeForceStick, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
}

function MessageView({
  message,
  live = false,
  running = false,
  onForkSession,
}: {
  message: ChatMessage;
  live?: boolean;
  running?: boolean;
  onForkSession?: () => void;
}) {
  return (
    <SessionPaneBlockRouter
      message={message}
      live={live}
      running={running}
      onForkSession={onForkSession}
    />
  );
}
