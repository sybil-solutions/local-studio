import { useEffect, type RefObject } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalRunResult } from "@/lib/agent/contracts/terminal";

export type TerminalRefs = {
  term: XTerm | null;
  fit: FitAddon | null;
  input: string;
  running: boolean;
  disposed: boolean;
};

type TerminalSessionState = {
  input: string;
  running: boolean;
};

export function useTerminalPanelEffects({
  containerRef,
  cwd,
  stateRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  cwd: string | null;
  stateRef: RefObject<TerminalRefs>;
}): void {
  useEffect(() => {
    const refs = stateRef.current;
    refs.disposed = false;
    refs.input = "";
    refs.running = false;
    let cleanupResize: (() => void) | null = null;

    async function boot() {
      const element = containerRef.current;
      if (!element) return;
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (refs.disposed) return;
      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily:
          'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 12,
        lineHeight: 1.35,
        theme: {
          background: "#070707",
          foreground: "#f2f2f2",
          cursor: "#f2f2f2",
          selectionBackground: "#3a3a3a",
          black: "#0a0a0a",
          blue: "#74a7ff",
          brightBlue: "#9fc2ff",
          cyan: "#69d2e7",
          green: "#7ee787",
          magenta: "#d2a8ff",
          red: "#ff7b72",
          white: "#f0f0f0",
          yellow: "#f2cc60",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();
      refs.term = term;
      refs.fit = fit;
      const session: TerminalSessionState = { input: "", running: false };
      writeIntro(term, cwd);
      term.onData((data) => handleTerminalData(data, cwd, refs, term, session));
      term.focus();
      window.setTimeout(() => {
        if (!refs.disposed) term.focus();
      }, 0);
      const observer = new ResizeObserver(() => refs.fit?.fit());
      observer.observe(element);
      cleanupResize = () => observer.disconnect();
    }

    void boot();

    return () => {
      refs.disposed = true;
      cleanupResize?.();
      refs.term?.dispose();
      refs.term = null;
      refs.fit = null;
    };
  }, [containerRef, cwd, stateRef]);
}

function handleTerminalData(
  data: string,
  cwd: string | null,
  refs: TerminalRefs,
  term = refs.term,
  session: TerminalSessionState = refs,
): boolean {
  if (!term || session.running || term.element?.isConnected === false) return false;
  if (data === "\r") {
    const command = session.input.trim();
    term.write("\r\n");
    session.input = "";
    if (command) void runCommand(command, cwd, refs, session, term);
    else writePrompt(term, cwd);
    return true;
  }
  if (data === "\u007f") {
    if (session.input.length === 0) return true;
    session.input = session.input.slice(0, -1);
    term.write("\b \b");
    return true;
  }
  if (data >= " " && data !== "\u007f") {
    session.input += data;
    term.write(data);
    return true;
  }
  return false;
}

function writeIntro(term: XTerm, cwd: string | null) {
  term.writeln("\x1b[90mvLLM Studio terminal\x1b[0m");
  if (!cwd) {
    term.writeln("\x1b[31mChoose a project directory before running commands.\x1b[0m");
  }
  writePrompt(term, cwd);
}

function writePrompt(term: XTerm, cwd: string | null) {
  const label = cwd ? cwd.split("/").filter(Boolean).pop() || cwd : "no-project";
  term.write(`\x1b[90m${label}\x1b[0m \x1b[32m$\x1b[0m `);
}

async function runCommand(
  command: string,
  cwd: string | null,
  refs: TerminalRefs,
  session: TerminalSessionState = refs,
  term = refs.term,
) {
  if (!term) return;
  if (!cwd) {
    term.writeln("\x1b[31mNo project directory selected.\x1b[0m");
    writePrompt(term, cwd);
    return;
  }
  session.running = true;
  try {
    const response = await fetch(`/api/agent/terminal?cwd=${encodeURIComponent(cwd)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    const payload = (await response.json()) as TerminalRunResult;
    writeResult(term, payload);
  } catch (error) {
    term.writeln(`\x1b[31m${error instanceof Error ? error.message : "Command failed"}\x1b[0m`);
  } finally {
    session.running = false;
    if (!refs.disposed) writePrompt(term, cwd);
  }
}

function writeResult(term: XTerm, payload: TerminalRunResult) {
  if (payload.stdout) term.write(payload.stdout.replace(/\n/g, "\r\n"));
  if (payload.stderr) term.write(`\x1b[31m${payload.stderr.replace(/\n/g, "\r\n")}\x1b[0m`);
  if (payload.error) term.writeln(`\x1b[31m${payload.error}\x1b[0m`);
  if (!payload.ok) term.writeln(`\x1b[31mexit ${payload.exitCode ?? 1}\x1b[0m`);
  if (payload.ok && !payload.stdout && !payload.stderr) term.writeln("");
}
