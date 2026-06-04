// Public entry point for the MCP server module.
export { discoverMcpServers, type PluginRow } from "./discovery";
export { MCP_CATALOGUE, findCatalogueEntry } from "./catalogue";
export {
  listStoredServers,
  upsertServer,
  removeServer,
  setServerEnabled,
  setServerTags,
  serverConfigPath,
} from "./store";
export type { McpServerDef, McpServerEntry, McpServerSource, McpCatalogueEntry } from "./types";
