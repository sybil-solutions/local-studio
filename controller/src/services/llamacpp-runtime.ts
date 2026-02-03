// CRITICAL
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "../config/env";

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;

const runCommand = (command: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): CommandResult => {
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

const resolveBinary = (binaryName: string): string | null => {
  if (!binaryName) {
    return null;
  }
  if (binaryName.includes("/")) {
    const resolved = resolve(binaryName);
    return existsSync(resolved) ? resolved : null;
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
      if (entry) {
        searchPaths.push(entry);
      }
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
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const getLlamacppConfigHelp = async (
  config: Config,
): Promise<{ config: string | null; error: string | null }> => {
  const configured = config.llama_bin || "llama-server";
  const resolved = resolveBinary(configured) ?? (existsSync(configured) ? resolve(configured) : null);
  const binary = resolved ?? configured;

  const result = runCommand(binary, ["--help"]);
  if (result.status !== 0) {
    return {
      config: result.stdout || null,
      error: result.stderr || "Failed to fetch llama.cpp config",
    };
  }
  return { config: result.stdout || null, error: null };
};
