import { connectMcp, type McpConnection, type McpTarget, type McpToolInfo } from "./mcp-client";
import { connectorAuthorizationHeaders, googleWorkspaceConnectorAuth } from "./connector-auth";
import { listConnectors, type ConnectorConfig } from "./connectors-service";
import { googleWorkspaceConnection } from "./google-account";
import { googleWorkspaceEndpointTransport } from "./google-workspace-binding";
import { oauthConnectorSpawnEnv, type OAuthConnectorDependencies } from "./oauth-connectors";

export class ConnectorToolDeniedError extends Error {}

export class ConnectorPool {
  private pool = new Map<string, McpConnection>();

  async resolveConnectorTarget(
    connector: ConnectorConfig,
    signal?: AbortSignal,
    oauthDependencies?: OAuthConnectorDependencies,
  ): Promise<McpTarget> {
    if (connector.transport === "stdio") {
      return {
        transport: "stdio" as const,
        command: connector.command ?? "",
        args: [...(connector.args ?? [])],
        env: {
          ...(connector.env ?? {}),
          ...(await oauthConnectorSpawnEnv(connector, oauthDependencies)),
        },
        ...(connector.cwd ? { cwd: connector.cwd } : {}),
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
  }

  private async openConnection(
    connector: ConnectorConfig,
    signal?: AbortSignal,
  ): Promise<McpConnection> {
    const identity = googleWorkspaceConnectorAuth(connector);
    if (identity) {
      return googleWorkspaceConnection({
        service: identity.service,
        transport: googleWorkspaceEndpointTransport(identity.service, connector.url ?? ""),
        authorize: (forceRefresh: boolean) => connectorAuthorizationHeaders(connector, forceRefresh),
        ...(signal ? { signal } : {}),
      });
    }
    return connectMcp(await this.resolveConnectorTarget(connector, signal));
  }

  private async enabledConnector(connectorId: string): Promise<ConnectorConfig> {
    const connector = (await listConnectors()).find((entry) => entry.id === connectorId);
    if (!connector) throw new Error(`Unknown connector "${connectorId}"`);
    if (!connector.enabled) throw new Error(`Connector "${connectorId}" is disabled`);
    return connector;
  }

  private allowedTools(connector: ConnectorConfig, tools: McpToolInfo[]): McpToolInfo[] {
    if (!connector.allowTools) return tools;
    const allow = new Set(connector.allowTools);
    return tools.filter((tool) => allow.has(tool.name));
  }

  private assertToolAllowed(connector: ConnectorConfig, tool: string): void {
    if (!connector.allowTools || connector.allowTools.includes(tool)) return;
    throw new ConnectorToolDeniedError(
      `Tool "${tool}" is not allowed for connector "${connector.id}"`,
    );
  }

  async getPooledConnection(connectorId: string): Promise<McpConnection> {
    const existing = this.pool.get(connectorId);
    if (existing) return existing;
    const connector = await this.enabledConnector(connectorId);
    const connection = await this.openConnection(connector);
    this.pool.set(connectorId, connection);
    return connection;
  }

  closePooledConnection(connectorId: string): void {
    const connection = this.pool.get(connectorId);
    if (!connection) return;
    this.pool.delete(connectorId);
    connection.close();
  }

  async listConnectorTools(connectorId: string): Promise<McpToolInfo[]> {
    const connector = await this.enabledConnector(connectorId);
    try {
      const connection = await this.getPooledConnection(connectorId);
      return this.allowedTools(connector, await connection.listTools());
    } catch (error) {
      this.closePooledConnection(connectorId);
      throw error;
    }
  }

  async callConnectorTool(
    connectorId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const connector = await this.enabledConnector(connectorId);
    this.assertToolAllowed(connector, tool);
    try {
      return await (await this.getPooledConnection(connectorId)).callTool(tool, args);
    } catch (error) {
      this.closePooledConnection(connectorId);
      throw error;
    }
  }

  async probeConnector(
    connector: ConnectorConfig,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
    let connection: McpConnection | null = null;
    try {
      connection = await this.openConnection(connector, signal);
      const tools = await connection.listTools();
      return { ok: true, tools };
    } catch (error) {
      return { ok: false, tools: [], error: error instanceof Error ? error.message : String(error) };
    } finally {
      connection?.close();
    }
  }
}

const pool = new ConnectorPool();

export const resolveConnectorTarget = pool.resolveConnectorTarget.bind(pool);
export const getPooledConnection = pool.getPooledConnection.bind(pool);
export const closePooledConnection = pool.closePooledConnection.bind(pool);
export const listConnectorTools = pool.listConnectorTools.bind(pool);
export const callConnectorTool = pool.callConnectorTool.bind(pool);
export const probeConnector = pool.probeConnector.bind(pool);
