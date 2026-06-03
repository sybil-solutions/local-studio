// MCP server discovery → PluginRow.
//
// Unifies builtin servers + user-stored servers (manual/marketplace) into the
// `PluginRow` shape the rest of the app already consumes (composer catalogue,
// settings UI, runtime ref). This REPLACES the old multi-source Codex discovery
// — there is no filesystem scavenging of `~/.codex` or `Codex.app` anymore.

import { builtinServerDefs, BUILTIN_SOURCE } from "./builtins";
import { disabledBuiltinIds, listStoredServers, serverConfigPath, serverTags } from "./store";
import type { McpServerDef } from "./types";

/**
 * Row shape returned to clients. Mirrors the legacy PluginRow surface the
 * composer/settings already read (`name`, `mcpConfigPath`, `skillPath`,
 * `enabled`, …) so no consumer needs to change.
 */
export type PluginRow = {
  id: string;
  name: string;
  displayName?: string;
  path: string;
  installed: boolean;
  enabled: boolean;
  description?: string;
  shortDescription?: string;
  source?: string;
  category?: string;
  tags?: string[];
  capabilities?: string[];
  skillPath?: string;
  mcpConfigPath?: string;
};

function builtinRow(
  def: McpServerDef & { mcpConfigPath?: string },
  enabled: boolean,
  tags: string[],
): PluginRow {
  return {
    id: def.id,
    name: def.name,
    ...(def.displayName ? { displayName: def.displayName } : {}),
    path: def.cwd ?? "",
    installed: true,
    enabled,
    ...(def.description ? { description: def.description } : {}),
    ...(def.shortDescription ? { shortDescription: def.shortDescription } : {}),
    source: BUILTIN_SOURCE,
    ...(def.category ? { category: def.category } : {}),
    ...(tags.length || def.tags?.length ? { tags: tags.length ? tags : def.tags } : {}),
    ...(def.mcpConfigPath ? { mcpConfigPath: def.mcpConfigPath } : {}),
    ...(def.skillPath ? { skillPath: def.skillPath } : {}),
  };
}

function storedRow(def: McpServerDef, source: string, enabled: boolean): PluginRow {
  return {
    id: def.id,
    name: def.name,
    ...(def.displayName ? { displayName: def.displayName } : {}),
    path: def.cwd ?? "",
    installed: true,
    enabled,
    ...(def.description ? { description: def.description } : {}),
    ...(def.shortDescription ? { shortDescription: def.shortDescription } : {}),
    source,
    ...(def.category ? { category: def.category } : {}),
    ...(def.tags?.length ? { tags: def.tags } : {}),
    mcpConfigPath: serverConfigPath(def.id),
    ...(def.skillPath ? { skillPath: def.skillPath } : {}),
  };
}

/** All MCP servers (builtin + stored) as PluginRows. */
export function discoverMcpServers(): PluginRow[] {
  const disabled = disabledBuiltinIds();
  const tags = serverTags();
  const builtins = builtinServerDefs().map((def) =>
    builtinRow(def, !disabled.has(def.id), tags[def.id] ?? []),
  );
  const stored = listStoredServers().map((entry) =>
    storedRow(entry.def, entry.source, entry.enabled),
  );
  return [...builtins, ...stored];
}

/** True when the given id is a bundled builtin (vs a user-stored server). */
export function isBuiltinServerId(id: string): boolean {
  return builtinServerDefs().some((def) => def.id === id);
}
