import { useCallback, useRef, useSyncExternalStore, type RefObject } from "react";

const AT_BOTTOM_THRESHOLD_PX = 64;
export const TIMELINE_USER_LAYOUT_EVENT = "vllm-studio.timeline.user-layout-change";

const getTimelineScrollSnapshot = (): number => 0;

/**
 * Keeps the chat pinned to the latest message while streaming, yields to the
 * user the moment they intentionally scroll up to read history, and re-pins when
 * they return to the bottom.
 *
 * Detach is driven by genuine *user intent* (wheel-up, scrollbar drag, upward
 * touch drag, scroll-up keys, or expanding a detail block) rather than by a raw
 * decrease in `scrollTop`. Layout growth while streaming can momentarily shift
 * scroll geometry, so direction alone is noisy. Re-attach is driven by an
 * IntersectionObserver on the bottom sentinel, so reaching the bottom by any
 * means re-pins. Our own follow-writes never set intent, so they can't detach.
 */
export function useTimelineScrollEffects({
  scrollerRef,
  bottomRef,
  stickToBottom,
  onStickToBottomChange,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  stickToBottom: boolean;
  onStickToBottomChange?: (value: boolean) => void;
}) {
  // Synchronous source of truth the handlers read. The parent's `stickToBottom`
  // prop is the eventually-consistent mirror (drives chrome and lets submit /
  // tab-change force a re-stick); `onChangeRef` reports our changes back to it.
  const stickRef = useRef(stickToBottom);
  const onChangeRef = useRef(onStickToBottomChange);
  const programmaticScrollUntilRef = useRef(0);
  const userScrollIntentUntilRef = useRef(0);
  const lastScrollTopRef = useRef(0);

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
    const el = scrollerRef.current;
    if (!el) return () => undefined;

    const distanceFromBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = () => distanceFromBottom() <= AT_BOTTOM_THRESHOLD_PX;

    const pinToBottom = () => {
      programmaticScrollUntilRef.current = Date.now() + 200;
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
    };
    const setStick = (next: boolean) => {
      if (stickRef.current === next) return;
      stickRef.current = next;
      onChangeRef.current?.(next);
    };

    // User intent: an upward gesture detaches immediately. A downward gesture
    // that lands at the bottom re-attaches (the sentinel observer also covers
    // re-attach, but handling it here makes the wheel case feel instant).
    const onWheel = (event: WheelEvent) => {
      userScrollIntentUntilRef.current = Date.now() + 800;
      if (event.deltaY < 0) setStick(false);
      else if (atBottom()) setStick(true);
    };
    let pointerActive = false;
    const onPointerDown = () => {
      pointerActive = true;
      userScrollIntentUntilRef.current = Date.now() + 1_200;
    };
    const onPointerMove = () => {
      if (pointerActive) userScrollIntentUntilRef.current = Date.now() + 1_200;
    };
    const onPointerEnd = () => {
      pointerActive = false;
      userScrollIntentUntilRef.current = Date.now() + 300;
    };
    const onScroll = () => {
      const now = Date.now();
      const previousScrollTop = lastScrollTopRef.current;
      lastScrollTopRef.current = el.scrollTop;
      if (now < programmaticScrollUntilRef.current) return;
      if (atBottom()) {
        setStick(true);
        return;
      }
      if (now < userScrollIntentUntilRef.current || el.scrollTop < previousScrollTop - 1) {
        setStick(false);
      }
    };
    const onUserLayoutChange = () => {
      userScrollIntentUntilRef.current = Date.now() + 2_000;
      setStick(false);
    };
    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      userScrollIntentUntilRef.current = Date.now() + 1_200;
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      userScrollIntentUntilRef.current = Date.now() + 800;
      const y = event.touches[0]?.clientY ?? null;
      if (touchY !== null && y !== null && y - touchY > 2) setStick(false);
      touchY = y;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
        userScrollIntentUntilRef.current = Date.now() + 800;
        setStick(false);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener(TIMELINE_USER_LAYOUT_EVENT, onUserLayoutChange as EventListener);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);

    // Re-attach whenever the bottom sentinel scrolls back into view by any means.
    const sentinel = bottomRef.current;
    const intersectionObserver =
      typeof IntersectionObserver === "undefined" || !sentinel
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (Date.now() < userScrollIntentUntilRef.current) return;
              if (entries.some((entry) => entry.isIntersecting)) setStick(true);
            },
            { root: el, rootMargin: `0px 0px ${AT_BOTTOM_THRESHOLD_PX}px 0px` },
          );
    if (sentinel) intersectionObserver?.observe(sentinel);

    // Follow content + viewport growth while pinned. Running synchronously in the
    // observer callback means a growth never momentarily reads as "not at bottom".
    const listEl = sentinel?.parentElement ?? el;
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

    // Initial alignment.
    lastScrollTopRef.current = el.scrollTop;
    if (stickRef.current) pinToBottom();

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener(TIMELINE_USER_LAYOUT_EVENT, onUserLayoutChange as EventListener);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [bottomRef, scrollerRef]);

  // When the parent forces stick=true (submit, tab change, jump-to-latest) and we
  // aren't already near the bottom, snap down. Guarded so re-sticking from a
  // graze of the bottom doesn't cause a visible jump.
  const subscribeForceStick = useCallback(() => {
    const el = scrollerRef.current;
    if (
      stickToBottom &&
      el &&
      el.scrollHeight - el.scrollTop - el.clientHeight > AT_BOTTOM_THRESHOLD_PX
    ) {
      programmaticScrollUntilRef.current = Date.now() + 200;
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
    }
    return () => undefined;
  }, [stickToBottom, scrollerRef]);

  useSyncExternalStore(subscribeStickRef, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeOnChangeRef, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeScroll, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeForceStick, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
}
