"use client";
import {
  useCallback,
  useMemo,
  type ChangeEvent,
  type ClipboardEvent,
  type Dispatch,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  type FileMentionRow,
  type LoadedContextKind,
  type MentionRow,
} from "@/features/agent/ui/agent-composer-context";
import {
  byQuery,
  detectComposerMention,
  type ComposerMention,
  type ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { ComposerCommand } from "@/features/agent/composer/command-types";
import { type SessionTab } from "@/features/agent/messages";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import {
  filesFromDataTransfer,
  imageFileFromDataUrlText,
} from "@/features/agent/ui/chat-attachments";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type UpdateTab = (tabId: string, patch: (tab: SessionTab) => SessionTab) => void;

export function useComposerLoadedContext({
  activeTab,
  tools,
}: {
  activeTab: SessionTab | null;
  tools: ToolsContextValue;
}) {
  const activeSelection = tools.selectionFor(activeTab?.id);
  const removeLoadedContext = useCallback(
    (kind: LoadedContextKind, id: string) => {
      if (!activeTab) return;
      const current = tools.selectionFor(activeTab.id);
      tools.setSelection(activeTab.id, {
        skills:
          kind === "skill" ? current.skills.filter((skill) => skill.id !== id) : current.skills,
        promptTemplates:
          kind === "promptTemplate"
            ? current.promptTemplates.filter((template) => template.id !== id)
            : current.promptTemplates,
      });
    },
    [activeTab, tools],
  );

  return {
    selectedSkills: activeSelection.skills,
    selectedPromptTemplates: activeSelection.promptTemplates,
    removeLoadedContext,
  };
}

type UseComposerMentionRowsOptions = {
  commandRows: ComposerCommand[];
  fileMentionRows: FileMentionRow[];
  mention: ComposerMention | null;
  skillRows: ComposerSkillRef[];
};

export function useComposerMentionRows({
  commandRows,
  fileMentionRows,
  mention,
  skillRows,
}: UseComposerMentionRowsOptions): MentionRow[] {
  return useMemo<MentionRow[]>(() => {
    if (!mention) return [];
    if (mention.kind === "skill") {
      return byQuery(skillRows, mention.query, 8).map((row) => ({ kind: "skill", row }));
    }
    if (mention.kind === "command") {
      // Already registry-matched against the query; just wrap for the picker.
      return commandRows.map((row) => ({ kind: "command" as const, row }));
    }
    const q = mention.query.trim().toLowerCase();
    const files = fileMentionRows
      .filter(
        (row) => !q || row.rel.toLowerCase().includes(q) || row.name.toLowerCase().includes(q),
      )
      .slice(0, 5)
      .map((row) => ({ kind: "file" as const, row }));
    return files.slice(0, 8);
  }, [commandRows, fileMentionRows, mention, skillRows]);
}

export function useComposerTextareaHeightSync({
  value,
  textareaRef,
  lastAppliedComposerHeightRef,
  lastComposerValueLengthRef,
}: {
  value: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  lastAppliedComposerHeightRef: MutableRefObject<number>;
  lastComposerValueLengthRef: MutableRefObject<number>;
}) {
  useMountSubscription(() => {
    const node = textareaRef.current;
    if (!node) return;

    if (!value) {
      node.style.height = "";
      node.scrollTop = 0;
      lastAppliedComposerHeightRef.current = 0;
      lastComposerValueLengthRef.current = 0;
      return;
    }

    node.style.height = "auto";
    const next = node.scrollHeight;
    node.style.height = `${next}px`;
    lastAppliedComposerHeightRef.current = next;
    lastComposerValueLengthRef.current = value.length;
  }, [lastAppliedComposerHeightRef, lastComposerValueLengthRef, textareaRef, value]);
}

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
