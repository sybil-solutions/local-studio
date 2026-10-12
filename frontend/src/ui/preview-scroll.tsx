"use client";

import { useState, type ReactNode } from "react";
import { cx } from "./utils";

/**
 * Every tool output, file preview, diff and code block in the timeline scrolls
 * inside one of these.
 *
 * The problem this solves is layout shift while a turn streams. A `max-h` box
 * grows line by line as output arrives, so everything below it — the rest of
 * the transcript, the composer — slides down on every chunk, and the reader
 * loses their place mid-sentence. ChatGPT never does this: a preview claims its
 * space once and then scrolls inside it.
 *
 * So the height *latches*. While content is short the box hugs it (a two-line
 * `ls` should not reserve 320px of nothing). The first time content would
 * exceed the cap the box locks to exactly the cap and never resizes again, even
 * if the content later shrinks — one settle, then stillness.
 *
 * `stickToBottom` keeps the newest output visible the way a terminal does, but
 * only while the reader is already at the bottom. Scrolling up to read
 * something is a deliberate act and streaming must not yank you back down.
 */

export type PreviewHeight = "sm" | "md" | "lg";

export const PREVIEW_HEIGHT_PX: Record<PreviewHeight, number> = { sm: 240, md: 320, lg: 420 };

/** Rounding and sub-pixel line heights mean "at the bottom" needs slack. */
export const BOTTOM_SLACK_PX = 24;

/**
 * Latch, never unlatch. Once a preview has claimed its full height, shrinking
 * back when content is deleted would be a second layout shift for no gain.
 */
export function nextLockedState(locked: boolean, contentHeight: number, capPx: number): boolean {
  return locked || contentHeight > capPx;
}

/** True when the reader is parked at the bottom and wants to ride the stream. */
export function isAtBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_SLACK_PX;
}

export function PreviewScroll({
  children,
  height = "md",
  stickToBottom = true,
  className,
}: {
  children: ReactNode;
  height?: PreviewHeight;
  stickToBottom?: boolean;
  className?: string;
}) {
  const capPx = PREVIEW_HEIGHT_PX[height];
  const [locked, setLocked] = useState(false);

  const observeContent = (content: HTMLDivElement | null) => {
    if (!content) return;
    const viewport = content.parentElement;
    if (!viewport) return;

    // Sampled before the growth is painted, so "were we at the bottom" reflects
    // where the reader was, not where the new content pushed them.
    let wasAtBottom = true;
    const trackScroll = () => {
      wasAtBottom = isAtBottom(viewport.scrollHeight, viewport.scrollTop, viewport.clientHeight);
    };
    viewport.addEventListener("scroll", trackScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      setLocked((current) => nextLockedState(current, content.scrollHeight, capPx));
      if (stickToBottom && wasAtBottom) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(content);

    return () => {
      viewport.removeEventListener("scroll", trackScroll);
      observer.disconnect();
    };
  };

  return (
    <div
      className={cx("min-w-0 overscroll-contain", locked ? "overflow-auto" : "overflow-hidden", className)}
      style={locked ? { height: capPx } : undefined}
    >
      <div ref={observeContent} className="min-w-0">
        {children}
      </div>
    </div>
  );
}
