import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { app, type WebContents } from "electron";
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
  ownerKey: string | null;
  pty: PtyHandle;
  webContents: WebContents | null;
  replay: string;
  disposers: Array<() => void>;
  disposeWebContents?: () => void;
};

const MAX_REPLAY_CHARS = 200_000;
const MAX_PTY_SESSIONS = 64;
const sessions = new Map<string, Session>();
const sessionsByOwner = new Map<string, string>();
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
    const packageRequire = app.isPackaged
      ? createRequire(path.join(process.resourcesPath, "desktop-runtime", "package.json"))
      : createRequire(path.join(app.getAppPath(), "package.json"));
    const required = packageRequire("@lydell/node-pty") as Mod | { default: Mod };
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
  return { shell, args: [] };
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

function safeOwnerKey(input: string | undefined | null): string | null {
  const key = (input || "").trim();
  return key ? key.slice(0, 512) : null;
}

// Coerce a renderer-supplied terminal dimension to a sane integer; a non-numeric
// value (e.g. a string) would otherwise become NaN and reach node-pty spawn.
function clampPtyDimension(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 2 ? parsed : fallback;
}

function appendReplay(session: Session, chunk: string): void {
  session.replay += chunk;
  if (session.replay.length > MAX_REPLAY_CHARS) {
    session.replay = session.replay.slice(-MAX_REPLAY_CHARS);
  }
}

function attachWebContents(session: Session, webContents: WebContents): void {
  session.disposeWebContents?.();
  session.webContents = webContents;
  const destroyed = () => {
    if (session.ownerKey) {
      if (session.webContents === webContents) session.webContents = null;
      session.disposeWebContents = undefined;
      return;
    }
    closeInternal(session.id);
  };
  webContents.once("destroyed", destroyed);
  session.disposeWebContents = () => webContents.removeListener("destroyed", destroyed);
}

function ownedSession(ownerKey: string): Session | null {
  const id = sessionsByOwner.get(ownerKey);
  const session = id ? sessions.get(id) : null;
  if (!session) sessionsByOwner.delete(ownerKey);
  return session ?? null;
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
  opts: { cwd?: string; cols?: number; rows?: number; ownerKey?: string },
): { id: string; replay?: string; reused?: boolean } {
  const make = loadFactory();
  if (!make) {
    throw new Error(`PTY unavailable: ${factoryError?.message ?? "unknown"}`);
  }
  const ownerKey = safeOwnerKey(opts.ownerKey);
  const cwd = safeCwd(opts.cwd);
  const cols = clampPtyDimension(opts.cols, 80);
  const rows = clampPtyDimension(opts.rows, 24);
  const existing = ownerKey ? ownedSession(ownerKey) : null;
  if (existing) {
    attachWebContents(existing, webContents);
    resizePty(existing.id, cols, rows);
    log.info(`pty-manager: attached id=${existing.id} owner=${ownerKey}`);
    return { id: existing.id, replay: existing.replay, reused: true };
  }

  // Cap live shells so a buggy/compromised renderer can't loop openPty with
  // fresh owner keys and fork-bomb the host.
  if (sessions.size >= MAX_PTY_SESSIONS) {
    throw new Error(`PTY limit reached (${MAX_PTY_SESSIONS} active terminals)`);
  }

  const { shell, args } = resolveShell();
  const pty = make({ cwd, cols, rows, shell, args, env: buildEnv() });
  const id = randomUUID();
  const session: Session = {
    id,
    ownerKey,
    pty,
    webContents: null,
    replay: "",
    disposers: [],
  };
  const onData = pty.onData((chunk) => {
    const current = sessions.get(id);
    if (!current) return;
    appendReplay(current, chunk);
    if (!current.webContents || current.webContents.isDestroyed()) return;
    current.webContents.send("desktop:pty-data", { id, chunk });
  });
  const onExit = pty.onExit(({ exitCode, signal }) => {
    const current = sessions.get(id);
    if (current?.webContents && !current.webContents.isDestroyed()) {
      current.webContents.send("desktop:pty-exit", { id, exitCode, signal: signal ?? null });
    }
    closeInternal(id);
  });
  session.disposers.push(
    () => onData.dispose(),
    () => onExit.dispose(),
  );
  sessions.set(id, session);
  if (ownerKey) sessionsByOwner.set(ownerKey, id);
  attachWebContents(session, webContents);
  log.info(
    `pty-manager: spawned id=${id} pid=${pty.pid} cwd=${cwd} shell=${shell}${ownerKey ? ` owner=${ownerKey}` : ""}`,
  );
  return { id, reused: false };
}

export function writePty(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session) return;
  try {
    session.pty.write(data);
  } catch (error) {
    // The pty may have exited between its onExit and closeInternal removing the
    // session; writing to a dead fd throws. Match resize/kill, which guard too.
    log.error(`pty-manager: write failed id=${id}: ${String(error)}`);
  }
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

export function closePtyByOwner(ownerKey: string): void {
  const session = ownedSession(ownerKey);
  if (session) closeInternal(session.id);
}

function closeInternal(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.ownerKey) sessionsByOwner.delete(session.ownerKey);
  session.disposeWebContents?.();
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
