import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";
import type { PluginRow } from "./plugin-discovery";

export type PluginRuntimeCheck = {
  skillConfigured: boolean;
  mcpConfigured: boolean;
  appConfigured: boolean;
  mcpExecutableExists?: boolean;
  runtimeBlockedOutsideCodex?: boolean;
  runtimeCheckRequired?: boolean;
  note?: string;
};

export type PluginsResponse = {
  plugins: PluginRow[];
  validation: {
    browserUseAvailable: boolean;
    browserUse: PluginRow | null;
    browserUseRuntime: PluginRuntimeCheck | null;
    computerUseAvailable: boolean;
    computerUse: PluginRow | null;
    computerUseRuntime: PluginRuntimeCheck | null;
  };
};

export function buildPluginsResponse(
  allPlugins: PluginRow[],
  options: { includeDisabled?: boolean } = {},
): PluginsResponse {
  const plugins = options.includeDisabled ? allPlugins : allPlugins.filter((row) => row.enabled);
  const computerUse =
    plugins.find((row) => row.enabled && pluginMatches(row, "computer-use")) ?? null;
  const browserUse =
    plugins.find((row) => row.enabled && pluginMatches(row, "browser-use")) ?? null;
  return {
    plugins,
    validation: {
      browserUseAvailable: Boolean(browserUse),
      browserUse,
      browserUseRuntime: browserUse ? pluginRuntimeCheck(browserUse) : null,
      computerUseAvailable: Boolean(computerUse),
      computerUse,
      computerUseRuntime: computerUse ? pluginRuntimeCheck(computerUse) : null,
    },
  };
}

function pluginRuntimeCheck(plugin: PluginRow): PluginRuntimeCheck {
  const mcpExecutable = plugin.mcpConfigPath
    ? allMcpExecutablesExist(plugin.mcpConfigPath)
    : undefined;
  const launchConstrained = plugin.mcpConfigPath
    ? mcpConfigUsesSkyComputerUseClient(plugin.mcpConfigPath) &&
      !isLocalComputerUseHelper(plugin, plugin.mcpConfigPath)
    : false;
  return {
    skillConfigured: Boolean(plugin.skillPath && existsSync(plugin.skillPath)),
    mcpConfigured: Boolean(plugin.mcpConfigPath && existsSync(plugin.mcpConfigPath)),
    appConfigured: Boolean(plugin.appPath && existsSync(plugin.appPath)),
    ...(mcpExecutable === undefined ? {} : { mcpExecutableExists: mcpExecutable }),
    ...(launchConstrained ? { runtimeBlockedOutsideCodex: true } : {}),
    ...(pluginMatches(plugin, "computer-use") && plugin.mcpConfigPath
      ? {
          runtimeCheckRequired: true,
          note: launchConstrained
            ? "Computer-use is discovered and selectable. vLLM Studio skips its launch-constrained SkyComputerUseClient MCP by default outside the Codex-signed host, while still loading skill context and browser-tool fallback for browser tasks."
            : "Computer-use is wired through MCP; verify helper launch from an active session with mcp_plugin_status before desktop control.",
        }
      : {}),
  };
}

function isLocalComputerUseHelper(plugin: PluginRow, configPath: string): boolean {
  return (
    pluginMatches(plugin, "computer-use") &&
    localComputerUseRoots().some((root) => isPathInside(configPath, root))
  );
}

function localComputerUseRoots(): string[] {
  return [
    path.join(resolveDataDir(), "computer-use"),
    path.join(homedir(), ".codex", "computer-use"),
  ];
}

function pluginMatches(plugin: PluginRow, needle: string): boolean {
  return [plugin.id, plugin.name, plugin.displayName, plugin.path]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function allMcpExecutablesExist(configPath: string): boolean | undefined {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
      mcpServers?: Record<string, { command?: unknown; cwd?: unknown }>;
    };
    const servers = Object.values(parsed.mcpServers ?? {}).filter(
      (entry) => typeof entry.command === "string" && entry.command.trim(),
    );
    if (!servers.length) return undefined;
    return servers.every((server) => {
      const command = String(server.command);
      const cwd = typeof server.cwd === "string" ? server.cwd : ".";
      const base = path.resolve(path.dirname(configPath), cwd);
      const resolved = command.startsWith(".") ? path.resolve(base, command) : command;
      return path.isAbsolute(resolved) ? existsSync(resolved) : true;
    });
  } catch {
    return false;
  }
}

function mcpConfigUsesSkyComputerUseClient(configPath: string): boolean {
  try {
    const raw = readFileSync(configPath, "utf8");
    return raw.toLowerCase().includes("skycomputeruseclient");
  } catch {
    return false;
  }
}
