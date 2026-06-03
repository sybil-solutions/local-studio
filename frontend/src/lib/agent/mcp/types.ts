// Types for the MCP server system. An `McpServerDef` fully describes how to
// launch a stdio MCP server; an `McpServerEntry` adds runtime state (enabled +
// where it came from). These replace the old multi-source Codex `PluginRow`
// discovery — every server here is first-party, curated, or user-added, and
// always launchable (no Codex-signed-runtime constraints).

export type McpServerSource = "builtin" | "marketplace" | "manual";

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
  registry?: "curated" | "glama";
  registryUrl?: string;
  repositoryUrl?: string;
  attributes?: string[];
  /** Default env keys (value may be a placeholder the user replaces). */
  env?: Record<string, string>;
  /** Which env keys are mandatory before the server can launch. */
  requiredEnv?: string[];
  /** Optional homepage/docs link. */
  homepage?: string;
};
