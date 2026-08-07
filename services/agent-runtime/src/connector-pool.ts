import { createHash } from "node:crypto";
import { Effect } from "effect";
import {
  GitHubConnectorArtifactError,
  assertGitHubConnectorReady,
  isManagedGitHubConnector,
  managedGitHubConnectorMatches,
} from "./connector-artifacts";
import { connectorAuthorizationHeaders } from "./connector-auth";
import { listConnectors, type ConnectorConfig } from "./connectors-service";
import { connectMcp, type McpConnection, type McpTarget, type McpToolInfo } from "./mcp-client";

export class ConnectorToolDeniedError extends Error {}

class ConnectorConnectionInvalidatedError extends Error {
  constructor(connectorId: string) {
    super(`Connector "${connectorId}" connection was invalidated`);
    this.name = "ConnectorConnectionInvalidatedError";
  }
}

type ConnectorPoolDependencies = {
  loadConnectors: () => Promise<ConnectorConfig[]>;
  connect: (target: McpTarget) => McpConnection;
  verifyGitHub: (connector: ConnectorConfig, signal?: AbortSignal) => Promise<void>;
};

type ConnectionEntry = {
  identity: string;
  generation: number;
  connection: McpConnection;
};

type PendingConnectionEntry = {
  identity: string;
  generation: number;
  controller: AbortController;
  promise: Promise<McpConnection>;
};

const toTarget = (connector: ConnectorConfig, signal?: AbortSignal): McpTarget => {
  if (connector.transport === "stdio") {
    return {
      transport: "stdio",
      command: connector.command ?? "",
      args: [...(connector.args ?? [])],
      env: connector.env ?? {},
      ...(connector.cwd ? { cwd: connector.cwd } : {}),
    };
  }
  return {
    transport: "http",
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

function assertConnectorConfiguration(connector: ConnectorConfig): void {
  if (isManagedGitHubConnector(connector) && !managedGitHubConnectorMatches(connector)) {
    throw new GitHubConnectorArtifactError(409, "GitHub connector configuration is invalid");
  }
}

const orderedRecord = (
  record: Readonly<Record<string, string>> | undefined,
): readonly (readonly [string, string])[] | null =>
  record
    ? Object.entries(record).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    : null;

function connectorConnectionIdentity(connector: ConnectorConfig): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: connector.id,
        transport: connector.transport,
        command: connector.command ?? null,
        args: connector.args ?? null,
        env: orderedRecord(connector.env),
        cwd: connector.cwd ?? null,
        url: connector.url ?? null,
        headers: orderedRecord(connector.headers),
        auth: connector.auth
          ? [connector.auth.type, connector.auth.provider, connector.auth.account]
          : null,
        allowTools: connector.allowTools ?? null,
        origin: connector.origin
          ? [
              connector.origin.kind,
              connector.origin.id,
              connector.origin.version ?? null,
              connector.origin.binding ?? null,
              connector.origin.artifactDigest ?? null,
              connector.origin.configurationDigest ?? null,
              connector.origin.snapshotDigest ?? null,
              connector.origin.runtimeDigest ?? null,
              connector.origin.sourceDigest ?? null,
            ]
          : null,
        enabled: connector.enabled,
      }),
    )
    .digest("hex");
}

function allowedTools(connector: ConnectorConfig, tools: McpToolInfo[]): McpToolInfo[] {
  if (!connector.allowTools) return tools;
  const allow = new Set(connector.allowTools);
  return tools.filter((tool) => allow.has(tool.name));
}

function assertToolAllowed(connector: ConnectorConfig, tool: string): void {
  if (!connector.allowTools || connector.allowTools.includes(tool)) return;
  throw new ConnectorToolDeniedError(
    `Tool "${tool}" is not allowed for connector "${connector.id}"`,
  );
}

export function makeConnectorPool(overrides: Partial<ConnectorPoolDependencies> = {}): {
  getPooledConnection(connectorId: string): Promise<McpConnection>;
  closePooledConnection(connectorId: string): Promise<void>;
  listConnectorTools(connectorId: string): Promise<McpToolInfo[]>;
  callConnectorTool(
    connectorId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  probeConnector(
    connector: ConnectorConfig,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }>;
} {
  const dependencies: ConnectorPoolDependencies = {
    loadConnectors: listConnectors,
    connect: connectMcp,
    verifyGitHub: (connector, signal) =>
      Effect.runPromise(assertGitHubConnectorReady(connector), { signal }),
    ...overrides,
  };
  const pool = new Map<string, ConnectionEntry>();
  const pending = new Map<string, PendingConnectionEntry>();
  const generations = new Map<string, number>();

  const generationFor = (connectorId: string): number => generations.get(connectorId) ?? 0;

  const advanceGeneration = (connectorId: string): void => {
    generations.set(connectorId, generationFor(connectorId) + 1);
  };

  const invalidateConnection = async (
    connectorId: string,
    expected?: Pick<ConnectionEntry, "identity" | "generation">,
  ): Promise<void> => {
    const active = pool.get(connectorId);
    const creating = pending.get(connectorId);
    const matchingActive =
      active &&
      (!expected ||
        (active.identity === expected.identity && active.generation === expected.generation))
        ? active
        : null;
    const matchingPending =
      creating &&
      (!expected ||
        (creating.identity === expected.identity && creating.generation === expected.generation))
        ? creating
        : null;
    if (expected && !matchingActive && !matchingPending) return;

    advanceGeneration(connectorId);
    if (matchingActive && pool.get(connectorId) === matchingActive) pool.delete(connectorId);
    if (matchingPending && pending.get(connectorId) === matchingPending) {
      pending.delete(connectorId);
      matchingPending.controller.abort();
    }

    const activeClose = matchingActive
      ? Promise.resolve().then(() => matchingActive.connection.close())
      : Promise.resolve();
    const pendingSettlement = matchingPending
      ? matchingPending.promise.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    const [activeResult] = await Promise.allSettled([activeClose, pendingSettlement]);
    if (activeResult.status === "rejected") throw activeResult.reason;
  };

  const enabledConnector = async (connectorId: string): Promise<ConnectorConfig> => {
    const connector = (await dependencies.loadConnectors()).find(
      (entry) => entry.id === connectorId,
    );
    if (!connector) throw new Error(`Unknown connector "${connectorId}"`);
    if (!connector.enabled) throw new Error(`Connector "${connectorId}" is disabled`);
    assertConnectorConfiguration(connector);
    return connector;
  };

  const awaitCurrentConnection = async (
    connectorId: string,
    entry: PendingConnectionEntry,
  ): Promise<ConnectionEntry> => {
    const connection = await entry.promise;
    const active = pool.get(connectorId);
    if (
      generationFor(connectorId) !== entry.generation ||
      active?.identity !== entry.identity ||
      active.connection !== connection
    ) {
      await connection.close().catch(() => undefined);
      throw new ConnectorConnectionInvalidatedError(connectorId);
    }
    return active;
  };

  const connectionFor = async (connector: ConnectorConfig): Promise<ConnectionEntry> => {
    const identity = connectorConnectionIdentity(connector);
    for (;;) {
      const active = pool.get(connector.id);
      if (active?.identity === identity) return active;
      if (active) {
        await invalidateConnection(connector.id);
        continue;
      }

      const creating = pending.get(connector.id);
      if (creating?.identity === identity) {
        return awaitCurrentConnection(connector.id, creating);
      }
      if (creating) {
        await invalidateConnection(connector.id);
        continue;
      }

      const generation = generationFor(connector.id);
      const controller = new AbortController();
      const promise = Promise.resolve().then(async () => {
        let connection: McpConnection | null = null;
        try {
          if (isManagedGitHubConnector(connector)) {
            await dependencies.verifyGitHub(connector, controller.signal);
          }
          if (generationFor(connector.id) !== generation) {
            throw new ConnectorConnectionInvalidatedError(connector.id);
          }
          connection = dependencies.connect(toTarget(connector));
          if (generationFor(connector.id) !== generation) {
            throw new ConnectorConnectionInvalidatedError(connector.id);
          }
          pool.set(connector.id, { identity, generation, connection });
          return connection;
        } catch (error) {
          await connection?.close().catch(() => undefined);
          throw error;
        }
      });
      const entry: PendingConnectionEntry = { identity, generation, controller, promise };
      pending.set(connector.id, entry);
      const clearPending = (): void => {
        if (pending.get(connector.id) === entry) pending.delete(connector.id);
      };
      void promise.then(clearPending, clearPending);
      return awaitCurrentConnection(connector.id, entry);
    }
  };

  const getPooledConnection = async (connectorId: string): Promise<McpConnection> =>
    (await connectionFor(await enabledConnector(connectorId))).connection;

  const closePooledConnection = (connectorId: string): Promise<void> =>
    invalidateConnection(connectorId);

  const listConnectorTools = async (connectorId: string): Promise<McpToolInfo[]> => {
    const connector = await enabledConnector(connectorId);
    const entry = await connectionFor(connector);
    try {
      return allowedTools(connector, await entry.connection.listTools());
    } catch (error) {
      await invalidateConnection(connectorId, entry);
      throw error;
    }
  };

  const callConnectorTool = async (
    connectorId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    const connector = await enabledConnector(connectorId);
    assertToolAllowed(connector, tool);
    const entry = await connectionFor(connector);
    try {
      return await entry.connection.callTool(tool, args);
    } catch (error) {
      await invalidateConnection(connectorId, entry);
      throw error;
    }
  };

  const probeConnector = async (
    connector: ConnectorConfig,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> => {
    let connection: McpConnection | null = null;
    try {
      assertConnectorConfiguration(connector);
      if (isManagedGitHubConnector(connector)) {
        await dependencies.verifyGitHub(connector, signal);
      }
      connection = dependencies.connect(toTarget(connector, signal));
      const tools = await connection.listTools();
      await connection.close();
      connection = null;
      return { ok: true, tools };
    } catch (error) {
      return {
        ok: false,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await connection?.close().catch(() => undefined);
    }
  };

  return {
    getPooledConnection,
    closePooledConnection,
    listConnectorTools,
    callConnectorTool,
    probeConnector,
  };
}

const defaultConnectorPool = makeConnectorPool();

export const getPooledConnection = defaultConnectorPool.getPooledConnection;
export const closePooledConnection = defaultConnectorPool.closePooledConnection;
export const listConnectorTools = defaultConnectorPool.listConnectorTools;
export const callConnectorTool = defaultConnectorPool.callConnectorTool;
export const probeConnector = defaultConnectorPool.probeConnector;
