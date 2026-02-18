// CRITICAL
import { spawn } from "node:child_process";

export interface CliRunOptions {
  command: string;
  args: string[];
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdinText?: string;
}

export interface CliRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  command: string;
  args: string[];
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Execute a command without shell interpolation, capturing stdout/stderr.
 * @param options - CLI invocation options.
 * @returns Captured CLI execution result.
 */
export const runCliCommand = async (options: CliRunOptions): Promise<CliRunResult> => {
  const { command, args, timeoutMs = DEFAULT_TIMEOUT_MS, cwd, env = process.env, stdinText } = options;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore best-effort shutdown failures.
      }

      setTimeout(() => {
        if (!resolved) {
          try {
            child.kill("SIGKILL");
          } catch {
            // Ignore best-effort shutdown failures.
          }
        }
      }, 1_000);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.stdin?.on("error", () => {
      // Best effort only; process may exit before stdin writes complete.
    });

    if (typeof stdinText === "string") {
      child.stdin?.write(stdinText);
    }
    child.stdin?.end();

    child.on("error", (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
        timedOut,
        command,
        args,
      });
    });

    child.on("close", (exitCode, signal) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
        command,
        args,
      });
    });
  });
};
