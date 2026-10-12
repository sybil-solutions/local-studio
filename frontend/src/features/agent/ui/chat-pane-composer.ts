"use client";
import {
  useCallback,
  useMemo,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type Dispatch,
  type KeyboardEvent,
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
import type { Session } from "@/features/agent/runtime/types";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import {
  filesFromDataTransfer,
  imageFileFromDataUrlText,
} from "@/features/agent/ui/chat-attachments";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  recentComposerHistory,
  stepComposerHistory,
  type ComposerHistoryCursor,
} from "@/features/agent/ui/composer-history";

export type UpdateTab = (tabId: string, patch: (tab: Session) => Session) => void;

export function useComposerLoadedContext({
  activeTab,
  tools,
}: {
  activeTab: Session | null;
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
    // Already path-matched and ranked server-side against the query; keep that
    // order and honour the same 8-row budget as the other mention kinds.
    return fileMentionRows.slice(0, 8).map((row) => ({ kind: "file" as const, row }));
  }, [commandRows, fileMentionRows, mention, skillRows]);
}

export type ComposerAutosizeHandle = {
  reset: () => void;
  resizeAfterCommit: (nextValue: string, nextCaret: number) => void;
  resizeOnChange: (element: HTMLTextAreaElement, nextValue: string) => void;
};

/** Owns the composer textarea's autosize state: the last applied height and value
 *  length let growth skip redundant style writes while shrinking re-measures. */
export function useComposerAutosize({
  textareaRef,
  value,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
}): ComposerAutosizeHandle {
  const lastAppliedHeightRef = useRef(0);
  const lastValueLengthRef = useRef(0);

  useMountSubscription(() => {
    const node = textareaRef.current;
    if (!node) return;

    if (!value) {
      node.style.height = "";
      node.scrollTop = 0;
      lastAppliedHeightRef.current = 0;
      lastValueLengthRef.current = 0;
      return;
    }

    node.style.height = "auto";
    const next = node.scrollHeight;
    node.style.height = `${next}px`;
    lastAppliedHeightRef.current = next;
    lastValueLengthRef.current = value.length;
  }, [textareaRef, value]);

  const reset = useCallback(() => {
    if (textareaRef.current) textareaRef.current.style.height = "";
    lastAppliedHeightRef.current = 0;
    lastValueLengthRef.current = 0;
  }, [textareaRef]);

  const resizeAfterCommit = useCallback(
    (nextValue: string, nextCaret: number) => {
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.setSelectionRange(nextCaret, nextCaret);
        node.style.height = "auto";
        const next = node.scrollHeight;
        node.style.height = `${next}px`;
        lastAppliedHeightRef.current = next;
        lastValueLengthRef.current = nextValue.length;
      });
    },
    [textareaRef],
  );

  const resizeOnChange = useCallback(
    (element: HTMLTextAreaElement, nextValue: string) => {
      if (!nextValue) {
        reset();
        return;
      }
      const prevLength = lastValueLengthRef.current;
      lastValueLengthRef.current = nextValue.length;
      const shrinking = nextValue.length < prevLength;
      if (shrinking) element.style.height = "auto";
      const next = element.scrollHeight;
      if (!shrinking && next === lastAppliedHeightRef.current) return;
      element.style.height = `${next}px`;
      lastAppliedHeightRef.current = next;
    },
    [reset],
  );

  return useMemo(
    () => ({ reset, resizeAfterCommit, resizeOnChange }),
    [reset, resizeAfterCommit, resizeOnChange],
  );
}

export function useComposerTextareaBehavior({
  activeTab,
  mention,
  mentionRows,
  mentionIndex,
  running,
  autosize,
  updateTab,
  setMention,
  setMentionIndex,
  selectMentionRow,
  queueMessage,
  abortTurn,
  attachFiles,
}: {
  activeTab: Session | null;
  mention: ComposerMention | null;
  mentionRows: MentionRow[];
  mentionIndex: number;
  running: boolean;
  autosize: ComposerAutosizeHandle;
  updateTab: UpdateTab;
  setMention: Dispatch<SetStateAction<ComposerMention | null>>;
  setMentionIndex: Dispatch<SetStateAction<number>>;
  selectMentionRow: (entry: MentionRow) => Promise<void>;
  queueMessage: () => Promise<void>;
  abortTurn: () => Promise<void>;
  attachFiles: (files: FileList | File[] | null) => Promise<void>;
}) {
  const historyNavigationRef = useRef<{
    sessionId: string;
    cursor: ComposerHistoryCursor;
  }>({ sessionId: "", cursor: { index: -1, draft: "" } });

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
        autosize.resizeAfterCommit(nextValue, nextCaret);
        return;
      }
      event.preventDefault();
      void attachFiles(files);
    },
    [activeTab, attachFiles, autosize, setMention, updateTab],
  );

  const handleComposerChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      if (!activeTab) return;
      historyNavigationRef.current = {
        sessionId: activeTab.id,
        cursor: { index: -1, draft: value },
      };
      updateTab(activeTab.id, (tab) => ({ ...tab, input: value }));
      setMention(value ? detectComposerMention(value, event.currentTarget.selectionStart) : null);
      autosize.resizeOnChange(event.currentTarget, value);
    },
    [activeTab, autosize, setMention, updateTab],
  );

  /** Arrow/Escape/accept keys while the @-mention or /-command popup is open.
   *  Returns true when the key was consumed by the popup. */
  const handleMentionKey = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((index) => {
          if (mentionRows.length === 0) return 0;
          const delta = event.key === "ArrowDown" ? 1 : -1;
          return (index + delta + mentionRows.length) % mentionRows.length;
        });
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return true;
      }
      if ((event.key === "Enter" || event.key === "Tab") && mentionRows[mentionIndex]) {
        event.preventDefault();
        void selectMentionRow(mentionRows[mentionIndex]);
        return true;
      }
      return false;
    },
    [mentionIndex, mentionRows, selectMentionRow, setMention, setMentionIndex],
  );

  const handleComposerHistoryKey = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (
        !activeTab ||
        (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.nativeEvent.isComposing
      ) {
        return false;
      }
      const history = recentComposerHistory(activeTab.messages);
      const stored = historyNavigationRef.current;
      const expectedValue =
        stored.sessionId === activeTab.id && stored.cursor.index >= 0
          ? history[stored.cursor.index]
          : stored.cursor.draft;
      const cursor =
        stored.sessionId === activeTab.id && expectedValue === activeTab.input
          ? stored.cursor
          : { index: -1, draft: activeTab.input };
      if (cursor.index < 0 && activeTab.input.length > 0) return false;
      const step = stepComposerHistory(
        activeTab.messages,
        cursor,
        event.key === "ArrowUp" ? "older" : "newer",
      );
      if (!step) return false;
      event.preventDefault();
      historyNavigationRef.current = { sessionId: activeTab.id, cursor: step.cursor };
      updateTab(activeTab.id, (tab) => ({ ...tab, input: step.value }));
      setMention(null);
      autosize.resizeAfterCommit(step.value, step.value.length);
      return true;
    },
    [activeTab, autosize, setMention, updateTab],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mention && handleMentionKey(event)) return;
      if (handleComposerHistoryKey(event)) return;
      // While a turn is running, Enter QUEUES rather than steers. Steering
      // interrupts the agent's plan mid-flight, so it stays a deliberate act —
      // the drawer's "Interrupt now" button, promoting an item in the queue
      // stack, or Alt+Enter. Tab used to queue too; it is back to moving focus,
      // since the drawer now offers both choices as buttons.
      if (event.key === "Enter" && !event.shiftKey) {
        if (running && !event.altKey && activeTab?.input.trim()) {
          event.preventDefault();
          void queueMessage();
          return;
        }
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
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
      handleComposerHistoryKey,
      handleMentionKey,
      mention,
      queueMessage,
      running,
    ],
  );

  return {
    handleComposerPaste,
    handleComposerChange,
    handleComposerKeyDown,
  };
}
