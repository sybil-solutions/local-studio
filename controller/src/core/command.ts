import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 3_000;

export const runCommand = (
  command: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): CommandResult => {
  try {
    const result = spawnSync(command, args, { timeout: timeoutMs, env: process.env });
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
};

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
  const runtimeOverride = process.env["VLLM_STUDIO_RUNTIME_BIN"];
  const runtimeBin = runtimeOverride ?? (process.env["SNAP"] ? resolve(process.cwd(), "runtime", "bin") : null);
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

