import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const AT_BOTTOM_THRESHOLD_PX = 64;

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
  const stickRef = useRef(stickToBottom);
  useEffect(() => {
    stickRef.current = stickToBottom;
  }, [stickToBottom]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !onStickToBottomChange) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX;
      if (atBottom !== stickRef.current) onStickToBottomChange(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollerRef, onStickToBottomChange]);

  useLayoutEffect(() => {
    if (!stickRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [bottomRef, itemCount, running, statusLabel, stickToBottom]);
}
