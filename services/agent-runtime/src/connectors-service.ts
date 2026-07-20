import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import {
  CONNECTOR_MASK_TOKEN,
  ConnectorConfigSchema,
  ConnectorUpsertInputSchema,
  ConnectorsFileSchema,
  type ConnectorConfig,
  type ConnectorView,
  type StoredConnectorConfig,
} from "./connector-contract";
import { resolveDataDir } from "./data-dir";
import {
  connectorAuthorizationMatches,
  connectorExecutionMatches,
} from "./connector-configuration";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  googleWorkspaceConnectorAccount,
} from "./google-workspace-binding";
import {
  catalogConnectorConfiguration,
  catalogConnectorMatchesOrigin,
  migrateLegacyCatalogConnector,
} from "./connector-policy";

export {
  type ConnectorAuthReference,
  type ConnectorConfig,
  type ConnectorOrigin,
  type ConnectorView,
} from "./connector-contract";

const CONNECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const CONNECTOR_CONFIGURATION_ERROR = "Connector configuration is invalid";
let connectorAccess = Promise.resolve();

export class ConnectorConfigurationError extends Error {
  readonly status = 409;

  constructor() {
    super(CONNECTOR_CONFIGURATION_ERROR);
    this.name = "ConnectorConfigurationError";
  }
}

type NormalizedConnector = {
  connector: ConnectorConfig;
  migrated: boolean;
};

type ConnectorState = {
  connectors: ConnectorConfig[];
  migrated: boolean;
};

export type ConnectorUpsertInput = typeof ConnectorUpsertInputSchema.Type;
export type ConnectorStateUpdate = {
  expected: ConnectorConfig | null;
  replacement: ConnectorConfig;
};
export type ConnectorStateUpdateResult = {
  connectors: ConnectorConfig[];
  committed: boolean;
};

const exact = { onExcessProperty: "error" } as const;
const decodeRawConnector = Schema.decodeUnknownSync(ConnectorConfigSchema, exact);

function validatedRawConnectors(incoming: readonly ConnectorConfig[]): ConnectorConfig[] {
  try {
    return incoming.map((connector) => decodeRawConnector(connector));
  } catch {
    throw new ConnectorConfigurationError();
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

function normalizedAllowTools(tools: readonly string[] | undefined): string[] {
  return [...new Set((tools ?? []).filter((tool) => tool.length > 0))];
}

export function normalizeStoredConnector(stored: StoredConnectorConfig): NormalizedConnector {
  const explicitGrant = stored.allowTools !== undefined;
  const normalizedTools = normalizedAllowTools(stored.allowTools);
  const executableIdentityComplete =
    stored.transport !== "stdio" || Boolean(stored.origin?.executable);
  const pluginIdentityComplete =
    stored.origin?.kind !== "plugin" ||
    Boolean(
      stored.origin.artifactDigest && stored.origin.inventoryDigest && executableIdentityComplete,
    );
  const permissionReviewed =
    explicitGrant && stored.permissionReviewed !== false && pluginIdentityComplete;
  const allowTools = permissionReviewed ? normalizedTools : [];
  const enabled = stored.enabled && permissionReviewed;
  const normalized: ConnectorConfig = {
    ...stored,
    allowTools,
    permissionReviewed,
    enabled,
  };
  const migratedCatalog =
    normalized.origin?.kind === "catalog" ? migrateLegacyCatalogConnector(normalized) : undefined;
  if (migratedCatalog && migratedCatalog.origin?.id === normalized.origin?.id) {
    return { connector: migratedCatalog, migrated: true };
  }
  const invalidCatalog =
    normalized.origin?.kind === "catalog" && !catalogConnectorMatchesOrigin(normalized);
  if (invalidCatalog) {
    return {
      connector: {
        ...normalized,
        origin: undefined,
        allowTools: [],
        permissionReviewed: false,
        enabled: false,
      },
      migrated: true,
    };
  }
  const catalogConnector = normalized.origin
    ? undefined
    : migrateLegacyCatalogConnector(normalized);
  return {
    connector: catalogConnector ?? normalized,
    migrated:
      !explicitGrant ||
      catalogConnector !== undefined ||
      stored.permissionReviewed !== permissionReviewed ||
      stored.enabled !== enabled ||
      stored.allowTools?.length !== allowTools.length ||
      stored.allowTools?.some((tool, index) => tool !== allowTools[index]) === true,
  };
}

function claimsGoogleWorkspace(connector: ConnectorConfig): boolean {
  return (
    googleWorkspaceConnectorAccount(connector.id) !== null ||
    connector.auth?.provider === "google-workspace" ||
    connector.origin?.binding === "google-workspace"
  );
}

export function protectManagedConnector(connector: ConnectorConfig): ConnectorConfig {
  if (!catalogConnectorMatchesOrigin(connector)) {
    throw new Error(`Catalog connector "${connector.id}" configuration is immutable`);
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
    connector.permissionReviewed &&
    connector.allowTools.length === binding?.observeTools.length &&
    binding?.observeTools.every((tool, index) => connector.allowTools[index] === tool);
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

export function resolveConnectorsFilePath(): string {
  return join(resolveDataDir(), "connectors.json");
}

export const isValidConnectorId = (id: string): boolean => CONNECTOR_ID_PATTERN.test(id);

function normalizeConnectorState(stored: readonly StoredConnectorConfig[]): ConnectorState {
  const normalized = stored.map(normalizeStoredConnector);
  return {
    connectors: normalized.map(({ connector }) => protectManagedConnector(connector)),
    migrated: normalized.some(({ migrated }) => migrated),
  };
}

async function readConnectorState(): Promise<ConnectorState> {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return { connectors: [], migrated: false };
  try {
    const parsed = Schema.decodeUnknownSync(ConnectorsFileSchema)(
      JSON.parse(await readFile(file, "utf-8")),
    );
    return normalizeConnectorState(parsed.connectors ?? []);
  } catch {
    throw new ConnectorConfigurationError();
  }
}

async function writeConnectors(connectors: readonly ConnectorConfig[]): Promise<void> {
  resolveDataDir();
  const file = resolveConnectorsFilePath();
  const configuration = { connectors: connectors.map(protectManagedConnector) };
  try {
    Schema.decodeUnknownSync(ConnectorsFileSchema, exact)(configuration);
  } catch {
    throw new ConnectorConfigurationError();
  }
  const payload = JSON.stringify(configuration, null, 2);
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

export function inspectConnectors(): Promise<ConnectorConfig[]> {
  return withConnectorAccess(async () => (await readConnectorState()).connectors);
}

export function saveConnectors(connectors: ConnectorConfig[]): Promise<void> {
  return withConnectorAccess(() => writeConnectors(connectors));
}

export async function upsertConnector(connector: ConnectorConfig): Promise<ConnectorConfig[]> {
  return upsertConnectors([connector]);
}

function persistIncomingConnectors(incoming: ConnectorConfig[]): Promise<ConnectorConfig[]> {
  return withConnectorAccess(async () => {
    const candidates = validatedRawConnectors(incoming);
    const connectors = await readAndMigrateConnectors();
    for (const candidate of candidates) {
      const connector = protectManagedConnector(candidate);
      const index = connectors.findIndex((entry) => entry.id === connector.id);
      const existing = index === -1 ? null : connectors[index];
      if (existing?.origin?.kind === "catalog" && connector.origin?.kind !== "catalog") {
        throw new Error(`Catalog connector "${connector.id}" configuration is immutable`);
      }
      const stored = protectManagedConnector({
        ...connector,
        cwd: connector.cwd ?? existing?.cwd,
        origin: connector.origin ?? existing?.origin,
        auth: connector.auth ?? existing?.auth,
      });
      if (index === -1) connectors.push(stored);
      else connectors[index] = stored;
    }
    await writeConnectors(connectors);
    return connectors;
  });
}

export function decodeConnectorUpsertPayload(payload: string): ConnectorUpsertInput {
  try {
    return Schema.decodeUnknownSync(ConnectorUpsertInputSchema, exact)(JSON.parse(payload));
  } catch {
    throw new ConnectorConfigurationError();
  }
}

function connectorPermissionReviewed(input: ConnectorUpsertInput): boolean {
  return input.allowTools !== undefined && input.permissionReviewed === true;
}

function customConnectorConfiguration(input: ConnectorUpsertInput): ConnectorConfig {
  if ("catalogId" in input) return catalogConnectorConfiguration(input);
  if (input.transport === "stdio" && !input.command) {
    throw new Error("Command is required for stdio");
  }
  if (input.transport === "http" && !input.url) {
    throw new Error("URL is required for http");
  }
  const permissionReviewed = connectorPermissionReviewed(input);
  if (input.enabled && !permissionReviewed) {
    throw new Error("Review and save an explicit tool grant before enabling");
  }
  return {
    id: input.id,
    name: input.name?.trim() || input.id,
    transport: input.transport,
    ...(input.command ? { command: input.command } : {}),
    ...(input.args ? { args: [...input.args] } : {}),
    ...(input.env ? { env: { ...input.env } } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.headers ? { headers: { ...input.headers } } : {}),
    allowTools: [...(input.allowTools ?? [])],
    permissionReviewed,
    enabled: input.enabled ?? false,
  };
}

export function upsertConnectorInput(input: ConnectorUpsertInput): Promise<ConnectorConfig[]> {
  if (!isValidConnectorId(input.id)) return Promise.reject(new Error("Invalid connector id"));
  return withConnectorAccess(async () => {
    const connectors = await readAndMigrateConnectors();
    const index = connectors.findIndex((entry) => entry.id === input.id);
    const existing = index === -1 ? null : connectors[index];
    const configured =
      "catalogId" in input
        ? catalogConnectorConfiguration({
            ...input,
            env: mergeSecrets(input.env, existing?.env),
          })
        : customConnectorConfiguration(input);
    const merged = {
      ...configured,
      env: mergeSecrets(configured.env, existing?.env),
      headers: mergeSecrets(configured.headers, existing?.headers),
    };
    const pluginCandidate =
      existing?.origin?.kind === "plugin" ? { ...merged, origin: existing.origin } : undefined;
    const incoming =
      pluginCandidate && existing && connectorExecutionMatches(existing, pluginCandidate)
        ? pluginCandidate
        : merged;
    if (existing?.origin?.kind === "catalog" && incoming.origin?.kind !== "catalog") {
      throw new Error(`Catalog connector "${input.id}" configuration is immutable`);
    }
    const connector = protectManagedConnector(incoming);
    if (index === -1) connectors.push(connector);
    else connectors[index] = connector;
    await writeConnectors(connectors);
    return connectors;
  });
}

export function upsertConnectors(incoming: ConnectorConfig[]): Promise<ConnectorConfig[]> {
  return persistIncomingConnectors(incoming);
}

export function replaceConnectorsIfCurrent(
  updates: readonly ConnectorStateUpdate[],
): Promise<ConnectorStateUpdateResult> {
  return withConnectorAccess(async () => {
    const replacements = updates.map(({ expected, replacement }) => {
      if (expected && expected.id !== replacement.id) {
        throw new Error("Connector state update id does not match");
      }
      return { expected, replacement: protectManagedConnector(replacement) };
    });
    const ids = replacements.map(({ replacement }) => replacement.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Connector state update ids must be unique");
    }
    const connectors = await readAndMigrateConnectors();
    const committed = replacements.every(({ expected, replacement }) => {
      const current = connectors.find((connector) => connector.id === replacement.id);
      if (current?.origin?.kind === "catalog" && replacement.origin?.kind !== "catalog") {
        throw new Error(`Catalog connector "${replacement.id}" configuration is immutable`);
      }
      return expected
        ? Boolean(current && connectorAuthorizationMatches(current, expected))
        : current === undefined;
    });
    if (!committed) return { connectors, committed: false };
    for (const { replacement } of replacements) {
      const index = connectors.findIndex((connector) => connector.id === replacement.id);
      if (index === -1) connectors.push(replacement);
      else connectors[index] = replacement;
    }
    if (replacements.length > 0) await writeConnectors(connectors);
    return { connectors, committed: true };
  });
}

export function replaceConnectorIfUnchanged(
  expected: ConnectorConfig,
  replacement: ConnectorConfig,
): Promise<boolean> {
  return withConnectorAccess(async () => {
    const connectors = await readAndMigrateConnectors();
    const index = connectors.findIndex((entry) => entry.id === expected.id);
    const current = connectors[index];
    if (!current || !connectorAuthorizationMatches(current, expected)) return false;
    connectors[index] = protectManagedConnector(replacement);
    await writeConnectors(connectors);
    return true;
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
    if (value !== CONNECTOR_MASK_TOKEN) {
      result[key] = value;
      continue;
    }
    if (!stored || !Object.hasOwn(stored, key)) throw new ConnectorConfigurationError();
    const storedValue = stored[key];
    if (storedValue === undefined) throw new ConnectorConfigurationError();
    result[key] = storedValue;
  }
  return result;
}

function maskRecord(
  record: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return record;
  return Object.fromEntries(Object.keys(record).map((key) => [key, CONNECTOR_MASK_TOKEN]));
}

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
  return (await inspectConnectors()).filter(
    (connector) => connector.enabled && connector.permissionReviewed,
  );
}

export function hasEnabledConnectorsSync(): boolean {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return false;
  try {
    const parsed = Schema.decodeUnknownSync(ConnectorsFileSchema)(
      JSON.parse(readFileSync(file, "utf-8")),
    );
    return normalizeConnectorState(parsed.connectors ?? []).connectors.some(
      (connector) => connector.enabled && connector.permissionReviewed,
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
