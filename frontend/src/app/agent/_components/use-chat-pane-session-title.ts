"use client";

import { useCallback, useMemo } from "react";
import { useProjectsNavSessionPrefs } from "@/hooks/agent/use-projects-nav-section-effects";
import { cleanSessionTitle, type SessionTab } from "@/lib/agent/session";
import { copySessionPref, patchSessionPref } from "@/lib/agent/session/prefs";

export function useChatPaneSessionTitle({
  activeTab,
  activeTabId,
  paneId,
  running,
  onPiSessionIdChange,
  onRenameSession,
}: {
  activeTab: SessionTab | null;
  activeTabId: string;
  paneId: string;
  running: boolean;
  onPiSessionIdChange?: (sessionId: string) => void;
  onRenameSession: (tabId: string, title: string) => void;
}) {
  const sessionPrefs = useProjectsNavSessionPrefs();
  const sessionPrefKeys = useMemo(
    () =>
      [
        activeTab?.piSessionId,
        paneId && activeTab?.id ? `tab:${paneId}:${activeTab.id}` : null,
      ].filter((value): value is string => Boolean(value)),
    [activeTab?.id, activeTab?.piSessionId, paneId],
  );
  const sessionPrefTitle = sessionPrefKeys.reduce((title, key) => {
    const nextTitle = cleanSessionTitle(sessionPrefs[key]?.title);
    return nextTitle || title;
  }, "");
  // Empty starter/restored tabs stay visually untitled until user content arrives.
  const sessionLooksEmpty =
    !activeTab || (activeTab.messages.length === 0 && !activeTab.input.trim() && !running);
  const displayedSessionTitle = sessionLooksEmpty
    ? ""
    : sessionPrefTitle || cleanSessionTitle(activeTab?.title) || "";
  const sessionPinned = sessionPrefKeys.some((key) => Boolean(sessionPrefs[key]?.pinned));
  const patchActiveSessionPrefs = useCallback(
    (patch: { title?: string; pinned?: boolean }) => {
      for (const key of sessionPrefKeys) patchSessionPref(key, patch);
    },
    [sessionPrefKeys],
  );
  const togglePinnedSession = useCallback(() => {
    if (sessionPrefKeys.length === 0) return;
    patchActiveSessionPrefs({ pinned: !sessionPinned });
  }, [patchActiveSessionPrefs, sessionPinned, sessionPrefKeys.length]);
  const handlePiSessionIdChange = useCallback(
    (piSessionId: string) => {
      if (paneId && activeTabId) copySessionPref(`tab:${paneId}:${activeTabId}`, piSessionId);
      onPiSessionIdChange?.(piSessionId);
    },
    [activeTabId, onPiSessionIdChange, paneId],
  );
  const renameActiveSession = useCallback(
    (nextTitle: string) => {
      if (!activeTab) return;
      const trimmed = cleanSessionTitle(nextTitle);
      if (!trimmed || trimmed === displayedSessionTitle) return;
      onRenameSession(activeTab.id, trimmed);
      patchActiveSessionPrefs({ title: trimmed });
    },
    [activeTab, displayedSessionTitle, onRenameSession, patchActiveSessionPrefs],
  );

  return {
    displayedSessionTitle,
    sessionPinned,
    togglePinnedSession,
    handlePiSessionIdChange,
    renameActiveSession,
  };
}
