import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir } from "./data-dir";
import { Schema } from "effect";
import {
  CONNECTOR_MASK_TOKEN,
  ConnectorConfigSchema,
  ConnectorUpsertInputSchema,
  ConnectorsFileSchema,
  type ConnectorConfig,
  type ConnectorUpsertInput,
  type ConnectorView,
} from "./connector-contract";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  googleWorkspaceConnectorAccount,
} from "./google-workspace-binding";
import {
  readConnectorPrivateFile,
  replaceConnectorPrivateFile,
  type ConnectorPersistenceOptions,
} from "./connector-private-file";

export {
  type ConnectorAuthReference,
  type ConnectorConfig,
  type ConnectorOrigin,
  type ConnectorView,
} from "./connector-contract";
export type {
  ConnectorDarwinSecurity,
  ConnectorFileHandle,
  ConnectorFileSystem,
  ConnectorPersistenceIdentity,
  ConnectorPersistenceOptions,
  ConnectorWindowsSecurity,
} from "./connector-private-file";

const CONNECTOR_CONFIGURATION_ERROR = "Connector configuration is invalid";
const exact = { onExcessProperty: "error" } as const;
const decodeRawConnector = Schema.decodeUnknownSync(ConnectorConfigSchema, exact);
const decodeUpsertInput = Schema.decodeUnknownSync(ConnectorUpsertInputSchema, exact);
let connectorAccess = Promise.resolve();

export class ConnectorConfigurationError extends Error {
  readonly status = 409;

  constructor() {
    super(CONNECTOR_CONFIGURATION_ERROR);
    this.name = "ConnectorConfigurationError";
  }
}

function configurationError(): ConnectorConfigurationError {
  return new ConnectorConfigurationError();
}

function validatedRawConnectors(incoming: readonly ConnectorConfig[]): ConnectorConfig[] {
  try {
    return incoming.map((connector) => decodeRawConnector(connector));
  } catch {
    throw configurationError();
  }
}

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

export function listConnectors(): Promise<ConnectorConfig[]>;
export function listConnectors(options: ConnectorPersistenceOptions): Promise<ConnectorConfig[]>;
export async function listConnectors(
  options: ConnectorPersistenceOptions = {},
): Promise<ConnectorConfig[]> {
  const payload = await readConnectorPrivateFile(resolveConnectorsFilePath(), options);
  if (payload === null) return [];
  try {
    const parsed = Schema.decodeUnknownSync(ConnectorsFileSchema, exact)(JSON.parse(payload));
    return (parsed.connectors ?? []).map(protectManagedConnector);
  } catch {
    throw configurationError();
  }
}

function writeConnectors(
  connectors: ConnectorConfig[],
  options: ConnectorPersistenceOptions = {},
): Promise<void> {
  let configuration: typeof ConnectorsFileSchema.Type;
  try {
    configuration = Schema.decodeUnknownSync(
      ConnectorsFileSchema,
      exact,
    )({
      connectors: connectors.map(protectManagedConnector),
    });
  } catch {
    throw configurationError();
  }
  const payload = JSON.stringify(configuration, null, 2);
  return replaceConnectorPrivateFile(resolveConnectorsFilePath(), payload, options);
}

export function saveConnectors(
  connectors: ConnectorConfig[],
  options: ConnectorPersistenceOptions = {},
): Promise<void> {
  return withConnectorAccess(() => writeConnectors(connectors, options));
}

export async function upsertConnector(connector: ConnectorConfig): Promise<ConnectorConfig[]> {
  return upsertConnectors([connector]);
}

export function upsertConnectors(incoming: ConnectorConfig[]): Promise<ConnectorConfig[]> {
  return persistIncomingConnectors(incoming, false);
}

export function upsertConnectorInput(input: ConnectorUpsertInput): Promise<ConnectorConfig[]> {
  let body: ConnectorUpsertInput;
  try {
    body = decodeUpsertInput(input);
  } catch {
    return Promise.reject(configurationError());
  }
  const connector: ConnectorConfig = {
    id: body.id,
    name: body.name?.trim() || body.id,
    transport: body.transport,
    ...(body.command ? { command: body.command } : {}),
    ...(body.args ? { args: body.args } : {}),
    ...(body.env ? { env: body.env } : {}),
    ...(body.cwd ? { cwd: body.cwd } : {}),
    ...(body.url ? { url: body.url } : {}),
    ...(body.headers ? { headers: body.headers } : {}),
    ...(body.allowTools ? { allowTools: body.allowTools } : {}),
    enabled: body.enabled ?? true,
  };
  return persistIncomingConnectors([connector], true);
}

function persistIncomingConnectors(
  incoming: ConnectorConfig[],
  preserveMaskedSecrets: boolean,
): Promise<ConnectorConfig[]> {
  return withConnectorAccess(async () => {
    const candidates = preserveMaskedSecrets ? incoming : validatedRawConnectors(incoming);
    const connectors = await listConnectors();
    for (const candidate of candidates) {
      const index = connectors.findIndex((entry) => entry.id === candidate.id);
      const existing = index === -1 ? null : connectors[index];
      let connector: ConnectorConfig;
      try {
        connector = protectManagedConnector(
          decodeRawConnector({
            ...candidate,
            env: preserveMaskedSecrets ? mergeSecrets(candidate.env, existing?.env) : candidate.env,
            headers: preserveMaskedSecrets
              ? mergeSecrets(candidate.headers, existing?.headers)
              : candidate.headers,
            cwd: candidate.cwd ?? existing?.cwd,
            allowTools: candidate.allowTools ?? existing?.allowTools,
            origin: candidate.origin ?? existing?.origin,
            auth: candidate.auth ?? existing?.auth,
          }),
        );
      } catch (error) {
        if (error instanceof ConnectorConfigurationError) throw error;
        throw configurationError();
      }
      if (index === -1) connectors.push(connector);
      else connectors[index] = connector;
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
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== CONNECTOR_MASK_TOKEN) {
      result[key] = value;
      continue;
    }
    if (!stored || !Object.hasOwn(stored, key)) throw configurationError();
    const storedValue = stored[key];
    if (storedValue === undefined) throw configurationError();
    result[key] = storedValue;
  }
  return result;
}

const maskRecord = (
  record: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!record) return record;
  return Object.fromEntries(Object.keys(record).map((key) => [key, CONNECTOR_MASK_TOKEN]));
};

export function toConnectorView(connector: ConnectorConfig): ConnectorView {
  return {
    ...connector,
    env: maskRecord(connector.env),
    headers: maskRecord(connector.headers),
    secret_keys: {
      env: Object.keys(connector.env ?? {}).sort(),
      headers: Object.keys(connector.headers ?? {}).sort(),
    },
  };
}

export async function enabledConnectors(): Promise<ConnectorConfig[]> {
  return (await listConnectors()).filter((connector) => connector.enabled);
}

export function hasEnabledConnectorsSync(): boolean {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return false;
  try {
    const parsed = Schema.decodeUnknownSync(
      ConnectorsFileSchema,
      exact,
    )(JSON.parse(readFileSync(file, "utf-8")));
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
