import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delayTimeout } from "node:timers/promises";
import { accessSync, constants, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { McpServer } from "../types/models";

type ErrorSource = {
  once: (event: "error", listener: (error: Error) => void) => void;
  removeListener: (event: "error", listener: (error: Error) => void) => void;
};

/**
 * Resolve a working npx path.
 * @returns Path to npx.
 */
/**
 * Resolve a runtime bin directory.
 * @returns Runtime bin path or null.
 */
const getRuntimeBinDirectory = (): string | null => {
  const runtimeOverride = process.env["VLLM_STUDIO_RUNTIME_BIN"];
  if (runtimeOverride) {
    return existsSync(runtimeOverride) ? runtimeOverride : null;
  }
  if (!process.env["SNAP"]) {
    return null;
  }
  const candidate = resolve(process.cwd(), "runtime", "bin");
  return existsSync(candidate) ? candidate : null;
};

/**
 * Resolve a runtime MCP directory.
 * @returns Runtime MCP path or null.
 */
const getRuntimeMcpDirectory = (): string | null => {
  const runtimeOverride = process.env["VLLM_STUDIO_RUNTIME_MCP"];
  if (runtimeOverride) {
    return existsSync(runtimeOverride) ? runtimeOverride : null;
  }
  if (!process.env["SNAP"]) {
    return null;
  }
  const candidate = resolve(process.cwd(), "runtime", "mcp");
  return existsSync(candidate) ? candidate : null;
};

/**
 * Map MCP script paths into the runtime directory.
 * @param argument - CLI argument.
 * @returns Updated argument.
 */
const resolveRuntimeMcpArgument = (argument: string): string => {
  const runtimeMcp = getRuntimeMcpDirectory();
  if (!runtimeMcp || !argument.startsWith("/home/")) {
    return argument;
  }
  const marker = "/exa-mcp-server/";
  const markerIndex = argument.indexOf(marker);
  if (markerIndex < 0) {
    return argument;
  }
  const relative = argument.slice(markerIndex + 1);
  const candidate = join(runtimeMcp, relative);
  if (existsSync(candidate)) {
    return candidate;
  }
  return argument;
};

/**
 * Resolve MCP args with runtime fallback.
 * @param args - Original args.
 * @returns Updated args.
 */
const resolveMcpArguments = (args: string[]): string[] => {
  return args.map((argument) => resolveRuntimeMcpArgument(argument));
};

/**
 * Resolve a working npx path.
 * @returns Path to npx.
 */
export const getNpxPath = (): string => {
  const runtimeBin = getRuntimeBinDirectory();
  if (runtimeBin) {
    const runtimeNpx = join(runtimeBin, "npx");
    if (existsSync(runtimeNpx)) {
      return runtimeNpx;
    }
  }
  const candidates = ["/usr/local/bin/npx", "/usr/bin/npx", "npx"];
  for (const candidate of candidates) {
    if (candidate === "npx" || existsSync(candidate)) {
      return candidate;
    }
  }
  return "npx";
};

/**
 * Resolve the command to execute, with runtime fallback.
 * @param command - Command string.
 * @returns Resolved command string.
 */
const resolveCommand = (command: string): string => {
  if (command === "npx") {
    return getNpxPath();
  }
  const runtimeBin = getRuntimeBinDirectory();
  if (command.includes("/")) {
    if (runtimeBin && command.startsWith("/home/")) {
      const fallback = join(runtimeBin, basename(command));
      if (existsSync(fallback)) {
        return fallback;
      }
    }
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      if (runtimeBin) {
        const fallback = join(runtimeBin, basename(command));
        if (existsSync(fallback)) {
          return fallback;
        }
      }
      return command;
    }
  }
  if (runtimeBin) {
    const fallback = join(runtimeBin, command);
    if (existsSync(fallback)) {
      return fallback;
    }
  }
  return command;
};

/**
 * Read one line with a timeout.
 * @param reader - Readline interface.
 * @param timeoutMs - Timeout milliseconds.
 * @param errorSource - Optional error emitter.
 * @returns Line string.
 */
export const readLineWithTimeout = async (
  reader: ReturnType<typeof createInterface>,
  timeoutMs: number,
  errorSource?: ErrorSource,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onLine = (line: string): void => {
      cleanup();
      resolve(line);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("MCP command closed without response"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("MCP command timed out"));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      reader.removeListener("line", onLine);
      reader.removeListener("close", onClose);
      if (errorSource) {
        errorSource.removeListener("error", onError);
      }
    };
    reader.once("line", onLine);
    reader.once("close", onClose);
    if (errorSource) {
      errorSource.once("error", onError);
    }
  });
};

/**
 * Run an MCP command using JSON-RPC over stdio.
 * @param server - MCP server configuration.
 * @param method - JSON-RPC method.
 * @param params - Method params.
 * @returns JSON-RPC result object.
 */
export const runMcpCommand = async (
  server: McpServer,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => {
  const command = resolveCommand(server.command);
  const args = resolveMcpArguments(server.args);
  const env = { ...process.env, ...server.env };

  const child = spawn(command, args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (!child.stdin || !child.stdout) {
    throw new Error("MCP process stdio unavailable");
  }
  const reader = createInterface({ input: child.stdout });

  const writeLine = (payload: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  try {
    writeLine({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "vllm-studio", version: "1.0.0" },
      },
    });

    const initLine = await readLineWithTimeout(reader, 30_000, child);
    const initResponse = JSON.parse(initLine) as Record<string, unknown>;
    if (initResponse["error"]) {
      throw new Error((initResponse["error"] as { message?: string }).message ?? "Initialize failed");
    }

    writeLine({ jsonrpc: "2.0", method: "notifications/initialized" });

    if (method !== "initialize") {
      writeLine({
        jsonrpc: "2.0",
        id: 2,
        method,
        params,
      });
      const responseLine = await readLineWithTimeout(reader, 30_000, child);
      const response = JSON.parse(responseLine) as Record<string, unknown>;
      if (response["error"]) {
        throw new Error((response["error"] as { message?: string }).message ?? "Unknown MCP error");
      }
      return (response["result"] as Record<string, unknown>) ?? {};
    }

    return (initResponse["result"] as Record<string, unknown>) ?? {};
  } finally {
    try {
      child.stdin.end();
    } catch {
      await delayTimeout(0);
    }
    try {
      reader.close();
    } catch {
      await delayTimeout(0);
    }
    try {
      child.kill("SIGTERM");
    } catch {
      await delayTimeout(0);
    }
  }
};
