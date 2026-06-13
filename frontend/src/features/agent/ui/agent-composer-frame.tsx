"use client";

import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  DragEventHandler,
  FormEventHandler,
  KeyboardEventHandler,
  ReactNode,
  RefObject,
} from "react";
import type {
  ComposerMention,
  ComposerPluginRef,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { QueuedMessage } from "@/features/agent/messages";
import type { BrowserBackend } from "@/features/agent/tools/types";
import { AgentAttachmentTray, type AgentComposerAttachment } from "./agent-attachment-tray";
import { AgentComposerActions } from "./agent-composer-actions";
import {
  AgentLoadedContextTabs,
  AgentMentionPicker,
  type MentionRow,
} from "./agent-composer-context";
import { AgentComposerStatusBar } from "./agent-composer-status-bar";
import { AgentComposerTextArea } from "./agent-composer-textarea";
import { AgentQueuePanel } from "./agent-queue-panel";
import { cx } from "@/ui/utils";

type LoadedContextKind = "plugin" | "skill" | "promptTemplate";

type GitSummary = {
  isRepo: boolean;
  additions: number;
  deletions: number;
  statusCount: number;
};

export type AgentComposerFrameProps = {
  attachments: AgentComposerAttachment[];
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  canvasEnabled: boolean;
  composerDragActive: boolean;
  contextWindow: number;
  currentContextTokens: number;
  cwd: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  input: string;
  mention: ComposerMention | null;
  mentionIndex: number;
  mentionRows: MentionRow[];
  modelSelector?: ReactNode;
  onAbortTurn: () => void;
  onAttachFiles: (files: FileList | null) => void;
  onComposerChange: ChangeEventHandler<HTMLTextAreaElement>;
  onComposerDragLeave: DragEventHandler<HTMLDivElement>;
  onComposerDragOver: DragEventHandler<HTMLDivElement>;
  onComposerDrop: DragEventHandler<HTMLDivElement>;
  onComposerKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onComposerPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onEditQueued: (queueId: string, text: string) => void;
  onInitGit?: () => void;
  onOpenStatus: () => void;
  onQueueExpandedChange: (expanded: boolean) => void;
  onQueueMessage: () => void;
  onRemoveAttachment: (id: string) => void;
  onRemoveLoadedContext: (kind: LoadedContextKind, id: string) => void;
  onRemoveQueued: (queueId: string) => void;
  onSelectMention: (entry: MentionRow) => void;
  onSteerQueued: (queueId: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onToggleBrowserBackend: () => void;
  onToggleBrowserTool: () => void;
  onToggleCanvas: () => void;
  promptTemplates: ComposerPromptTemplateRef[];
  queueExpanded: boolean;
  queueItems: QueuedMessage[];
  readingAttachments: boolean;
  running: boolean;
  selectedPlugins: ComposerPluginRef[];
  selectedSkills: ComposerSkillRef[];
  status?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

export function AgentComposerFrame({
  attachments,
  browserToolEnabled,
  browserBackend,
  canvasEnabled,
  composerDragActive,
  contextWindow,
  currentContextTokens,
  cwd,
  fileInputRef,
  gitBranch,
  gitSummary,
  input,
  mention,
  mentionIndex,
  mentionRows,
  modelSelector,
  onAbortTurn,
  onAttachFiles,
  onComposerChange,
  onComposerDragLeave,
  onComposerDragOver,
  onComposerDrop,
  onComposerKeyDown,
  onComposerPaste,
  onEditQueued,
  onInitGit,
  onOpenStatus,
  onQueueExpandedChange,
  onQueueMessage,
  onRemoveAttachment,
  onRemoveLoadedContext,
  onRemoveQueued,
  onSelectMention,
  onSteerQueued,
  onSubmit,
  onToggleBrowserBackend,
  onToggleBrowserTool,
  onToggleCanvas,
  promptTemplates,
  queueExpanded,
  queueItems,
  readingAttachments,
  running,
  selectedPlugins,
  selectedSkills,
  status,
  textareaRef,
}: AgentComposerFrameProps) {
  return (
    <form onSubmit={onSubmit} className="shrink-0 bg-(--agent-bg) px-6 pb-1.5 pt-2">
      <AgentQueuePanel
        items={queueItems}
        expanded={queueExpanded}
        running={running}
        onExpandedChange={onQueueExpandedChange}
        onEdit={onEditQueued}
        onRemove={onRemoveQueued}
        onSteer={onSteerQueued}
      />
      <div
        onDragOver={onComposerDragOver}
        onDragLeave={onComposerDragLeave}
        onDrop={onComposerDrop}
        className={cx(
          // The Codex composer: a big-radius surface over a hairline border and
          // a soft shadow — the most "designed" object in the pane.
          "ml-auto w-full max-w-[var(--composer-w)] overflow-visible rounded-[var(--composer-radius)] border border-(--border)/60 bg-(--composer) shadow-[var(--composer-shadow)] transition-colors",
          composerDragActive && "outline outline-1 outline-(--link)/50",
        )}
      >
        {composerDragActive ? (
          <div className="px-4 pt-2 text-[length:var(--fs-sm)] text-(--link)">
            Drop files to attach to the next message.
          </div>
        ) : null}
        <AgentLoadedContextTabs
          plugins={selectedPlugins}
          skills={selectedSkills}
          promptTemplates={promptTemplates}
          onRemove={onRemoveLoadedContext}
        />
        <AgentMentionPicker
          mention={mention}
          rows={mentionRows}
          activeIndex={mentionIndex}
          onSelect={onSelectMention}
        />
        <AgentAttachmentTray attachments={attachments} onRemove={onRemoveAttachment} />
        <AgentComposerTextArea
          inputRef={textareaRef}
          value={input}
          onPaste={onComposerPaste}
          onChange={onComposerChange}
          onKeyDown={onComposerKeyDown}
        />
        <AgentComposerActions
          fileInputRef={fileInputRef}
          onAttachFiles={onAttachFiles}
          readingAttachments={readingAttachments}
          running={running}
          status={status}
          input={input}
          attachmentsCount={attachments.length}
          browserToolEnabled={browserToolEnabled}
          browserBackend={browserBackend}
          onToggleBrowserBackend={onToggleBrowserBackend}
          onToggleBrowserTool={onToggleBrowserTool}
          canvasEnabled={canvasEnabled}
          onToggleCanvas={onToggleCanvas}
          onQueueMessage={onQueueMessage}
          onAbortTurn={onAbortTurn}
          modelSelector={modelSelector}
        />
      </div>
      {/* Codex keeps the model picker inside the composer footer; the status
          line below carries workspace context (cwd, branch, diff, tokens). */}
      <AgentComposerStatusBar
        cwd={cwd}
        gitBranch={gitBranch}
        gitSummary={gitSummary}
        onInitGit={onInitGit}
        currentContextTokens={currentContextTokens}
        contextWindow={contextWindow}
        onOpenStatus={onOpenStatus}
      />
    </form>
  );
}
