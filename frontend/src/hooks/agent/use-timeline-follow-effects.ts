import { useEffect, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

export function useTimelineFollowEffects({
  enabled,
  itemCount,
  statusLabel,
  virtuosoRef,
}: {
  enabled: boolean;
  itemCount: number;
  statusLabel?: string;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
}) {
  useEffect(() => {
    if (!enabled || itemCount === 0) return;
    const frame = requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ align: "end", index: "LAST" });
      virtuosoRef.current?.autoscrollToBottom();
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, itemCount, statusLabel, virtuosoRef]);
}
