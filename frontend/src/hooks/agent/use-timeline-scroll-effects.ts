import { useCallback, useRef, useSyncExternalStore, type RefObject } from "react";

const AT_BOTTOM_THRESHOLD_PX = 64;
const RETURN_TO_BOTTOM_IDLE_MS = 250;
const PROGRAMMATIC_SCROLL_IGNORE_MS = 120;
const USER_SCROLL_INTENT_MS = 700;

const getTimelineScrollSnapshot = (): number => 0;

export function useTimelineScrollEffects({
  scrollerRef,
  bottomRef,
  stickToBottom,
  itemCount,
  running,
  statusLabel,
  onStickToBottomChange,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  stickToBottom: boolean;
  itemCount: number;
  running: boolean;
  statusLabel?: string;
  onStickToBottomChange?: (value: boolean) => void;
}) {
  // `stickRef` is the SYNCHRONOUS source of truth that the layout effect
  // consults. The parent's `stickToBottom` prop is the eventually-consistent
  // mirror used for UI like a "jump to latest" button. We flip the ref
  // immediately on user input so streaming `scrollIntoView` writes never
  // fight a user scroll-up gesture mid-frame (which is the visible "shake").
  const stickRef = useRef(stickToBottom);

  // Cache the callback in a ref so listener registration never re-binds
  // when the parent hands us a new function identity per render.
  const onChangeRef = useRef(onStickToBottomChange);

  const subscribeStickRef = useCallback(() => {
    stickRef.current = stickToBottom;
    return () => undefined;
  }, [stickToBottom]);

  const subscribeOnChangeRef = useCallback(() => {
    onChangeRef.current = onStickToBottomChange;
    return () => undefined;
  }, [onStickToBottomChange]);

  const subscribeScrollListeners = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return () => undefined;
    let rafId: number | null = null;
    let scrollRafId: number | null = null;
    let followupScrollRafId: number | null = null;
    let returnTimer: number | null = null;
    let userScrollIntentUntil = 0;
    let pointerScrollActive = false;
    // `programmaticScrollUntil` lets us ignore scroll events emitted by our
    // own writes; otherwise a sticky scroll can immediately re-evaluate
    // against a transient layout and toggle state.
    let programmaticScrollUntil = 0;

    const markProgrammaticScroll = () => {
      programmaticScrollUntil = performance.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    };
    const scrollToBottom = () => {
      if (!stickRef.current) return;
      markProgrammaticScroll();
      el.scrollTop = el.scrollHeight;
      if (scrollRafId != null) return;
      scrollRafId = window.requestAnimationFrame(() => {
        scrollRafId = null;
        if (!stickRef.current) return;
        markProgrammaticScroll();
        el.scrollTop = el.scrollHeight;
        followupScrollRafId = window.requestAnimationFrame(() => {
          followupScrollRafId = null;
          if (!stickRef.current) return;
          markProgrammaticScroll();
          el.scrollTop = el.scrollHeight;
        });
      });
    };

    const evaluate = () => {
      rafId = null;
      if (performance.now() < programmaticScrollUntil) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX;

      if (!atBottom && stickRef.current) {
        const userIntendedScroll = pointerScrollActive || performance.now() < userScrollIntentUntil;
        if (!userIntendedScroll) {
          // Content grew between frames while we were sticky. Do not interpret
          // that scroll-height delta as the user scrolling up; follow it.
          scrollToBottom();
          return;
        }
        // User started scrolling up. Detach IMMEDIATELY so streaming content
        // can no longer yank the viewport. Tell the parent on the same tick so
        // any chrome (jump-to-latest button) updates promptly.
        stickRef.current = false;
        onChangeRef.current?.(false);
        if (returnTimer != null) {
          window.clearTimeout(returnTimer);
          returnTimer = null;
        }
        return;
      }

      if (atBottom && !stickRef.current) {
        // Don't re-stick the moment the user grazes the bottom — wait until
        // they've been idle there. This prevents inertial rubber-banding
        // from causing rapid stick/unstick oscillation.
        if (returnTimer != null) return;
        returnTimer = window.setTimeout(() => {
          returnTimer = null;
          const stillAtBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX;
          if (stillAtBottom) {
            stickRef.current = true;
            onChangeRef.current?.(true);
          }
        }, RETURN_TO_BOTTOM_IDLE_MS);
      }
    };

    const onScroll = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(evaluate);
    };
    const restickIfAtBottom = () => {
      if (stickRef.current) return;
      window.requestAnimationFrame(() => {
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX;
        if (!atBottom) return;
        stickRef.current = true;
        onChangeRef.current?.(true);
        scrollToBottom();
      });
    };
    const markUserScrollIntent = () => {
      userScrollIntentUntil = performance.now() + USER_SCROLL_INTENT_MS;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        markUserScrollIntent();
        return;
      }
      if (event.deltaY > 0) restickIfAtBottom();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== el) return;
      pointerScrollActive = true;
      markUserScrollIntent();
    };
    const onPointerUp = () => {
      if (!pointerScrollActive) return;
      pointerScrollActive = false;
      markUserScrollIntent();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
        markUserScrollIntent();
        return;
      }
      if (["ArrowDown", "PageDown", "End"].includes(event.key)) {
        restickIfAtBottom();
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", markUserScrollIntent, { passive: true });
    el.addEventListener("touchmove", markUserScrollIntent, { passive: true });
    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    el.addEventListener("keydown", onKeyDown);

    const listEl = bottomRef.current?.parentElement;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (stickRef.current) scrollToBottom();
          });
    if (listEl) resizeObserver?.observe(listEl);
    resizeObserver?.observe(el);

    // Expose a marker the scroll sync can set when it programmatically
    // scrolls, so we don't misread our own writes as user input.
    (el as HTMLElement & { __markProgrammaticScroll?: () => void }).__markProgrammaticScroll =
      markProgrammaticScroll;

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", markUserScrollIntent);
      el.removeEventListener("touchmove", markUserScrollIntent);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("keydown", onKeyDown);
      resizeObserver?.disconnect();
      if (rafId != null) window.cancelAnimationFrame(rafId);
      if (scrollRafId != null) window.cancelAnimationFrame(scrollRafId);
      if (followupScrollRafId != null) window.cancelAnimationFrame(followupScrollRafId);
      if (returnTimer != null) window.clearTimeout(returnTimer);
      delete (el as HTMLElement & { __markProgrammaticScroll?: () => void })
        .__markProgrammaticScroll;
    };
  }, [bottomRef, scrollerRef]);

  const subscribeStickyScroll = useCallback(() => {
    if (!stickRef.current) return () => undefined;
    const scroller = scrollerRef.current as
      | (HTMLElement & { __markProgrammaticScroll?: () => void })
      | null;
    if (!scroller || !bottomRef.current) return () => undefined;
    scroller?.__markProgrammaticScroll?.();
    // Keep the write scoped to the timeline scroller. `scrollIntoView` walks
    // ancestor scrollers too; when a submit swaps the empty-state view for the
    // real timeline it can accidentally yank the chat container to the top.
    // Directly assigning scrollTop avoids touching any parent scroll context.
    scroller.scrollTop = scroller.scrollHeight;
    let followupRafId: number | null = null;
    const rafId = window.requestAnimationFrame(() => {
      if (!stickRef.current) return;
      scroller.__markProgrammaticScroll?.();
      scroller.scrollTop = scroller.scrollHeight;
      followupRafId = window.requestAnimationFrame(() => {
        if (!stickRef.current) return;
        scroller.__markProgrammaticScroll?.();
        scroller.scrollTop = scroller.scrollHeight;
      });
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      if (followupRafId != null) window.cancelAnimationFrame(followupRafId);
    };
  }, [bottomRef, scrollerRef, itemCount, running, statusLabel]);

  useSyncExternalStore(subscribeStickRef, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeOnChangeRef, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(
    subscribeScrollListeners,
    getTimelineScrollSnapshot,
    getTimelineScrollSnapshot,
  );
  useSyncExternalStore(subscribeStickyScroll, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
}
