import { Effect } from "effect";
import { connectMcp, type McpConnection, type McpToolInfo } from "./mcp-client";
import { connectorAuthorizationHeaders } from "./connector-auth";
import {
  connectorAuthorizationMatches,
  connectorConfigurationFingerprint,
} from "./connector-configuration";
import { connectorInventoryDigest } from "./connector-inventory";
import {
  inspectConnectors,
  replaceConnectorIfUnchanged,
  type ConnectorConfig,
} from "./connectors-service";
import { catalogConnectorRuntime } from "./connector-policy";
import { clearedPluginConnector } from "./plugin-connector-identity";

const CONNECTOR_INVENTORY_ERROR = "Connector tool inventory failed";
export const CONNECTOR_CALL_ERROR = "Connector tool call failed";
export const CONNECTOR_PROBE_ERROR = "Connector probe failed";

type PooledConnection = { connection: McpConnection; fingerprint: string };

const pool = new Map<string, PooledConnection>();
const pluginInvocationAccess = new Map<string, Promise<void>>();
const connectorSecurityTransitions = new Set<string>();

export class ConnectorToolDeniedError extends Error {}

export type ConnectorSecurityTransition = {
  release(): void;
  shutdown(): Promise<void>;
};

function rejectedReasons(results: readonly PromiseSettledResult<void>[]): unknown[] {
  return results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
}

async function closeConnections(connectorIds: readonly string[]): Promise<unknown[]> {
  return rejectedReasons(await Promise.allSettled(connectorIds.map(closePooledConnection)));
}

function assertConnectorNotTransitioning(connectorId: string): void {
  if (connectorSecurityTransitions.has(connectorId)) {
    throw new ConnectorToolDeniedError(`Connector "${connectorId}" lifecycle transition is active`);
  }
}

export function beginConnectorSecurityTransition(
  connectorIds: readonly string[],
): ConnectorSecurityTransition {
  const ids = [...new Set(connectorIds)];
  for (const id of ids) assertConnectorNotTransitioning(id);
  for (const id of ids) connectorSecurityTransitions.add(id);
  let released = false;
  return {
    async shutdown(): Promise<void> {
      await closeConnections(ids);
      const invocationFailures = rejectedReasons(
        await Promise.allSettled(ids.flatMap((id) => pluginInvocationAccess.get(id) ?? [])),
      );
      const closeFailures = await closeConnections(ids);
      const failures = [...invocationFailures, ...closeFailures];
      if (failures.length > 0) throw new AggregateError(failures, "Connector shutdown failed");
    },
    release(): void {
      if (released) return;
      released = true;
      for (const id of ids) connectorSecurityTransitions.delete(id);
    },
  };
}

const toTarget = (connector: ConnectorConfig, signal?: AbortSignal) => {
  if (connector.transport === "stdio") {
    const catalogRuntime = catalogConnectorRuntime(connector);
    const environment = catalogRuntime?.env ?? connector.env ?? {};
    return {
      transport: "stdio" as const,
      command: connector.command ?? "",
      args: [...(connector.args ?? [])],
      ...(connector.origin?.kind === "plugin"
        ? { startupEnvironment: environment }
        : { env: environment }),
      ...(catalogRuntime
        ? { cwd: catalogRuntime.cwd }
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
  assertConnectorNotTransitioning(connectorId);
  const connector = await enabledConnector(connectorId);
  assertConnectorNotTransitioning(connectorId);
  assertConnectorToolAllowed(connector, tool);
  return connector;
}

export async function getPooledConnection(connectorId: string): Promise<McpConnection> {
  const connector = await enabledConnector(connectorId);
  if (connector.origin?.kind === "plugin") {
    throw new ConnectorToolDeniedError("Plugin tool calls require invocation validation");
  }
  return pooledConnection(connector);
}

async function pooledConnection(connector: ConnectorConfig): Promise<McpConnection> {
  const fingerprint = connectorConfigurationFingerprint(connector);
  const existing = pool.get(connector.id);
  if (existing?.fingerprint === fingerprint) return existing.connection;
  if (existing) await existing.connection.close();
  const connection = connectMcp(toTarget(connector));
  pool.set(connector.id, { connection, fingerprint });
  return connection;
}

export async function closePooledConnection(connectorId: string): Promise<void> {
  const connection = pool.get(connectorId);
  if (!connection) return;
  await connection.connection.close();
  if (pool.get(connectorId) === connection) pool.delete(connectorId);
}

export async function listConnectorTools(connectorId: string): Promise<McpToolInfo[]> {
  const connector = await enabledConnector(connectorId);
  try {
    const connection = await pooledConnection(connector);
    return filterAllowedConnectorTools(connector, await connection.listTools());
  } catch {
    await closePooledConnection(connectorId);
    throw new Error(CONNECTOR_INVENTORY_ERROR);
  }
}

export async function callConnectorTool(
  approvedConnector: ConnectorConfig,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const invoke = async (): Promise<unknown> => {
    const connector = await authorizedConnectorTool(approvedConnector.id, tool);
    if (!connectorAuthorizationMatches(connector, approvedConnector)) {
      throw new ConnectorToolDeniedError("Connector configuration changed after approval");
    }
    const connection =
      connector.origin?.kind === "plugin"
        ? await validatedPluginConnection(connector, tool)
        : await pooledConnection(connector);
    try {
      return await connection.callTool(tool, args);
    } catch {
      await closePooledConnection(connector.id);
      throw new Error(CONNECTOR_CALL_ERROR);
    }
  };
  return approvedConnector.origin?.kind === "plugin"
    ? withPluginInvocation(approvedConnector.id, invoke)
    : invoke();
}

function withPluginInvocation<A>(connectorId: string, operation: () => Promise<A>): Promise<A> {
  const previous = pluginInvocationAccess.get(connectorId) ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  pluginInvocationAccess.set(connectorId, tail);
  return previous
    .then(() => {
      assertConnectorNotTransitioning(connectorId);
      return operation();
    })
    .finally(() => {
      release();
      if (pluginInvocationAccess.get(connectorId) === tail) {
        pluginInvocationAccess.delete(connectorId);
      }
    });
}

async function denyPluginIdentity(connector: ConnectorConfig): Promise<never> {
  try {
    await replaceConnectorIfUnchanged(connector, clearedPluginConnector(connector));
  } finally {
    await closePooledConnection(connector.id);
  }
  throw new ConnectorToolDeniedError("Plugin connector identity changed; review required");
}

async function validatePluginIdentity(connector: ConnectorConfig): Promise<void> {
  try {
    const { validatePluginConnectorInvocation } = await import("./plugin-runtime");
    await Effect.runPromise(validatePluginConnectorInvocation(connector));
  } catch {
    await denyPluginIdentity(connector);
  }
}

async function validatedPluginConnection(
  connector: ConnectorConfig,
  tool: string,
): Promise<McpConnection> {
  assertConnectorNotTransitioning(connector.id);
  await validatePluginIdentity(connector);
  const beforeInventory = await authorizedConnectorTool(connector.id, tool);
  if (!connectorAuthorizationMatches(beforeInventory, connector)) {
    throw new ConnectorToolDeniedError("Connector configuration changed after approval");
  }
  const connection = await pooledConnection(beforeInventory);
  await validatePluginInventory(beforeInventory, connection);
  await validatePluginIdentity(beforeInventory);
  const current = await authorizedConnectorTool(connector.id, tool);
  if (!connectorAuthorizationMatches(current, beforeInventory)) {
    throw new ConnectorToolDeniedError("Connector configuration changed after approval");
  }
  await validatePluginInventory(current, connection);
  const latest = await authorizedConnectorTool(connector.id, tool);
  if (!connectorAuthorizationMatches(latest, current)) {
    throw new ConnectorToolDeniedError("Connector configuration changed after approval");
  }
  assertConnectorNotTransitioning(connector.id);
  return connection;
}

async function validatePluginInventory(
  connector: ConnectorConfig,
  connection: McpConnection,
): Promise<void> {
  let inventory: McpToolInfo[];
  try {
    inventory = await connection.listTools();
  } catch {
    return denyPluginIdentity(connector);
  }
  if (
    !connector.origin?.inventoryDigest ||
    connectorInventoryDigest(inventory) !== connector.origin.inventoryDigest
  ) {
    return denyPluginIdentity(connector);
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
    await connection?.close();
  }
}
