"use client";

import type { ReactNode, RefObject } from "react";
import { Spinner } from "@/ui";
import { ArrowUp, Plus } from "@/ui/icon-registry";
import type { BrowserBackend } from "@/features/agent/tools/types";
import { GlobeIcon, PanelIcon, StopIcon, UserBrowserIcon } from "@/ui/icons";

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
  onAbortTurn: () => void;
  modelSelector?: ReactNode;
}) {
  const inputHasText = Boolean(input.trim());
  const starting = status === "starting";
  const stopping = status === "stopping";
  // The sandbox browser is always armed once the browser tool is on; this
  // second button adds the user's own browser on top of it, so it reads as an
  // on/off for Chrome rather than a choice between two backends.
  const chromeArmed = browserBackend === "chrome";
  const chromeLabel = chromeArmed
    ? "Your Chrome is armed — the agent can drive your real browser, with your logins"
    : "Your Chrome is off — the agent only has the headless sandbox browser";
  const chromeAction = chromeArmed ? "Stop letting it use your browser" : "Let it use your browser";
  const inactiveIconClass = "text-(--hl2) hover:bg-(--hover) hover:text-(--fg)";
  const activeIconClass = "bg-(--active) text-(--fg)";

  return (
    <div className="agent-composer-actions-row flex min-h-8 items-center gap-0.5 bg-transparent px-2 pb-1.5 pt-0 text-xs">
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
        className={`composer-action-optional inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full ${browserToolEnabled ? activeIconClass : inactiveIconClass}`}
      >
        <span className="relative inline-flex">
          <GlobeIcon className="h-4 w-4" />
        </span>
      </button>
      {browserToolEnabled ? (
        <button
          type="button"
          onClick={onToggleBrowserBackend}
          aria-pressed={chromeArmed}
          aria-label={`${chromeLabel}. ${chromeAction}.`}
          className={`composer-action-optional inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full ${chromeArmed ? activeIconClass : inactiveIconClass}`}
          title={`${chromeLabel}. Click to ${chromeAction.toLowerCase()}.`}
        >
          {chromeArmed ? (
            <UserBrowserIcon className="h-4 w-4" />
          ) : (
            <PanelIcon className="h-4 w-4" />
          )}
        </button>
      ) : null}
      <div className="ml-auto flex min-w-0 shrink items-center gap-0.5">
        {modelSelector}
        {running ? (
          <>
            {starting || stopping ? (
              <span
                className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1.5 px-2 text-[length:var(--fs-sm)] text-(--dim)"
                title={stopping ? "Waiting for Pi to stop" : "Waiting for the model to start"}
              >
                <Spinner size="xs" />
                {stopping ? "Stopping…" : "Starting…"}
              </span>
            ) : inputHasText ? (
              <button
                type="submit"
                className="inline-flex !h-[30px] !min-h-[30px] !w-[30px] !min-w-[30px] shrink-0 items-center justify-center rounded-full bg-(--fg) text-(--bg) transition-opacity hover:opacity-85"
                aria-label="Steer current task now"
                title="Steer current task now (Alt+Enter) · Enter queues it instead"
              >
                <ArrowUp className="h-4 w-4 stroke-[2.25]" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onAbortTurn}
              disabled={starting || stopping}
              className="inline-flex !h-[30px] !min-h-[30px] !w-[30px] !min-w-[30px] shrink-0 items-center justify-center rounded-full bg-(--fg) text-(--bg) transition-opacity hover:opacity-85 disabled:opacity-30"
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
            title="Send (Enter)"
          >
            {starting ? <Spinner size="sm" /> : <ArrowUp className="h-4 w-4 stroke-[2.25]" />}
          </button>
        )}
      </div>
    </div>
  );
}
