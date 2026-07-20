import { createHash } from "node:crypto";
import type { ConnectorConfig, ConnectorJson } from "./connector-contract";

type ConnectorConfiguration = { readonly [key: string]: ConnectorJson };

export function canonicalConnectorJson(value: ConnectorJson): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (isConnectorJsonArray(value)) return `[${value.map(canonicalConnectorJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalConnectorJson(connectorJsonProperty(value, key))}`,
    )
    .join(",")}}`;
}

function isConnectorJsonArray(value: ConnectorJson): value is readonly ConnectorJson[] {
  return Array.isArray(value);
}

function connectorJsonProperty(value: ConnectorConfiguration, key: string): ConnectorJson {
  const property = value[key];
  if (property === undefined) throw new Error("Connector configuration contains unsupported JSON");
  return property;
}

export function connectorExecutionConfiguration(
  connector: ConnectorConfig,
): ConnectorConfiguration {
  return {
    id: connector.id,
    transport: connector.transport,
    ...(connector.command === undefined ? {} : { command: connector.command }),
    ...(connector.args === undefined ? {} : { args: connector.args }),
    ...(connector.env === undefined ? {} : { env: connector.env }),
    ...(connector.cwd === undefined ? {} : { cwd: connector.cwd }),
    ...(connector.url === undefined ? {} : { url: connector.url }),
    ...(connector.headers === undefined ? {} : { headers: connector.headers }),
    ...(connector.auth === undefined ? {} : { auth: connector.auth }),
    ...(connector.origin === undefined ? {} : { origin: connector.origin }),
  };
}

export function connectorAuthorizationConfiguration(
  connector: ConnectorConfig,
): ConnectorConfiguration {
  return {
    ...connectorExecutionConfiguration(connector),
    name: connector.name,
    allowTools: connector.allowTools,
    permissionReviewed: connector.permissionReviewed,
    enabled: connector.enabled,
  };
}

export function connectorConfigurationFingerprint(connector: ConnectorConfig): string {
  return createHash("sha256")
    .update(canonicalConnectorJson(connectorAuthorizationConfiguration(connector)))
    .digest("hex");
}

export function connectorExecutionMatches(left: ConnectorConfig, right: ConnectorConfig): boolean {
  return (
    canonicalConnectorJson(connectorExecutionConfiguration(left)) ===
    canonicalConnectorJson(connectorExecutionConfiguration(right))
  );
}

export function connectorAuthorizationMatches(
  left: ConnectorConfig,
  right: ConnectorConfig,
): boolean {
  return (
    canonicalConnectorJson(connectorAuthorizationConfiguration(left)) ===
    canonicalConnectorJson(connectorAuthorizationConfiguration(right))
  );
}
