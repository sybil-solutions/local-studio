"use client";

import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AssistantBlock, ChatMessage } from "@/features/agent/messages";
import { SessionPaneBlockRouter } from "@/features/agent/ui/timeline/session-pane-block-router";
import { ChevronDownIcon } from "@/ui/icons";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { effectTimeout, type EffectTimer } from "@/lib/effect-timers";
import { patchSessionView, readSessionView } from "@/features/agent/workspace/session-view-state";

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
  viewKey: string | null;
  viewAlias: string | null;
  /** Older history remains unread beyond the loaded tail (shows "Load earlier"). */
  hasEarlier?: boolean;
  onLoadEarlier?: () => Promise<void> | void;
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
  viewKey,
  viewAlias,
  hasEarlier = false,
  onLoadEarlier,
}: TimelineProps) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [bottom, setBottom] = useState<HTMLDivElement | null>(null);

  const [mergeCache] = useState(() => new Map<string, MergedRun>());
  const visibleMessages = useMemo(
    () => mergeConsecutiveAssistantMessages(messages.filter(messageRenders), mergeCache),
    [messages, mergeCache],
  );

  useTimelineScrollEffects({
    scroller,
    bottom,
    stickToBottom,
    onStickToBottomChange,
    viewKey,
    viewAlias,
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
    <div className="agent-timeline-frame relative flex min-h-0 min-w-0 flex-1">
      <PromptMarkers scroller={scroller} messages={visibleMessages} />
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div
          ref={setScroller}
          data-timeline-scroller
          className="agent-chat-scroller min-h-0 min-w-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-1 pt-2 [overflow-anchor:auto] [overscroll-behavior:contain] [scroll-behavior:auto] [scrollbar-gutter:stable]"
        >
          <div data-timeline-list className="agent-thread-shell mx-auto flex flex-col">
            {hasEarlier && onLoadEarlier ? (
              <LoadEarlierButton onLoadEarlier={onLoadEarlier} />
            ) : null}
            {visibleMessages.map((message, index) => {
              const isLast = index === visibleMessages.length - 1;
              const prevRole = index > 0 ? visibleMessages[index - 1].role : null;
              const isGrouped = message.role === prevRole;
              return (
                <div
                  key={message.id}
                  data-timeline-message-id={message.id}
                  className={`${isGrouped ? "pt-2" : "pt-6"} ${isLast ? "pb-4" : ""}`}
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
              <div className="pt-6 pb-4">
                <span className="codex-shimmer-text text-[length:var(--fs-base)] font-normal leading-5">
                  Thinking
                </span>
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
    </div>
  );
}

/** Top-of-thread affordance for tail-loaded sessions: fetches the previous page
 * of older history and prepends it. Rendered only while a history cursor
 * remains (older events exist beyond what is loaded). */
function LoadEarlierButton({ onLoadEarlier }: { onLoadEarlier: () => Promise<void> | void }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="flex justify-center pt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void Promise.resolve(onLoadEarlier()).finally(() => setPending(false));
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-(--border) bg-(--surface) px-3 py-1 text-[length:var(--fs-xs)] text-(--fg)/70 transition-colors hover:text-(--fg) disabled:opacity-60"
        aria-label="Load earlier messages"
      >
        {pending ? "Loading earlier…" : "Load earlier messages"}
      </button>
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
      className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-(--border) bg-(--color-popover) px-3 py-1 text-[length:var(--fs-xs)] text-(--fg)/85 shadow-[0_6px_20px_rgba(0,0,0,0.35)] transition-colors hover:text-(--fg)"
      aria-label="Scroll to latest"
    >
      {running ? "New messages" : "Latest"}
      <ChevronDownIcon className="h-3 w-3" />
    </button>
  );
}

const PROMPT_MARKER_HEIGHT_PX = 16;
const PROMPT_MARKER_GAP_PX = 10;
const PROMPT_MARKER_MAX_RATIO = 0.6;

type PromptMarkerEntry = {
  id: string;
  label: string;
  time: string;
};

function PromptMarkers({
  scroller,
  messages,
}: {
  scroller: HTMLDivElement | null;
  messages: ChatMessage[];
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const prompts = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user" && userPromptLabel(message).length > 0)
        .map((message) => ({
          id: message.id,
          label: userPromptLabel(message),
          time: formatPromptTime(message.timestamp),
        })),
    [messages],
  );
  const viewportHeight = useScrollerViewportHeight(scroller);
  if (!scroller || prompts.length === 0) return null;
  const maxCount = Math.max(
    1,
    Math.floor(
      (viewportHeight * PROMPT_MARKER_MAX_RATIO + PROMPT_MARKER_GAP_PX) /
        (PROMPT_MARKER_HEIGHT_PX + PROMPT_MARKER_GAP_PX),
    ),
  );
  const visible = prompts.length > maxCount ? prompts.slice(-maxCount) : prompts;
  const scrollToPrompt = (id: string) => {
    const node = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-timeline-message-id]"),
    ).find((element) => element.dataset.timelineMessageId === id);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  return (
    <nav className="prompt-minimap" aria-label="Session prompts">
      {visible.map((marker, index) => {
        const active = hoveredId === marker.id;
        return (
          <button
            key={marker.id}
            type="button"
            className="prompt-minimap-marker"
            data-current={index === visible.length - 1 ? "true" : undefined}
            aria-label={`Scroll to prompt: ${marker.label}`}
            onMouseEnter={() => setHoveredId(marker.id)}
            onMouseLeave={() => setHoveredId((value) => (value === marker.id ? null : value))}
            onFocus={() => setHoveredId(marker.id)}
            onBlur={() => setHoveredId((value) => (value === marker.id ? null : value))}
            onClick={(event) => {
              scrollToPrompt(marker.id);
              setHoveredId(null);
              event.currentTarget.blur();
            }}
          >
            <span className="prompt-minimap-line" />
            {active ? (
              <span className="prompt-minimap-card" role="tooltip">
                <span className="prompt-minimap-card-text">{marker.label}</span>
                <span className="prompt-minimap-card-time">{marker.time || "Prompt"}</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function useScrollerViewportHeight(scroller: HTMLDivElement | null): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!scroller) return () => undefined;
      const resizeObserver = new ResizeObserver(onStoreChange);
      resizeObserver.observe(scroller);
      return () => resizeObserver.disconnect();
    },
    [scroller],
  );
  return useSyncExternalStore(
    subscribe,
    () => scroller?.clientHeight ?? 0,
    () => 0,
  );
}

function userPromptLabel(message: ChatMessage): string {
  const text = message.text.trim();
  if (text) return text.replace(/\s+/g, " ");
  if (message.attachments?.length) {
    return message.attachments.map((attachment) => attachment.name).join(", ");
  }
  return "";
}

function formatPromptTime(timestamp?: string): string {
  const value = timestamp?.trim() ?? "";
  if (!value) return "";
  if (/^\d{1,2}:\d{2}(?:\s?[AP]M)?$/i.test(value)) return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(parsed),
  );
}

type MergedRun = { segments: ChatMessage[]; merged: ChatMessage };
const MERGE_CACHE_MAX_ENTRIES = 512;

// Streaming commits a fresh `messages` array every animation frame, so this
// merge runs per frame. The per-run cache keeps a merged turn's object
// identity stable while its segments are unchanged — otherwise every settled
// multi-segment turn would get a new identity each frame and its MemoMessage
// would re-render for the whole stream.
function mergeConsecutiveAssistantMessages(
  messages: ChatMessage[],
  cache: Map<string, MergedRun>,
): ChatMessage[] {
  const merged: ChatMessage[] = [];
  let run: ChatMessage[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      merged.push(run[0]);
    } else {
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
  if (cache.size >= MERGE_CACHE_MAX_ENTRIES) cache.clear();
  cache.set(first.id, { segments: run, merged: combined });
  return combined;
}

const AT_BOTTOM_THRESHOLD_PX = 80;
const USER_HOLD_MS = 700;

/**
 * Keeps the chat locked to the latest message while streaming and re-pins after
 * any layout growth (new tokens, expanded reasoning, async-loaded history), so
 * the view never drifts off the bottom or shifts under the user.
 *
 * Proximity to the bottom is the single source of truth: if the viewport is at
 * the bottom we follow new content, otherwise we leave the user where they are.
 * `scrollTop` can move from three sources — a genuine user scroll, our own pin
 * write, and now native scroll anchoring compensating for above-viewport growth
 * — but all three classify correctly via `atBottom()`: an anchoring adjustment
 * while scrolled up keeps us off-bottom (stays detached), and while pinned the
 * next pin write re-asserts the bottom, so neither is misread as "scrolled up".
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
  viewKey,
  viewAlias,
}: {
  scroller: HTMLDivElement | null;
  bottom: HTMLDivElement | null;
  stickToBottom: boolean;
  onStickToBottomChange?: (value: boolean) => void;
  viewKey: string | null;
  viewAlias: string | null;
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
  useMountSubscription(() => {
    stickRef.current = stickToBottom;
  }, [stickToBottom]);
  useMountSubscription(() => {
    onChangeRef.current = onStickToBottomChange;
  }, [onStickToBottomChange]);

  useMountSubscription(() => {
    const el = scroller;
    if (!el) return;
    const viewIdentity = viewKey ? { key: viewKey, aliases: viewAlias ? [viewAlias] : [] } : null;
    const restored = viewIdentity ? readSessionView(window.localStorage, viewIdentity) : null;
    let pendingRestoreTop = restored && !restored.stickToBottom ? restored.scrollTop : null;
    let persistTimer: EffectTimer | null = null;

    const distanceFromBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = () => distanceFromBottom() <= AT_BOTTOM_THRESHOLD_PX;

    const pinToBottom = () => {
      pendingRestoreTop = null;
      el.scrollTop = el.scrollHeight;
    };
    const restoreScrollTop = () => {
      if (pendingRestoreTop === null) return;
      const maximum = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(pendingRestoreTop, maximum);
      if (maximum >= pendingRestoreTop) pendingRestoreTop = null;
    };
    const persist = () => {
      if (!viewIdentity) return;
      persistTimer?.cancel();
      persistTimer = effectTimeout(() => {
        patchSessionView(window.localStorage, viewIdentity, {
          scrollTop: el.scrollTop,
          stickToBottom: stickRef.current,
        });
      }, 120);
    };
    let pinFrame: number | null = null;
    const schedulePinToBottom = () => {
      if (!stickRef.current || pinFrame !== null) return;
      pinFrame = window.requestAnimationFrame(() => {
        pinFrame = null;
        if (stickRef.current) pinToBottom();
      });
    };
    const setStick = (next: boolean) => {
      if (stickRef.current === next) return;
      stickRef.current = next;
      onChangeRef.current?.(next);
      persist();
    };

    const onScroll = () => {
      if (pendingRestoreTop !== null) {
        restoreScrollTop();
        if (pendingRestoreTop !== null) return;
      }
      if (atBottom()) {
        // Briefly respect a deliberate scroll-up near the bottom instead of
        // immediately re-locking and fighting the user.
        if (Date.now() < userHoldUntilRef.current) return;
        setStick(true);
        persist();
        return;
      }
      setStick(false);
      persist();
    };

    const holdAndDetach = () => {
      pendingRestoreTop = null;
      userHoldUntilRef.current = Date.now() + USER_HOLD_MS;
      setStick(false);
    };
    const releaseHold = () => {
      pendingRestoreTop = null;
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

    // Follow content + viewport growth while pinned. Coalesce observer bursts to
    // one scroll write per animation frame; streamed tool/thinking text can
    // otherwise trigger a scrollTop write for every token and make the timeline
    // look like it is flickering or fighting itself.
    const listEl = bottom?.parentElement ?? el;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (pendingRestoreTop !== null) restoreScrollTop();
            else schedulePinToBottom();
          });
    resizeObserver?.observe(el);
    if (listEl !== el) resizeObserver?.observe(listEl);

    // Structural timeline changes need following; characterData streaming is
    // deliberately excluded and left to ResizeObserver so we don't do a DOM
    // scroll write on every token.
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            if (pendingRestoreTop !== null) restoreScrollTop();
            else schedulePinToBottom();
          });
    mutationObserver?.observe(listEl, { childList: true, subtree: true });

    // Initial alignment (also covers async-loaded history once it renders, via
    // the ResizeObserver above).
    if (restored) {
      stickRef.current = restored.stickToBottom;
      onChangeRef.current?.(restored.stickToBottom);
    }
    if (stickRef.current) pinToBottom();
    else restoreScrollTop();

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (pinFrame !== null) window.cancelAnimationFrame(pinFrame);
      persistTimer?.cancel();
      if (viewIdentity) {
        patchSessionView(window.localStorage, viewIdentity, {
          scrollTop: el.scrollTop,
          stickToBottom: stickRef.current,
        });
      }
    };
  }, [bottom, scroller, viewKey, viewAlias]);

  // When the parent forces stick=true (submit, tab change, session load), snap
  // back to the bottom and clear any lingering hold.
  useMountSubscription(() => {
    if (stickToBottom && scroller) {
      stickRef.current = true;
      userHoldUntilRef.current = 0;
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [stickToBottom, scroller]);
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
