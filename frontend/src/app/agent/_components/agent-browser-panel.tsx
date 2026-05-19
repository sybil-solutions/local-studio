"use client";

import type { FormEvent, ReactNode } from "react";
import { CloseIcon } from "@/components/icons";
import { normalizeBrowserInput } from "@/lib/agent/tools/browser-url";
import { useTools, type ToolsContextValue } from "@/lib/agent/tools/context";
import type { Project } from "@/lib/agent/projects/types";
import { AgentBrowser, type AgentBrowserHandle } from "./agent-browser";
import { FilesystemPanel } from "./filesystem-panel";
import { GitDiffPanel } from "./git-diff-panel";
import { TerminalPanel } from "./terminal-panel";
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
  focusedTitle: _focusedTitle,
}: AgentBrowserPanelProps) {
  const tools = useTools();
  if (!tools.computer.open) return null;

  const { registerComputerAside, startComputerResize, registerBrowserHandle, runBrowserCommand } =
    handles;
  const isElectron = typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
  const submitBrowserUrl = (event: FormEvent) => {
    event.preventDefault();
    navigateBrowser(tools.browser.input);
  };
  const navigateBrowser = (value: string) => {
    const next = normalizeBrowserInput(value, activeProject?.path ?? "");
    if (!next) return;
    tools.setBrowserUrl(next, next);
    void runBrowserCommand("navigate", { url: next });
  };

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-(--border) bg-(--bg)"
      ref={registerComputerAside}
      style={{ width: `min(${tools.computer.width}px, 65vw)` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize computer"
        onMouseDown={startComputerResize}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-(--accent)/20"
      />
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-(--border) px-2 text-xs text-(--dim) [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          Git
        </ComputerTabButton>
        <ComputerTabButton
          active={tools.computer.tab === "terminal"}
          onClick={() => tools.setComputerTab("terminal")}
        >
          Term
        </ComputerTabButton>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => tools.setComputerOpen(false)}
          className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center hover:text-(--fg)"
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
          onNavigate={navigateBrowser}
          onLocationChange={(next) => tools.setBrowserUrl(next, next)}
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
      ) : tools.computer.tab === "diff" ? (
        <GitDiffPanel cwd={activeProject?.path ?? null} />
      ) : (
        <TerminalPanel cwd={activeProject?.path ?? null} />
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
      className={`h-7 shrink-0 rounded-md px-2 font-medium ${
        active ? "bg-(--hover) text-(--fg)" : "hover:bg-(--hover) hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
  );
}
