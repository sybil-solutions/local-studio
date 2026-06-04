import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import type { ComposerMention } from "@/lib/agent/composer-context";
import { newId, type ChatPaneHandle } from "@/lib/agent/session";
import type { ContextAttachRequest } from "@/lib/agent/tools/types";
import { attachmentDedupKey, type ChatAttachment } from "@/app/agent/_components/chat-attachments";

const getChatPaneSnapshot = (): number => 0;

export type ChatPaneFileMentionRow = {
  id: string;
  name: string;
  rel: string;
  path: string;
  source: string;
};

export function useChatPaneStickToBottomEffect({
  activeTabId,
  setStickToBottom,
}: {
  activeTabId: string | null | undefined;
  setStickToBottom: Dispatch<SetStateAction<boolean>>;
}): void {
  const subscribeStickToBottom = useCallback(() => {
    setStickToBottom(true);
    return () => undefined;
  }, [activeTabId, setStickToBottom]);

  useSyncExternalStore(subscribeStickToBottom, getChatPaneSnapshot, getChatPaneSnapshot);
}

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
  const subscribeMentionIndex = useCallback(() => {
    setMentionIndex(0);
    return () => undefined;
  }, [mention?.kind, mention?.query, setMentionIndex]);

  const subscribeMentionRows = useCallback(() => {
    if (!mention || mention.kind !== "plugin" || !cwd) {
      setFileMentionRows([]);
      return () => undefined;
    }
    let cancelled = false;
    void fetch(`/api/agent/fs?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          payload: {
            entries?: Array<{ name: string; rel: string; path: string; kind: string }>;
          } | null,
        ) => {
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
        },
      )
      .catch(() => {
        if (!cancelled) setFileMentionRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, mention, setFileMentionRows]);

  useSyncExternalStore(subscribeMentionIndex, getChatPaneSnapshot, getChatPaneSnapshot);
  useSyncExternalStore(subscribeMentionRows, getChatPaneSnapshot, getChatPaneSnapshot);
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
  const subscribeContextAttach = useCallback(() => {
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
    return () => undefined;
  }, [contextAttachRequest, isFocused, setAttachments]);

  useSyncExternalStore(subscribeContextAttach, getChatPaneSnapshot, getChatPaneSnapshot);
}

export function useChatPaneRegisterHandleEffect({
  handleRef,
  onRegisterHandle,
}: {
  handleRef: RefObject<ChatPaneHandle>;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
}): void {
  const subscribeHandle = useCallback(() => {
    if (!onRegisterHandle) return () => undefined;
    const handle: ChatPaneHandle = {
      loadAndReplay: (id) => handleRef.current.loadAndReplay(id),
      compact: () => handleRef.current.compact(),
    };
    onRegisterHandle(handle);
    return () => onRegisterHandle(null);
  }, [handleRef, onRegisterHandle]);

  useSyncExternalStore(subscribeHandle, getChatPaneSnapshot, getChatPaneSnapshot);
}
