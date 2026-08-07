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
  isManagedGitHubConnector,
  managedGitHubConnectorMatches,
  migrateLegacyGitHubConnector,
} from "./connector-artifacts";
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
  if (isManagedGitHubConnector(connector) && !managedGitHubConnectorMatches(connector)) {
    throw new Error('Managed GitHub connector "github" is immutable');
  }
  if (!claimsGoogleWorkspace(connector)) return connector;
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
    origin: { kind: "account-adapter", id: account, binding: "google-workspace" },
    enabled: connector.enabled,
  };
}

export function resolveConnectorsFilePath(): string {
  return join(resolveDataDir(), "connectors.json");
}

const CONNECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export const isValidConnectorId = (id: string): boolean => CONNECTOR_ID_PATTERN.test(id);

async function readConnectorState(): Promise<{ connectors: ConnectorConfig[]; migrated: boolean }> {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return { connectors: [], migrated: false };
  try {
    const parsed = Schema.decodeUnknownSync(ConnectorsFileSchema)(
      JSON.parse(await readFile(file, "utf-8")),
    );
    const normalized = (parsed.connectors ?? []).map((connector) =>
      migrateLegacyGitHubConnector(connector),
    );
    return {
      connectors: normalized.map(({ connector }) => protectManagedConnector(connector)),
      migrated: normalized.some(({ migrated }) => migrated),
    };
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

async function readAndMigrateConnectors(): Promise<ConnectorConfig[]> {
  const state = await readConnectorState();
  if (state.migrated) await writeConnectors(state.connectors);
  return state.connectors;
}

export function listConnectors(): Promise<ConnectorConfig[]> {
  return withConnectorAccess(readAndMigrateConnectors);
}

export function saveConnectors(connectors: ConnectorConfig[]): Promise<void> {
  return withConnectorAccess(() => writeConnectors(connectors));
}

export async function upsertConnector(connector: ConnectorConfig): Promise<ConnectorConfig[]> {
  return upsertConnectors([connector]);
}

export function upsertConnectors(incoming: ConnectorConfig[]): Promise<ConnectorConfig[]> {
  return withConnectorAccess(async () => {
    const connectors = await readAndMigrateConnectors();
    for (const candidate of incoming) {
      const connector = protectManagedConnector(candidate);
      const index = connectors.findIndex((entry) => entry.id === connector.id);
      const existing = index === -1 ? null : connectors[index];
      if (isManagedGitHubConnector(existing ?? connector) && !isManagedGitHubConnector(connector)) {
        throw new Error('Managed GitHub connector "github" is immutable');
      }
      const merged: ConnectorConfig = {
        ...connector,
        env: mergeSecrets(connector.env, existing?.env),
        headers: mergeSecrets(connector.headers, existing?.headers),
        cwd: connector.cwd ?? existing?.cwd,
        allowTools: connector.allowTools ?? existing?.allowTools,
        origin: connector.origin ?? existing?.origin,
        auth: connector.auth ?? existing?.auth,
      };
      const protectedConnector = protectManagedConnector(merged);
      if (index === -1) connectors.push(protectedConnector);
      else connectors[index] = protectedConnector;
    }
    await writeConnectors(connectors);
    return connectors;
  });
}

export function replaceConnectors(incoming: ConnectorConfig[]): Promise<ConnectorConfig[]> {
  return replaceConnectorIdentities(
    incoming.map((connector) => ({ existingId: connector.id, connector })),
  );
}

export function replaceConnectorIdentities(
  incoming: { existingId: string; connector: ConnectorConfig }[],
): Promise<ConnectorConfig[]> {
  return withConnectorAccess(async () => {
    const replacements = incoming.map(({ existingId, connector }) => ({
      existingId,
      connector: protectManagedConnector(connector),
    }));
    const targetIds = new Set(replacements.map(({ connector }) => connector.id));
    if (targetIds.size !== replacements.length) {
      throw new Error("Connector replacement identities conflict");
    }
    const removedIds = new Set(
      replacements.flatMap(({ existingId, connector }) => [existingId, connector.id]),
    );
    const connectors = (await readAndMigrateConnectors()).filter(
      (entry) => !removedIds.has(entry.id),
    );
    connectors.push(...replacements.map(({ connector }) => connector));
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
    const connectors = (await readAndMigrateConnectors()).filter((entry) => entry.id !== id);
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
  const origin = connector.origin
    ? {
        kind: connector.origin.kind,
        id: connector.origin.id,
        ...(connector.origin.version ? { version: connector.origin.version } : {}),
        ...(connector.origin.binding ? { binding: connector.origin.binding } : {}),
      }
    : undefined;
  return {
    ...connector,
    ...(origin ? { origin } : { origin: undefined }),
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
    return Boolean(parsed.connectors?.some((connector) => connector.enabled));
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
