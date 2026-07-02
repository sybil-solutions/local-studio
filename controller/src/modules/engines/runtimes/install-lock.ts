import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import { delayEffect } from "../../../core/async";
import type { EngineBackend } from "@local-studio/contracts/system";
import { ENGINE_INSTALL_TIMEOUT_MS } from "../configs";
import { pidExists } from "../process/process-utilities";

interface EngineInstallLock {
  path: string;
  release: () => void;
}

interface AcquireEngineInstallLockOptions {
  timeoutMs?: number | undefined;
  pollMs?: number | undefined;
  onWait?: ((path: string) => void) | undefined;
  shouldContinue?: (() => boolean) | undefined;
}

const installLockDirectory = (config: Pick<Config, "data_dir">): string =>
  join(config.data_dir, "runtime", "locks");

const installLockPath = (config: Pick<Config, "data_dir">, backend: EngineBackend): string =>
  join(installLockDirectory(config), `${backend}.install.lock`);

const nodeErrorCode = (error: unknown): string | null =>
  error instanceof Error && "code" in error ? String(error.code) : null;

const releaseInstallLock = (path: string): void => {
  try {
    rmSync(path);
  } catch {}
};

// A lock is stale if its owning process is gone. Nothing but releaseInstallLock
// (an in-process `finally`) ever removes the file, so a crash/OOM-kill during an
// install would otherwise orphan it and stall every future install for the full
// timeout. Reclaim when the recorded pid is dead, or when the file is empty/
// unparseable (a torn write). PID reuse across a reboot is the residual risk,
// accepted as far rarer than the crash-during-install case this recovers.
const isStaleLock = (path: string): boolean => {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    // The holder released it between our failed create and this read.
    return true;
  }
  try {
    const pid = (JSON.parse(raw) as { pid?: unknown }).pid;
    if (typeof pid !== "number" || !Number.isInteger(pid)) return true;
    if (pid === process.pid) return false;
    return !pidExists(pid);
  } catch {
    return true;
  }
};

const tryAcquireInstallLock = (
  config: Pick<Config, "data_dir">,
  backend: EngineBackend,
): EngineInstallLock | null => {
  const path = installLockPath(config, backend);
  mkdirSync(installLockDirectory(config), { recursive: true });
  try {
    writeFileSync(
      path,
      JSON.stringify({ backend, pid: process.pid, startedAt: new Date().toISOString() }),
      { flag: "wx" },
    );
    return { path, release: () => releaseInstallLock(path) };
  } catch (error) {
    if (nodeErrorCode(error) !== "EEXIST") throw error;
    // Reclaim a lock whose owner has died, then retry the create exactly once.
    // A single retry avoids looping if two controllers race to reclaim.
    if (isStaleLock(path)) {
      releaseInstallLock(path);
      try {
        writeFileSync(
          path,
          JSON.stringify({ backend, pid: process.pid, startedAt: new Date().toISOString() }),
          { flag: "wx" },
        );
        return { path, release: () => releaseInstallLock(path) };
      } catch (retryError) {
        if (nodeErrorCode(retryError) !== "EEXIST") throw retryError;
      }
    }
    return null;
  }
};

const acquireEngineInstallLockEffect = (
  config: Pick<Config, "data_dir">,
  backend: EngineBackend,
  options: AcquireEngineInstallLockOptions,
  startedAt: number,
): Effect.Effect<EngineInstallLock | null> =>
  Effect.gen(function* () {
    const timeoutMs = options.timeoutMs ?? ENGINE_INSTALL_TIMEOUT_MS;
    const pollMs = options.pollMs ?? 3_000;
    let reportedWait = false;
    while (Date.now() - startedAt < timeoutMs) {
      if (options.shouldContinue && !options.shouldContinue()) return null;
      const lock = tryAcquireInstallLock(config, backend);
      if (lock) return lock;
      if (!reportedWait) {
        reportedWait = true;
        options.onWait?.(installLockPath(config, backend));
      }
      yield* delayEffect(pollMs);
    }
    return null;
  });

export const acquireEngineInstallLock = (
  config: Pick<Config, "data_dir">,
  backend: EngineBackend,
  options: AcquireEngineInstallLockOptions = {},
): Promise<EngineInstallLock | null> =>
  Effect.runPromise(acquireEngineInstallLockEffect(config, backend, options, Date.now()));

export const installLockTimeoutMessage = (
  backend: EngineBackend,
  timeoutMs = ENGINE_INSTALL_TIMEOUT_MS,
): string =>
  `${backend} install lock still present after ${Math.round(timeoutMs / 60_000)} minutes`;
