"use client";

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  activateComposerPlugin,
  consumeComposerMention,
  type ComposerMention,
  type ComposerPluginRef,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/lib/agent/composer-context";
import type { SessionTab } from "@/lib/agent/session";
import type { ToolsContextValue } from "@/lib/agent/tools/context";
import type { MentionRow } from "@/ui/agent-composer-context";
import {
  attachmentDedupKey,
  createProjectFileAttachment,
  type ChatAttachment,
} from "./chat-attachments";

type ContextRow = ComposerPluginRef | ComposerSkillRef | ComposerPromptTemplateRef;
type LoadedContextRow = {
  skill?: ComposerSkillRef;
  plugin?: ComposerPluginRef;
  template?: ComposerPromptTemplateRef;
};

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
  tools: Pick<ToolsContextValue, "selectionFor" | "setSelection">;
  updateTab: (tabId: string, patch: (tab: SessionTab) => SessionTab) => void;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  setMention: Dispatch<SetStateAction<ComposerMention | null>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return useCallback(
    async (entry: MentionRow) => {
      if (!activeTab || !mention) return;

      if (entry.kind === "file") {
        const input = consumeComposerMention(activeTab.input, mention);
        updateTab(activeTab.id, (tab) => ({ ...tab, input }));
        addUniqueAttachment(setAttachments, await loadProjectFileAttachment(cwd, entry.row));
      } else {
        const selectedRow = await loadContextRow(entry.row, mention.kind);
        const input = consumeComposerMention(activeTab.input, mention);
        updateTab(activeTab.id, (tab) => ({ ...tab, input }));
        applySelectedContext(activeTab.id, mention.kind, selectedRow, tools);
      }

      setMention(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [activeTab, cwd, mention, setAttachments, setMention, textareaRef, tools, updateTab],
  );
}

async function loadProjectFileAttachment(
  cwd: string,
  row: Extract<MentionRow, { kind: "file" }>["row"],
): Promise<ChatAttachment> {
  const loaded = await jsonOrNull<{ content: string; truncated: boolean; size: number }>(
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
}

async function loadContextRow(row: ContextRow, kind: ComposerMention["kind"]): Promise<ContextRow> {
  if (!row.path) return row;
  const loaded = await jsonOrNull<LoadedContextRow>(loadEndpoint(kind, row.path));
  return loaded?.skill
    ? { ...row, ...loaded.skill, id: row.id }
    : loaded?.plugin
      ? { ...row, ...loaded.plugin, id: row.id }
      : loaded?.template
        ? { ...row, ...loaded.template, id: row.id }
        : row;
}

function loadEndpoint(kind: ComposerMention["kind"], path: string): string {
  const encoded = encodeURIComponent(path);
  if (kind === "skill") return `/api/agent/skills/load?path=${encoded}`;
  if (kind === "promptTemplate") return `/api/agent/prompt-templates/load?path=${encoded}`;
  return `/api/agent/plugins/load?path=${encoded}`;
}

function applySelectedContext(
  sessionId: string,
  kind: ComposerMention["kind"],
  selectedRow: ContextRow,
  tools: Pick<ToolsContextValue, "selectionFor" | "setSelection">,
) {
  const current = tools.selectionFor(sessionId);
  if (kind === "plugin" && !current.plugins.some((plugin) => plugin.id === selectedRow.id)) {
    return tools.setSelection(sessionId, {
      ...current,
      plugins: [...current.plugins, activateComposerPlugin(selectedRow as ComposerPluginRef)],
    });
  }
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

function jsonOrNull<T>(url: string): Promise<T | null> {
  return fetch(url, { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<T>) : null))
    .catch(() => null);
}
