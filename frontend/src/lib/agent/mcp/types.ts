// Types for the MCP server system. An `McpServerDef` fully describes how to
// launch a stdio MCP server; an `McpServerEntry` adds runtime state (enabled +
// where it came from). These replace the old multi-source plugin discovery:
// every server here is a curated or user-added MCP server.

export type McpServerSource = "marketplace" | "manual";

/**
 * A launchable stdio MCP server. `command`/`args`/`env`/`cwd` map 1:1 onto the
 * `.mcp.json` `mcpServers[name]` shape the runtime (`mcp-plugin.ts`) consumes.
 */
export type McpServerDef = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  shortDescription?: string;
  category?: string;
  tags?: string[];
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Absolute path to a bundled skill dir (SKILL.md) describing the tools. */
  skillPath?: string;
};

/** A server definition plus its persisted runtime state. */
export type McpServerEntry = {
  def: McpServerDef;
  enabled: boolean;
  source: McpServerSource;
};

/**
 * A curated, trusted catalogue entry. `env` lists the variables a user must
 * supply (e.g. API keys); `requiredEnv` names which are mandatory. The command
 * template is fixed so users get a vetted launch line they only fill secrets
 * into.
 */
export type McpCatalogueEntry = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  shortDescription?: string;
  category: string;
  command: string;
  args?: string[];
  tags?: string[];
  registry?: "curated" | "official" | "custom";
  registryName?: string;
  registrySourceId?: string;
  registryUrl?: string;
  repositoryUrl?: string;
  attributes?: string[];
  installable?: boolean;
  unsupportedReason?: string;
  /** Default env keys (value may be a placeholder the user replaces). */
  env?: Record<string, string>;
  /** Which env keys are mandatory before the server can launch. */
  requiredEnv?: string[];
  /** Whether a curated local server needs an explicit target path argument. */
  requiresTargetArg?: boolean;
  /** Optional homepage/docs link. */
  homepage?: string;
};
