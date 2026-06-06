"use client";

import type { RefObject } from "react";
import { Code2, Loader2, Plus } from "lucide-react";
import type { BrowserBackend } from "@/lib/agent/tools/types";
import { GlobeIcon, SendIcon, StopIcon } from "./icons";

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
  onQueueMessage,
  onAbortTurn,
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
  onQueueMessage: () => void;
  onAbortTurn: () => void;
}) {
  const inputHasText = Boolean(input.trim());
  const starting = status === "starting";
  const browserBackendLabel = browserBackend === "parchi" ? "Parchi relay" : "embedded panel";
  const browserBackendTarget = browserBackend === "parchi" ? "embedded panel" : "Parchi relay";

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
        className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center text-(--dim) hover:text-(--fg)/80 disabled:opacity-30"
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
        className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md ${browserToolEnabled ? "text-(--accent)/70 hover:text-(--accent)" : "text-(--dim)/75 hover:text-(--fg)/80"}`}
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
          className="inline-flex !h-7 !min-h-7 shrink-0 items-center rounded-md px-1.5 font-mono text-[10px] uppercase tracking-normal text-(--dim) hover:bg-(--bg-soft) hover:text-(--fg)/85"
          title={
            browserBackend === "parchi"
              ? "Browser backend: Parchi relay. Click to use embedded panel."
              : "Browser backend: embedded panel. Click to use Parchi relay."
          }
        >
          {browserBackend === "parchi" ? "Parchi" : "Panel"}
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
        className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md ${canvasEnabled ? "text-(--accent)/70 hover:text-(--accent)" : "text-(--dim)/75 hover:text-(--fg)/80"}`}
      >
        <Code2 className="h-3.5 w-3.5" />
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {running ? (
          <>
            {starting ? (
              <span
                className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1.5 px-2 text-[length:var(--fs-sm)] text-(--dim)"
                title="Waiting for the model to start"
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                Starting…
              </span>
            ) : inputHasText ? (
              <>
                <button
                  type="button"
                  onClick={onQueueMessage}
                  className="inline-flex !h-7 !min-h-7 shrink-0 items-center px-1.5 text-[length:var(--fs-sm)] text-(--dim) underline-offset-2 hover:text-(--fg) hover:underline"
                  title="Queue (Tab)"
                >
                  Queue
                </button>
                <button
                  type="submit"
                  className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1 rounded-md bg-(--accent)/10 px-2 text-[length:var(--fs-sm)] text-(--accent)/75 hover:bg-(--accent)/15 hover:text-(--fg)/85"
                  title="Steer (Enter): interrupt current turn and send"
                >
                  <SendIcon className="h-3 w-3" /> Steer
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={onAbortTurn}
              disabled={starting}
              className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md text-(--dim) hover:text-(--fg) disabled:opacity-30 disabled:hover:text-(--dim)"
              aria-label="Pause"
              title="Pause (Esc)"
            >
              <StopIcon className="h-3 w-3" />
            </button>
          </>
        ) : (
          <button
            type="submit"
            disabled={(!inputHasText && attachmentsCount === 0) || readingAttachments}
            className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center text-(--dim)/85 hover:text-(--fg)/85 disabled:opacity-30"
            aria-label="Send"
            title="Send (Enter) · Queue (Tab)"
          >
            {starting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SendIcon className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
