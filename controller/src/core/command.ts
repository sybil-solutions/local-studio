import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { Effect } from "effect";

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type RunSyncOptions = {
  /** Kill the command after this long. Omit for no timeout (matches bare `spawnSync`). */
  timeoutMs?: number | undefined;
};

export type SpawnDetachedOptions = {
  env?: NodeJS.ProcessEnv | undefined;
  /** "pipe" exposes stdout/stderr for log capture; "ignore" discards them. */
  stdio: "pipe" | "ignore";
};

/** Minimal view of a detached child process; satisfied by `ChildProcess`. */
export interface SpawnedProcess {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: () => void): void;
  unref(): void;
}

/**
 * Injectable process boundary. Production code takes a `ProcessRunner`
 * defaulting to `realProcessRunner`; tests substitute a scripted fake so spawn
 * logic (constructed argv, exit handling, output capture) is testable without
 * touching the host.
 */
export interface ProcessRunner {
  runSync(command: string, args: string[], options?: RunSyncOptions): CommandResult;
  spawnDetached(command: string, args: string[], options: SpawnDetachedOptions): SpawnedProcess;
}

export const realProcessRunner: ProcessRunner = {
  runSync: (command, args, options = {}) => {
    try {
      const result = spawnSync(command, args, {
        ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        env: process.env,
      });
      return {
        status: result.status,
        stdout: result.stdout ? result.stdout.toString("utf-8").trim() : "",
        stderr: result.stderr ? result.stderr.toString("utf-8").trim() : "",
      };
    } catch (error) {
      return {
        status: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  },
  spawnDetached: (command, args, options) =>
    spawn(command, args, {
      stdio: options.stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "ignore",
      ...(options.env ? { env: options.env } : {}),
      detached: true,
    }),
};

export type AsyncCommandResult = CommandResult & {
  timedOut: boolean;
  signal: NodeJS.Signals | null;
};

export type AsyncCommandOptions = {
  timeoutMs: number;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  stdin?: string | undefined;
  onOutput?: ((chunk: string) => void) | undefined;
  onSpawn?: ((child: ChildProcess) => void) | undefined;
};

const DEFAULT_TIMEOUT_MS = 3_000;
const TIMEOUT_KILL_GRACE_MS = 5_000;

export const runCommandEffect = (
  command: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Effect.Effect<CommandResult> =>
  Effect.sync(() => realProcessRunner.runSync(command, args, { timeoutMs }));

export const runCommand = (
  command: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): CommandResult => Effect.runSync(runCommandEffect(command, args, timeoutMs));

export const runCommandAsyncEffect = (
  command: string,
  args: string[],
  options: AsyncCommandOptions,
): Effect.Effect<AsyncCommandResult> =>
  Effect.callback<AsyncCommandResult>((resume) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    options.onSpawn?.(child);
    if (options.stdin !== undefined) {
      child.stdin?.on("error", () => {});
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_KILL_GRACE_MS);
    }, options.timeoutMs);
    const settle = (result: AsyncCommandResult): void => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resume(Effect.succeed(result));
    };
    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf-8");
      stdout += chunk;
      options.onOutput?.(chunk);
    });
    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf-8");
      stderr += chunk;
      options.onOutput?.(chunk);
    });
    child.on("error", (error) => {
      settle({
        status: null,
        stdout: stdout.trim(),
        stderr: error.message,
        timedOut,
        signal: null,
      });
    });
    child.on("close", (code, signal) => {
      settle({ status: code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut, signal });
    });
  });

export const runCommandAsync = (
  command: string,
  args: string[],
  options: AsyncCommandOptions,
): Promise<AsyncCommandResult> => Effect.runPromise(runCommandAsyncEffect(command, args, options));

const isExecutableFile = (filePath: string): boolean => {
  try {
    const stats = statSync(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
};

export const resolveBinary = (binaryName: string): string | null => {
  if (!binaryName) return null;

  if (binaryName.includes("/")) {
    const resolved = resolve(binaryName);
    return isExecutableFile(resolved) ? resolved : null;
  }

  const searchPaths: string[] = [];
  const runtimeOverride = process.env["LOCAL_STUDIO_RUNTIME_BIN"];
  const runtimeBin =
    runtimeOverride ?? (process.env["SNAP"] ? resolve(process.cwd(), "runtime", "bin") : null);
  if (runtimeBin && existsSync(runtimeBin)) {
    searchPaths.push(runtimeBin);
  }

  const pathValue = process.env["PATH"];
  if (pathValue) {
    for (const entry of pathValue.split(":")) {
      if (entry) searchPaths.push(entry);
    }
  }

  const home = process.env["HOME"];
  if (home) {
    searchPaths.push(join(home, ".local", "bin"));
    searchPaths.push(join(home, "bin"));
  }

  const user = process.env["USER"] ?? process.env["LOGNAME"];
  if (user) {
    searchPaths.push(join("/home", user, ".local", "bin"));
    searchPaths.push(join("/home", user, "bin"));
  }

  for (const entry of searchPaths) {
    const candidate = join(entry, binaryName);
    if (isExecutableFile(candidate)) return candidate;
  }

  return null;
};
