import { randomUUID } from "node:crypto";
import os from "node:os";
import { existsSync, statSync } from "node:fs";
import type { WebContents } from "electron";
import { log } from "../helpers/logger";

type PtyHandle = {
  pid: number;
  cols: number;
  rows: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (info: { exitCode: number; signal: number | undefined }) => void): {
    dispose(): void;
  };
};

type PtyFactory = (opts: {
  cwd: string;
  cols: number;
  rows: number;
  shell: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}) => PtyHandle;

type Session = {
  id: string;
  pty: PtyHandle;
  webContents: WebContents;
  disposers: Array<() => void>;
};

const sessions = new Map<string, Session>();
let factory: PtyFactory | null = null;
let factoryError: Error | null = null;

function loadFactory(): PtyFactory | null {
  if (factory || factoryError) return factory;
  try {
    type Mod = {
      spawn: (
        shell: string,
        args: string[],
        opts: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv; name?: string },
      ) => PtyHandle;
    };
    const required = require("@lydell/node-pty") as Mod | { default: Mod }; // eslint-disable-line @typescript-eslint/no-require-imports
    const mod = (
      required && "spawn" in required ? required : (required as { default: Mod }).default
    ) as Mod;
    factory = ({ cwd, cols, rows, shell, args, env }) =>
      mod.spawn(shell, args, { cwd, cols, rows, env, name: "xterm-256color" });
    return factory;
  } catch (error) {
    factoryError = error instanceof Error ? error : new Error(String(error));
    log.error(`pty-manager: failed to load @lydell/node-pty: ${factoryError.message}`);
    return null;
  }
}

function resolveShell(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return { shell: process.env.COMSPEC || "cmd.exe", args: [] };
  }
  const shell = process.env.SHELL || "/bin/zsh";
  return { shell, args: ["-l"] };
}

function safeCwd(input: string | undefined | null): string {
  const candidate = (input || "").trim();
  if (candidate && existsSync(candidate)) {
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // fall through
    }
  }
  return os.homedir();
}

function buildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.LANG = env.LANG || "en_US.UTF-8";
  return env;
}

export function isPtyAvailable(): boolean {
  return loadFactory() !== null;
}

export function ptyUnavailableReason(): string | null {
  if (loadFactory()) return null;
  return factoryError?.message ?? "node-pty unavailable";
}

export function openPty(
  webContents: WebContents,
  opts: { cwd?: string; cols?: number; rows?: number },
): { id: string } {
  const make = loadFactory();
  if (!make) {
    throw new Error(`PTY unavailable: ${factoryError?.message ?? "unknown"}`);
  }
  const cwd = safeCwd(opts.cwd);
  const cols = Math.max(2, Math.floor(opts.cols ?? 80));
  const rows = Math.max(2, Math.floor(opts.rows ?? 24));
  const { shell, args } = resolveShell();
  const pty = make({ cwd, cols, rows, shell, args, env: buildEnv() });
  const id = randomUUID();
  const onData = pty.onData((chunk) => {
    if (webContents.isDestroyed()) return;
    webContents.send("desktop:pty-data", { id, chunk });
  });
  const onExit = pty.onExit(({ exitCode, signal }) => {
    if (!webContents.isDestroyed()) {
      webContents.send("desktop:pty-exit", { id, exitCode, signal: signal ?? null });
    }
    closeInternal(id);
  });
  const session: Session = {
    id,
    pty,
    webContents,
    disposers: [() => onData.dispose(), () => onExit.dispose()],
  };
  sessions.set(id, session);
  const destroyed = () => closeInternal(id);
  webContents.once("destroyed", destroyed);
  session.disposers.push(() => webContents.removeListener("destroyed", destroyed));
  log.info(`pty-manager: spawned id=${id} pid=${pty.pid} cwd=${cwd} shell=${shell}`);
  return { id };
}

export function writePty(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.pty.write(data);
}

export function resizePty(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) return;
  const c = Math.max(2, Math.floor(cols));
  const r = Math.max(2, Math.floor(rows));
  try {
    session.pty.resize(c, r);
  } catch (error) {
    log.error(`pty-manager: resize failed id=${id}: ${String(error)}`);
  }
}

export function closePty(id: string): void {
  closeInternal(id);
}

function closeInternal(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  for (const dispose of session.disposers) {
    try {
      dispose();
    } catch {
      // ignore
    }
  }
  try {
    session.pty.kill();
  } catch {
    // ignore — already exited
  }
}

export function killAllPtys(): void {
  for (const id of [...sessions.keys()]) closeInternal(id);
}
