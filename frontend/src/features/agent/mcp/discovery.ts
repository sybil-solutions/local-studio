// MCP server discovery.

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { listStoredServers, serverConfigPath } from "@/features/agent/mcp/store";
import type { McpServerDef } from "@/features/agent/mcp/types";

/**
 * Row shape returned to clients and used by the composer/runtime.
 */
export type McpServerRow = {
  id: string;
  name: string;
  displayName?: string;
  path: string;
  installed: boolean;
  enabled: boolean;
  ready: boolean;
  description?: string;
  shortDescription?: string;
  source?: string;
  category?: string;
  tags?: string[];
  capabilities?: string[];
  skillPath?: string;
  mcpConfigPath?: string;
};

/** Check whether a command binary is available on the system PATH. */
function isCommandAvailable(command: string, cwd = "."): boolean {
  try {
    // `command -v` works on both macOS and Linux
    execFileSync("/bin/sh", ["-lc", 'command -v "$1"', "sh", command], {
      stdio: "ignore",
      timeout: 3_000,
    });
    return true;
  } catch {
    // Try direct path check for absolute/relative paths
    if (command.includes("/") || command.includes("\\") || command.includes(".")) {
      try {
        const resolvedCwd = path.resolve(expandHome(cwd));
        const resolvedCommand = path.isAbsolute(command)
          ? command
          : path.resolve(resolvedCwd, command);
        return existsSync(resolvedCommand);
      } catch {
        return false;
      }
    }
    return false;
  }
}

function expandHome(value: string): string {
  if (value === "~") return process.env.HOME || value;
  if (value.startsWith("~/")) return path.join(process.env.HOME || "~", value.slice(2));
  return value.replace(/\$\{HOME\}/g, process.env.HOME || "");
}

function storedRow(def: McpServerDef, source: string, enabled: boolean): McpServerRow {
  const configReady = existsSync(serverConfigPath(def.id));
  const commandReady = isCommandAvailable(def.command, def.cwd);
  return {
    id: def.id,
    name: def.name,
    ...(def.displayName ? { displayName: def.displayName } : {}),
    path: def.cwd ?? "",
    installed: true,
    enabled,
    ready: enabled && configReady && commandReady,
    ...(def.description ? { description: def.description } : {}),
    ...(def.shortDescription ? { shortDescription: def.shortDescription } : {}),
    source,
    ...(def.category ? { category: def.category } : {}),
    ...(def.tags?.length ? { tags: def.tags } : {}),
    mcpConfigPath: serverConfigPath(def.id),
    ...(def.skillPath ? { skillPath: def.skillPath } : {}),
  };
}

/** All installed MCP servers. */
export function discoverMcpServers(): McpServerRow[] {
  return listStoredServers().map((entry) => storedRow(entry.def, entry.source, entry.enabled));
}
