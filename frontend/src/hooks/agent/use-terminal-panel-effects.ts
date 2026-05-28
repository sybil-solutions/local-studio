import { useCallback, useSyncExternalStore, type RefObject } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalRunResult } from "@/lib/agent/contracts/terminal";

type PtyBridge = {
  status(): Promise<{ available: boolean; reason: string | null }>;
  open(opts: { cwd?: string; cols?: number; rows?: number }): Promise<{ id: string }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<void>;
  onData(listener: (id: string, chunk: string) => void): () => void;
  onExit(
    listener: (id: string, info: { exitCode: number; signal: number | null }) => void,
  ): () => void;
};

function getPtyBridge(): PtyBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { vllmStudioDesktop?: { terminal?: PtyBridge } })
    .vllmStudioDesktop?.terminal;
  return bridge ?? null;
}

export type TerminalRefs = {
  term: XTerm | null;
  fit: FitAddon | null;
  input: string;
  running: boolean;
  disposed: boolean;
};

type FallbackSession = {
  input: string;
  running: boolean;
  cwd: string | null;
  previousCwd: string | null;
};

const getTerminalPanelSnapshot = (): number => 0;

export function useTerminalPanelEffects({
  containerRef,
  cwd,
  stateRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  cwd: string | null;
  stateRef: RefObject<TerminalRefs>;
}): void {
  const subscribeTerminal = useCallback(() => {
    const refs = stateRef.current;
    refs.disposed = false;
    refs.input = "";
    refs.running = false;
    let cleanupResize: (() => void) | null = null;
    let disposePty: (() => void) | null = null;

    async function boot() {
      const element = containerRef.current;
      if (!element) return;
      const [{ Terminal }, { FitAddon }, webLinksModule] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links").catch(() => null),
      ]);
      if (refs.disposed) return;
      // xterm renders to canvas and cannot resolve `var(--font-geist-mono)` itself,
      // so read the resolved value off the container first and fall back gracefully.
      const resolvedGeistMono =
        getComputedStyle(element).getPropertyValue("--font-geist-mono").trim() || "";
      const fontFamily =
        (resolvedGeistMono ? `${resolvedGeistMono}, ` : "") +
        '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
      const term = new Terminal({
        cursorBlink: true,
        convertEol: false,
        scrollback: 10_000,
        allowProposedApi: true,
        macOptionIsMeta: true,
        rightClickSelectsWord: true,
        fontFamily,
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
      if (webLinksModule) {
        try {
          term.loadAddon(
            new webLinksModule.WebLinksAddon((event, uri) => {
              event.preventDefault();
              const opener = (
                window as unknown as { vllmStudioDesktop?: { openExternal?: (u: string) => void } }
              ).vllmStudioDesktop?.openExternal;
              if (opener) opener(uri);
              else window.open(uri, "_blank", "noopener");
            }),
          );
        } catch {
          // optional
        }
      }
      term.open(element);
      fit.fit();
      refs.term = term;
      refs.fit = fit;

      const pty = getPtyBridge();
      let useFallback = !pty;
      if (pty) {
        const status = await pty.status().catch(() => ({ available: false, reason: "ipc error" }));
        if (!status.available) {
          term.writeln(`\x1b[33mPTY unavailable: ${status.reason ?? "unknown"}\x1b[0m`);
          term.writeln("\x1b[33mFalling back to non-interactive shell.\x1b[0m");
          useFallback = true;
        }
      } else {
        term.writeln("\x1b[33mNo desktop PTY bridge — using web fallback (no TUI).\x1b[0m");
      }

      if (!useFallback && pty) {
        disposePty = await bootPty(pty, term, fit, refs, element, cwd);
        cleanupResize = disposePty;
      } else {
        cleanupResize = bootFallback(term, fit, refs, element, cwd);
      }

      window.setTimeout(() => {
        if (!refs.disposed) term.focus();
      }, 0);
    }

    void boot();

    return () => {
      refs.disposed = true;
      cleanupResize?.();
      disposePty?.();
      refs.term?.dispose();
      refs.term = null;
      refs.fit = null;
    };
  }, [containerRef, cwd, stateRef]);

  useSyncExternalStore(subscribeTerminal, getTerminalPanelSnapshot, getTerminalPanelSnapshot);
}

async function bootPty(
  pty: PtyBridge,
  term: XTerm,
  fit: FitAddon,
  refs: TerminalRefs,
  element: HTMLDivElement,
  cwd: string | null,
): Promise<() => void> {
  const { cols, rows } = term;
  const { id } = await pty.open({ cwd: cwd ?? undefined, cols, rows });
  const dataDisposer = pty.onData((sessionId, chunk) => {
    if (sessionId === id && !refs.disposed) term.write(chunk);
  });
  const exitDisposer = pty.onExit((sessionId, info) => {
    if (sessionId !== id || refs.disposed) return;
    term.writeln(
      `\r\n\x1b[90m[process exited: code=${info.exitCode}${info.signal ? ` signal=${info.signal}` : ""}]\x1b[0m`,
    );
  });
  const dataSub = term.onData((data) => {
    void pty.write(id, data);
  });
  const resizeObserver = new ResizeObserver(() => {
    if (refs.disposed) return;
    try {
      fit.fit();
      void pty.resize(id, term.cols, term.rows);
    } catch {
      // ignore
    }
  });
  resizeObserver.observe(element);
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && (event.key === "c" || event.key === "C")) {
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard?.writeText(selection).catch(() => undefined);
        return false;
      }
    }
    if (meta && (event.key === "v" || event.key === "V")) {
      navigator.clipboard
        ?.readText()
        .then((text) => {
          if (text) void pty.write(id, text);
        })
        .catch(() => undefined);
      return false;
    }
    return true;
  });
  return () => {
    dataDisposer();
    exitDisposer();
    dataSub.dispose();
    resizeObserver.disconnect();
    void pty.close(id);
  };
}

function bootFallback(
  term: XTerm,
  fit: FitAddon,
  refs: TerminalRefs,
  element: HTMLDivElement,
  cwd: string | null,
): () => void {
  const session: FallbackSession = { input: "", running: false, cwd, previousCwd: null };
  writeIntro(term, session.cwd);
  const dataSub = term.onData((data) => handleTerminalData(data, refs, term, session));
  const resizeObserver = new ResizeObserver(() => refs.fit?.fit());
  resizeObserver.observe(element);
  void fit;
  return () => {
    dataSub.dispose();
    resizeObserver.disconnect();
  };
}

function handleTerminalData(
  data: string,
  refs: TerminalRefs,
  term: XTerm,
  session: FallbackSession,
): boolean {
  if (session.running || term.element?.isConnected === false) return false;
  if (data === "\r") {
    const command = session.input.trim();
    term.write("\r\n");
    session.input = "";
    if (command) void runFallbackCommand(command, refs, session, term);
    else writePrompt(term, session.cwd);
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
  term.writeln("\x1b[90mvLLM Studio terminal (fallback mode — no TUI)\x1b[0m");
  if (!cwd) term.writeln("\x1b[31mNo working directory.\x1b[0m");
  writePrompt(term, cwd);
}

function writePrompt(term: XTerm, cwd: string | null) {
  term.write(`\x1b[90m${cwd ?? "no-project"}\x1b[0m \x1b[32m$\x1b[0m `);
}

function parseCdTarget(command: string): string | null {
  const trimmed = command.trim();
  if (trimmed !== "cd" && !/^cd(\s|$)/.test(trimmed)) return null;
  const rest = trimmed.slice(2).trim();
  if (!rest) return "~";
  return rest.replace(/^["']|["']$/g, "");
}

async function handleCd(target: string, refs: TerminalRefs, session: FallbackSession, term: XTerm) {
  try {
    const response = await fetch("/api/agent/terminal/resolve-cwd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, from: session.cwd, previous: session.previousCwd }),
    });
    const payload = (await response.json()) as { ok: boolean; cwd?: string; error?: string };
    if (!payload.ok || !payload.cwd) {
      term.writeln(`\x1b[31mcd: ${payload.error ?? "failed"}\x1b[0m`);
      return;
    }
    if (session.cwd) session.previousCwd = session.cwd;
    session.cwd = payload.cwd;
    if (target === "-") term.writeln(payload.cwd);
  } catch (error) {
    term.writeln(`\x1b[31m${error instanceof Error ? error.message : "cd failed"}\x1b[0m`);
  } finally {
    if (!refs.disposed) writePrompt(term, session.cwd);
  }
}

async function runFallbackCommand(
  command: string,
  refs: TerminalRefs,
  session: FallbackSession,
  term: XTerm,
) {
  const cdTarget = parseCdTarget(command);
  if (cdTarget !== null) {
    session.running = true;
    try {
      await handleCd(cdTarget, refs, session, term);
    } finally {
      session.running = false;
    }
    return;
  }
  if (!session.cwd) {
    term.writeln("\x1b[31mNo working directory.\x1b[0m");
    writePrompt(term, session.cwd);
    return;
  }
  session.running = true;
  try {
    const response = await fetch(`/api/agent/terminal?cwd=${encodeURIComponent(session.cwd)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    const payload = (await response.json()) as TerminalRunResult;
    if (payload.stdout) term.write(payload.stdout.replace(/\n/g, "\r\n"));
    if (payload.stderr) term.write(`\x1b[31m${payload.stderr.replace(/\n/g, "\r\n")}\x1b[0m`);
    if (payload.error) term.writeln(`\x1b[31m${payload.error}\x1b[0m`);
    if (!payload.ok) term.writeln(`\x1b[31mexit ${payload.exitCode ?? 1}\x1b[0m`);
  } catch (error) {
    term.writeln(`\x1b[31m${error instanceof Error ? error.message : "Command failed"}\x1b[0m`);
  } finally {
    session.running = false;
    if (!refs.disposed) writePrompt(term, session.cwd);
  }
}
