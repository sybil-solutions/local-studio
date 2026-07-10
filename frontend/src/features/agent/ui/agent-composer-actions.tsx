"use client";

import type { ReactNode, RefObject } from "react";
import { Spinner } from "@/ui";
import { ArrowUp, Code2, Plus } from "@/ui/icon-registry";
import type { BrowserBackend } from "@/features/agent/tools/types";
import { GlobeIcon, PanelIcon, SitegeistIcon, StopIcon } from "@/ui/icons";

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
  modelSelector?: ReactNode;
}) {
  const inputHasText = Boolean(input.trim());
  const starting = status === "starting";
  const usingSitegeist = browserBackend === "sitegeist";
  const browserBackendLabel = usingSitegeist ? "Sitegeist relay" : "embedded panel";
  const browserBackendTarget = usingSitegeist ? "embedded panel" : "Sitegeist relay";
  const inactiveIconClass = "text-(--dim)/75 hover:bg-(--hover) hover:text-(--fg)/85";
  const activeIconClass = "bg-(--hover) text-(--fg)/85 hover:text-(--fg)";

  return (
    <div className="agent-composer-actions-row flex min-h-8 items-center gap-1.5 bg-transparent px-3 pb-1.5 pt-0.5 text-xs">
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
        className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md text-(--dim)/75 hover:bg-(--hover) hover:text-(--fg)/85 disabled:opacity-30"
        aria-label="Attach files"
        title="Attach files (or paste/drop into composer)"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
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
        className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md ${browserToolEnabled ? activeIconClass : inactiveIconClass}`}
      >
        <span className="relative inline-flex">
          <GlobeIcon className="h-3.5 w-3.5" />
        </span>
      </button>
      {browserToolEnabled ? (
        <button
          type="button"
          onClick={onToggleBrowserBackend}
          aria-label={`Browser backend: ${browserBackendLabel}. Switch to ${browserBackendTarget}.`}
          className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md ${usingSitegeist ? activeIconClass : inactiveIconClass}`}
          title={`Browser: ${browserBackendLabel}. Click to use ${browserBackendTarget}.`}
        >
          {usingSitegeist ? (
            <SitegeistIcon className="h-3.5 w-3.5" />
          ) : (
            <PanelIcon className="h-3.5 w-3.5" />
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
        className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md ${canvasEnabled ? activeIconClass : inactiveIconClass}`}
      >
        <Code2 className="h-3.5 w-3.5" />
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {modelSelector}
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
                className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full bg-(--fg) text-(--bg) transition-opacity hover:opacity-85"
                aria-label="Steer current task"
                title="Steer current task (Enter) · Queue instead (Tab)"
              >
                <ArrowUp className="h-3.5 w-3.5 stroke-[2.25]" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onAbortTurn}
              disabled={starting}
              className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-85 disabled:opacity-30 ${inputHasText ? "bg-(--hover) text-(--fg)" : "bg-(--fg) text-(--bg)"}`}
              aria-label="Stop"
              title="Stop (Esc)"
            >
              <StopIcon className="h-3 w-3" />
            </button>
          </>
        ) : (
          <button
            type="submit"
            disabled={(!inputHasText && attachmentsCount === 0) || readingAttachments}
            className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full bg-(--fg) text-(--bg) transition-opacity hover:opacity-85 disabled:opacity-25"
            aria-label="Send"
            title="Send (Enter) · Queue (Tab)"
          >
            {starting ? <Spinner size="sm" /> : <ArrowUp className="h-3.5 w-3.5 stroke-[2.25]" />}
          </button>
        )}
      </div>
    </div>
  );
}
