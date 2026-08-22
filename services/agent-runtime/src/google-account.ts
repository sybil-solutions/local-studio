import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Schema, Semaphore } from "effect";
import type { McpConnection } from "./mcp-client";
import { listConnectors, upsertConnectors } from "./connectors-service";
import { atomicWriteJson, resolveDataDir } from "./data-dir";
import { createGoogleRestConnection } from "./google-rest-adapter";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  GOOGLE_WORKSPACE_PLUGIN_IDS,
  googleWorkspaceConnectorIdentity,
  type GoogleWorkspaceIdentity,
  type GoogleWorkspacePluginId,
} from "./google-workspace-binding";
import { desktopOAuthVault, type OAuthVault } from "./oauth-vault";
import type { GoogleAccountView, GoogleConnectionView } from "./google-account-contract";

export type { GoogleAccountView, GoogleConnectionView } from "./google-account-contract";

const ConnectionSchema = Schema.Struct({
  scopes: Schema.Array(Schema.String),
  endpoint: Schema.String,
  /** Written by retired builds that had a second transport; decoded and ignored. */
  transport: Schema.optional(Schema.String),
  connectedAt: Schema.String,
  revision: Schema.optional(Schema.String),
});

const ConnectionsSchema = Schema.Struct({
  gmail: Schema.optional(ConnectionSchema),
  "google-calendar": Schema.optional(ConnectionSchema),
});

const AccountRecordSchema = Schema.Struct({
  email: Schema.String,
  connections: ConnectionsSchema,
});

const MetadataSchema = Schema.Struct({
  version: Schema.Literal(2),
  clientId: Schema.String,
  hasClientSecret: Schema.Boolean,
  accounts: Schema.Record(Schema.String, AccountRecordSchema),
});

/** Single-account layout written before accounts were keyed by mailbox. */
const LegacyConnectionSchema = Schema.Struct({
  email: Schema.String,
  scopes: Schema.Array(Schema.String),
  resource: Schema.String,
  connectedAt: Schema.String,
});

const LegacyMetadataSchema = Schema.Struct({
  clientId: Schema.String,
  hasClientSecret: Schema.Boolean,
  connections: Schema.Struct({
    gmail: Schema.optional(LegacyConnectionSchema),
    "google-calendar": Schema.optional(LegacyConnectionSchema),
  }),
});

const StoredMetadataSchema = Schema.Union([MetadataSchema, LegacyMetadataSchema]);

const AccountTokensSchema = Schema.Struct({
  gmail: Schema.optional(Schema.String),
  "google-calendar": Schema.optional(Schema.String),
});

const SecretsSchema = Schema.Struct({
  version: Schema.Literal(2),
  clientSecret: Schema.optional(Schema.String),
  refreshTokens: Schema.Record(Schema.String, AccountTokensSchema),
  pendingRevocations: Schema.optional(Schema.Array(Schema.String)),
});

const LegacySecretsSchema = Schema.Struct({
  clientSecret: Schema.optional(Schema.String),
  refreshTokens: AccountTokensSchema,
  pendingRevocations: Schema.optional(Schema.Array(Schema.String)),
});

const StoredSecretsSchema = Schema.Union([SecretsSchema, LegacySecretsSchema]);

const PendingSchema = Schema.Struct({
  service: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
  clientId: Schema.String,
  flowId: Schema.String,
  state: Schema.String,
  verifier: Schema.String,
  redirectUri: Schema.String,
  /** Written by retired builds that had a second transport; decoded and ignored. */
  transport: Schema.optional(Schema.String),
  expiresAt: Schema.Number,
});

const TokenResponseSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.optional(Schema.Number),
  refresh_token: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
});

const UserInfoSchema = Schema.Struct({ email: Schema.String });

type Connection = typeof ConnectionSchema.Type;
type AccountRecord = typeof AccountRecordSchema.Type;
type Metadata = typeof MetadataSchema.Type;
type Secrets = typeof SecretsSchema.Type;
type AccountTokens = typeof AccountTokensSchema.Type;
type Pending = typeof PendingSchema.Type;
type TokenResponse = typeof TokenResponseSchema.Type;

export type GoogleOAuthDependencies = {
  fetch: typeof fetch;
  now: () => number;
  random: (size: number) => Buffer;
  requestTimeoutMs?: number;
  verifyAccess: (
    service: GoogleWorkspacePluginId,
    accessToken: string,
    signal: AbortSignal,
  ) => Promise<void>;
};

export class GoogleAccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const defaultDependencies: GoogleOAuthDependencies = {
  fetch,
  now: Date.now,
  random: randomBytes,
  verifyAccess: verifyGoogleWorkspaceAccess,
};

const secretsKey = "google-workspace";
const accessTokens = new Map<string, { value: string; expiresAt: number }>();
const authorizationFlows = new Map<
  GoogleWorkspacePluginId,
  { id: string; controller: AbortController }
>();
const accountMutation = Semaphore.makeUnsafe(1);
const authorizationLifecycle = Semaphore.makeUnsafe(1);

/**
 * Accounts are keyed by a digest of the verified mailbox, not by the address:
 * the key ends up in connector ids and permission grants, where a raw email
 * would both break the id charset and leak the mailbox into tool names.
 */
export function googleAccountKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 10);
}

function tokenCacheKey(identity: GoogleWorkspaceIdentity): string {
  return `${identity.accountKey}:${identity.service}`;
}

export function createGoogleAuthorizationFlow(service: GoogleWorkspacePluginId): string {
  authorizationFlows.get(service)?.controller.abort();
  const flowId = randomUUID();
  authorizationFlows.set(service, { id: flowId, controller: new AbortController() });
  return flowId;
}

function invalidateGoogleWorkspaceAuthorizations(): void {
  GOOGLE_WORKSPACE_PLUGIN_IDS.forEach(createGoogleAuthorizationFlow);
}

function ownsGoogleAuthorizationFlow(service: GoogleWorkspacePluginId, flowId: string): boolean {
  return authorizationFlows.get(service)?.id === flowId;
}

function googleAuthorizationFlowSignal(
  service: GoogleWorkspacePluginId,
  flowId: string,
): AbortSignal {
  const flow = authorizationFlows.get(service);
  if (flow?.id !== flowId) throw authorizationFlowError();
  return flow.controller.signal;
}

function authorizationFlowError(): GoogleAccountError {
  return new GoogleAccountError(409, "Google sign-in was cancelled or replaced");
}

function requireGoogleAuthorizationFlow(
  service: GoogleWorkspacePluginId,
  flowId: string,
): Effect.Effect<void, GoogleAccountError> {
  return ownsGoogleAuthorizationFlow(service, flowId)
    ? Effect.void
    : Effect.fail(authorizationFlowError());
}

export function resolveGoogleAccountFilePath(): string {
  return path.join(resolveDataDir(), "google-account.json");
}

function pendingKey(service: GoogleWorkspacePluginId): string {
  return `google-workspace-pending:${service}`;
}

/**
 * Reads either storage layout and always hands back the keyed one. The legacy
 * record carried one mailbox per service, so its account key is recoverable
 * from the stored email; nothing needs a migration pass on disk because the
 * next write emits the current layout.
 */
function normalizeMetadata(stored: typeof StoredMetadataSchema.Type): Metadata {
  if ("accounts" in stored) return stored;
  const accounts: Record<string, AccountRecord> = {};
  for (const service of GOOGLE_WORKSPACE_PLUGIN_IDS) {
    const legacy = stored.connections[service];
    if (!legacy) continue;
    const key = googleAccountKey(legacy.email);
    const existing = accounts[key] ?? { email: legacy.email, connections: {} };
    accounts[key] = {
      email: existing.email,
      connections: {
        ...existing.connections,
        [service]: {
          scopes: legacy.scopes,
          endpoint: legacy.resource,
          connectedAt: legacy.connectedAt,
        },
      },
    };
  }
  return {
    version: 2,
    clientId: stored.clientId,
    hasClientSecret: stored.hasClientSecret,
    accounts,
  };
}

function normalizeSecrets(
  stored: typeof StoredSecretsSchema.Type,
  metadata: Metadata | null,
): Secrets {
  if ("version" in stored) return stored;
  const refreshTokens: Record<string, AccountTokens> = {};
  for (const service of GOOGLE_WORKSPACE_PLUGIN_IDS) {
    const token = stored.refreshTokens[service];
    if (!token) continue;
    // A legacy token names a service, not a mailbox. The only place the mailbox
    // survives is the metadata connection for that same service; without it the
    // token cannot be attributed to an account and is dropped rather than being
    // handed to the wrong one.
    const key = Object.keys(metadata?.accounts ?? {}).find(
      (candidate) => metadata?.accounts[candidate]?.connections[service],
    );
    if (!key) continue;
    refreshTokens[key] = { ...refreshTokens[key], [service]: token };
  }
  return {
    version: 2,
    ...(stored.clientSecret ? { clientSecret: stored.clientSecret } : {}),
    refreshTokens,
    pendingRevocations: [...(stored.pendingRevocations ?? [])],
  };
}

async function readMetadata(): Promise<Metadata | null> {
  const file = resolveGoogleAccountFilePath();
  if (!existsSync(file)) return null;
  try {
    return normalizeMetadata(
      Schema.decodeUnknownSync(StoredMetadataSchema)(JSON.parse(await readFile(file, "utf8"))),
    );
  } catch {
    throw new GoogleAccountError(500, "Google account metadata is invalid");
  }
}

function writeMetadata(metadata: Metadata): Promise<void> {
  return atomicWriteJson(resolveGoogleAccountFilePath(), metadata, { mode: 0o600 });
}

function metadataEffect(): Effect.Effect<Metadata | null, GoogleAccountError> {
  return Effect.tryPromise({
    try: readMetadata,
    catch: (error) =>
      error instanceof GoogleAccountError
        ? error
        : new GoogleAccountError(500, "Google account metadata failed"),
  });
}

function writeMetadataEffect(metadata: Metadata): Effect.Effect<void, GoogleAccountError> {
  return Effect.tryPromise({
    try: () => writeMetadata(metadata),
    catch: () => new GoogleAccountError(500, "Google account metadata could not be saved"),
  });
}

function vaultError(): GoogleAccountError {
  return new GoogleAccountError(503, "Secure OAuth storage is unavailable");
}

function readVaultJson<A>(
  vault: OAuthVault,
  key: string,
  decode: (input: unknown) => A,
): Effect.Effect<A | null, GoogleAccountError> {
  return vault.read(key).pipe(
    Effect.mapError(vaultError),
    Effect.flatMap((raw) => {
      if (!raw) return Effect.succeed(null);
      return Effect.try({
        try: () => decode(JSON.parse(raw)),
        catch: () => new GoogleAccountError(500, "Secure OAuth record is invalid"),
      });
    }),
  );
}

function writeVaultJson(
  vault: OAuthVault,
  key: string,
  value: unknown,
): Effect.Effect<void, GoogleAccountError> {
  return vault.write(key, JSON.stringify(value)).pipe(Effect.mapError(vaultError));
}

function removeVaultValue(vault: OAuthVault, key: string): Effect.Effect<void, GoogleAccountError> {
  return vault.remove(key).pipe(Effect.mapError(vaultError));
}

function emptySecrets(): Secrets {
  return { version: 2, refreshTokens: {}, pendingRevocations: [] };
}

function secretsEffect(
  vault: OAuthVault,
  metadata: Metadata | null,
): Effect.Effect<Secrets, GoogleAccountError> {
  return readVaultJson(vault, secretsKey, Schema.decodeUnknownSync(StoredSecretsSchema)).pipe(
    Effect.map((stored) => (stored ? normalizeSecrets(stored, metadata) : emptySecrets())),
  );
}

function connectionView(connection?: Connection): GoogleConnectionView {
  return {
    connected: Boolean(connection),
    scopes: connection?.scopes ?? [],
    endpoint: connection?.endpoint ?? "",
    connectedAt: connection?.connectedAt ?? null,
  };
}

function accountView(metadata: Metadata | null): GoogleAccountView {
  const accounts = Object.entries(metadata?.accounts ?? {})
    .map(([key, record]) => ({
      key,
      email: record.email,
      connections: {
        gmail: connectionView(record.connections.gmail),
        "google-calendar": connectionView(record.connections["google-calendar"]),
      },
    }))
    .sort((left, right) => left.email.localeCompare(right.email));
  return {
    configured: Boolean(metadata?.clientId),
    clientId: metadata?.clientId ?? null,
    hasClientSecret: metadata?.hasClientSecret ?? false,
    accounts,
  };
}

export function getGoogleAccount(): Effect.Effect<GoogleAccountView, GoogleAccountError> {
  return metadataEffect().pipe(Effect.map(accountView));
}

/** Every refresh token this client has ever stored, deduplicated. */
function storedRefreshTokens(secrets: Secrets): string[] {
  const tokens = Object.values(secrets.refreshTokens).flatMap((entry) =>
    GOOGLE_WORKSPACE_PLUGIN_IDS.flatMap((service) => {
      const token = entry[service];
      return token ? [token] : [];
    }),
  );
  return [...new Set(tokens)];
}

export function saveGoogleClient(
  input: { clientId: string; clientSecret?: string },
  vault: OAuthVault = desktopOAuthVault,
  dependencies: GoogleOAuthDependencies = defaultDependencies,
): Effect.Effect<GoogleAccountView, GoogleAccountError> {
  return authorizationLifecycle.withPermit(
    accountMutation.withPermit(
      Effect.gen(function* () {
        const clientId = input.clientId.trim();
        const incomingSecret = input.clientSecret?.trim();
        if (!clientId)
          return yield* Effect.fail(new GoogleAccountError(400, "Client ID is required"));
        yield* retryPendingGoogleRevocations(vault, dependencies);
        const current = yield* metadataEffect();
        const currentSecrets = yield* secretsEffect(vault, current);
        const sameClient = current?.clientId === clientId;
        if (!sameClient) {
          // Every account was granted to the outgoing client, so every grant has
          // to be handed back — revoking only the first one (the previous
          // behaviour) orphaned the rest at Google with no way to reach them.
          yield* Effect.forEach(storedRefreshTokens(currentSecrets), (token) =>
            promiseEffect(() => revokeGoogleGrant(token, dependencies)),
          );
          invalidateGoogleWorkspaceAuthorizations();
          accessTokens.clear();
          yield* disableGoogleWorkspaceConnectors();
          if (current) yield* writeMetadataEffect({ ...current, accounts: {} });
        }
        const secrets: Secrets = {
          version: 2,
          ...(incomingSecret
            ? { clientSecret: incomingSecret }
            : sameClient && currentSecrets.clientSecret
              ? { clientSecret: currentSecrets.clientSecret }
              : {}),
          refreshTokens: sameClient ? currentSecrets.refreshTokens : {},
          pendingRevocations: pendingRevocations(currentSecrets),
        };
        const metadata: Metadata = {
          version: 2,
          clientId,
          hasClientSecret: Boolean(secrets.clientSecret),
          accounts: sameClient ? (current?.accounts ?? {}) : {},
        };
        if (!sameClient) {
          invalidateGoogleWorkspaceAuthorizations();
          yield* Effect.forEach(GOOGLE_WORKSPACE_PLUGIN_IDS, (id) =>
            removeVaultValue(vault, pendingKey(id)),
          );
        }
        yield* writeVaultJson(vault, secretsKey, secrets);
        yield* writeMetadataEffect(metadata);
        accessTokens.clear();
        if (!sameClient) yield* disableGoogleWorkspaceConnectors();
        return accountView(metadata);
      }),
    ),
  );
}

function loopbackRedirect(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/callback") {
    throw new GoogleAccountError(400, "Google sign-in requires a private loopback callback");
  }
  return url.toString();
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function beginGoogleAuthorization(
  service: GoogleWorkspacePluginId,
  redirectUri: string,
  dependencies: GoogleOAuthDependencies = defaultDependencies,
  vault: OAuthVault = desktopOAuthVault,
  requestedFlowId?: string,
): Effect.Effect<{ authorizationUrl: string }, GoogleAccountError> {
  return Effect.suspend(() => {
    const flowId = requestedFlowId ?? createGoogleAuthorizationFlow(service);
    return accountMutation.withPermit(
      Effect.gen(function* () {
        yield* requireGoogleAuthorizationFlow(service, flowId);
        yield* retryPendingGoogleRevocations(vault, dependencies);
        yield* requireGoogleAuthorizationFlow(service, flowId);
        const metadata = yield* metadataEffect();
        if (!metadata?.clientId) {
          return yield* Effect.fail(
            new GoogleAccountError(409, "Configure a Google OAuth client first"),
          );
        }
        const binding = GOOGLE_WORKSPACE_BINDINGS[service];
        const verifier = dependencies.random(64).toString("base64url");
        const pending: Pending = {
          service,
          clientId: metadata.clientId,
          flowId,
          state: dependencies.random(32).toString("base64url"),
          verifier,
          redirectUri: loopbackRedirect(redirectUri),
          expiresAt: dependencies.now() + 10 * 60 * 1000,
        };
        yield* writeVaultJson(vault, pendingKey(service), pending);
        if (!ownsGoogleAuthorizationFlow(service, flowId)) {
          yield* removeVaultValue(vault, pendingKey(service));
          return yield* Effect.fail(authorizationFlowError());
        }
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = new URLSearchParams({
          client_id: metadata.clientId,
          redirect_uri: pending.redirectUri,
          response_type: "code",
          scope: ["openid", "email", ...binding.scopes].join(" "),
          state: pending.state,
          code_challenge: codeChallenge(verifier),
          code_challenge_method: "S256",
          access_type: "offline",
          // Without `select_account` Google silently reuses whichever session the
          // browser already has, so a second mailbox can never be added.
          prompt: "select_account consent",
          include_granted_scopes: "true",
        }).toString();
        return { authorizationUrl: url.toString() };
      }),
    );
  });
}

export function cancelGoogleAuthorization(
  service: GoogleWorkspacePluginId,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<void, GoogleAccountError> {
  return Effect.suspend(() => {
    const cancellationId = createGoogleAuthorizationFlow(service);
    return authorizationLifecycle.withPermit(
      accountMutation.withPermit(
        ownsGoogleAuthorizationFlow(service, cancellationId)
          ? removeVaultValue(vault, pendingKey(service))
          : Effect.void,
      ),
    );
  });
}

function googleRequestSignal(
  dependencies: GoogleOAuthDependencies,
  cancellation?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(dependencies.requestTimeoutMs ?? 15_000);
  return cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;
}

async function exchangeAuthorizationCode(
  metadata: Metadata,
  secrets: Secrets,
  pending: Pending,
  code: string,
  dependencies: GoogleOAuthDependencies,
  cancellation: AbortSignal,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: metadata.clientId,
    code,
    code_verifier: pending.verifier,
    grant_type: "authorization_code",
    redirect_uri: pending.redirectUri,
    ...(secrets.clientSecret ? { client_secret: secrets.clientSecret } : {}),
  });
  const response = await dependencies.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: googleRequestSignal(dependencies, cancellation),
  });
  if (!response.ok) throw new GoogleAccountError(502, "Google rejected the authorization code");
  try {
    return Schema.decodeUnknownSync(TokenResponseSchema)(await response.json());
  } catch {
    throw new GoogleAccountError(502, "Google returned an invalid token response");
  }
}

async function verifiedEmail(
  accessToken: string,
  dependencies: GoogleOAuthDependencies,
  cancellation: AbortSignal,
): Promise<string> {
  const response = await dependencies.fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: googleRequestSignal(dependencies, cancellation),
  });
  if (!response.ok) throw new GoogleAccountError(502, "Google account verification failed");
  try {
    return Schema.decodeUnknownSync(UserInfoSchema)(await response.json()).email;
  } catch {
    throw new GoogleAccountError(502, "Google returned an invalid account profile");
  }
}

export function googleWorkspaceConnection(input: {
  service: GoogleWorkspacePluginId;
  authorize: (forceRefresh: boolean) => Promise<Record<string, string>>;
  signal?: AbortSignal;
}): McpConnection {
  return createGoogleRestConnection({
    service: input.service,
    authorize: input.authorize,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

async function verifyGoogleWorkspaceAccess(
  service: GoogleWorkspacePluginId,
  accessToken: string,
  signal: AbortSignal,
): Promise<void> {
  const binding = GOOGLE_WORKSPACE_BINDINGS[service];
  const connection = googleWorkspaceConnection({
    service,
    authorize: () => Promise.resolve({ Authorization: `Bearer ${accessToken}` }),
    signal,
  });
  try {
    const tool = (await connection.listTools()).find(
      (candidate) => candidate.name === binding.verifyTool,
    );
    if (tool?.annotations?.readOnlyHint !== true) {
      throw new GoogleAccountError(502, "Google read-only tool contract could not be verified");
    }
    const result = await connection.callTool(binding.verifyTool, {});
    if (result !== null && typeof result === "object" && Reflect.get(result, "isError") === true) {
      throw new GoogleAccountError(502, "Google read-only access could not be verified");
    }
  } finally {
    connection.close();
  }
}

function grantedScopes(service: GoogleWorkspacePluginId, token: TokenResponse): string[] {
  const scopes = token.scope?.split(/\s+/).filter(Boolean) ?? [];
  const granted = new Set(scopes);
  const missing = GOOGLE_WORKSPACE_BINDINGS[service].scopes.filter((scope) => !granted.has(scope));
  if (missing.length) {
    throw new GoogleAccountError(403, "Google did not grant every required read-only scope");
  }
  return scopes;
}

function isGoogleWorkspaceConnector(connectorId: string, identity?: GoogleWorkspaceIdentity) {
  const parsed = googleWorkspaceConnectorIdentity(connectorId);
  if (!parsed) return false;
  if (!identity) return true;
  return parsed.service === identity.service && parsed.accountKey === identity.accountKey;
}

function disableGoogleWorkspaceConnectors(identity?: GoogleWorkspaceIdentity): Effect.Effect<void> {
  return Effect.tryPromise({
    try: async () => {
      const connectors = await listConnectors();
      const changed = connectors
        .filter(
          (connector) => connector.enabled && isGoogleWorkspaceConnector(connector.id, identity),
        )
        .map((connector) => ({ ...connector, enabled: false }));
      if (changed.length) await upsertConnectors(changed);
    },
    catch: () => undefined,
  }).pipe(Effect.catch(() => Effect.void));
}

async function revokeGoogleGrant(
  token: string,
  dependencies: GoogleOAuthDependencies,
): Promise<void> {
  const response = await dependencies.fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: googleRequestSignal(dependencies),
  });
  if (response.ok) return;
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 400 && body && typeof body === "object") {
    if (Reflect.get(body, "error") === "invalid_token") return;
  }
  throw new GoogleAccountError(502, "Google access could not be revoked");
}

function promiseEffect<A>(operation: () => Promise<A>): Effect.Effect<A, GoogleAccountError> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => {
      if (error instanceof GoogleAccountError) return error;
      if (error instanceof Error && error.name === "TimeoutError") {
        return new GoogleAccountError(504, "Google OAuth request timed out");
      }
      return new GoogleAccountError(502, "Google OAuth request failed");
    },
  });
}

function pendingRevocations(secrets: Secrets): string[] {
  return [...new Set(secrets.pendingRevocations ?? [])];
}

function updatePendingRevocation(
  vault: OAuthVault,
  token: string,
  present: boolean,
): Effect.Effect<void, GoogleAccountError> {
  return Effect.gen(function* () {
    const metadata = yield* metadataEffect();
    const secrets = yield* secretsEffect(vault, metadata);
    const tokens = new Set(pendingRevocations(secrets));
    if (present) tokens.add(token);
    else tokens.delete(token);
    yield* writeVaultJson(vault, secretsKey, {
      ...secrets,
      pendingRevocations: [...tokens],
    });
  });
}

function revokeQueuedGoogleGrant(
  vault: OAuthVault,
  token: string,
  dependencies: GoogleOAuthDependencies,
): Effect.Effect<void, GoogleAccountError> {
  const revoke = promiseEffect(() => revokeGoogleGrant(token, dependencies));
  return updatePendingRevocation(vault, token, true).pipe(
    Effect.as(true),
    Effect.catch((queueError) =>
      revoke.pipe(
        Effect.as(false),
        Effect.catch(() => Effect.fail(queueError)),
      ),
    ),
    Effect.flatMap((queued) =>
      queued
        ? revoke.pipe(Effect.andThen(updatePendingRevocation(vault, token, false)))
        : Effect.void,
    ),
  );
}

function retryPendingGoogleRevocations(
  vault: OAuthVault,
  dependencies: GoogleOAuthDependencies,
): Effect.Effect<void, GoogleAccountError> {
  return Effect.gen(function* () {
    const metadata = yield* metadataEffect();
    const secrets = yield* secretsEffect(vault, metadata);
    yield* Effect.forEach(pendingRevocations(secrets), (token) =>
      promiseEffect(() => revokeGoogleGrant(token, dependencies)).pipe(
        Effect.andThen(updatePendingRevocation(vault, token, false)),
      ),
    );
  });
}

function authorizationRequestEffect<A>(
  service: GoogleWorkspacePluginId,
  flowId: string,
  operation: () => Promise<A>,
): Effect.Effect<A, GoogleAccountError> {
  return promiseEffect(operation).pipe(
    Effect.catch((error) =>
      ownsGoogleAuthorizationFlow(service, flowId)
        ? Effect.fail(error)
        : Effect.fail(authorizationFlowError()),
    ),
  );
}

type AuthorizationCommit = {
  account: GoogleAccountView;
  identity: GoogleWorkspaceIdentity;
  committedRefreshToken: string;
  connectionRevision: string;
  flowId: string;
  previousMetadata: Metadata;
  previousSecrets: Secrets;
  rollbackToken?: string;
};

function withoutConnection(
  accounts: Record<string, AccountRecord>,
  identity: GoogleWorkspaceIdentity,
  restored?: Connection,
): Record<string, AccountRecord> {
  const next = { ...accounts };
  const account = next[identity.accountKey];
  if (!account) return next;
  const connections = { ...account.connections };
  if (restored) connections[identity.service] = restored;
  else delete connections[identity.service];
  if (Object.keys(connections).length === 0) delete next[identity.accountKey];
  else next[identity.accountKey] = { ...account, connections };
  return next;
}

function withoutToken(
  refreshTokens: Record<string, AccountTokens>,
  identity: GoogleWorkspaceIdentity,
  restored?: string,
): Record<string, AccountTokens> {
  const next = { ...refreshTokens };
  const tokens = { ...next[identity.accountKey] };
  if (restored) tokens[identity.service] = restored;
  else delete tokens[identity.service];
  if (Object.keys(tokens).length === 0) delete next[identity.accountKey];
  else next[identity.accountKey] = tokens;
  return next;
}

function restoreGoogleAuthorization(
  vault: OAuthVault,
  commit: AuthorizationCommit,
): Effect.Effect<void, GoogleAccountError> {
  return Effect.gen(function* () {
    const currentMetadata = (yield* metadataEffect()) ?? commit.previousMetadata;
    const currentSecrets = yield* secretsEffect(vault, currentMetadata);
    const { accountKey, service } = commit.identity;
    const committed =
      currentMetadata.accounts[accountKey]?.connections[service]?.revision ===
      commit.connectionRevision;
    const accounts = committed
      ? withoutConnection(
          currentMetadata.accounts,
          commit.identity,
          commit.previousMetadata.accounts[accountKey]?.connections[service],
        )
      : currentMetadata.accounts;
    const refreshTokens =
      currentSecrets.refreshTokens[accountKey]?.[service] === commit.committedRefreshToken
        ? withoutToken(
            currentSecrets.refreshTokens,
            commit.identity,
            commit.previousSecrets.refreshTokens[accountKey]?.[service],
          )
        : currentSecrets.refreshTokens;
    yield* writeVaultJson(vault, secretsKey, { ...currentSecrets, refreshTokens });
    yield* writeMetadataEffect({ ...currentMetadata, accounts });
  });
}

function failAfterGoogleGrantRollback(
  error: GoogleAccountError,
  vault: OAuthVault,
  token: string | undefined,
  dependencies: GoogleOAuthDependencies,
): Effect.Effect<never, GoogleAccountError> {
  return token
    ? revokeQueuedGoogleGrant(vault, token, dependencies).pipe(Effect.andThen(Effect.fail(error)))
    : Effect.fail(error);
}

function rollbackGoogleAuthorization(
  vault: OAuthVault,
  commit: AuthorizationCommit,
  dependencies: GoogleOAuthDependencies,
): Effect.Effect<void, GoogleAccountError> {
  const restore = restoreGoogleAuthorization(vault, commit);
  const token = commit.rollbackToken;
  return token
    ? revokeQueuedGoogleGrant(vault, token, dependencies).pipe(
        Effect.catch((revokeError) =>
          restore.pipe(
            Effect.catch(() => Effect.void),
            Effect.andThen(Effect.fail(revokeError)),
          ),
        ),
        Effect.andThen(restore),
      )
    : restore;
}

function completeGoogleAuthorizationUnlocked(
  service: GoogleWorkspacePluginId,
  input: { state: string; code: string },
  expectedFlowId: string | undefined,
  dependencies: GoogleOAuthDependencies,
  vault: OAuthVault,
): Effect.Effect<AuthorizationCommit, GoogleAccountError> {
  return Effect.gen(function* () {
    const pending = yield* readVaultJson(
      vault,
      pendingKey(service),
      Schema.decodeUnknownSync(PendingSchema),
    );
    if (
      !pending ||
      pending.service !== service ||
      pending.state !== input.state ||
      (expectedFlowId && pending.flowId !== expectedFlowId)
    ) {
      return yield* Effect.fail(new GoogleAccountError(400, "Google sign-in state is invalid"));
    }
    yield* requireGoogleAuthorizationFlow(service, pending.flowId);
    const cancellation = googleAuthorizationFlowSignal(service, pending.flowId);
    if (pending.expiresAt < dependencies.now()) {
      yield* removeVaultValue(vault, pendingKey(service));
      return yield* Effect.fail(new GoogleAccountError(400, "Google sign-in expired; start again"));
    }
    yield* removeVaultValue(vault, pendingKey(service));
    const metadata = yield* metadataEffect();
    if (!metadata || metadata.clientId !== pending.clientId) {
      return yield* Effect.fail(
        new GoogleAccountError(409, "Google OAuth client changed; start sign-in again"),
      );
    }
    const secrets = yield* secretsEffect(vault, metadata);
    const token = yield* authorizationRequestEffect(service, pending.flowId, () =>
      exchangeAuthorizationCode(metadata, secrets, pending, input.code, dependencies, cancellation),
    );
    // Before the mailbox is known the grant cannot be attributed, so it is only
    // safe to hand back when this client holds no grants at all. Once the email
    // verifies, the account is known and the test narrows to that account.
    let rollbackToken = storedRefreshTokens(secrets).length
      ? undefined
      : (token.refresh_token ?? token.access_token);
    const rollbackFailure = (error: GoogleAccountError) =>
      failAfterGoogleGrantRollback(error, vault, rollbackToken, dependencies);
    yield* requireGoogleAuthorizationFlow(service, pending.flowId).pipe(
      Effect.catch(rollbackFailure),
    );
    const scopes = yield* Effect.try({
      try: () => grantedScopes(service, token),
      catch: (error) =>
        error instanceof GoogleAccountError
          ? error
          : new GoogleAccountError(403, "Google scope verification failed"),
    }).pipe(Effect.catch(rollbackFailure));
    const email = yield* authorizationRequestEffect(service, pending.flowId, () =>
      verifiedEmail(token.access_token, dependencies, cancellation),
    ).pipe(Effect.catch(rollbackFailure));
    const identity: GoogleWorkspaceIdentity = {
      service,
      accountKey: googleAccountKey(email),
    };
    const accountTokens = secrets.refreshTokens[identity.accountKey] ?? {};
    const refreshToken = token.refresh_token ?? accountTokens[service];
    if (Object.keys(accountTokens).length === 0) {
      rollbackToken = token.refresh_token ?? token.access_token;
    }
    if (!refreshToken) {
      return yield* rollbackFailure(
        new GoogleAccountError(502, "Google did not return offline access; start sign-in again"),
      );
    }
    yield* requireGoogleAuthorizationFlow(service, pending.flowId).pipe(
      Effect.catch(rollbackFailure),
    );
    yield* authorizationRequestEffect(service, pending.flowId, () =>
      dependencies.verifyAccess(service, token.access_token, cancellation),
    ).pipe(Effect.catch(rollbackFailure));
    yield* requireGoogleAuthorizationFlow(service, pending.flowId).pipe(
      Effect.catch(rollbackFailure),
    );
    const connectionRevision = randomUUID();
    const connection: Connection = {
      scopes,
      endpoint: GOOGLE_WORKSPACE_BINDINGS[service].restEndpoint,
      connectedAt: new Date(dependencies.now()).toISOString(),
      revision: connectionRevision,
    };
    const existing = metadata.accounts[identity.accountKey];
    const updatedSecrets: Secrets = {
      version: 2,
      ...(secrets.clientSecret ? { clientSecret: secrets.clientSecret } : {}),
      refreshTokens: {
        ...secrets.refreshTokens,
        [identity.accountKey]: { ...accountTokens, [service]: refreshToken },
      },
      pendingRevocations: pendingRevocations(secrets),
    };
    const updatedMetadata: Metadata = {
      ...metadata,
      accounts: {
        ...metadata.accounts,
        // Re-authorizing a mailbox rotates its tokens in place; it never creates
        // a second entry for the same address.
        [identity.accountKey]: {
          email,
          connections: { ...existing?.connections, [service]: connection },
        },
      },
    };
    const commit: AuthorizationCommit = {
      account: accountView(updatedMetadata),
      identity,
      committedRefreshToken: refreshToken,
      connectionRevision,
      flowId: pending.flowId,
      previousMetadata: metadata,
      previousSecrets: secrets,
      ...(rollbackToken ? { rollbackToken } : {}),
    };
    yield* writeVaultJson(vault, secretsKey, updatedSecrets).pipe(
      Effect.andThen(writeMetadataEffect(updatedMetadata)),
      Effect.catch((error: GoogleAccountError) =>
        rollbackGoogleAuthorization(vault, commit, dependencies).pipe(
          Effect.catch(() => Effect.void),
          Effect.andThen(Effect.fail(error)),
        ),
      ),
    );
    if (!ownsGoogleAuthorizationFlow(service, pending.flowId)) {
      yield* rollbackGoogleAuthorization(vault, commit, dependencies);
      return yield* Effect.fail(authorizationFlowError());
    }
    accessTokens.set(tokenCacheKey(identity), {
      value: token.access_token,
      expiresAt: dependencies.now() + Math.max(30, (token.expires_in ?? 3600) - 60) * 1000,
    });
    return commit;
  });
}

export function completeGoogleAuthorizationWithActivation<A>(
  service: GoogleWorkspacePluginId,
  input: { state: string; code: string },
  flowId: string,
  activation: (signal: AbortSignal, identity: GoogleWorkspaceIdentity) => Effect.Effect<A, Error>,
  rollback: (identity: GoogleWorkspaceIdentity, activated: A) => Effect.Effect<unknown, Error>,
  dependencies: GoogleOAuthDependencies = defaultDependencies,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<
  { account: GoogleAccountView; identity: GoogleWorkspaceIdentity; activation: A },
  Error | GoogleAccountError
> {
  return authorizationLifecycle.withPermit(
    Effect.gen(function* () {
      const cancellation = googleAuthorizationFlowSignal(service, flowId);
      const commit = yield* accountMutation.withPermit(
        completeGoogleAuthorizationUnlocked(service, input, flowId, dependencies, vault),
      );
      const activated = yield* activation(cancellation, commit.identity);
      if (!ownsGoogleAuthorizationFlow(service, flowId)) {
        yield* accountMutation
          .withPermit(rollbackGoogleAuthorization(vault, commit, dependencies))
          .pipe(
            Effect.ensuring(
              rollback(commit.identity, activated).pipe(
                Effect.catch(() => Effect.void),
                Effect.andThen(
                  Effect.sync(() => accessTokens.delete(tokenCacheKey(commit.identity))),
                ),
              ),
            ),
          );
        return yield* Effect.fail(authorizationFlowError());
      }
      return { account: commit.account, identity: commit.identity, activation: activated };
    }),
  );
}

export function disconnectGoogleAccount(
  identity: GoogleWorkspaceIdentity,
  vault: OAuthVault = desktopOAuthVault,
  dependencies: GoogleOAuthDependencies = defaultDependencies,
): Effect.Effect<GoogleAccountView, GoogleAccountError> {
  return Effect.suspend(() => {
    invalidateGoogleWorkspaceAuthorizations();
    return authorizationLifecycle.withPermit(
      accountMutation.withPermit(
        Effect.gen(function* () {
          yield* retryPendingGoogleRevocations(vault, dependencies);
          const metadata = yield* metadataEffect();
          const secrets = yield* secretsEffect(vault, metadata);
          const accountTokens = secrets.refreshTokens[identity.accountKey] ?? {};
          const token = accountTokens[identity.service];
          const remaining = GOOGLE_WORKSPACE_PLUGIN_IDS.filter(
            (service) => service !== identity.service && accountTokens[service],
          );
          // Google revokes the whole grant for a (client, user) pair, so handing
          // this token back would also cut the mailbox's other service. It is
          // only revoked once nothing else is still using it; until then the
          // local copy is simply dropped.
          if (token && remaining.length === 0) {
            yield* promiseEffect(() => revokeGoogleGrant(token, dependencies));
          }
          const updatedMetadata: Metadata | null = metadata
            ? { ...metadata, accounts: withoutConnection(metadata.accounts, identity) }
            : null;
          const updatedSecrets: Secrets = {
            version: 2,
            ...(secrets.clientSecret ? { clientSecret: secrets.clientSecret } : {}),
            refreshTokens: withoutToken(secrets.refreshTokens, identity),
            pendingRevocations: pendingRevocations(secrets),
          };
          return yield* Effect.gen(function* () {
            if (updatedMetadata) yield* writeMetadataEffect(updatedMetadata);
            yield* removeVaultValue(vault, pendingKey(identity.service));
            if (metadata) yield* writeVaultJson(vault, secretsKey, updatedSecrets);
            else yield* removeVaultValue(vault, secretsKey);
            return accountView(updatedMetadata);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => accessTokens.delete(tokenCacheKey(identity))).pipe(
                Effect.andThen(disableGoogleWorkspaceConnectors(identity)),
              ),
            ),
          );
        }),
      ),
    );
  });
}

async function refreshAccessToken(
  identity: GoogleWorkspaceIdentity,
  metadata: Metadata,
  secrets: Secrets,
  dependencies: GoogleOAuthDependencies,
): Promise<TokenResponse> {
  const refreshToken = secrets.refreshTokens[identity.accountKey]?.[identity.service];
  if (!refreshToken) throw new GoogleAccountError(401, "Google account is not connected");
  const body = new URLSearchParams({
    client_id: metadata.clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    ...(secrets.clientSecret ? { client_secret: secrets.clientSecret } : {}),
  });
  const response = await dependencies.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: googleRequestSignal(dependencies),
  });
  if (!response.ok) throw new GoogleAccountError(401, "Google account authorization expired");
  try {
    return Schema.decodeUnknownSync(TokenResponseSchema)(await response.json());
  } catch {
    throw new GoogleAccountError(502, "Google returned an invalid refresh response");
  }
}

export function googleAuthorizationHeaders(
  identity: GoogleWorkspaceIdentity,
  forceRefresh = false,
  dependencies: GoogleOAuthDependencies = defaultDependencies,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<Record<string, string>, GoogleAccountError> {
  return accountMutation.withPermit(
    Effect.gen(function* () {
      const cacheKey = tokenCacheKey(identity);
      if (forceRefresh) accessTokens.delete(cacheKey);
      const cached = accessTokens.get(cacheKey);
      if (cached && cached.expiresAt > dependencies.now()) {
        return { Authorization: `Bearer ${cached.value}` };
      }
      const metadata = yield* metadataEffect();
      const connection = metadata?.accounts[identity.accountKey]?.connections[identity.service];
      if (!connection) {
        return yield* Effect.fail(new GoogleAccountError(401, "Google account is not connected"));
      }
      const secrets = yield* secretsEffect(vault, metadata);
      const token = yield* promiseEffect(() =>
        refreshAccessToken(identity, metadata, secrets, dependencies),
      );
      if (token.refresh_token) {
        yield* writeVaultJson(vault, secretsKey, {
          ...secrets,
          refreshTokens: {
            ...secrets.refreshTokens,
            [identity.accountKey]: {
              ...secrets.refreshTokens[identity.accountKey],
              [identity.service]: token.refresh_token,
            },
          },
        });
      }
      const expiresAt = dependencies.now() + Math.max(30, (token.expires_in ?? 3600) - 60) * 1000;
      accessTokens.set(cacheKey, { value: token.access_token, expiresAt });
      return { Authorization: `Bearer ${token.access_token}` };
    }),
  );
}

export function clearGoogleAuthorizationCache(): void {
  accessTokens.clear();
}
