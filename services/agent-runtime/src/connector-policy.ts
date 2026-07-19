import type {
  ConnectorConfig,
  ConnectorOrigin,
  ConnectorRisk,
  ConnectorToolPermission,
} from "./connector-contract";
import path from "node:path";
import { tmpdir } from "node:os";
import { resolveBundledMcpServerPath, resolveExecutablePath } from "./bundled-mcp-server";
import {
  GITHUB_MCP_ARGS,
  GITHUB_MCP_ARTIFACTS,
  GITHUB_MCP_INVENTORY_DIGEST,
  GITHUB_MCP_TOOLS,
  githubMcpArtifactFor,
  githubMcpExecutablePath,
  verifiedGitHubMcpExecutablePath,
} from "./connector-artifacts";
import { resolveDataDir } from "./data-dir";
import { GOOGLE_WORKSPACE_BINDINGS, isGoogleWorkspacePlugin } from "./google-workspace-binding";
import type { McpToolInfo } from "./mcp-client";

const GITHUB_READ_TOOLS: ReadonlySet<string> = new Set(GITHUB_MCP_TOOLS);
const TWITTER_READ_TOOLS = new Set(["search_tweets"]);
const TWITTER_MUTATING_TOOLS = new Set(["post_tweet"]);
const LEGACY_CATALOG_POLICY_VERSION = "2026-07-19.1";
const CATALOG_POLICY_VERSION = "2026-07-19.2";
const CATALOG_IDS = ["github", "x", "computer"] as const;

export type CatalogConnectorId = "github" | "x" | "computer";

type CatalogConnectorInput = {
  id: string;
  catalogId: CatalogConnectorId;
  env?: Readonly<Record<string, string>>;
  allowTools?: readonly string[];
  permissionReviewed?: boolean;
  enabled?: boolean;
};

type CatalogDescriptor = {
  name: string;
  command(): string | null;
  args(): readonly string[] | null;
  env: ReadonlySet<string>;
};

const CATALOG: Record<CatalogConnectorId, CatalogDescriptor> = {
  github: {
    name: "GitHub",
    command: () => githubMcpExecutablePath(),
    args: () => GITHUB_MCP_ARGS,
    env: new Set(["GITHUB_PERSONAL_ACCESS_TOKEN"]),
  },
  x: {
    name: "X / Twitter",
    command: () => resolveExecutablePath("npx"),
    args: () => ["-y", "@enescinar/twitter-mcp"],
    env: new Set(["API_KEY", "API_SECRET_KEY", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"]),
  },
  computer: {
    name: "Remote computer",
    command: () => process.execPath,
    args: () => {
      const server = resolveBundledMcpServerPath("ssh-remote.mjs");
      return server ? [server] : null;
    },
    env: new Set(["SSH_HOST"]),
  },
};

function catalogIdMatches(connectorId: string, catalogId: CatalogConnectorId): boolean {
  if (catalogId !== "computer") return connectorId === catalogId;
  return connectorId === "computer" || connectorId.startsWith("computer-");
}

function exactValues(left: readonly string[] | undefined, right: readonly string[]): boolean {
  return left?.length === right.length && right.every((value, index) => left[index] === value);
}

function allowedEnvironment(
  env: Readonly<Record<string, string>> | undefined,
  allowlist: ReadonlySet<string>,
): boolean {
  return Object.keys(env ?? {}).every((key) => allowlist.has(key));
}

function catalogExecutionMatches(
  connector: ConnectorConfig,
  catalogId: CatalogConnectorId,
): boolean {
  const descriptor = CATALOG[catalogId];
  const command = descriptor.command();
  const args = descriptor.args();
  return (
    command !== null &&
    args !== null &&
    catalogIdMatches(connector.id, catalogId) &&
    connector.transport === "stdio" &&
    connector.command === command &&
    exactValues(connector.args, args) &&
    allowedEnvironment(connector.env, descriptor.env) &&
    !connector.cwd &&
    !connector.url &&
    !connector.headers &&
    !connector.auth
  );
}

function legacyCatalogExecutionMatches(
  connector: ConnectorConfig,
  catalogId: CatalogConnectorId,
): boolean {
  const descriptor = CATALOG[catalogId];
  const args = descriptor.args();
  const legacyCommand = catalogId === "computer" ? "node" : "npx";
  return (
    args !== null &&
    catalogIdMatches(connector.id, catalogId) &&
    connector.transport === "stdio" &&
    connector.command === legacyCommand &&
    exactValues(connector.args, args) &&
    allowedEnvironment(connector.env, descriptor.env) &&
    !connector.cwd &&
    !connector.url &&
    !connector.headers &&
    !connector.auth
  );
}

function legacyGitHubCommand(
  command: string | undefined,
  origin: ConnectorOrigin | undefined,
): boolean {
  if (!command) return false;
  if (!origin) return command === "npx";
  const names = [path.posix.basename(command), path.win32.basename(command)];
  return names.some((name) => name.toLowerCase() === "npx" || name.toLowerCase() === "npx.cmd");
}

function legacyGitHubOrigin(origin: ConnectorOrigin | undefined): boolean {
  return (
    origin === undefined ||
    (origin.kind === "catalog" &&
      origin.id === "github" &&
      (origin.version === undefined || origin.version === LEGACY_CATALOG_POLICY_VERSION) &&
      origin.binding === undefined &&
      origin.artifactDigest === undefined &&
      origin.inventoryDigest === undefined &&
      origin.executable === undefined)
  );
}

function legacyGeneratedGitHubConnector(connector: ConnectorConfig): boolean {
  return (
    connector.id === "github" &&
    connector.name === "GitHub" &&
    connector.transport === "stdio" &&
    legacyGitHubCommand(connector.command, connector.origin) &&
    exactValues(connector.args, ["-y", "@modelcontextprotocol/server-github"]) &&
    allowedEnvironment(connector.env, CATALOG.github.env) &&
    !connector.cwd &&
    !connector.url &&
    !connector.headers &&
    !connector.auth &&
    legacyGitHubOrigin(connector.origin)
  );
}

function managedGitHubExecutablePath(connector: ConnectorConfig): boolean {
  const origin = connector.origin;
  if (!connector.command || origin?.kind !== "catalog" || !origin.artifactDigest) return false;
  const selected = Object.values(GITHUB_MCP_ARTIFACTS).find(
    (entry) => `sha256:${entry.executableSha256}` === origin.artifactDigest,
  );
  if (!selected) return false;
  const paths = selected.platform === "win32" ? path.win32 : path.posix;
  const normalized = paths.normalize(connector.command);
  const relative = paths.relative(paths.parse(normalized).root, normalized);
  const parts = relative.split(paths.sep);
  const suffix = [
    "runtime",
    "connectors",
    "github-mcp-server",
    selected.version,
    selected.executableName,
  ];
  return (
    normalized === connector.command &&
    paths.isAbsolute(normalized) &&
    parts.length > suffix.length &&
    exactValues(parts.slice(-suffix.length), suffix)
  );
}

function previousManagedGitHubConnector(connector: ConnectorConfig): boolean {
  const origin = connector.origin;
  return (
    connector.id === "github" &&
    connector.name === "GitHub" &&
    connector.transport === "stdio" &&
    exactValues(connector.args, GITHUB_MCP_ARGS) &&
    allowedEnvironment(connector.env, CATALOG.github.env) &&
    !connector.cwd &&
    !connector.url &&
    !connector.headers &&
    !connector.auth &&
    origin?.kind === "catalog" &&
    origin.id === "github" &&
    origin.version === CATALOG_POLICY_VERSION &&
    origin.binding === undefined &&
    origin.inventoryDigest === GITHUB_MCP_INVENTORY_DIGEST &&
    origin.executable === undefined &&
    managedGitHubExecutablePath(connector)
  );
}

export function catalogConnectorOrigin(catalogId: CatalogConnectorId): ConnectorOrigin {
  const selected = catalogId === "github" ? githubMcpArtifactFor() : null;
  return {
    kind: "catalog",
    id: catalogId,
    version: CATALOG_POLICY_VERSION,
    ...(selected
      ? {
          artifactDigest: `sha256:${selected.executableSha256}`,
          inventoryDigest: GITHUB_MCP_INVENTORY_DIGEST,
        }
      : {}),
  };
}

export function migrateLegacyCatalogConnector(
  connector: ConnectorConfig,
): ConnectorConfig | undefined {
  if (
    legacyGeneratedGitHubConnector(connector) ||
    (previousManagedGitHubConnector(connector) && !catalogConnectorMatchesOrigin(connector))
  ) {
    return catalogConnectorConfiguration({
      id: connector.id,
      catalogId: "github",
      env: connector.env,
      allowTools: [],
      permissionReviewed: false,
      enabled: false,
    });
  }
  const catalogId = CATALOG_IDS.filter((id) => id !== "github").find(
    (id) => catalogExecutionMatches(connector, id) || legacyCatalogExecutionMatches(connector, id),
  );
  return catalogId
    ? catalogConnectorConfiguration({
        id: connector.id,
        catalogId,
        env: connector.env,
        allowTools: connector.allowTools,
        permissionReviewed: connector.permissionReviewed,
        enabled: connector.enabled,
      })
    : undefined;
}

export function catalogConnectorConfiguration(input: CatalogConnectorInput): ConnectorConfig {
  const descriptor = CATALOG[input.catalogId];
  const command = descriptor.command();
  const args = descriptor.args();
  if (!command || !args) throw new Error(`Catalog connector "${input.catalogId}" is unavailable`);
  if (!catalogIdMatches(input.id, input.catalogId)) {
    throw new Error(`Catalog connector "${input.catalogId}" has an invalid id`);
  }
  if (!allowedEnvironment(input.env, descriptor.env)) {
    throw new Error(`Catalog connector "${input.catalogId}" environment is invalid`);
  }
  const allowTools = [...new Set(input.allowTools ?? [])];
  const permissionReviewed = input.allowTools !== undefined && input.permissionReviewed === true;
  if (input.enabled && !permissionReviewed) {
    throw new Error("Review and save an explicit tool grant before enabling");
  }
  const host = input.env?.SSH_HOST?.trim();
  return {
    id: input.id,
    name: input.catalogId === "computer" && host ? `Computer: ${host}` : descriptor.name,
    transport: "stdio",
    command,
    args: [...args],
    ...(input.env ? { env: { ...input.env } } : {}),
    allowTools,
    permissionReviewed,
    origin: catalogConnectorOrigin(input.catalogId),
    enabled: input.enabled ?? false,
  };
}

export async function catalogConnectorRuntime(
  connector: ConnectorConfig,
): Promise<{ cwd: string; env: Record<string, string> } | null> {
  if (connector.origin?.kind !== "catalog" || !catalogConnectorMatchesOrigin(connector))
    return null;
  if (
    connector.origin.id === "github" &&
    (await verifiedGitHubMcpExecutablePath()) !== connector.command
  ) {
    return null;
  }
  const cwd = resolveDataDir();
  const temporary = tmpdir();
  const env: Record<string, string> = {
    HOME: cwd,
    PATH: [
      path.dirname(connector.command ?? ""),
      path.dirname(process.execPath),
      "/usr/bin",
      "/bin",
    ]
      .filter((entry, index, entries) => entry && entries.indexOf(entry) === index)
      .join(path.delimiter),
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    USERPROFILE: cwd,
  };
  if (process.platform === "win32" && process.env.SystemRoot) {
    env.SystemRoot = process.env.SystemRoot;
  }
  return { cwd, env: { ...env, ...(connector.env ?? {}) } };
}

export function catalogConnectorMatchesOrigin(connector: ConnectorConfig): boolean {
  const origin = connector.origin;
  if (origin?.kind !== "catalog") return true;
  const catalogId = CATALOG_IDS.find((id) => id === origin.id);
  if (!catalogId) return false;
  const expected = catalogConnectorOrigin(catalogId);
  return (
    origin.version === expected.version &&
    catalogExecutionMatches(connector, catalogId) &&
    origin.binding === undefined &&
    origin.artifactDigest === expected.artifactDigest &&
    origin.inventoryDigest === expected.inventoryDigest &&
    origin.executable === undefined
  );
}

function googleWorkspaceRisk(connector: ConnectorConfig, tool: string): ConnectorRisk | null {
  if (connector.origin?.kind !== "account-adapter") return null;
  if (connector.origin.binding !== "google-workspace") return null;
  if (!isGoogleWorkspacePlugin(connector.origin.id)) return "critical";
  const binding = GOOGLE_WORKSPACE_BINDINGS[connector.origin.id];
  return binding.observeTools.includes(tool) ? "read" : "critical";
}

export function connectorToolRisk(connector: ConnectorConfig, tool: string): ConnectorRisk {
  const googleRisk = googleWorkspaceRisk(connector, tool);
  if (googleRisk) return googleRisk;
  if (connector.origin?.kind !== "catalog" || !catalogConnectorMatchesOrigin(connector)) {
    return "critical";
  }
  if (connector.origin.id === "computer") return "critical";
  if (connector.origin.id === "github") {
    return GITHUB_READ_TOOLS.has(tool) ? "read" : "critical";
  }
  if (connector.origin.id === "x") {
    if (TWITTER_READ_TOOLS.has(tool)) return "read";
    return TWITTER_MUTATING_TOOLS.has(tool) ? "mutating" : "critical";
  }
  return "critical";
}

export function connectorToolPermissions(
  connector: ConnectorConfig,
  tools: readonly McpToolInfo[],
): ConnectorToolPermission[] {
  const granted = new Set(connector.allowTools);
  return tools.map((tool) => {
    const risk = connectorToolRisk(connector, tool.name);
    return {
      name: tool.name,
      ...(tool.description ? { description: tool.description.slice(0, 500) } : {}),
      risk,
      granted: connector.permissionReviewed && granted.has(tool.name),
      default_granted: risk === "read",
    };
  });
}
