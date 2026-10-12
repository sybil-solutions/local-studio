"use client";

import { useMemo } from "react";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import {
  sidebarStatusFromSnapshot,
  type SidebarStatusSnapshot,
} from "@/hooks/realtime-status-types";

export type { SidebarStatusSnapshot };

/** Sidebar/server-page view over the realtime status store: a pure derivation,
 *  no listener or poll of its own. */
export function useSidebarStatus(): SidebarStatusSnapshot {
  const { connected, status, launchProgress } = useRealtimeStatusStore();
  return useMemo(
    () => sidebarStatusFromSnapshot({ connected, status, launchProgress }),
    [connected, status, launchProgress],
  );
}
