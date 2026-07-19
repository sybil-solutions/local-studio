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
import type { ComposerBanner } from "@/features/agent/composer/composer-visual-state";
import { Spinner } from "@/ui";
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
import { Folder } from "@/ui/icon-registry";

export type AgentComposerFrameProps = {
  attachments: AgentComposerAttachment[];
  banner: ComposerBanner | null;
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
  onTranscript: (text: string) => void;
  onToggleBrowserBackend: () => void;
  onToggleBrowserTool: () => void;
  onToggleCanvas: () => void;
  placeholder: string;
  projectRow?: { label: string; onPick: () => void } | null;
  promptTemplates: ComposerPromptTemplateRef[];
  queueExpanded: boolean;
  queueItems: QueuedMessage[];
  readingAttachments: boolean;
  running: boolean;
  selectedSkills: ComposerSkillRef[];
  status?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  floating?: boolean;
  dense?: boolean;
};

export function AgentComposerFrame({
  attachments,
  banner,
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
  onTranscript,
  onToggleBrowserBackend,
  onToggleBrowserTool,
  onToggleCanvas,
  placeholder,
  projectRow,
  promptTemplates,
  queueExpanded,
  queueItems,
  readingAttachments,
  running,
  selectedSkills,
  status,
  textareaRef,
  floating = false,
  dense = false,
}: AgentComposerFrameProps) {
  return (
    <form
      onSubmit={onSubmit}
      className={cx(
        "relative z-[100] shrink-0",
        floating
          ? "bg-transparent p-[calc(var(--space-base)*2)]"
          : dense
            ? "bg-(--agent-bg) px-3 pb-1 pt-1.5"
            : "bg-(--agent-bg) px-6 pb-2 pt-2.5",
      )}
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
      {banner ? (
        // Codex compacting banner: flat, chat-size text at ~35% white, no pill.
        <div className="mx-auto flex w-full max-w-[var(--composer-w)] items-center gap-2 pb-3 pl-1 text-[length:var(--codex-chat-font-size)] text-(--fg)/35">
          <Spinner size="xs" />
          {banner.label}
        </div>
      ) : null}
      {projectRow ? (
        // Codex fresh-thread "Choose project" row: a quiet tone step between
        // page and composer, chat-size text, folder glyph.
        <button
          type="button"
          onClick={projectRow.onPick}
          className="mx-auto -mb-4 flex w-full max-w-[var(--composer-w)] items-center gap-2.5 rounded-2xl bg-(--fg)/[0.03] px-4 pb-7 pt-3 text-left text-[length:var(--codex-chat-font-size)] text-(--fg)/85 transition-colors hover:bg-(--fg)/[0.05]"
        >
          <Folder className="h-4 w-4 shrink-0 text-(--fg)/60" strokeWidth={1.75} />
          <span className="truncate">{projectRow.label}</span>
        </button>
      ) : null}
      <div
        onDragOver={onComposerDragOver}
        onDragLeave={onComposerDragLeave}
        onDrop={onComposerDrop}
        className={cx(
          "relative mx-auto w-full max-w-[var(--composer-w)] overflow-visible rounded-[var(--composer-radius)] border border-(--composer-border) bg-(--composer) shadow-[var(--composer-shadow)] transition-colors",
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
        {mention ? (
          // Codex: the mention/command menu floats as its own elevated panel
          // above the composer card, not inside it.
          <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-[20px] bg-(--composer) py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
            <AgentMentionPicker
              mention={mention}
              rows={mentionRows}
              activeIndex={mentionIndex}
              onSelect={onSelectMention}
            />
          </div>
        ) : null}
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
          placeholder={placeholder}
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
          onTranscript={onTranscript}
          onOpenStatus={onOpenStatus}
          modelSelector={modelSelector}
        />
      </div>
      {projectRow ? null : (
        <AgentComposerStatusBar
          cwd={cwd}
          gitBranch={gitBranch}
          gitSummary={gitSummary}
          onInitGit={onInitGit}
          currentContextTokens={currentContextTokens}
          contextWindow={contextWindow}
          onOpenStatus={onOpenStatus}
        />
      )}
    </form>
  );
}
