"use client";

import { useRef, type RefObject } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalRunResult } from "@/features/agent/contracts";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { effectTimeout } from "@/lib/effect-timers";
import {
  bumpTerminalFontSize,
  getTerminalFontSize,
  getTerminalKeybinds,
  matchTerminalAction,
  resetTerminalFontSize,
  subscribeTerminalStore,
  type TerminalAction,
} from "@/lib/terminal-keybinds";

export function preloadTerminalPanel(): void {
  void import("@xterm/xterm");
  void import("@xterm/addon-fit");
  void import("@xterm/addon-web-links").catch(() => null);
}

export function TerminalPanel({ cwd, ownerKey }: { cwd: string | null; ownerKey: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<TerminalRefs>({
    term: null,
    fit: null,
    applyResize: null,
    input: "",
    running: false,
    disposed: false,
  });

  useTerminalPanelEffects({
    containerRef,
    cwd,
    ownerKey,
    stateRef,
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-(--color-terminal-bg)">
      <div
        ref={containerRef}
        tabIndex={0}
        onClick={(event) => {
          if (window.getSelection()?.toString()) return;
          if ((event.target as HTMLElement)?.tagName === "A") return;
          stateRef.current.term?.focus();
        }}
        className="min-h-0 flex-1 overflow-hidden px-3 py-2.5 [--xterm-color-background:var(--color-terminal-bg)]"
      />
    </section>
  );
}

type PtyBridge = {
  open(opts: {
    cwd?: string;
    cols?: number;
    rows?: number;
    ownerKey?: string;
  }): Promise<{ id: string; replay?: string; reused?: boolean }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  onData(listener: (id: string, chunk: string) => void): () => void;
  onExit(
    listener: (id: string, info: { exitCode: number; signal: number | null }) => void,
  ): () => void;
};

function getPtyBridge(): PtyBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { localStudioDesktop?: { terminal?: PtyBridge } })
    .localStudioDesktop?.terminal;
  return bridge ?? null;
}

type TerminalRefs = {
  term: XTerm | null;
  fit: FitAddon | null;
  applyResize: (() => void) | null;
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

type PtyBootOptions = {
  pty: PtyBridge;
  term: XTerm;
  fit: FitAddon;
  refs: TerminalRefs;
  element: HTMLDivElement;
  cwd: string | null;
  ownerKey: string;
};

function resolveTerminalFont(cssVar: (name: string) => string): string {
  const resolved = cssVar("--font-geist-mono") || "";
  return (
    (resolved ? `${resolved}, ` : "") +
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
  );
}

function buildTerminalTheme(cssVar: (name: string) => string): Record<string, string> {
  const v = (name: string, fallback: string) => cssVar(name) || fallback;
  return {
    background: v("--color-terminal-bg", "#181818"),
    foreground: v("--color-terminal-fg", "#d4d4d4"),
    cursor: v("--color-terminal-cursor", "#f8f8f8"),
    cursorAccent: v("--color-terminal-cursor-accent", "#181818"),
    selectionBackground: v("--color-terminal-selection", "#339cff47"),
    black: v("--color-terminal-black", "#363636"),
    red: v("--color-terminal-red", "#f67576"),
    green: v("--color-terminal-green", "#85df7b"),
    yellow: v("--color-terminal-yellow", "#fa994c"),
    blue: v("--color-terminal-blue", "#3d8dff"),
    magenta: v("--color-terminal-magenta", "#b06dff"),
    cyan: v("--color-terminal-cyan", "#6dcbf4"),
    white: v("--color-terminal-white", "#adadad"),
    brightBlack: v("--color-terminal-bright-black", "#747474"),
    brightRed: v("--color-terminal-bright-red", "#f99"),
    brightGreen: v("--color-terminal-bright-green", "#87d9a4"),
    brightYellow: v("--color-terminal-bright-yellow", "#ffb26b"),
    brightBlue: v("--color-terminal-bright-blue", "#55a2ff"),
    brightMagenta: v("--color-terminal-bright-magenta", "#a888f2"),
    brightCyan: v("--color-terminal-bright-cyan", "#8ee5e5"),
    brightWhite: v("--color-terminal-bright-white", "#f8f8f8"),
  };
}

type ITerminalLoadable = { loadAddon(addon: unknown): void };

function loadWebLinksAddon(
  term: ITerminalLoadable,
  webLinksModule: {
    WebLinksAddon: new (handler: (e: MouseEvent, uri: string) => void) => unknown;
  } | null,
): void {
  if (!webLinksModule) return;
  try {
    term.loadAddon(
      new webLinksModule.WebLinksAddon((event, uri) => {
        event.preventDefault();
        const opener = (
          window as unknown as { localStudioDesktop?: { openExternal?: (u: string) => void } }
        ).localStudioDesktop?.openExternal;
        if (opener) opener(uri);
        else window.open(uri, "_blank", "noopener");
      }),
    );
  } catch {}
}

function runTerminalAction(action: TerminalAction, refs: TerminalRefs): void {
  const dispatch: Record<TerminalAction, () => void> = {
    clearTerminal: () => refs.term?.clear(),
    fontSizeUp: () => bumpTerminalFontSize(1),
    fontSizeDown: () => bumpTerminalFontSize(-1),
    fontSizeReset: () => resetTerminalFontSize(),
  };
  dispatch[action]();
}

function terminalKeyHandler(stateRef: RefObject<TerminalRefs>): (event: KeyboardEvent) => boolean {
  return (event) => {
    if (event.type !== "keydown") return true;
    const action = matchTerminalAction(event, getTerminalKeybinds());
    if (!action) return true;
    event.preventDefault();
    event.stopPropagation();
    runTerminalAction(action, stateRef.current);
    return false;
  };
}

function useTerminalPanelEffects({
  containerRef,
  cwd,
  ownerKey,
  stateRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  cwd: string | null;
  ownerKey: string;
  stateRef: RefObject<TerminalRefs>;
}): void {
  useMountSubscription(() => {
    const refs = stateRef.current;
    refs.disposed = false;
    refs.input = "";
    refs.running = false;
    let cleanupTerminal: (() => void) | null = null;

    async function boot() {
      const element = containerRef.current;
      if (!element) return;
      const [{ Terminal }, { FitAddon }, webLinksModule] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links").catch(() => null),
      ]);
      if (refs.disposed) return;
      const styles = getComputedStyle(element);
      const cssVar = (name: string): string => styles.getPropertyValue(name).trim();
      const fontFamily = resolveTerminalFont(cssVar);
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        convertEol: false,
        // 10k lines is still deep history; 50k made every kept-alive terminal
        // hold a multi-MB buffer, which compounds across the mounted MRU set.
        scrollback: 10_000,
        allowProposedApi: true,
        macOptionIsMeta: true,
        rightClickSelectsWord: true,
        smoothScrollDuration: 80,
        minimumContrastRatio: 3,
        fontFamily,
        fontSize: getTerminalFontSize(),
        fontWeightBold: "600",
        lineHeight: 1.2,
        letterSpacing: 0,
        theme: buildTerminalTheme(cssVar),
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      loadWebLinksAddon(term, webLinksModule);
      term.attachCustomKeyEventHandler(terminalKeyHandler(stateRef));
      term.open(element);
      fit.fit();
      refs.term = term;
      refs.fit = fit;

      const pty = getPtyBridge();
      if (pty) {
        try {
          cleanupTerminal = await bootPty({ pty, term, fit, refs, element, cwd, ownerKey });
        } catch (error) {
          const reason = error instanceof Error ? error.message : "unknown";
          term.writeln(`\x1b[33mPTY unavailable: ${reason}\x1b[0m`);
          term.writeln("\x1b[33mFalling back to non-interactive shell.\x1b[0m");
          cleanupTerminal = bootFallback(term, fit, refs, element, cwd);
        }
      } else {
        term.writeln("\x1b[33mNo desktop PTY bridge — using web fallback (no TUI).\x1b[0m");
        cleanupTerminal = bootFallback(term, fit, refs, element, cwd);
      }

      effectTimeout(() => {
        if (!refs.disposed) term.focus();
      }, 0);
    }

    void boot();

    return () => {
      refs.disposed = true;
      cleanupTerminal?.();
      refs.term?.dispose();
      refs.term = null;
      refs.fit = null;
      refs.applyResize = null;
    };
  }, [containerRef, cwd, ownerKey, stateRef]);

  useMountSubscription(
    () =>
      subscribeTerminalStore(() => {
        const term = stateRef.current.term;
        if (!term) return;
        term.options.fontSize = getTerminalFontSize();
        stateRef.current.applyResize?.();
      }),
    [stateRef],
  );
}

async function bootPty({
  pty,
  term,
  fit,
  refs,
  element,
  cwd,
  ownerKey,
}: PtyBootOptions): Promise<() => void> {
  const { cols, rows } = term;
  let currentId: string | null = null;
  const queuedData: Array<{ sessionId: string; chunk: string }> = [];
  const queuedExits: Array<{
    sessionId: string;
    info: { exitCode: number; signal: number | null };
  }> = [];
  const dataDisposer = pty.onData((sessionId, chunk) => {
    if (!currentId) {
      queuedData.push({ sessionId, chunk });
      return;
    }
    if (sessionId === currentId && !refs.disposed) term.write(chunk);
  });
  const exitDisposer = pty.onExit((sessionId, info) => {
    if (!currentId) {
      queuedExits.push({ sessionId, info });
      return;
    }
    if (sessionId !== currentId || refs.disposed) return;
    term.writeln(
      `\r\n\x1b[90m[process exited: code=${info.exitCode}${info.signal ? ` signal=${info.signal}` : ""}]\x1b[0m`,
    );
  });
  const { id, replay } = await pty.open({ cwd: cwd ?? undefined, cols, rows, ownerKey });
  if (refs.disposed) {
    dataDisposer();
    exitDisposer();
    return () => {};
  }
  currentId = id;
  if (replay) term.write(replay);
  for (const item of queuedData) {
    if (item.sessionId === id && !refs.disposed) term.write(item.chunk);
  }
  for (const item of queuedExits) {
    if (item.sessionId !== id || refs.disposed) continue;
    const { info } = item;
    term.writeln(
      `\r\n\x1b[90m[process exited: code=${info.exitCode}${info.signal ? ` signal=${info.signal}` : ""}]\x1b[0m`,
    );
  }
  const dataSub = term.onData((data) => {
    void pty.write(id, data);
  });
  refs.applyResize = () => {
    if (refs.disposed) return;
    try {
      fit.fit();
      void pty.resize(id, term.cols, term.rows);
    } catch {}
  };
  const resizeObserver = new ResizeObserver(() => refs.applyResize?.());
  resizeObserver.observe(element);
  return () => {
    dataDisposer();
    exitDisposer();
    dataSub.dispose();
    resizeObserver.disconnect();
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
  refs.applyResize = () => fit.fit();
  const resizeObserver = new ResizeObserver(() => refs.applyResize?.());
  resizeObserver.observe(element);
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
  term.writeln("\x1b[90mLocal Studio terminal (fallback mode — no TUI)\x1b[0m");
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
