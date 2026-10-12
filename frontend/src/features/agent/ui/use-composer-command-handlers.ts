"use client";

import { useCallback, type RefObject } from "react";
import { consumeComposerMention, type ComposerMention } from "@/features/agent/composer-context";
import type {
  ComposerCommandRegistry,
  SlashInvocation,
} from "@/features/agent/composer/command-registry";
import type { ComposerCommandContext } from "@/features/agent/composer/command-types";
import type { MentionRow } from "@/features/agent/ui/agent-composer-context";
import type { SessionTab } from "@/features/agent/messages";

type UpdateTab = (id: string, update: (tab: SessionTab) => SessionTab) => void;

/** Running a slash command and choosing one from the mention list. Both need
 *  the same registry plus the composer's caret bookkeeping, so they travel
 *  together rather than as two more callbacks inside ChatPane. */
export function useComposerCommandHandlers({
  activeTab,
  commandRegistry,
  commandContext,
  mention,
  setMention,
  resetComposerHeight,
  textareaRef,
  updateTab,
  selectMentionRow,
}: {
  activeTab: SessionTab | undefined;
  commandRegistry: ComposerCommandRegistry;
  commandContext: ComposerCommandContext;
  mention: ComposerMention | null;
  setMention: (mention: ComposerMention | null) => void;
  resetComposerHeight: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  updateTab: UpdateTab;
  selectMentionRow: (entry: MentionRow) => Promise<void>;
}): {
  runCommandInvocation: (invocation: SlashInvocation) => Promise<void>;
  handleSelectMention: (entry: MentionRow) => Promise<void>;
} {
  const runCommandInvocation = useCallback(
    async (invocation: SlashInvocation) => {
      if (!activeTab) return;
      const execution = commandRegistry.execute(invocation, commandContext);
      if (!execution) return;
      const tabId = activeTab.id;
      const outcome = await execution;
      if (outcome.kind === "error") {
        updateTab(tabId, (tab) => ({ ...tab, error: outcome.message }));
      } else {
        const nextInput = outcome.kind === "set-input" ? outcome.input : "";
        updateTab(tabId, (tab) => ({ ...tab, input: nextInput, error: "" }));
        if (!nextInput) resetComposerHeight();
      }
      setMention(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [
      activeTab,
      commandContext,
      commandRegistry,
      resetComposerHeight,
      setMention,
      textareaRef,
      updateTab,
    ],
  );

  /** A command row consumes the typed "/name" and passes the rest as its args;
   *  every other row type keeps the default mention behaviour. */
  const handleSelectMention = useCallback(
    (entry: MentionRow): Promise<void> => {
      if (entry.kind === "command" && activeTab && mention) {
        const args = consumeComposerMention(activeTab.input, mention).trim();
        return runCommandInvocation({ name: entry.row.name, args });
      }
      return selectMentionRow(entry);
    },
    [activeTab, mention, runCommandInvocation, selectMentionRow],
  );

  return { runCommandInvocation, handleSelectMention };
}
