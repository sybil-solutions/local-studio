import { connectMcp, type McpConnection, type McpToolInfo } from "./mcp-client";
import { connectorAuthorizationHeaders } from "./connector-auth";
import {
  connectorAuthorizationMatches,
  connectorConfigurationFingerprint,
} from "./connector-configuration";
import { inspectConnectors, type ConnectorConfig } from "./connectors-service";
import { catalogConnectorRuntime } from "./connector-policy";

const CONNECTOR_INVENTORY_ERROR = "Connector tool inventory failed";
export const CONNECTOR_CALL_ERROR = "Connector tool call failed";
export const CONNECTOR_PROBE_ERROR = "Connector probe failed";

type PooledConnection = { connection: McpConnection; fingerprint: string };

const pool = new Map<string, PooledConnection>();

export class ConnectorToolDeniedError extends Error {}

const toTarget = (connector: ConnectorConfig, signal?: AbortSignal) => {
  if (connector.transport === "stdio") {
    const catalogRuntime = catalogConnectorRuntime(connector);
    return {
      transport: "stdio" as const,
      command: connector.command ?? "",
      args: [...(connector.args ?? [])],
      env: catalogRuntime?.env ?? connector.env ?? {},
      ...(catalogRuntime
        ? { cwd: catalogRuntime.cwd, isolated: true }
        : connector.cwd
          ? { cwd: connector.cwd }
          : {}),
    };
  }
  return {
    transport: "http" as const,
    url: connector.url ?? "",
    headers: connector.headers ?? {},
    ...(connector.auth
      ? {
          authorize: (forceRefresh: boolean) =>
            connectorAuthorizationHeaders(connector, forceRefresh),
        }
      : {}),
    ...(signal ? { signal } : {}),
  };
};

async function enabledConnector(connectorId: string): Promise<ConnectorConfig> {
  const connector = (await inspectConnectors()).find((entry) => entry.id === connectorId);
  if (!connector) throw new Error(`Unknown connector "${connectorId}"`);
  if (!connector.enabled || !connector.permissionReviewed) {
    throw new Error(`Connector "${connectorId}" is disabled`);
  }
  return connector;
}

export function filterAllowedConnectorTools(
  connector: ConnectorConfig,
  tools: McpToolInfo[],
): McpToolInfo[] {
  if (!connector.permissionReviewed) return [];
  const allow = new Set(connector.allowTools);
  return tools.filter((tool) => allow.has(tool.name));
}

export function assertConnectorToolAllowed(connector: ConnectorConfig, tool: string): void {
  if (connector.permissionReviewed && connector.allowTools.includes(tool)) return;
  throw new ConnectorToolDeniedError(
    `Tool "${tool}" is not allowed for connector "${connector.id}"`,
  );
}

export async function authorizedConnectorTool(
  connectorId: string,
  tool: string,
): Promise<ConnectorConfig> {
  const connector = await enabledConnector(connectorId);
  assertConnectorToolAllowed(connector, tool);
  return connector;
}

export async function getPooledConnection(connectorId: string): Promise<McpConnection> {
  const connector = await enabledConnector(connectorId);
  return pooledConnection(connector);
}

function pooledConnection(connector: ConnectorConfig): McpConnection {
  const fingerprint = connectorConfigurationFingerprint(connector);
  const existing = pool.get(connector.id);
  if (existing?.fingerprint === fingerprint) return existing.connection;
  existing?.connection.close();
  const connection = connectMcp(toTarget(connector));
  pool.set(connector.id, { connection, fingerprint });
  return connection;
}

export function closePooledConnection(connectorId: string): void {
  const connection = pool.get(connectorId);
  if (!connection) return;
  pool.delete(connectorId);
  connection.connection.close();
}

export async function listConnectorTools(connectorId: string): Promise<McpToolInfo[]> {
  const connector = await enabledConnector(connectorId);
  try {
    const connection = pooledConnection(connector);
    return filterAllowedConnectorTools(connector, await connection.listTools());
  } catch {
    closePooledConnection(connectorId);
    throw new Error(CONNECTOR_INVENTORY_ERROR);
  }
}

export async function callConnectorTool(
  approvedConnector: ConnectorConfig,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const connector = await authorizedConnectorTool(approvedConnector.id, tool);
  if (!connectorAuthorizationMatches(connector, approvedConnector)) {
    throw new ConnectorToolDeniedError("Connector configuration changed after approval");
  }
  try {
    return await pooledConnection(connector).callTool(tool, args);
  } catch {
    closePooledConnection(connector.id);
    throw new Error(CONNECTOR_CALL_ERROR);
  }
}

export async function probeConnector(
  connector: ConnectorConfig,
  signal?: AbortSignal,
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  let connection: McpConnection | null = null;
  try {
    connection = connectMcp(toTarget(connector, signal));
    const tools = await connection.listTools();
    return { ok: true, tools };
  } catch {
    return { ok: false, tools: [], error: CONNECTOR_PROBE_ERROR };
  } finally {
    connection?.close();
  }
}
