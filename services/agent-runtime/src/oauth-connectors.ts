import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import { atomicWriteJson, resolveDataDir } from "./data-dir";
import {
  listConnectors,
  saveConnectors,
  upsertConnector,
  type ConnectorConfig,
} from "./connectors-service";
import {
  oauthConnectorProvider,
  type OAuthConnectorAuthDefinition,
  type OAuthConnectorProvider,
  type OAuthConnectorProviderId,
  type OAuthAuthorizeResponse,
  type OAuthStatusResponse,
} from "./oauth-connector-contract";

/**
 * The generic OAuth engine behind click-to-connect catalog connectors.
 *
 * One flow — device code: the provider hands back a short code the user types
 * into the provider's own site; this process polls the token endpoint until
 * the provider says yes. No secret, no redirect, works for public clients.
 *
 * Tokens land in `<dataDir>/oauth-tokens.json` (0600, atomic replace), keyed
 * by connector id. The refresh token never leaves this file: what a spawned
 * MCP child receives is a fresh access token, injected into the env var the
 * server package already documents, at the moment the pool opens it.
 */

export class OAuthConnectorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type OAuthConnectorDependencies = {
  fetch: typeof fetch;
  now: () => number;
  requestTimeoutMs?: number;
  /** Test seam: endpoint overrides per provider, so no flow touches the real host. */
  definitions?: Partial<Record<OAuthConnectorProviderId, OAuthConnectorAuthDefinition>>;
};

const defaultDependencies: OAuthConnectorDependencies = {
  fetch,
  now: Date.now,
};

const TokenRecordSchema = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.optional(Schema.String),
  /** Epoch ms. Absent for providers whose tokens do not expire (GitHub OAuth apps). */
  expiresAt: Schema.optional(Schema.Number),
  scopes: Schema.Array(Schema.String),
  account: Schema.optional(Schema.String),
  obtainedAt: Schema.String,
});

const StoreSchema = Schema.Struct({
  version: Schema.Literal(1),
  clients: Schema.Record(Schema.String, Schema.Struct({ clientId: Schema.String })),
  tokens: Schema.Record(Schema.String, TokenRecordSchema),
});

type TokenRecord = typeof TokenRecordSchema.Type;
type Store = typeof StoreSchema.Type;

export function resolveOAuthTokensFilePath(): string {
  return path.join(resolveDataDir(), "oauth-tokens.json");
}

const emptyStore = (): Store => ({ version: 1, clients: {}, tokens: {} });

async function readStore(): Promise<Store> {
  const file = resolveOAuthTokensFilePath();
  if (!existsSync(file)) return emptyStore();
  try {
    return Schema.decodeUnknownSync(StoreSchema)(JSON.parse(await readFile(file, "utf8")));
  } catch {
    throw new OAuthConnectorError(500, "OAuth token store is invalid");
  }
}

function writeStore(store: Store): Promise<void> {
  return atomicWriteJson(resolveOAuthTokensFilePath(), store, { mode: 0o600 });
}

// One writer at a time. A device poll finishing while a disconnect runs must
// not interleave read-modify-write cycles on the same file.
let storeAccess = Promise.resolve();

function withStoreAccess<A>(operation: () => Promise<A>): Promise<A> {
  const result = storeAccess.then(operation);
  storeAccess = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function updateStore(mutate: (store: Store) => Store): Promise<Store> {
  return withStoreAccess(async () => {
    const next = mutate(await readStore());
    await writeStore(next);
    return next;
  });
}

/**
 * A provider definition with test overrides applied. Everything below resolves
 * endpoints through this, so a test can stand up a fake provider without any
 * code path knowing the difference.
 */
function definitionFor(
  provider: OAuthConnectorProvider,
  dependencies: OAuthConnectorDependencies,
): OAuthConnectorAuthDefinition {
  return dependencies.definitions?.[provider.id] ?? provider.auth;
}

function requireProvider(connectorId: string): OAuthConnectorProvider {
  const provider = oauthConnectorProvider(connectorId);
  if (!provider) {
    throw new OAuthConnectorError(404, `"${connectorId}" is not an OAuth-capable connector`);
  }
  return provider;
}

async function resolveClientId(
  provider: OAuthConnectorProvider,
  definition: OAuthConnectorAuthDefinition,
): Promise<string | null> {
  const fromEnv = process.env[definition.clientIdEnv]?.trim();
  if (fromEnv) return fromEnv;
  const stored = (await readStore()).clients[provider.id]?.clientId?.trim();
  if (stored) return stored;
  return definition.clientId ?? null;
}

function requestSignal(dependencies: OAuthConnectorDependencies): AbortSignal {
  return AbortSignal.timeout(dependencies.requestTimeoutMs ?? 15_000);
}

async function postForm(
  url: string,
  body: Record<string, string>,
  dependencies: OAuthConnectorDependencies,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await dependencies.fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
      signal: requestSignal(dependencies),
    });
  } catch {
    throw new OAuthConnectorError(502, "The OAuth provider could not be reached");
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!parsed || typeof parsed !== "object") {
    throw new OAuthConnectorError(502, "The OAuth provider returned an unreadable response");
  }
  return parsed as Record<string, unknown>;
}

const readString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const readNumber = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** GitHub separates scopes with commas, RFC 8693 with spaces; accept both. */
const parseScopes = (raw: string | null, requested: readonly string[]): string[] => {
  const scopes = raw?.split(/[\s,]+/).filter(Boolean) ?? [];
  return scopes.length ? scopes : [...requested];
};

async function fetchAccountName(
  definition: OAuthConnectorAuthDefinition,
  accessToken: string,
  dependencies: OAuthConnectorDependencies,
): Promise<string | null> {
  try {
    const response = await dependencies.fetch(definition.identityUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        // GitHub's API rejects requests without one.
        "user-agent": "local-studio",
      },
      signal: requestSignal(dependencies),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== "object") return null;
    return readString(body as Record<string, unknown>, definition.identityField);
  } catch {
    // The token works even when the identity lookup does not; a connection
    // without a display name beats a failed connect.
    return null;
  }
}

function tokenRecordFrom(
  body: Record<string, unknown>,
  definition: OAuthConnectorAuthDefinition,
  account: string | null,
  dependencies: OAuthConnectorDependencies,
): TokenRecord {
  const accessToken = readString(body, "access_token");
  if (!accessToken) {
    throw new OAuthConnectorError(502, "The OAuth provider returned no access token");
  }
  const expiresIn = readNumber(body, "expires_in");
  const refreshToken = readString(body, "refresh_token");
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresIn ? { expiresAt: dependencies.now() + expiresIn * 1000 } : {}),
    scopes: parseScopes(readString(body, "scope"), definition.scopes),
    ...(account ? { account } : {}),
    obtainedAt: new Date(dependencies.now()).toISOString(),
  };
}

/**
 * The moment a flow succeeds: persist the grant, then rewrite the connector
 * row so the pool can find it. The row deliberately loses any stored value
 * under `tokenEnv` — the whole point is that the env var is filled with a
 * fresh token at spawn, not read from a file that would go stale.
 */
async function commitConnection(
  provider: OAuthConnectorProvider,
  record: TokenRecord,
): Promise<void> {
  await updateStore((store) => ({
    ...store,
    tokens: { ...store.tokens, [provider.id]: record },
  }));
  const existing = (await listConnectors()).find((entry) => entry.id === provider.id);
  const cleanedEnv = { ...existing?.env };
  delete cleanedEnv[provider.auth.tokenEnv];
  const cleanedFlags = { ...existing?.envSecret };
  delete cleanedFlags[provider.auth.tokenEnv];
  const connector: ConnectorConfig = {
    id: provider.id,
    name: record.account ? `${provider.name} · ${record.account}` : provider.name,
    transport: "stdio",
    command: provider.connector.command,
    args: [...provider.connector.args],
    ...(Object.keys(cleanedEnv).length ? { env: cleanedEnv } : {}),
    ...(Object.keys(cleanedFlags).length ? { envSecret: cleanedFlags } : {}),
    auth: {
      type: "oauth",
      provider: provider.id,
      account: record.account ?? provider.id,
    },
    // Connecting grants access; running the MCP server stays a separate,
    // deliberate act, same as every other new connector row.
    enabled: existing?.enabled ?? false,
  };
  await upsertConnector(connector);
}

type ActiveFlow = {
  id: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  controller: AbortController;
  /** Resolves when the background half of the flow stops, however it stops. */
  settled: Promise<void>;
};

const activeFlows = new Map<string, ActiveFlow>();
const lastFlowErrors = new Map<string, string>();

function closeFlow(connectorId: string, expectedId?: string): void {
  const flow = activeFlows.get(connectorId);
  if (!flow || (expectedId && flow.id !== expectedId)) return;
  activeFlows.delete(connectorId);
  flow.controller.abort();
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function pollDeviceGrant(
  provider: OAuthConnectorProvider,
  definition: OAuthConnectorAuthDefinition,
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresAt: number,
  flow: ActiveFlow,
  dependencies: OAuthConnectorDependencies,
): Promise<void> {
  let intervalMs = Math.max(0, intervalSeconds) * 1000;
  while (dependencies.now() < expiresAt) {
    await sleep(intervalMs, flow.controller.signal);
    if (flow.controller.signal.aborted) return;
    const body = await postForm(
      definition.tokenUrl,
      {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
      dependencies,
    );
    const error = readString(body, "error");
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      // RFC 8628: every slow_down adds 5 seconds to the interval, permanently.
      intervalMs += 5000;
      continue;
    }
    if (error === "access_denied") {
      throw new OAuthConnectorError(403, "The sign-in was declined");
    }
    if (error === "expired_token") break;
    if (error) throw new OAuthConnectorError(502, `The OAuth provider failed: ${error}`);
    const accessToken = readString(body, "access_token");
    if (!accessToken) {
      throw new OAuthConnectorError(502, "The OAuth provider returned no access token");
    }
    if (flow.controller.signal.aborted) return;
    const account = await fetchAccountName(definition, accessToken, dependencies);
    if (flow.controller.signal.aborted) return;
    await commitConnection(provider, tokenRecordFrom(body, definition, account, dependencies));
    return;
  }
  throw new OAuthConnectorError(408, "The sign-in code expired before it was used");
}

async function beginDeviceAuthorization(
  provider: OAuthConnectorProvider,
  definition: OAuthConnectorAuthDefinition,
  clientId: string,
  dependencies: OAuthConnectorDependencies,
): Promise<OAuthAuthorizeResponse> {
  if (!definition.deviceUrl) {
    throw new OAuthConnectorError(500, `${provider.name} has no device authorization endpoint`);
  }
  const body = await postForm(
    definition.deviceUrl,
    { client_id: clientId, scope: definition.scopes.join(" ") },
    dependencies,
  );
  const deviceCode = readString(body, "device_code");
  const userCode = readString(body, "user_code");
  const verificationUri = readString(body, "verification_uri");
  if (!deviceCode || !userCode || !verificationUri) {
    const error = readString(body, "error");
    throw new OAuthConnectorError(
      502,
      error
        ? `${provider.name} refused the sign-in request: ${error}`
        : `${provider.name} returned an invalid device authorization`,
    );
  }
  const expiresAt = dependencies.now() + (readNumber(body, "expires_in") ?? 900) * 1000;
  const controller = new AbortController();
  const flow: ActiveFlow = {
    id: randomUUID(),
    userCode,
    verificationUri,
    expiresAt,
    controller,
    settled: Promise.resolve(),
  };
  flow.settled = pollDeviceGrant(
    provider,
    definition,
    clientId,
    deviceCode,
    readNumber(body, "interval") ?? 5,
    expiresAt,
    flow,
    dependencies,
  )
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      lastFlowErrors.set(
        provider.id,
        error instanceof Error ? error.message : "The sign-in failed",
      );
    })
    .finally(() => closeFlow(provider.id, flow.id));
  activeFlows.set(provider.id, flow);
  return { flow: "device", userCode, verificationUri, expiresAt };
}

export async function beginOAuthConnectorAuthorization(
  connectorId: string,
  dependencies: OAuthConnectorDependencies = defaultDependencies,
): Promise<OAuthAuthorizeResponse> {
  const provider = requireProvider(connectorId);
  const definition = definitionFor(provider, dependencies);
  const clientId = await resolveClientId(provider, definition);
  if (!clientId) {
    throw new OAuthConnectorError(409, `Register an OAuth client for ${provider.name} first`);
  }
  closeFlow(provider.id);
  lastFlowErrors.delete(provider.id);
  return beginDeviceAuthorization(provider, definition, clientId, dependencies);
}

export function cancelOAuthConnectorAuthorization(connectorId: string): void {
  requireProvider(connectorId);
  closeFlow(connectorId);
  lastFlowErrors.delete(connectorId);
}

/** Test seam: the background half of the active flow, so tests can await it. */
export function oauthConnectorFlowSettled(connectorId: string): Promise<void> {
  return activeFlows.get(connectorId)?.settled ?? Promise.resolve();
}

export async function saveOAuthConnectorClient(
  connectorId: string,
  clientId: string,
): Promise<void> {
  const provider = requireProvider(connectorId);
  const trimmed = clientId.trim();
  if (!trimmed) throw new OAuthConnectorError(400, "Client ID is required");
  closeFlow(provider.id);
  await updateStore((store) => {
    const replacingClient = store.clients[provider.id]?.clientId !== trimmed;
    const tokens = { ...store.tokens };
    // A token minted by one client is meaningless under another; keeping it
    // would report "connected" while every refresh and every call fails.
    if (replacingClient) delete tokens[provider.id];
    return {
      ...store,
      clients: { ...store.clients, [provider.id]: { clientId: trimmed } },
      tokens,
    };
  });
}

export async function getOAuthConnectorStatus(
  connectorId: string,
  dependencies: OAuthConnectorDependencies = defaultDependencies,
): Promise<OAuthStatusResponse> {
  const provider = requireProvider(connectorId);
  const definition = definitionFor(provider, dependencies);
  const clientId = await resolveClientId(provider, definition);
  const record = (await readStore()).tokens[provider.id] ?? null;
  const flow = activeFlows.get(provider.id);
  const pending = flow
    ? {
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        expiresAt: flow.expiresAt,
      }
    : null;
  return {
    connectorId: provider.id,
    configured: Boolean(clientId),
    clientId,
    connected: Boolean(record),
    account: record?.account ?? null,
    expiresAt: record?.expiresAt ?? null,
    scopes: record?.scopes ?? [],
    pending,
    error: lastFlowErrors.get(provider.id) ?? null,
  };
}

export async function disconnectOAuthConnector(
  connectorId: string,
): Promise<OAuthStatusResponse> {
  const provider = requireProvider(connectorId);
  closeFlow(provider.id);
  lastFlowErrors.delete(provider.id);
  // GitHub only exposes grant revocation to confidential clients (HTTP basic
  // auth with the client secret); a public device-flow client has no secret to
  // present, so the honest disconnect is to destroy the local grant and stop
  // offering the tools.
  await updateStore((store) => {
    const tokens = { ...store.tokens };
    delete tokens[provider.id];
    return { ...store, tokens };
  });
  // Not `upsertConnector`: its merge hands the stored `auth` back when the
  // incoming row omits it, which is exactly the field a disconnect must clear.
  const connectors = await listConnectors();
  const index = connectors.findIndex((entry) => entry.id === provider.id);
  const existing = index === -1 ? undefined : connectors[index];
  if (existing) {
    const { auth: _auth, ...withoutAuth } = existing;
    connectors[index] = { ...withoutAuth, name: provider.name, enabled: false };
    await saveConnectors(connectors);
  }
  return getOAuthConnectorStatus(connectorId);
}

/**
 * The access token a spawn should carry, refreshed first when it is about to
 * expire. Serialized behind the store mutex so two connectors spawning at once
 * cannot both burn the same refresh token.
 */
export function freshOAuthConnectorAccessToken(
  connectorId: string,
  dependencies: OAuthConnectorDependencies = defaultDependencies,
): Promise<string> {
  const provider = requireProvider(connectorId);
  const definition = definitionFor(provider, dependencies);
  return withStoreAccess(async () => {
    const store = await readStore();
    const record = store.tokens[provider.id];
    if (!record) {
      throw new OAuthConnectorError(401, `${provider.name} is not connected`);
    }
    const expiringSoon =
      record.expiresAt !== undefined && record.expiresAt <= dependencies.now() + 60_000;
    if (!expiringSoon) return record.accessToken;
    if (!record.refreshToken) {
      throw new OAuthConnectorError(
        401,
        `The ${provider.name} connection expired; connect it again`,
      );
    }
    const clientId = await resolveClientId(provider, definition);
    if (!clientId) {
      throw new OAuthConnectorError(409, `Register an OAuth client for ${provider.name} first`);
    }
    const body = await postForm(
      definition.tokenUrl,
      {
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: record.refreshToken,
      },
      dependencies,
    );
    if (readString(body, "error")) {
      throw new OAuthConnectorError(
        401,
        `The ${provider.name} connection expired; connect it again`,
      );
    }
    const refreshed: TokenRecord = {
      ...tokenRecordFrom(body, definition, record.account ?? null, dependencies),
      // Some providers rotate the refresh token on every use, some omit it
      // from the refresh response; only a returned one replaces the stored one.
      ...(readString(body, "refresh_token") ? {} : { refreshToken: record.refreshToken }),
    };
    await writeStore({
      ...store,
      tokens: { ...store.tokens, [provider.id]: refreshed },
    });
    return refreshed.accessToken;
  });
}

/**
 * What the connector pool merges into a stdio child's environment: the token
 * env var and nothing else. Only a row whose id IS the provider id gets the
 * injection — a hand-edited row claiming `auth.provider: "github"` under some
 * other id names a grant it does not own and receives nothing.
 */
export async function oauthConnectorSpawnEnv(
  connector: ConnectorConfig,
  dependencies: OAuthConnectorDependencies = defaultDependencies,
): Promise<Record<string, string>> {
  const provider = oauthConnectorProvider(connector.id);
  if (!provider) return {};
  if (connector.auth?.type !== "oauth" || connector.auth.provider !== provider.id) return {};
  const definition = definitionFor(provider, dependencies);
  const token = await freshOAuthConnectorAccessToken(connector.id, dependencies);
  return { [definition.tokenEnv]: token };
}
