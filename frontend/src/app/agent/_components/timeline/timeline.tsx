import { forwardRef, useCallback, useMemo, useRef, type ComponentPropsWithoutRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useTimelineFollowEffects } from "@/hooks/agent/use-timeline-follow-effects";
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

const TimelineList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      className={`mx-auto flex w-full max-w-[var(--thread-w)] flex-col ${className ?? ""}`}
    />
  ),
);
TimelineList.displayName = "TimelineList";

function TimelineItem({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={`pb-5 ${className ?? ""}`} />;
}

export function Timeline({
  messages,
  running,
  statusLabel,
  emptyPrompt = false,
  stickToBottom = true,
  onStickToBottomChange,
}: TimelineProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );
  const shouldFollowOutput = stickToBottom || running;
  const footer = useMemo(
    () =>
      running
        ? () => (
            <div className="mx-auto flex w-full max-w-[var(--thread-w)] items-center gap-2 py-4 text-xs text-(--dim)">
              <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-(--accent)" />
              <span className="animate-pulse">Pi is {statusLabel ?? "running"}…</span>
            </div>
          )
        : undefined,
    [running, statusLabel],
  );
  const handleAtBottomStateChange = useCallback(
    (atBottom: boolean) => {
      if (atBottom || !running) {
        onStickToBottomChange?.(atBottom);
        return;
      }
      if (stickToBottom) {
        requestAnimationFrame(() => virtuosoRef.current?.autoscrollToBottom());
      }
    },
    [onStickToBottomChange, running, stickToBottom],
  );

  useTimelineFollowEffects({
    enabled: shouldFollowOutput,
    itemCount: visibleMessages.length,
    statusLabel,
    virtuosoRef,
  });

  if (emptyPrompt) {
    return (
      <div className="flex min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-2">
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
    <div className="min-h-0 flex-1 px-6 pb-1 pt-2">
      <Virtuoso
        ref={virtuosoRef}
        className="h-full"
        data={visibleMessages}
        computeItemKey={(_, message) => message.id}
        defaultItemHeight={180}
        increaseViewportBy={{ top: 700, bottom: 1000 }}
        alignToBottom
        atBottomThreshold={80}
        atBottomStateChange={handleAtBottomStateChange}
        followOutput={() => (shouldFollowOutput ? "auto" : false)}
        initialTopMostItemIndex={Math.max(0, visibleMessages.length - 1)}
        components={{
          Footer: footer,
          Item: TimelineItem,
          List: TimelineList,
        }}
        itemContent={(_, message) => <MessageView message={message} />}
      />
    </div>
  );
}
