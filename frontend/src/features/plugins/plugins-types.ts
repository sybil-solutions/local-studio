// Plugin-page types re-exported from their MCP canonical modules.

export type { McpServerRow as McpServer } from "@/features/agent/mcp/discovery";
export type { McpCatalogueEntry as CatalogueEntry } from "@/features/agent/mcp/types";

export type ServersPayload = {
  servers?: import("@/features/agent/mcp/discovery").McpServerRow[];
  catalogue?: import("@/features/agent/mcp/types").McpCatalogueEntry[];
  configText?: string;
  error?: string;
};
