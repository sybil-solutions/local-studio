import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Effect } from "effect";
import type { ComposerMention } from "@/features/agent/composer-context";
import {
  newId,
  visibleQueuedMessages,
  type ChatPaneHandle,
  type SessionTab,
} from "@/features/agent/messages";
import type { SessionEngine } from "@/features/agent/runtime/engine";
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
  tabs: SessionTab[];
}) {
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const running = activeTab?.status === "running" || activeTab?.status === "starting";
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
    visibleQueueItems: visibleQueuedMessages(queue),
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
  activeTab: SessionTab | null;
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
    const { piSessionId, messages, status } = activeTab;
    if (!piSessionId || messages.length > 0 || status !== "idle") return;
    if (replayedRef.current.has(activeTabId)) return;
    replayedRef.current.add(activeTabId);
    void engine.loadAndReplay(piSessionId, activeTabId);
  }, [activeTab, activeTabId, isFocused, engine]);
  const loadAndReplay = useCallback(
    (piSessionId: string) =>
      activeTabId ? engine.loadAndReplay(piSessionId, activeTabId) : Promise.resolve(),
    [activeTabId, engine],
  );
  const compactSession = useCallback(() => {
    if (!activeTab || running || compacting || !modelId) return Promise.resolve();
    setCompacting(true);
    return Effect.runPromise(
      Effect.tryPromise({ try: () => engine.compact(activeTab.id), catch: (error) => error }).pipe(
        Effect.ensuring(Effect.sync(() => setCompacting(false))),
      ),
    );
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

  useMountSubscription(() => {
    if (!mention || mention.kind !== "file" || !cwd) {
      setFileMentionRows([]);
      return;
    }
    let cancelled = false;
    void Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () => fetch(`/api/agent/fs?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" }),
          catch: (error) => error,
        });
        const payload = response.ok
          ? yield* Effect.tryPromise({
              try: () =>
                response.json() as Promise<{
                  entries?: Array<{ name: string; rel: string; path: string; kind: string }>;
                }>,
              catch: (error) => error,
            })
          : null;
        if (cancelled) return;
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
      }).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            if (!cancelled) setFileMentionRows([]);
          }),
        ),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [cwd, mention, setFileMentionRows]);
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
