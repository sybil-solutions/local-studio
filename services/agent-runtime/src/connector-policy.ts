import type { ConnectorConfig, ConnectorRisk, ConnectorToolPermission } from "./connector-contract";
import { resolveBundledMcpServerPath } from "./pi-runtime-helpers";
import { GOOGLE_WORKSPACE_BINDINGS, isGoogleWorkspacePlugin } from "./google-workspace-binding";
import type { McpToolInfo } from "./mcp-client";

const GITHUB_READ = new Set(
  "get_file_contents get_issue get_pull_request get_pull_request_comments get_pull_request_files get_pull_request_reviews get_pull_request_status list_commits list_issues list_pull_requests search_code search_issues search_repositories search_users".split(
    " ",
  ),
);
const GITHUB_MUTATIONS = new Set(
  "add_issue_comment create_branch create_issue create_or_update_file create_pull_request create_pull_request_review create_repository fork_repository merge_pull_request push_files update_issue update_pull_request_branch".split(
    " ",
  ),
);
const CATALOG_VERSION = "2026-08-06.1";

export type CatalogConnectorId = "github" | "x" | "computer";

const catalogSpec = (id: CatalogConnectorId) => {
  if (id === "github") {
    return {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: new Set(["GITHUB_PERSONAL_ACCESS_TOKEN"]),
    };
  }
  if (id === "x") {
    return {
      command: "npx",
      args: ["-y", "@enescinar/twitter-mcp"],
      env: new Set(["API_KEY", "API_SECRET_KEY", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"]),
    };
  }
  const server = resolveBundledMcpServerPath("ssh-remote.mjs");
  return { command: "node", args: server ? [server] : [], env: new Set(["SSH_HOST"]) };
};

function catalogMatches(connector: ConnectorConfig, id: CatalogConnectorId): boolean {
  const spec = catalogSpec(id);
  const validId = id === "computer" ? connector.id.startsWith("computer") : connector.id === id;
  return (
    validId &&
    spec.args.length > 0 &&
    connector.transport === "stdio" &&
    connector.command === spec.command &&
    JSON.stringify(connector.args) === JSON.stringify(spec.args) &&
    Object.keys(connector.env ?? {}).every((key) => spec.env.has(key)) &&
    !connector.cwd &&
    !connector.url &&
    !connector.headers &&
    !connector.auth
  );
}

export function catalogConnectorConfiguration(
  connector: ConnectorConfig,
  id: CatalogConnectorId,
): ConnectorConfig {
  if (!catalogMatches(connector, id)) throw new Error(`Invalid ${id} catalog connector`);
  const allowTools = [...new Set(connector.allowTools ?? [])];
  const permissionReviewed = connector.permissionReviewed === true;
  if (connector.enabled && !permissionReviewed) {
    throw new Error("Review and save an explicit tool grant before enabling");
  }
  return {
    ...connector,
    allowTools,
    permissionReviewed,
    origin: { kind: "catalog", id, version: CATALOG_VERSION },
  };
}

function trustedCatalog(connector: ConnectorConfig): CatalogConnectorId | null {
  const id = connector.origin?.id;
  if (
    connector.origin?.kind !== "catalog" ||
    connector.origin.version !== CATALOG_VERSION ||
    (id !== "github" && id !== "x" && id !== "computer")
  ) {
    return null;
  }
  return catalogMatches(connector, id) ? id : null;
}

export function connectorToolRisk(connector: ConnectorConfig, tool: string): ConnectorRisk {
  const googleBinding =
    connector.origin?.kind === "account-adapter" &&
    connector.origin.binding === "google-workspace" &&
    isGoogleWorkspacePlugin(connector.origin.id)
      ? GOOGLE_WORKSPACE_BINDINGS[connector.origin.id]
      : null;
  if (googleBinding) return googleBinding.observeTools.includes(tool) ? "read" : "critical";
  const catalog = trustedCatalog(connector);
  if (catalog === "github") {
    if (GITHUB_READ.has(tool)) return "read";
    return GITHUB_MUTATIONS.has(tool) ? "mutating" : "critical";
  }
  if (catalog === "x") {
    if (tool === "search_tweets") return "read";
    return tool === "post_tweet" ? "mutating" : "critical";
  }
  return "critical";
}

export function connectorToolPermissions(
  connector: ConnectorConfig,
  tools: readonly McpToolInfo[],
): ConnectorToolPermission[] {
  const granted = new Set(connector.allowTools ?? []);
  return tools.map((tool) => {
    const risk = connectorToolRisk(connector, tool.name);
    return {
      name: tool.name,
      risk,
      granted: connector.permissionReviewed === true && granted.has(tool.name),
      default_granted: risk === "read",
    };
  });
}
