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
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { QueuedMessage } from "@/features/agent/messages";
import type { BrowserBackend } from "@/features/agent/tools/types";
import type { GitSummary } from "@/features/agent/projects/types";
import { AgentAttachmentTray, type AgentComposerAttachment } from "./agent-attachment-tray";
import { AgentComposerActions } from "./agent-composer-actions";
import {
  AgentLoadedContextTabs,
  AgentMentionPicker,
  type MentionRow,
  type LoadedContextKind,
} from "./agent-composer-context";
import { AgentComposerStatusBar } from "./agent-composer-status-bar";
import { AgentComposerTextArea } from "./agent-composer-textarea";
import { AgentQueuePanel } from "./agent-queue-panel";
import { cx } from "@/ui/utils";

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
  modelSupportsVision: boolean;
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
  modelSupportsVision,
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
  selectedSkills,
  status,
  textareaRef,
}: AgentComposerFrameProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="relative z-[100] shrink-0 bg-(--agent-bg) px-6 pb-2 pt-2.5"
    >
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
          "mx-auto w-full max-w-[var(--composer-w)] overflow-visible rounded-[var(--composer-radius)] border border-(--border) bg-(--composer) shadow-[var(--composer-shadow)] transition-colors",
          composerDragActive && "outline outline-1 outline-(--link)/50",
        )}
      >
        {composerDragActive ? (
          <div className="px-4 pt-2 text-[length:var(--fs-sm)] text-(--link)">
            Drop files to attach to the next message.
          </div>
        ) : null}
        <AgentLoadedContextTabs
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
        <AgentAttachmentTray
          attachments={attachments}
          modelSupportsVision={modelSupportsVision}
          onRemove={onRemoveAttachment}
        />
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
          onAbortTurn={onAbortTurn}
          modelSelector={modelSelector}
        />
      </div>
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
