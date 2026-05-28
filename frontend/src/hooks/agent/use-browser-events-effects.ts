import { useCallback, useSyncExternalStore } from "react";
import type { BrowserEventsSubscription } from "@/lib/agent/workspace/effects";

export function useBrowserEventsEffects({
  browserEvents,
  enabled,
}: {
  browserEvents: BrowserEventsSubscription;
  enabled: boolean;
}) {
  const subscribe = useCallback(
    (_notify: () => void) => {
      browserEvents.setEnabled(enabled);
      return () => browserEvents.setEnabled(false);
    },
    [browserEvents, enabled],
  );

  useSyncExternalStore(subscribe, getBrowserEventsSnapshot, getBrowserEventsSnapshot);
}

const getBrowserEventsSnapshot = (): number => 0;
