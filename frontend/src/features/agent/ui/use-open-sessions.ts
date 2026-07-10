"use client";

import { useSyncExternalStore } from "react";
import {
  getOpenSessions,
  subscribeOpenSessions,
  type OpenAgentSession,
} from "@/features/agent/session-index";

export function useOpenSessions(): readonly OpenAgentSession[] {
  return useSyncExternalStore(subscribeOpenSessions, getOpenSessions, getOpenSessions);
}
