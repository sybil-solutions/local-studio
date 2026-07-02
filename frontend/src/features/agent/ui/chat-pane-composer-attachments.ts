import { useCallback, useState, type DragEvent, type RefObject } from "react";
import { Effect } from "effect";
import { type SessionTab } from "@/features/agent/messages";
import {
  attachmentDedupKey,
  createAttachment,
  dataTransferHasFiles,
  filesFromDataTransfer,
  revokeAttachmentPreview,
  type ChatAttachment,
} from "@/features/agent/ui/chat-attachments";
import type { UpdateTab } from "@/features/agent/ui/chat-pane-composer";

type UseComposerAttachmentsOptions = {
  activeTab: SessionTab | null;
  running: boolean;
  updateTab: UpdateTab;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

export function useComposerAttachments({
  activeTab,
  running,
  updateTab,
  fileInputRef,
}: UseComposerAttachmentsOptions) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);

  const attachFiles = useCallback(
    (files: FileList | File[] | null) => {
      const fileArray = files ? Array.from(files) : [];
      if (fileArray.length === 0 || !activeTab) return Promise.resolve();
      if (running) {
        updateTab(activeTab.id, (tab) => ({
          ...tab,
          error: "Pause or wait for the current turn before attaching files.",
        }));
        return Promise.resolve();
      }
      setReadingAttachments(true);
      return Effect.runPromise(
        Effect.gen(function* () {
          const next = yield* Effect.all(
            fileArray.map((file) =>
              Effect.tryPromise({ try: () => createAttachment(file), catch: (error) => error }),
            ),
          );
          setAttachments((current) => {
            const seen = new Set(current.map(attachmentDedupKey));
            const uniqueNext: ChatAttachment[] = [];
            next.forEach((file) => {
              const key = attachmentDedupKey(file);
              if (seen.has(key)) return;
              seen.add(key);
              uniqueNext.push(file);
            });
            return [...current, ...uniqueNext];
          });
          updateTab(activeTab.id, (tab) => ({ ...tab, error: "" }));
        }).pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              updateTab(activeTab.id, (tab) => ({
                ...tab,
                error: err instanceof Error ? err.message : "Failed to attach file",
              }));
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              setReadingAttachments(false);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }),
          ),
        ),
      );
    },
    [activeTab, fileInputRef, running, updateTab],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => {
      // The removed attachment is discarded before sending, so its blob preview
      // URL will never be referenced by a message — reclaim it now.
      const removed = current.find((item) => item.id === id);
      if (removed) revokeAttachmentPreview(removed);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [fileInputRef]);

  const handleComposerDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = running ? "none" : "copy";
      setComposerDragActive(true);
    },
    [running],
  );

  const handleComposerDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setComposerDragActive(false);
  }, []);

  const handleComposerDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      setComposerDragActive(false);
      void attachFiles(filesFromDataTransfer(event.dataTransfer));
    },
    [attachFiles],
  );

  return {
    attachments,
    setAttachments,
    readingAttachments,
    composerDragActive,
    attachFiles,
    removeAttachment,
    clearAttachments,
    handleComposerDragOver,
    handleComposerDragLeave,
    handleComposerDrop,
  };
}
