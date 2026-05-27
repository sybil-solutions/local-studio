"use client";

import { memo, useMemo, useRef } from "react";
import { useTimelineScrollEffects } from "@/hooks/agent/use-timeline-scroll-effects";
import type { ChatMessage } from "@/lib/agent/session";
import { MessageView } from "./message-view";

type TimelineProps = {
  messages: ChatMessage[];
  running: boolean;
  statusLabel?: string;
  emptyPrompt?: boolean;
  stickToBottom?: boolean;
  onStickToBottomChange?: (value: boolean) => void;
};

const MemoMessage = memo(
  function MemoMessage({ message }: { message: ChatMessage }) {
    return <MessageView message={message} />;
  },
  (prev, next) => prev.message === next.message,
);

export function Timeline({
  messages,
  running,
  statusLabel,
  emptyPrompt = false,
  stickToBottom = true,
  onStickToBottomChange,
}: TimelineProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );

  useTimelineScrollEffects({
    scrollerRef,
    bottomRef,
    stickToBottom,
    itemCount: visibleMessages.length,
    running,
    statusLabel,
    onStickToBottomChange,
  });

  if (emptyPrompt) {
    return (
      <div className="flex min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-10 pt-2">
        <div className="mx-auto flex w-full max-w-[var(--thread-w)] flex-1">
          <div className="flex flex-1 items-center justify-center text-center text-[26px] font-medium leading-[1.35] text-(--fg)">
            <p className="max-w-[680px]">
              A dream is something you build for yourself.
              <br />
              Just talk to it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      data-timeline-scroller
      className="agent-chat-scroller min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-1 pt-2 [overflow-anchor:none] [overscroll-behavior:contain] [scroll-behavior:auto] [scrollbar-gutter:stable_both-edges]"
    >
      <div data-timeline-list className="mx-auto flex w-full max-w-[var(--thread-w)] flex-col">
        {visibleMessages.map((message, index) => {
          const isLast = index === visibleMessages.length - 1;
          const prevRole = index > 0 ? visibleMessages[index - 1].role : null;
          const isGrouped = message.role === prevRole;
          return (
            <div
              key={message.id}
              className={`[overflow-anchor:none] ${isGrouped ? "pt-2" : "pt-6"} ${isLast ? "pb-4" : ""} ${isLast ? "" : "[content-visibility:auto] [contain-intrinsic-size:auto_220px]"}`}
            >
              <MemoMessage message={message} />
            </div>
          );
        })}
        {running ? (
          <div className="pt-6 pb-4 [overflow-anchor:none]">
            <div className="flex items-center gap-2.5 text-[10.4px] leading-4 text-(--dim)">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--accent)/40 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-(--accent)/60" />
              </span>
              <span className="animate-pulse">Thinking…</span>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} aria-hidden="true" className="[overflow-anchor:none]" />
      </div>
    </div>
  );
}
