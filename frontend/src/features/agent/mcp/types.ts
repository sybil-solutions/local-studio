// Types for the MCP server system. An `McpServerDef` fully describes how to
// launch a stdio MCP server; an `McpServerEntry` adds runtime state (enabled +
// where it came from). These replace the old multi-source plugin discovery:
// every server here is a curated or user-added MCP server.

export type McpServerSource = "curated" | "manual";

export type McpToolSelection = {
  include?: string[];
  exclude?: string[];
  resources?: boolean;
  prompts?: boolean;
};

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
  tools?: McpToolSelection;
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
  cwd?: string;
  tags?: string[];
  repositoryUrl?: string;
  attributes?: string[];
  tools?: McpToolSelection;
  /** Default env keys (value may be a placeholder the user replaces). */
  env?: Record<string, string>;
  /** Which env keys are mandatory before the server can launch. */
  requiredEnv?: string[];
  /**
   * OAuth provider id (see `oauth/oauth-providers.ts`). When set, the entry is
   * connected with a one-click OAuth button; the provider's tokens are injected
   * into the server env at launch, so the user fills in no keys.
   */
  oauthProvider?: string;
  /** Whether a curated local server needs an explicit target path argument. */
  requiresTargetArg?: boolean;
  /** Optional homepage/docs link. */
  homepage?: string;
};

export type McpConfigServer = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  enabled?: boolean;
  displayName?: string;
  description?: string;
  shortDescription?: string;
  category?: string;
  tags?: string[];
  source?: McpServerSource;
  tools?: McpToolSelection;
};

export type McpConfigFile = {
  version: 1;
  mcp_servers: Record<string, McpConfigServer>;
};
