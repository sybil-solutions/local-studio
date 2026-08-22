import { fork, type ChildProcess } from "node:child_process";
import { log } from "../helpers/logger";
import { resolveAugmentedPath } from "../helpers/resolve-path";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Every live supervised child. One process-exit hook kills whichever children
// are current — registering a fresh once("exit") per (re)start leaked listeners
// on every frontend restart.
const supervised = new Set<ChildProcess>();
process.once("exit", () => {
  for (const child of supervised) {
    if (!child.killed) child.kill("SIGTERM");
  }
});

export function isSupervised(child: ChildProcess): boolean {
  return supervised.has(child);
}

type ForkChildOptions = {
  /** Log prefix for the child's stdout/stderr lines. */
  label: string;
  entry: string;
  cwd?: string;
  execArgv?: string[];
  env: NodeJS.ProcessEnv;
};

/**
 * Fork a supervised helper process: inherited environment plus the augmented
 * PATH and the caller's overrides, attached to Electron (a detached child can
 * survive a main-process exit with closed stdio pipes and spin while the
 * desktop app itself is gone), with its output mirrored into the desktop log.
 */
export function forkChild({ label, entry, cwd, execArgv, env }: ForkChildOptions): ChildProcess {
  const child = fork(entry, {
    cwd,
    execArgv,
    stdio: "pipe",
    detached: false,
    env: { ...process.env, PATH: resolveAugmentedPath(), ...env },
  });
  child.stdout?.on("data", (chunk: Buffer | string) => {
    log.info(`${label}: ${String(chunk).trim()}`);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    log.warn(`${label}: ${String(chunk).trim()}`);
  });
  supervised.add(child);
  child.once("exit", () => supervised.delete(child));
  return child;
}

/**
 * Poll `isReady` until it answers true, the child dies, or the timeout lapses.
 * `label` names the child in both failure messages.
 */
export async function waitUntilReady(options: {
  child?: ChildProcess;
  isReady: () => Promise<boolean>;
  timeoutMs: number;
  intervalMs: number;
  label: string;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    if (options.child?.exitCode != null) {
      throw new Error(`${options.label} exited with code ${options.child.exitCode}`);
    }
    if (await options.isReady()) return;
    await delay(options.intervalMs);
  }
  throw new Error(`Timed out waiting for ${options.label}`);
}

/** Ask the child to stop, escalating to SIGKILL if it is still alive after 5s. */
export async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const pid = child.pid;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (pid && isProcessAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
