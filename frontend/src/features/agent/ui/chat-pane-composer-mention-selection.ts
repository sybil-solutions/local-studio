import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { Effect } from "effect";
import { type MentionRow } from "@/features/agent/ui/agent-composer-context";
import {
  consumeComposerMention,
  type ComposerMention,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/features/agent/composer-context";
import { type SessionTab } from "@/features/agent/messages";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import {
  attachmentDedupKey,
  createProjectFileAttachment,
  type ChatAttachment,
} from "@/features/agent/ui/chat-attachments";

type ContextRow = ComposerSkillRef | ComposerPromptTemplateRef;
type LoadedContextRow = {
  skill?: ComposerSkillRef;
  template?: ComposerPromptTemplateRef;
};
type SelectionTools = Pick<ToolsContextValue, "selectionFor" | "setSelection">;

export function useComposerMentionSelection({
  activeTab,
  mention,
  cwd,
  tools,
  updateTab,
  setAttachments,
  setMention,
  textareaRef,
}: {
  activeTab: SessionTab | null;
  mention: ComposerMention | null;
  cwd: string;
  tools: SelectionTools;
  updateTab: (tabId: string, patch: (tab: SessionTab) => SessionTab) => void;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  setMention: Dispatch<SetStateAction<ComposerMention | null>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return useCallback(
    (entry: MentionRow) => {
      // Command rows are executed by the pane's command runner, not here.
      if (!activeTab || !mention || entry.kind === "command") return Promise.resolve();

      return Effect.runPromise(
        Effect.gen(function* () {
          const input = consumeComposerMention(activeTab.input, mention);
          updateTab(activeTab.id, (tab) => ({ ...tab, input }));
          if (entry.kind === "file") {
            const attachment = yield* loadProjectFileAttachmentEffect(cwd, entry.row);
            addUniqueAttachment(setAttachments, attachment);
          } else {
            yield* Effect.tryPromise({
              try: () => applyContextRow(activeTab.id, "skill", entry.row, tools),
              catch: (error) => error,
            });
          }

          setMention(null);
          requestAnimationFrame(() => textareaRef.current?.focus());
        }),
      );
    },
    [activeTab, cwd, mention, setAttachments, setMention, textareaRef, tools, updateTab],
  );
}

/**
 * Load a skill or prompt template's full body and add it to the session's
 * tool selection. Shared by `$`-mention selection and the composer command
 * providers, so both paths stay behaviourally identical.
 */
export function applyContextRow(
  sessionId: string,
  kind: "skill" | "promptTemplate",
  row: ContextRow,
  tools: SelectionTools,
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const loaded = yield* loadContextRowEffect(row, kind);
      applySelectedContext(sessionId, kind, loaded, tools);
    }),
  );
}

function loadProjectFileAttachmentEffect(
  cwd: string,
  row: Extract<MentionRow, { kind: "file" }>["row"],
): Effect.Effect<ChatAttachment> {
  return Effect.gen(function* () {
    const loaded = yield* jsonOrNullEffect<{ content: string; truncated: boolean; size: number }>(
      `/api/agent/fs/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(row.rel)}`,
    );
    return createProjectFileAttachment({
      id: row.id,
      name: row.name,
      path: row.path,
      content: loaded?.content ?? "",
      truncated: loaded?.truncated ?? true,
      size: loaded?.size ?? 0,
    });
  });
}

function loadContextRowEffect(
  row: ContextRow,
  kind: "skill" | "promptTemplate",
): Effect.Effect<ContextRow> {
  if (!row.path) return Effect.succeed(row);
  const rowPath = row.path;
  return Effect.gen(function* () {
    const loaded = yield* jsonOrNullEffect<LoadedContextRow>(loadEndpoint(kind, rowPath));
    return loaded?.skill
      ? { ...row, ...loaded.skill, id: row.id }
      : loaded?.template
        ? { ...row, ...loaded.template, id: row.id }
        : row;
  });
}

function loadEndpoint(kind: "skill" | "promptTemplate", path: string): string {
  const encoded = encodeURIComponent(path);
  if (kind === "skill") return `/api/agent/skills/load?path=${encoded}`;
  return `/api/agent/prompt-templates/load?path=${encoded}`;
}

function applySelectedContext(
  sessionId: string,
  kind: "skill" | "promptTemplate",
  selectedRow: ContextRow,
  tools: SelectionTools,
) {
  const current = tools.selectionFor(sessionId);
  if (kind === "skill" && !current.skills.some((skill) => skill.id === selectedRow.id)) {
    return tools.setSelection(sessionId, {
      ...current,
      skills: [...current.skills, selectedRow as ComposerSkillRef],
    });
  }
  if (
    kind === "promptTemplate" &&
    !current.promptTemplates.some((template) => template.id === selectedRow.id)
  ) {
    return tools.setSelection(sessionId, {
      ...current,
      promptTemplates: [...current.promptTemplates, selectedRow as ComposerPromptTemplateRef],
    });
  }
}

function addUniqueAttachment(
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>,
  attachment: ChatAttachment,
) {
  setAttachments((current) => {
    const nextKey = attachmentDedupKey(attachment);
    if (current.some((file) => attachmentDedupKey(file) === nextKey)) return current;
    return [...current, attachment];
  });
}

function jsonOrNullEffect<T>(url: string): Effect.Effect<T | null> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { cache: "no-store" }),
      catch: (error) => error,
    });
    if (!response?.ok) return null;
    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<T>,
      catch: (error) => error,
    });
  }).pipe(Effect.catch(() => Effect.succeed(null)));
}
