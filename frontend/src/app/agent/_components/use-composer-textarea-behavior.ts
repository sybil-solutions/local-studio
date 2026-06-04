"use client";

import {
  useCallback,
  type ChangeEvent,
  type ClipboardEvent,
  type Dispatch,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { detectComposerMention, type ComposerMention } from "@/lib/agent/composer-context";
import type { SessionTab } from "@/lib/agent/session";
import type { MentionRow } from "@/ui/agent-composer-context";
import { filesFromDataTransfer, imageFileFromDataUrlText } from "./chat-attachments";

type UpdateTab = (tabId: string, patch: (tab: SessionTab) => SessionTab) => void;

export function useComposerTextareaBehavior({
  activeTab,
  mention,
  mentionRows,
  mentionIndex,
  running,
  textareaRef,
  lastAppliedComposerHeightRef,
  lastComposerValueLengthRef,
  resetComposerHeight,
  updateTab,
  setMention,
  setMentionIndex,
  selectMentionRow,
  queueMessage,
  abortTurn,
  attachFiles,
}: {
  activeTab: SessionTab | null;
  mention: ComposerMention | null;
  mentionRows: MentionRow[];
  mentionIndex: number;
  running: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  lastAppliedComposerHeightRef: MutableRefObject<number>;
  lastComposerValueLengthRef: MutableRefObject<number>;
  resetComposerHeight: () => void;
  updateTab: UpdateTab;
  setMention: Dispatch<SetStateAction<ComposerMention | null>>;
  setMentionIndex: Dispatch<SetStateAction<number>>;
  selectMentionRow: (entry: MentionRow) => Promise<void>;
  queueMessage: () => Promise<void>;
  abortTurn: () => Promise<void>;
  attachFiles: (files: FileList | File[] | null) => Promise<void>;
}) {
  const resizeAfterCommit = useCallback(
    (nextValue: string, nextCaret: number) => {
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.setSelectionRange(nextCaret, nextCaret);
        node.style.height = "auto";
        const next = node.scrollHeight;
        node.style.height = `${next}px`;
        lastAppliedComposerHeightRef.current = next;
        lastComposerValueLengthRef.current = nextValue.length;
      });
    },
    [lastAppliedComposerHeightRef, lastComposerValueLengthRef, textareaRef],
  );

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = filesFromDataTransfer(event.clipboardData);
      if (files.length === 0) {
        const text = event.clipboardData.getData("text/plain");
        const pastedImage = imageFileFromDataUrlText(text);
        if (pastedImage) {
          event.preventDefault();
          void attachFiles([pastedImage]);
          return;
        }
        if (!text || !activeTab) return;
        event.preventDefault();
        // Apply large text pastes as one controlled update to avoid composer resize flicker.
        const element = event.currentTarget;
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? element.value.length;
        const current = activeTab.input ?? "";
        const nextValue = current.slice(0, start) + text + current.slice(end);
        const nextCaret = start + text.length;
        updateTab(activeTab.id, (tab) => ({ ...tab, input: nextValue }));
        setMention(null);
        resizeAfterCommit(nextValue, nextCaret);
        return;
      }
      event.preventDefault();
      void attachFiles(files);
    },
    [activeTab, attachFiles, resizeAfterCommit, setMention, updateTab],
  );

  const handleComposerChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({ ...tab, input: value }));
      setMention(value ? detectComposerMention(value, event.currentTarget.selectionStart) : null);
      const element = event.currentTarget;
      if (!value) {
        resetComposerHeight();
        return;
      }
      const prevLength = lastComposerValueLengthRef.current;
      lastComposerValueLengthRef.current = value.length;
      const shrinking = value.length < prevLength;
      if (shrinking) element.style.height = "auto";
      const next = element.scrollHeight;
      if (!shrinking && next === lastAppliedComposerHeightRef.current) return;
      element.style.height = `${next}px`;
      lastAppliedComposerHeightRef.current = next;
    },
    [
      activeTab,
      lastAppliedComposerHeightRef,
      lastComposerValueLengthRef,
      resetComposerHeight,
      setMention,
      updateTab,
    ],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mention) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setMentionIndex((index) => {
            if (mentionRows.length === 0) return 0;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            return (index + delta + mentionRows.length) % mentionRows.length;
          });
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setMention(null);
          return;
        }
        if ((event.key === "Enter" || event.key === "Tab") && mentionRows[mentionIndex]) {
          event.preventDefault();
          void selectMentionRow(mentionRows[mentionIndex]);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        if (!activeTab?.input.trim()) return;
        event.preventDefault();
        void queueMessage();
        return;
      }
      if (event.key === "Escape" || (event.key === "." && (event.metaKey || event.ctrlKey))) {
        if (running) {
          event.preventDefault();
          void abortTurn();
        }
      }
    },
    [
      abortTurn,
      activeTab,
      mention,
      mentionIndex,
      mentionRows,
      queueMessage,
      running,
      selectMentionRow,
      setMention,
      setMentionIndex,
    ],
  );

  return {
    handleComposerPaste,
    handleComposerChange,
    handleComposerKeyDown,
  };
}
