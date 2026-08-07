import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "fs/promises";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { resolveDataDir } from "./data-dir";
import { Schema } from "effect";
import {
  ConnectorsFileSchema,
  type ConnectorConfig,
  type ConnectorView,
} from "./connector-contract";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  googleWorkspaceConnectorAccount,
} from "./google-workspace-binding";

export {
  type ConnectorAuthReference,
  type ConnectorConfig,
  type ConnectorOrigin,
  type ConnectorView,
} from "./connector-contract";

const MASK = "••••••••";
const SECRET_KEY_PATTERN = /token|key|secret|password|auth/i;
let connectorAccess = Promise.resolve();

function withConnectorAccess<A>(operation: () => Promise<A>): Promise<A> {
  const result = connectorAccess.then(operation);
  connectorAccess = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function claimsGoogleWorkspace(connector: ConnectorConfig): boolean {
  return (
    googleWorkspaceConnectorAccount(connector.id) !== null ||
    connector.auth?.provider === "google-workspace" ||
    connector.origin?.binding === "google-workspace"
  );
}

export function protectManagedConnector(connector: ConnectorConfig): ConnectorConfig {
  if (!claimsGoogleWorkspace(connector)) return normalizeConnector(connector);
  const account = googleWorkspaceConnectorAccount(connector.id);
  const binding = account ? GOOGLE_WORKSPACE_BINDINGS[account] : null;
  const valid =
    account !== null &&
    binding !== null &&
    connector.transport === "http" &&
    connector.url === binding.endpoint &&
    connector.auth?.type === "oauth" &&
    connector.auth.provider === "google-workspace" &&
    connector.auth.account === account &&
    connector.origin?.kind === "account-adapter" &&
    connector.origin.id === account &&
    connector.origin.binding === "google-workspace" &&
    !connector.command &&
    !connector.cwd &&
    !connector.args?.length &&
    !connector.env &&
    !connector.headers &&
    connector.allowTools?.length === binding?.observeTools.length &&
    binding?.observeTools.every((tool, index) => connector.allowTools?.[index] === tool);
  if (!valid || !account || !binding) {
    throw new Error(`Managed Google Workspace connector "${connector.id}" is immutable`);
  }
  return {
    id: binding.connectorId,
    name: binding.name,
    transport: "http",
    url: binding.endpoint,
    auth: { type: "oauth", provider: "google-workspace", account },
    allowTools: [...binding.observeTools],
    permissionReviewed: true,
    origin: { kind: "account-adapter", id: account, binding: "google-workspace" },
    enabled: connector.enabled,
  };
}

function normalizeConnector(connector: ConnectorConfig): ConnectorConfig {
  const allowTools = [...new Set(connector.allowTools ?? [])];
  const permissionReviewed =
    connector.allowTools !== undefined && connector.permissionReviewed === true;
  return {
    ...connector,
    allowTools,
    permissionReviewed,
    enabled: connector.enabled && permissionReviewed,
  };
}

export function resolveConnectorsFilePath(): string {
  return join(resolveDataDir(), "connectors.json");
}

const CONNECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export const isValidConnectorId = (id: string): boolean => CONNECTOR_ID_PATTERN.test(id);

export async function listConnectors(): Promise<ConnectorConfig[]> {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return [];
  try {
    const parsed = Schema.decodeUnknownSync(ConnectorsFileSchema)(
      JSON.parse(await readFile(file, "utf-8")),
    );
    return (parsed.connectors ?? []).map(protectManagedConnector);
  } catch {
    throw new Error("Connector configuration is invalid");
  }
}

async function writeConnectors(connectors: ConnectorConfig[]): Promise<void> {
  resolveDataDir();
  const file = resolveConnectorsFilePath();
  const payload = JSON.stringify({ connectors: connectors.map(protectManagedConnector) }, null, 2);
  const tempFile = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tempFile, payload, "utf-8");
  await chmod(tempFile, 0o600).catch(() => undefined);
  await rename(tempFile, file);
}

export function saveConnectors(connectors: ConnectorConfig[]): Promise<void> {
  return withConnectorAccess(() => writeConnectors(connectors));
}

export async function upsertConnector(connector: ConnectorConfig): Promise<ConnectorConfig[]> {
  return upsertConnectors([connector]);
}

export function upsertConnectors(incoming: ConnectorConfig[]): Promise<ConnectorConfig[]> {
  return withConnectorAccess(async () => {
    const connectors = await listConnectors();
    for (const candidate of incoming) {
      const connector = protectManagedConnector(candidate);
      const index = connectors.findIndex((entry) => entry.id === connector.id);
      const existing = index === -1 ? null : connectors[index];
      const merged: ConnectorConfig = {
        ...connector,
        env: mergeSecrets(connector.env, existing?.env),
        headers: mergeSecrets(connector.headers, existing?.headers),
        cwd: connector.cwd ?? existing?.cwd,
        allowTools:
          connector.permissionReviewed === true
            ? (connector.allowTools ?? [])
            : (existing?.allowTools ?? []),
        permissionReviewed: connector.permissionReviewed ?? existing?.permissionReviewed ?? false,
        origin: connector.origin ?? existing?.origin,
        auth: connector.auth ?? existing?.auth,
      };
      const normalized = normalizeConnector(merged);
      if (index === -1) connectors.push(normalized);
      else connectors[index] = normalized;
    }
    await writeConnectors(connectors);
    return connectors;
  });
}

export function removeConnector(id: string): Promise<ConnectorConfig[]> {
  if (googleWorkspaceConnectorAccount(id)) {
    return Promise.reject(
      new Error(`Managed Google Workspace connector "${id}" cannot be removed`),
    );
  }
  return withConnectorAccess(async () => {
    const connectors = (await listConnectors()).filter((entry) => entry.id !== id);
    await writeConnectors(connectors);
    return connectors;
  });
}

function mergeSecrets(
  incoming: Record<string, string> | undefined,
  stored: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!incoming) return incoming;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    result[key] = value === MASK && stored?.[key] ? stored[key] : value;
  }
  return result;
}

const maskRecord = (
  record: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!record) return record;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      SECRET_KEY_PATTERN.test(key) && value ? MASK : value,
    ]),
  );
};

export function toConnectorView(connector: ConnectorConfig): ConnectorView {
  return {
    ...connector,
    allowTools: [...(connector.allowTools ?? [])],
    permissionReviewed: connector.permissionReviewed === true,
    env: maskRecord(connector.env),
    headers: maskRecord(connector.headers),
    secret_keys: [
      ...Object.keys(connector.env ?? {}),
      ...Object.keys(connector.headers ?? {}),
    ].filter((key) => SECRET_KEY_PATTERN.test(key)),
  };
}

export async function enabledConnectors(): Promise<ConnectorConfig[]> {
  return (await listConnectors()).filter((connector) => connector.enabled);
}

export function hasEnabledConnectorsSync(): boolean {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return false;
  try {
    const parsed = Schema.decodeUnknownSync(ConnectorsFileSchema)(
      JSON.parse(readFileSync(file, "utf-8")),
    );
    return Boolean(
      parsed.connectors?.map(normalizeConnector).some((connector) => connector.enabled),
    );
  } catch {
    return false;
  }
}

export function connectorsRevisionSync(): string {
  const file = resolveConnectorsFilePath();
  try {
    const info = statSync(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return "none";
  }
}
