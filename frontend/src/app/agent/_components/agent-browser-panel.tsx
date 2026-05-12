"use client";

import type { FormEvent, ReactNode } from "react";
import { CloseIcon } from "@/components/icons";
import { normalizeBrowserInput } from "@/lib/agent/tools/browser-url";
import { useTools, type ToolsContextValue } from "@/lib/agent/tools/context";
import type { Project } from "@/lib/agent/projects/types";
import { AgentBrowser, type AgentBrowserHandle } from "./agent-browser";
import { FilesystemPanel } from "./filesystem-panel";
import { GitDiffPanel } from "./git-diff-panel";
import type { WorkspaceHandles } from "./use-workspace";

type AgentBrowserPanelHandles = Pick<
  WorkspaceHandles,
  "registerComputerAside" | "startComputerResize" | "registerBrowserHandle" | "runBrowserCommand"
>;

type AgentBrowserPanelProps = {
  handles: AgentBrowserPanelHandles;
  activeProject: Project | null;
  focusedTitle: string;
};

export function AgentBrowserPanel({
  handles,
  activeProject,
  focusedTitle,
}: AgentBrowserPanelProps) {
  const tools = useTools();
  if (!tools.computer.open) return null;

  const { registerComputerAside, startComputerResize, registerBrowserHandle, runBrowserCommand } =
    handles;
  const isElectron = typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
  const submitBrowserUrl = (event: FormEvent) => {
    event.preventDefault();
    const next = normalizeBrowserInput(tools.browser.input, activeProject?.path ?? "");
    if (!next) return;
    tools.setBrowserUrl(next, next);
    void runBrowserCommand("navigate", { url: next });
  };

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-(--border) bg-(--bg)"
      ref={registerComputerAside}
      style={{ width: `min(${tools.computer.width}px, 48vw)` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize computer"
        onMouseDown={startComputerResize}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-(--accent)/20"
      />
      <div className="flex h-9 shrink-0 items-center gap-3 px-3 text-xs text-(--dim)">
        <span
          className="min-w-0 flex-1 truncate px-1 text-[10px] uppercase tracking-wide"
          title={`Computer follows focused session: ${focusedTitle}`}
        >
          {focusedTitle}
        </span>
        <ComputerTabButton
          active={tools.computer.tab === "browser"}
          onClick={() => tools.setComputerTab("browser")}
        >
          Browser
        </ComputerTabButton>
        <ComputerTabButton
          active={tools.computer.tab === "files"}
          onClick={() => tools.setComputerTab("files")}
        >
          Files
        </ComputerTabButton>
        <ComputerTabButton
          active={tools.computer.tab === "diff"}
          onClick={() => tools.setComputerTab("diff")}
        >
          Diff
        </ComputerTabButton>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => tools.setComputerOpen(false)}
          className="ml-1 inline-flex h-7 w-7 items-center justify-center hover:text-(--fg)"
          title="Close"
          aria-label="Close computer"
        >
          <CloseIcon className="h-3.5 w-3.5 pointer-events-none" />
        </button>
      </div>

      {tools.computer.tab === "browser" ? (
        <AgentBrowser
          ref={registerBrowserHandle}
          url={tools.browser.url}
          inputValue={tools.browser.input}
          onInputChange={tools.setBrowserInput}
          onSubmit={submitBrowserUrl}
          onClose={() => tools.setComputerOpen(false)}
          isElectron={isElectron}
        />
      ) : tools.computer.tab === "files" ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <FilesystemPanel cwd={activeProject?.path ?? null} />
          </div>
        </section>
      ) : (
        <GitDiffPanel cwd={activeProject?.path ?? null} />
      )}
    </aside>
  );
}

function ComputerTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-6 shrink-0 font-medium uppercase tracking-wide ${
        active ? "text-(--fg)" : "hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
  );
}
