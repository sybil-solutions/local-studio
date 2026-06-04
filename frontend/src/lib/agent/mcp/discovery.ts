// MCP server discovery → PluginRow.
//
// Exposes only user-stored MCP servers (manual/marketplace) in the `PluginRow`
// shape the rest of the app already consumes (composer catalogue, settings UI,
// runtime ref). There is no filesystem scavenging of bundled desktop-control or
// browser-control experiments here.

import { listStoredServers, serverConfigPath } from "./store";
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

/** All installed MCP servers as PluginRows. */
export function discoverMcpServers(): PluginRow[] {
  return listStoredServers().map((entry) => storedRow(entry.def, entry.source, entry.enabled));
}
