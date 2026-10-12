import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { Effect, Semaphore } from "effect";
import { type SessionTab } from "@/features/agent/messages";
import {
  appendAttachmentsWithinImageLimits,
  createAttachment,
  dataTransferHasFiles,
  filesFromDataTransfer,
  preflightAttachmentFiles,
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

function resolveAttachments(current: ChatAttachment[], update: SetStateAction<ChatAttachment[]>) {
  return typeof update === "function" ? update(current) : update;
}

export function createAttachmentQueue() {
  return Semaphore.makeUnsafe(1);
}

export function useComposerAttachments({
  activeTab,
  running,
  updateTab,
  fileInputRef,
}: UseComposerAttachmentsOptions) {
  const [attachments, setAttachmentState] = useState<ChatAttachment[]>([]);
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const pendingAttachmentBatchesRef = useRef(0);
  const [attachmentQueue] = useState(createAttachmentQueue);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const setAttachments = useCallback<Dispatch<SetStateAction<ChatAttachment[]>>>((update) => {
    const next = resolveAttachments(attachmentsRef.current, update);
    attachmentsRef.current = next;
    setAttachmentState(next);
  }, []);

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
      pendingAttachmentBatchesRef.current += 1;
      setReadingAttachments(true);
      return Effect.runPromise(
        attachmentQueue
          .withPermit(
            Effect.gen(function* () {
              const preflight = preflightAttachmentFiles(attachmentsRef.current, fileArray);
              const next = yield* Effect.all(
                preflight.accepted.map((file) =>
                  Effect.tryPromise({ try: () => createAttachment(file), catch: (error) => error }),
                ),
              );
              const result = appendAttachmentsWithinImageLimits(attachmentsRef.current, next);
              result.discarded.forEach(revokeAttachmentPreview);
              setAttachments(result.attachments);
              updateTab(activeTab.id, (tab) => ({
                ...tab,
                error: preflight.error ?? result.error ?? "",
              }));
            }),
          )
          .pipe(
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
                pendingAttachmentBatchesRef.current -= 1;
                if (pendingAttachmentBatchesRef.current === 0) setReadingAttachments(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }),
            ),
          ),
      );
    },
    [activeTab, attachmentQueue, fileInputRef, running, setAttachments, updateTab],
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
