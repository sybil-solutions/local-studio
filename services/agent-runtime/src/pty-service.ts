// Server-side PTY sessions — the single shell backend for every terminal, in
// the browser and in the packaged desktop app alike. Shells are keyed by
// ownerKey and outlive any UI attachment: closing the tab, navigating away, or
// dropping the SSE stream leaves the shell running; reattaching replays the
// bounded scrollback and resumes live output.
//
// Security posture: this service is only reachable through the Next.js
// frontend proxy (the runtime binds 127.0.0.1), which enforces the host
// allowlist, the opt-in access token, CSRF on mutations, and workspace-root
// checks on cwd. Everything here re-validates its own inputs anyway —
// defense-in-depth against a misrouted or host-local caller.

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";

// The runtime ships as ESM; node-pty is a CJS native addon, so load it with a
// scoped require rather than a static import (which would break the bun-run
// dev path and eagerly load the addon at boot).
const requireModule = createRequire(import.meta.url);

type PtyHandle = {
  pid: number;
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

export type PtySubscriber = {
  onData(chunk: string): void;
  onExit(info: { exitCode: number; signal: number | null }): void;
};

type Session = {
  id: string;
  ownerKey: string | null;
  pty: PtyHandle;
  replay: string;
  exited: { exitCode: number; signal: number | null } | null;
  subscribers: Set<PtySubscriber>;
  disposers: Array<() => void>;
};

// Bounded scrollback kept per shell for reattach/replay (~200 KB of UTF-16,
// comfortably under a 512 KB ceiling). A reattaching client gets this buffer as
// the first `snapshot` frame; navigating away or dropping the stream never
// trims it — only new output past the cap rolls off the front.
export const MAX_REPLAY_CHARS = 200_000;
const MAX_PTY_SESSIONS = 64;
export const MAX_PTY_INPUT_CHARS = 32_768;

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
    const required = requireModule("@lydell/node-pty") as Mod | { default: Mod };
    const mod = (
      required && "spawn" in required ? required : (required as { default: Mod }).default
    ) as Mod;
    factory = ({ cwd, cols, rows, shell, args, env }) =>
      mod.spawn(shell, args, { cwd, cols, rows, env, name: "xterm-256color" });
    return factory;
  } catch (error) {
    factoryError = error instanceof Error ? error : new Error(String(error));
    console.error(`[agent-runtime] pty: failed to load @lydell/node-pty: ${factoryError.message}`);
    return null;
  }
}

function resolveShell(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return { shell: process.env.COMSPEC || "cmd.exe", args: [] };
  }
  return { shell: process.env.SHELL || "/bin/zsh", args: [] };
}

// Never spawn a shell rooted at / or a bare system directory, and fall back to
// the home directory when the requested cwd is missing. Mirrors the frontend's
// assertWorkspaceRoot posture without importing Next-side code.
const SYSTEM_ROOTS = new Set(
  ["/bin", "/boot", "/dev", "/etc", "/lib", "/proc", "/sbin", "/sys", "/usr", "/var"].map((p) =>
    path.resolve(p),
  ),
);

function safeCwd(input: string | undefined | null): string {
  const candidate = (input || "").trim();
  if (!candidate || !path.isAbsolute(candidate)) return os.homedir();
  const resolved = (() => {
    try {
      return realpathSync(candidate);
    } catch {
      return path.resolve(candidate);
    }
  })();
  if (resolved === path.parse(resolved).root || SYSTEM_ROOTS.has(resolved)) return os.homedir();
  try {
    if (existsSync(resolved) && statSync(resolved).isDirectory()) return resolved;
  } catch {
    // fall through
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

function clampDimension(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 2 && parsed <= 1_000 ? parsed : fallback;
}

export function clampReplay(replay: string): string {
  return replay.length > MAX_REPLAY_CHARS ? replay.slice(-MAX_REPLAY_CHARS) : replay;
}

function appendReplay(session: Session, chunk: string): void {
  session.replay = clampReplay(session.replay + chunk);
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

export function openPtySession(opts: {
  cwd?: string;
  cols?: number;
  rows?: number;
  ownerKey?: string;
}): { id: string; reused: boolean } {
  const make = loadFactory();
  if (!make) throw new Error(`PTY unavailable: ${factoryError?.message ?? "unknown"}`);
  const ownerKey = safeOwnerKey(opts.ownerKey);
  const cols = clampDimension(opts.cols, 80);
  const rows = clampDimension(opts.rows, 24);
  const existing = ownerKey ? ownedSession(ownerKey) : null;
  if (existing && !existing.exited) {
    resizePtySession(existing.id, cols, rows);
    return { id: existing.id, reused: true };
  }

  if (sessions.size >= MAX_PTY_SESSIONS) {
    throw new Error(`PTY limit reached (${MAX_PTY_SESSIONS} active terminals)`);
  }

  const cwd = safeCwd(opts.cwd);
  const { shell, args } = resolveShell();
  const pty = make({ cwd, cols, rows, shell, args, env: buildEnv() });
  const id = randomUUID();
  const session: Session = {
    id,
    ownerKey,
    pty,
    replay: "",
    exited: null,
    subscribers: new Set(),
    disposers: [],
  };
  const onData = pty.onData((chunk) => {
    const current = sessions.get(id);
    if (!current) return;
    appendReplay(current, chunk);
    for (const subscriber of current.subscribers) subscriber.onData(chunk);
  });
  const onExit = pty.onExit(({ exitCode, signal }) => {
    const current = sessions.get(id);
    if (!current) return;
    current.exited = { exitCode, signal: signal ?? null };
    for (const subscriber of current.subscribers) subscriber.onExit(current.exited);
    closePtySession(id);
  });
  session.disposers.push(
    () => onData.dispose(),
    () => onExit.dispose(),
  );
  sessions.set(id, session);
  if (ownerKey) sessionsByOwner.set(ownerKey, id);
  console.log(
    `[agent-runtime] pty: spawned id=${id} pid=${pty.pid} cwd=${cwd}${ownerKey ? ` owner=${ownerKey}` : ""}`,
  );
  return { id, reused: false };
}

export function subscribePtySession(
  id: string,
  subscriber: PtySubscriber,
): { replay: string; unsubscribe: () => void } | null {
  const session = sessions.get(id);
  if (!session) return null;
  session.subscribers.add(subscriber);
  return {
    replay: session.replay,
    unsubscribe: () => session.subscribers.delete(subscriber),
  };
}

export function writePtySession(id: string, data: string): boolean {
  const session = sessions.get(id);
  if (!session || session.exited) return false;
  try {
    session.pty.write(data.slice(0, MAX_PTY_INPUT_CHARS));
    return true;
  } catch (error) {
    console.error(`[agent-runtime] pty: write failed id=${id}: ${String(error)}`);
    return false;
  }
}

export function resizePtySession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session || session.exited) return false;
  try {
    session.pty.resize(clampDimension(cols, 80), clampDimension(rows, 24));
    return true;
  } catch (error) {
    console.error(`[agent-runtime] pty: resize failed id=${id}: ${String(error)}`);
    return false;
  }
}

export function closePtySession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.ownerKey && sessionsByOwner.get(session.ownerKey) === id) {
    sessionsByOwner.delete(session.ownerKey);
  }
  for (const dispose of session.disposers) {
    try {
      dispose();
    } catch {
      // ignore
    }
  }
  session.subscribers.clear();
  try {
    session.pty.kill();
  } catch {
    // already exited
  }
}

export function closePtySessionByOwner(ownerKey: string): void {
  const session = ownedSession(ownerKey);
  if (session) closePtySession(session.id);
}
