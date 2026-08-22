import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ComposerMention } from "@/features/agent/composer-context";
import { newId, type ChatPaneHandle } from "@/features/agent/messages";
import type { SessionEngine } from "@/features/agent/runtime/engine";
import type { Session } from "@/features/agent/runtime/types";
import type { ContextAttachRequest } from "@/features/agent/tools/types";
import { attachmentDedupKey, type ChatAttachment } from "@/features/agent/ui/chat-attachments";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export function useChatPaneDerivedState({
  activeTabId,
  contextWindow,
  tabs,
}: {
  activeTabId: string;
  contextWindow: number;
  tabs: Session[];
}) {
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const running =
    activeTab?.status === "running" ||
    activeTab?.status === "starting" ||
    activeTab?.status === "stopping";
  const showEmptyPrompt = activeTab && activeTab.messages.length === 0 && !running;
  const queue = activeTab?.queue ?? [];
  const sdkContextUsage = activeTab?.contextUsage ?? null;
  const currentContextTokens = sdkContextUsage?.tokens ?? activeTab?.tokenStats?.current ?? 0;
  const effectiveContextWindow =
    sdkContextUsage?.contextWindow && sdkContextUsage.contextWindow > 0
      ? sdkContextUsage.contextWindow
      : contextWindow;

  return {
    activeTab,
    currentContextTokens,
    effectiveContextWindow,
    running,
    showEmptyPrompt,
    // Every item still in the queue is pending delivery, so all of them show.
    // This used to hide `sent` items, which meant EVERY follow-up — they are
    // marked sent the moment pi accepts them — so the drawer stack was always
    // empty and queueing looked broken. Items leave the queue when pi actually
    // delivers them (the user echo) or contradicts us (`queue_update`).
    visibleQueueItems: queue,
  };
}

export function useChatPaneRuntimeHandle({
  activeTab,
  activeTabId,
  engine,
  modelId,
  isFocused,
  onRegisterHandle,
  running,
}: {
  activeTab: Session | null;
  activeTabId: string;
  engine: SessionEngine;
  modelId: string;
  isFocused: boolean;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
  running: boolean;
}) {
  const [compacting, setCompacting] = useState(false);
  const replayedRef = useRef<Set<string>>(new Set());
  useMountSubscription(() => {
    if (!isFocused || !activeTab) return;
    const { piSessionId, messages, status, hydratedFromCache } = activeTab;
    // Messages restored from the localStorage snapshot do NOT count as having
    // the transcript. Treating them as such is what made a reloaded session
    // show a truncated history with no "Load earlier": the snapshot is capped
    // at 200 messages / 512KB and carries no history cursor, so the replay
    // that would fetch the real tail was skipped and there was no way back to
    // the rest of the conversation short of reopening the session.
    const hasRealTranscript = messages.length > 0 && !hydratedFromCache;
    if (!piSessionId || hasRealTranscript || status !== "idle") return;
    if (replayedRef.current.has(activeTabId)) return;
    replayedRef.current.add(activeTabId);
    void engine.loadAndReplay(piSessionId, activeTabId);
  }, [activeTab, activeTabId, isFocused, engine]);
  const loadAndReplay = useCallback(
    (piSessionId: string) =>
      activeTabId ? engine.loadAndReplay(piSessionId, activeTabId) : Promise.resolve(),
    [activeTabId, engine],
  );
  const compactSession = useCallback(async () => {
    if (!activeTab || running || compacting || !modelId) return;
    setCompacting(true);
    try {
      await engine.compact(activeTab.id);
    } finally {
      setCompacting(false);
    }
  }, [activeTab, compacting, engine, modelId, running]);
  const handle = useMemo<ChatPaneHandle>(
    () => ({ sessionId: activeTabId, loadAndReplay, compact: compactSession }),
    [activeTabId, compactSession, loadAndReplay],
  );
  useMountSubscription(() => {
    if (!onRegisterHandle) return;
    onRegisterHandle(handle);
    return () => onRegisterHandle(null);
  }, [handle, onRegisterHandle]);
  return { compacting, compactSession };
}

type ChatPaneFileMentionRow = {
  id: string;
  name: string;
  rel: string;
  path: string;
  source: string;
};

export function useChatPaneMentionEffects({
  cwd,
  mention,
  setFileMentionRows,
  setMentionIndex,
}: {
  cwd: string;
  mention: ComposerMention | null;
  setFileMentionRows: Dispatch<SetStateAction<ChatPaneFileMentionRow[]>>;
  setMentionIndex: Dispatch<SetStateAction<number>>;
}): void {
  useMountSubscription(() => {
    setMentionIndex(0);
  }, [mention?.kind, mention?.query, setMentionIndex]);

  const mentionKind = mention?.kind ?? null;
  const mentionQuery = mention?.query ?? "";
  // Keyed on kind+query rather than the whole `mention` object: start/end move
  // with the caret, so depending on the object refetched the whole listing on
  // every keystroke even though the request never used those fields.
  useMountSubscription(() => {
    if (mentionKind !== "file" || !cwd) {
      setFileMentionRows([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const url = `/api/agent/fs/search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(mentionQuery)}`;
          const response = await fetch(url, { cache: "no-store" });
          const payload = response.ok
            ? ((await response.json()) as {
                entries?: Array<{ name: string; rel: string; path: string; kind: string }>;
              })
            : null;
          if (cancelled) return;
          // Server-ranked (basename hits first); keep its order.
          const rows = (payload?.entries ?? [])
            .filter((entry) => entry.kind === "file")
            .map((entry) => ({
              id: `file:${entry.rel}`,
              name: entry.name,
              rel: entry.rel,
              path: entry.path,
              source: "project",
            }));
          setFileMentionRows(rows);
        } catch {
          if (!cancelled) setFileMentionRows([]);
        }
      })();
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cwd, mentionKind, mentionQuery, setFileMentionRows]);
}

export function useChatPaneContextAttachEffect({
  contextAttachRequest,
  isFocused,
  setAttachments,
}: {
  contextAttachRequest: ContextAttachRequest | null;
  isFocused: boolean;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
}): void {
  const handledContextAttachRef = useRef(0);
  useMountSubscription(() => {
    if (
      contextAttachRequest &&
      isFocused &&
      handledContextAttachRef.current !== contextAttachRequest.id
    ) {
      handledContextAttachRef.current = contextAttachRequest.id;
      const attachment: ChatAttachment = {
        id: newId("ctx"),
        name: contextAttachRequest.label,
        type: "text/plain",
        size: contextAttachRequest.content.length,
        ...(contextAttachRequest.path ? { path: contextAttachRequest.path } : {}),
        mode: "text",
        content: contextAttachRequest.content,
        previewKind: "file",
      };
      setAttachments((current) => {
        const nextKey = attachmentDedupKey(attachment);
        if (current.some((file) => attachmentDedupKey(file) === nextKey)) return current;
        return [...current, attachment];
      });
    }
  }, [contextAttachRequest, isFocused, setAttachments]);
}
