import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { delimiter, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { Effect } from "effect";

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type RunSyncOptions = {
  timeoutMs?: number | undefined;
};

export type SpawnDetachedOptions = {
  env?: NodeJS.ProcessEnv | undefined;
  stdio: "pipe" | "ignore";
};

export interface SpawnedProcess {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: () => void): void;
  unref(): void;
}

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
  exitConfirmed?: boolean | undefined;
};

export type AsyncCommandOptions = {
  timeoutMs: number;
  maxOutputBytes?: number | undefined;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  stdin?: string | undefined;
  signal?: AbortSignal | undefined;
  onOutput?: ((chunk: string) => void) | undefined;
  onSpawn?: ((child: ChildProcess) => void) | undefined;
};

const DEFAULT_TIMEOUT_MS = 3_000;
const TIMEOUT_KILL_GRACE_MS = 5_000;
const TERMINATION_CONFIRM_GRACE_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

export class CommandTerminationError extends Error {
  constructor() {
    super("Command process exit could not be confirmed");
    this.name = "CommandTerminationError";
  }
}

const boundedTail = (current: Buffer, chunk: Buffer, maximumBytes: number): Buffer => {
  if (maximumBytes === 0) return Buffer.alloc(0);
  if (chunk.length >= maximumBytes) return Buffer.from(chunk.subarray(-maximumBytes));
  const retained = current.subarray(Math.max(0, current.length + chunk.length - maximumBytes));
  return Buffer.concat([retained, chunk], retained.length + chunk.length);
};

export const runCommandEffect = (
  command: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Effect.Effect<CommandResult> =>
  Effect.sync(() => realProcessRunner.runSync(command, args, { timeoutMs }));

export const runCommandAsyncEffect = (
  command: string,
  args: string[],
  options: AsyncCommandOptions,
): Effect.Effect<AsyncCommandResult> =>
  Effect.callback<AsyncCommandResult>((resume) => {
    const requestedOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const maximumOutputBytes = Number.isSafeInteger(requestedOutputBytes)
      ? Math.max(0, requestedOutputBytes)
      : DEFAULT_MAX_OUTPUT_BYTES;
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
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    let timedOut = false;
    let closed = false;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let confirmKillTimer: ReturnType<typeof setTimeout> | null = null;
    const complete = (result: AsyncCommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (confirmKillTimer) clearTimeout(confirmKillTimer);
      options.signal?.removeEventListener("abort", terminate);
      resume(Effect.succeed(result));
    };
    const terminate = (): void => {
      if (closed) return;
      child.kill("SIGTERM");
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => {
          child.kill("SIGKILL");
          confirmKillTimer = setTimeout(
            () =>
              complete({
                status: null,
                stdout: stdout.toString("utf8").trim(),
                stderr: new CommandTerminationError().message,
                timedOut,
                signal: null,
                exitConfirmed: false,
              }),
            TERMINATION_CONFIRM_GRACE_MS,
          );
        }, TIMEOUT_KILL_GRACE_MS);
      }
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    const settle = (result: AsyncCommandResult): void => {
      complete(result);
    };
    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf-8");
      stdout = boundedTail(stdout, data, maximumOutputBytes);
      options.onOutput?.(chunk);
    });
    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf-8");
      stderr = boundedTail(stderr, data, maximumOutputBytes);
      options.onOutput?.(chunk);
    });
    child.on("error", (error) => {
      settle({
        status: null,
        stdout: stdout.toString("utf8").trim(),
        stderr: error.message,
        timedOut,
        signal: null,
      });
    });
    child.on("close", (code, signal) => {
      closed = true;
      settle({
        status: code,
        stdout: stdout.toString("utf8").trim(),
        stderr: stderr.toString("utf8").trim(),
        timedOut,
        signal,
      });
    });
    options.signal?.addEventListener("abort", terminate, { once: true });
    if (options.signal?.aborted) terminate();
    return Effect.callback<void>((finish) => {
      if (closed) {
        finish(Effect.void);
        return;
      }
      child.once("close", () => finish(Effect.void));
      terminate();
    }).pipe(
      Effect.timeoutOrElse({
        duration: TIMEOUT_KILL_GRACE_MS + TERMINATION_CONFIRM_GRACE_MS,
        orElse: () => Effect.die(new CommandTerminationError()),
      }),
    );
  });

const runtimeBinDirectory = (): string | null =>
  process.env["LOCAL_STUDIO_RUNTIME_BIN"] ??
  (process.env["SNAP"] ? resolve(process.cwd(), "runtime", "bin") : null);

const homeBinDirectories = (): string[] => {
  const directories: string[] = [];
  const home = process.env["HOME"];
  if (home) directories.push(join(home, ".local", "bin"), join(home, "bin"));
  const user = process.env["USER"] ?? process.env["LOGNAME"];
  if (user) directories.push(join("/home", user, ".local", "bin"), join("/home", user, "bin"));
  return directories;
};

const sanitizePathEntry = (entry: string): string => entry.trim().replace(/^"|"$/g, "");

const binarySearchPath = (): string => {
  const runtimeBin = runtimeBinDirectory();
  const pathEntries = (process.env["PATH"] ?? "")
    .split(delimiter)
    .map(sanitizePathEntry)
    .filter(Boolean);
  return [...(runtimeBin ? [runtimeBin] : []), ...pathEntries, ...homeBinDirectories()].join(
    delimiter,
  );
};

const isExplicitPath = (binaryName: string): boolean =>
  binaryName.includes("/") || binaryName.includes("\\");

export const resolveBinary = (binaryName: string): string | null => {
  if (!binaryName) return null;
  if (isExplicitPath(binaryName)) return Bun.which(resolve(binaryName));
  return Bun.which(binaryName, { PATH: binarySearchPath() });
};
