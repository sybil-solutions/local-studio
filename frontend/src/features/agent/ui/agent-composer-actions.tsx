"use client";

import type { ReactNode, RefObject } from "react";
import { Spinner } from "@/ui";
import { ArrowUp, CircleAlert, Code2, Plus } from "@/ui/icon-registry";
import type { BrowserBackend } from "@/features/agent/tools/types";
import { GlobeIcon, PanelIcon, SitegeistIcon, StopIcon } from "@/ui/icons";
import { ComposerDictationButton } from "./composer-dictation-button";

export function AgentComposerActions({
  fileInputRef,
  onAttachFiles,
  readingAttachments,
  running,
  status,
  input,
  attachmentsCount,
  browserToolEnabled,
  browserBackend,
  onToggleBrowserBackend,
  onToggleBrowserTool,
  canvasEnabled,
  onToggleCanvas,
  onAbortTurn,
  onTranscript,
  onOpenStatus,
  modelSelector,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAttachFiles: (files: FileList | null) => void;
  readingAttachments: boolean;
  running: boolean;
  status?: string;
  input: string;
  attachmentsCount: number;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  onToggleBrowserBackend: () => void;
  onToggleBrowserTool: () => void;
  canvasEnabled: boolean;
  onToggleCanvas: () => void;
  onAbortTurn: () => void;
  onTranscript: (text: string) => void;
  onOpenStatus?: () => void;
  modelSelector?: ReactNode;
}) {
  const inputHasText = Boolean(input.trim());
  const starting = status === "starting";
  const usingSitegeist = browserBackend === "sitegeist";
  const browserBackendLabel = usingSitegeist ? "Sitegeist relay" : "embedded panel";
  const browserBackendTarget = usingSitegeist ? "embedded panel" : "Sitegeist relay";
  const inactiveIconClass = "text-(--hl2) hover:bg-(--hover) hover:text-(--fg)";
  const activeIconClass = "bg-(--active) text-(--fg)";

  return (
    <div className="agent-composer-actions-row flex min-h-9 items-center gap-1 bg-transparent px-3 pb-2.5 pt-0.5 text-xs">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => onAttachFiles(event.currentTarget.files)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={readingAttachments || running}
        className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full text-(--hl2) hover:bg-(--hover) hover:text-(--fg) disabled:opacity-30"
        aria-label="Attach files"
        title="Attach files (or paste/drop into composer)"
      >
        <Plus className="h-4 w-4" strokeWidth={1.75} />
      </button>
      {onOpenStatus ? (
        // Codex access chip: the agent runs with full access; the chip opens
        // the status panel. Orange-200 from the Codex ramp.
        <button
          type="button"
          onClick={onOpenStatus}
          className="inline-flex !h-[30px] !min-h-[30px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[length:var(--codex-chat-font-size)] text-(--orange-200) transition-colors hover:bg-(--hover)"
          title="Full access — the agent can read, write, and run commands. Opens status."
        >
          <CircleAlert className="h-4 w-4" strokeWidth={1.75} />
          Full access
        </button>
      ) : null}
      <button
        type="button"
        onClick={onToggleBrowserTool}
        aria-pressed={browserToolEnabled}
        aria-label="Browser tools"
        title={
          browserToolEnabled
            ? "Browser tool: ON — agent can drive the browser"
            : "Browser tool: OFF — click to let the agent navigate, click, fill, and read pages"
        }
        className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full ${browserToolEnabled ? activeIconClass : inactiveIconClass}`}
      >
        <span className="relative inline-flex">
          <GlobeIcon className="h-4 w-4" />
        </span>
      </button>
      {browserToolEnabled ? (
        <button
          type="button"
          onClick={onToggleBrowserBackend}
          aria-label={`Browser backend: ${browserBackendLabel}. Switch to ${browserBackendTarget}.`}
          className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full ${usingSitegeist ? activeIconClass : inactiveIconClass}`}
          title={`Browser: ${browserBackendLabel}. Click to use ${browserBackendTarget}.`}
        >
          {usingSitegeist ? (
            <SitegeistIcon className="h-4 w-4" />
          ) : (
            <PanelIcon className="h-4 w-4" />
          )}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onToggleCanvas}
        aria-pressed={canvasEnabled}
        aria-label="Canvas context"
        title={
          canvasEnabled
            ? "Canvas: ON — shared scratchboard tools loaded; model reads/writes the canvas"
            : "Canvas: OFF — click to share a scratchboard with the model (notes, plans, links, state)"
        }
        className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full ${canvasEnabled ? activeIconClass : inactiveIconClass}`}
      >
        <Code2 className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {modelSelector}
        <ComposerDictationButton
          disabled={running}
          inactiveClassName={inactiveIconClass}
          onTranscript={onTranscript}
        />
        {running ? (
          <>
            {starting ? (
              <span
                className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1.5 px-2 text-[length:var(--fs-sm)] text-(--dim)"
                title="Waiting for the model to start"
              >
                <Spinner size="xs" />
                Starting…
              </span>
            ) : inputHasText ? (
              <button
                type="submit"
                className="inline-flex !h-[30px] !min-h-[30px] !w-[30px] !min-w-[30px] shrink-0 items-center justify-center rounded-full bg-(--fg) text-(--bg) transition-opacity hover:opacity-85"
                aria-label="Steer current task"
                title="Steer current task (Enter) · Queue instead (Tab)"
              >
                <ArrowUp className="h-4 w-4 stroke-[2.25]" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onAbortTurn}
              disabled={starting}
              className={`inline-flex shrink-0 items-center justify-center rounded-full bg-(--fg) text-(--bg) transition-opacity hover:opacity-85 disabled:opacity-30 ${inputHasText ? "!h-6 !min-h-6 !w-6 !min-w-6" : "!h-[30px] !min-h-[30px] !w-[30px] !min-w-[30px]"}`}
              aria-label="Stop"
              title="Stop (Esc)"
            >
              <StopIcon className="h-2.5 w-2.5" />
            </button>
          </>
        ) : (
          <button
            type="submit"
            disabled={(!inputHasText && attachmentsCount === 0) || readingAttachments}
            className="inline-flex !h-[30px] !min-h-[30px] !w-[30px] !min-w-[30px] shrink-0 items-center justify-center rounded-full bg-(--fg) text-(--bg) transition-opacity hover:opacity-85 disabled:bg-(--hl3) disabled:opacity-100"
            aria-label="Send"
            title="Send (Enter) · Queue (Tab)"
          >
            {starting ? <Spinner size="sm" /> : <ArrowUp className="h-4 w-4 stroke-[2.25]" />}
          </button>
        )}
      </div>
    </div>
  );
}
