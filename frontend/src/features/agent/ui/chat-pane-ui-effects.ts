import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Effect } from "effect";
import type { ComposerMention } from "@/features/agent/composer-context";
import { newId } from "@/features/agent/messages";
import type { ContextAttachRequest } from "@/features/agent/tools/types";
import { attachmentDedupKey, type ChatAttachment } from "@/features/agent/ui/chat-attachments";
import { getChatPaneSnapshot } from "@/features/agent/ui/chat-pane-snapshot";

type ChatPaneFileMentionRow = {
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
    if (!mention || mention.kind !== "file" || !cwd) {
      setFileMentionRows([]);
      return () => undefined;
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
