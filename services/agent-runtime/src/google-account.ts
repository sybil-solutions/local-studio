import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Schema, Semaphore } from "effect";
import { connectMcp } from "./mcp-client";
import { listConnectors, upsertConnectors } from "./connectors-service";
import { resolveDataDir } from "./data-dir";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  GOOGLE_WORKSPACE_PLUGIN_IDS,
  type GoogleWorkspacePluginId,
} from "./google-workspace-binding";
import { desktopOAuthVault, type OAuthVault } from "./oauth-vault";
import type { GoogleAccountView, GoogleConnectionView } from "./google-account-contract";

export type { GoogleAccountView, GoogleConnectionView } from "./google-account-contract";

const ConnectionSchema = Schema.Struct({
  email: Schema.String,
  scopes: Schema.Array(Schema.String),
  resource: Schema.String,
  connectedAt: Schema.String,
  revision: Schema.optional(Schema.String),
});

const ConnectionsSchema = Schema.Struct({
  gmail: Schema.optional(ConnectionSchema),
  "google-calendar": Schema.optional(ConnectionSchema),
});

const MetadataSchema = Schema.Struct({
  clientId: Schema.String,
  hasClientSecret: Schema.Boolean,
  connections: ConnectionsSchema,
});

const RefreshTokensSchema = Schema.Struct({
  gmail: Schema.optional(Schema.String),
  "google-calendar": Schema.optional(Schema.String),
});

const SecretsSchema = Schema.Struct({
  clientSecret: Schema.optional(Schema.String),
  refreshTokens: RefreshTokensSchema,
  pendingRevocations: Schema.optional(Schema.Array(Schema.String)),
});

const PendingSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
  clientId: Schema.String,
  flowId: Schema.String,
  state: Schema.String,
  verifier: Schema.String,
  redirectUri: Schema.String,
  resource: Schema.String,
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
type Metadata = typeof MetadataSchema.Type;
type Secrets = typeof SecretsSchema.Type;
type Pending = typeof PendingSchema.Type;
type TokenResponse = typeof TokenResponseSchema.Type;

export type GoogleOAuthDependencies = {
  fetch: typeof fetch;
  now: () => number;
  random: (size: number) => Buffer;
  requestTimeoutMs?: number;
  verifyAccess: (
    account: GoogleWorkspacePluginId,
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
const accessTokens = new Map<GoogleWorkspacePluginId, { value: string; expiresAt: number }>();
const authorizationFlows = new Map<
  GoogleWorkspacePluginId,
  { id: string; controller: AbortController }
>();
const accountMutation = Semaphore.makeUnsafe(1);
const authorizationLifecycle = Semaphore.makeUnsafe(1);

export function createGoogleAuthorizationFlow(account: GoogleWorkspacePluginId): string {
  authorizationFlows.get(account)?.controller.abort();
  const flowId = randomUUID();
  authorizationFlows.set(account, { id: flowId, controller: new AbortController() });
  return flowId;
}

function invalidateGoogleWorkspaceAuthorizations(): void {
  GOOGLE_WORKSPACE_PLUGIN_IDS.forEach(createGoogleAuthorizationFlow);
}

function ownsGoogleAuthorizationFlow(account: GoogleWorkspacePluginId, flowId: string): boolean {
  return authorizationFlows.get(account)?.id === flowId;
}

function googleAuthorizationFlowSignal(
  account: GoogleWorkspacePluginId,
  flowId: string,
): AbortSignal {
  const flow = authorizationFlows.get(account);
  if (flow?.id !== flowId) throw authorizationFlowError();
  return flow.controller.signal;
}

function authorizationFlowError(): GoogleAccountError {
  return new GoogleAccountError(409, "Google sign-in was cancelled or replaced");
}

function requireGoogleAuthorizationFlow(
  account: GoogleWorkspacePluginId,
  flowId: string,
): Effect.Effect<void, GoogleAccountError> {
  return ownsGoogleAuthorizationFlow(account, flowId)
    ? Effect.void
    : Effect.fail(authorizationFlowError());
}

export function resolveGoogleAccountFilePath(): string {
  return path.join(resolveDataDir(), "google-account.json");
}

function pendingKey(account: GoogleWorkspacePluginId): string {
  return `google-workspace-pending:${account}`;
}

async function readMetadata(): Promise<Metadata | null> {
  const file = resolveGoogleAccountFilePath();
  if (!existsSync(file)) return null;
  try {
    return Schema.decodeUnknownSync(MetadataSchema)(JSON.parse(await readFile(file, "utf8")));
  } catch {
    throw new GoogleAccountError(500, "Google account metadata is invalid");
  }
}

async function writeMetadata(metadata: Metadata): Promise<void> {
  const file = resolveGoogleAccountFilePath();
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  await chmod(file, 0o600);
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
  return { refreshTokens: {}, pendingRevocations: [] };
}

function connectionView(
  id: GoogleWorkspacePluginId,
  connection?: Connection,
): GoogleConnectionView {
  return {
    connected: Boolean(connection),
    email: connection?.email ?? null,
    scopes: connection?.scopes ?? [],
    resource: GOOGLE_WORKSPACE_BINDINGS[id].resource,
    connectedAt: connection?.connectedAt ?? null,
  };
}

function accountView(metadata: Metadata | null): GoogleAccountView {
  return {
    configured: Boolean(metadata?.clientId),
    clientId: metadata?.clientId ?? null,
    hasClientSecret: metadata?.hasClientSecret ?? false,
    connections: {
      gmail: connectionView("gmail", metadata?.connections.gmail),
      "google-calendar": connectionView(
        "google-calendar",
        metadata?.connections["google-calendar"],
      ),
    },
  };
}

export function getGoogleAccount(): Effect.Effect<GoogleAccountView, GoogleAccountError> {
  return metadataEffect().pipe(Effect.map(accountView));
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
        const currentSecrets =
          (yield* readVaultJson(vault, secretsKey, Schema.decodeUnknownSync(SecretsSchema))) ??
          emptySecrets();
        const sameClient = current?.clientId === clientId;
        const revokeToken = GOOGLE_WORKSPACE_PLUGIN_IDS.flatMap((id) =>
          currentSecrets.refreshTokens[id] ? [currentSecrets.refreshTokens[id]] : [],
        )[0];
        if (!sameClient && revokeToken) {
          yield* promiseEffect(() => revokeGoogleGrant(revokeToken, dependencies));
          invalidateGoogleWorkspaceAuthorizations();
          accessTokens.clear();
          yield* disableGoogleWorkspaceConnectors();
          if (current) yield* writeMetadataEffect({ ...current, connections: {} });
        }
        const secrets: Secrets = {
          ...(incomingSecret
            ? { clientSecret: incomingSecret }
            : sameClient && currentSecrets.clientSecret
              ? { clientSecret: currentSecrets.clientSecret }
              : {}),
          refreshTokens: sameClient ? currentSecrets.refreshTokens : {},
          pendingRevocations: pendingRevocations(currentSecrets),
        };
        const metadata: Metadata = {
          clientId,
          hasClientSecret: Boolean(secrets.clientSecret),
          connections: sameClient ? (current?.connections ?? {}) : {},
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
  account: GoogleWorkspacePluginId,
  redirectUri: string,
  dependencies: GoogleOAuthDependencies = defaultDependencies,
  vault: OAuthVault = desktopOAuthVault,
  requestedFlowId?: string,
): Effect.Effect<{ authorizationUrl: string }, GoogleAccountError> {
  return Effect.suspend(() => {
    const flowId = requestedFlowId ?? createGoogleAuthorizationFlow(account);
    return accountMutation.withPermit(
      Effect.gen(function* () {
        yield* requireGoogleAuthorizationFlow(account, flowId);
        yield* retryPendingGoogleRevocations(vault, dependencies);
        yield* requireGoogleAuthorizationFlow(account, flowId);
        const metadata = yield* metadataEffect();
        if (!metadata?.clientId) {
          return yield* Effect.fail(
            new GoogleAccountError(409, "Configure a Google OAuth client first"),
          );
        }
        const binding = GOOGLE_WORKSPACE_BINDINGS[account];
        const verifier = dependencies.random(64).toString("base64url");
        const pending: Pending = {
          account,
          clientId: metadata.clientId,
          flowId,
          state: dependencies.random(32).toString("base64url"),
          verifier,
          redirectUri: loopbackRedirect(redirectUri),
          resource: binding.resource,
          expiresAt: dependencies.now() + 10 * 60 * 1000,
        };
        yield* writeVaultJson(vault, pendingKey(account), pending);
        if (!ownsGoogleAuthorizationFlow(account, flowId)) {
          yield* removeVaultValue(vault, pendingKey(account));
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
          prompt: "consent",
          include_granted_scopes: "true",
          resource: binding.resource,
        }).toString();
        return { authorizationUrl: url.toString() };
      }),
    );
  });
}

export function cancelGoogleAuthorization(
  account: GoogleWorkspacePluginId,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<void, GoogleAccountError> {
  return Effect.suspend(() => {
    const cancellationId = createGoogleAuthorizationFlow(account);
    return authorizationLifecycle.withPermit(
      accountMutation.withPermit(
        ownsGoogleAuthorizationFlow(account, cancellationId)
          ? removeVaultValue(vault, pendingKey(account))
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
    resource: pending.resource,
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

async function verifyGoogleWorkspaceAccess(
  account: GoogleWorkspacePluginId,
  accessToken: string,
  signal: AbortSignal,
): Promise<void> {
  const binding = GOOGLE_WORKSPACE_BINDINGS[account];
  const connection = connectMcp({
    transport: "http",
    url: binding.endpoint,
    authorize: async () => ({ Authorization: `Bearer ${accessToken}` }),
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
    await connection.close();
  }
}

function grantedScopes(account: GoogleWorkspacePluginId, token: TokenResponse): string[] {
  const scopes = token.scope?.split(/\s+/).filter(Boolean) ?? [];
  const granted = new Set(scopes);
  const missing = GOOGLE_WORKSPACE_BINDINGS[account].scopes.filter((scope) => !granted.has(scope));
  if (missing.length) {
    throw new GoogleAccountError(403, "Google did not grant every required read-only scope");
  }
  return scopes;
}

function disableGoogleWorkspaceConnectors(): Effect.Effect<void> {
  return Effect.tryPromise({
    try: async () => {
      const connectors = await listConnectors();
      const changed = connectors
        .filter(
          (connector) =>
            connector.enabled &&
            connector.origin?.kind === "account-adapter" &&
            connector.origin.binding === "google-workspace",
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
    const secrets =
      (yield* readVaultJson(vault, secretsKey, Schema.decodeUnknownSync(SecretsSchema))) ??
      emptySecrets();
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
    const secrets =
      (yield* readVaultJson(vault, secretsKey, Schema.decodeUnknownSync(SecretsSchema))) ??
      emptySecrets();
    yield* Effect.forEach(pendingRevocations(secrets), (token) =>
      promiseEffect(() => revokeGoogleGrant(token, dependencies)).pipe(
        Effect.andThen(updatePendingRevocation(vault, token, false)),
      ),
    );
  });
}

function authorizationRequestEffect<A>(
  account: GoogleWorkspacePluginId,
  flowId: string,
  operation: () => Promise<A>,
): Effect.Effect<A, GoogleAccountError> {
  return promiseEffect(operation).pipe(
    Effect.catch((error) =>
      ownsGoogleAuthorizationFlow(account, flowId)
        ? Effect.fail(error)
        : Effect.fail(authorizationFlowError()),
    ),
  );
}

type AuthorizationCommit = {
  account: GoogleAccountView;
  accountId: GoogleWorkspacePluginId;
  committedRefreshToken: string;
  connectionRevision: string;
  flowId: string;
  previousMetadata: Metadata;
  previousSecrets: Secrets;
  rollbackToken?: string;
};

function restoreGoogleAuthorization(
  vault: OAuthVault,
  commit: AuthorizationCommit,
): Effect.Effect<void, GoogleAccountError> {
  return Effect.gen(function* () {
    const currentMetadata = (yield* metadataEffect()) ?? commit.previousMetadata;
    const currentSecrets =
      (yield* readVaultJson(vault, secretsKey, Schema.decodeUnknownSync(SecretsSchema))) ??
      commit.previousSecrets;
    const connections: Partial<Record<GoogleWorkspacePluginId, Connection>> = {
      ...currentMetadata.connections,
    };
    if (connections[commit.accountId]?.revision === commit.connectionRevision) {
      const previous = commit.previousMetadata.connections[commit.accountId];
      if (previous) connections[commit.accountId] = previous;
      else delete connections[commit.accountId];
    }
    const refreshTokens: Partial<Record<GoogleWorkspacePluginId, string>> = {
      ...currentSecrets.refreshTokens,
    };
    if (refreshTokens[commit.accountId] === commit.committedRefreshToken) {
      const previous = commit.previousSecrets.refreshTokens[commit.accountId];
      if (previous) refreshTokens[commit.accountId] = previous;
      else delete refreshTokens[commit.accountId];
    }
    yield* writeVaultJson(vault, secretsKey, { ...currentSecrets, refreshTokens });
    yield* writeMetadataEffect({ ...currentMetadata, connections });
  });
}

function rollbackTokenFor(secrets: Secrets, token: TokenResponse): string | undefined {
  const hadGrant = GOOGLE_WORKSPACE_PLUGIN_IDS.some((id) => Boolean(secrets.refreshTokens[id]));
  return hadGrant ? undefined : (token.refresh_token ?? token.access_token);
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
  account: GoogleWorkspacePluginId,
  input: { state: string; code: string },
  expectedFlowId: string | undefined,
  dependencies: GoogleOAuthDependencies,
  vault: OAuthVault,
): Effect.Effect<AuthorizationCommit, GoogleAccountError> {
  return Effect.gen(function* () {
    const pending = yield* readVaultJson(
      vault,
      pendingKey(account),
      Schema.decodeUnknownSync(PendingSchema),
    );
    if (
      !pending ||
      pending.account !== account ||
      pending.state !== input.state ||
      (expectedFlowId && pending.flowId !== expectedFlowId)
    ) {
      return yield* Effect.fail(new GoogleAccountError(400, "Google sign-in state is invalid"));
    }
    yield* requireGoogleAuthorizationFlow(account, pending.flowId);
    const cancellation = googleAuthorizationFlowSignal(account, pending.flowId);
    if (pending.expiresAt < dependencies.now()) {
      yield* removeVaultValue(vault, pendingKey(account));
      return yield* Effect.fail(new GoogleAccountError(400, "Google sign-in expired; start again"));
    }
    yield* removeVaultValue(vault, pendingKey(account));
    const metadata = yield* metadataEffect();
    if (!metadata || metadata.clientId !== pending.clientId) {
      return yield* Effect.fail(
        new GoogleAccountError(409, "Google OAuth client changed; start sign-in again"),
      );
    }
    const secrets =
      (yield* readVaultJson(vault, secretsKey, Schema.decodeUnknownSync(SecretsSchema))) ??
      emptySecrets();
    const token = yield* authorizationRequestEffect(account, pending.flowId, () =>
      exchangeAuthorizationCode(metadata, secrets, pending, input.code, dependencies, cancellation),
    );
    const rollbackToken = rollbackTokenFor(secrets, token);
    const rollbackFailure = (error: GoogleAccountError) =>
      failAfterGoogleGrantRollback(error, vault, rollbackToken, dependencies);
    yield* requireGoogleAuthorizationFlow(account, pending.flowId).pipe(
      Effect.catch(rollbackFailure),
    );
    const refreshToken = token.refresh_token ?? secrets.refreshTokens[account];
    if (!refreshToken) {
      return yield* rollbackFailure(
        new GoogleAccountError(502, "Google did not return offline access; start sign-in again"),
      );
    }
    const scopes = yield* Effect.try({
      try: () => grantedScopes(account, token),
      catch: (error) =>
        error instanceof GoogleAccountError
          ? error
          : new GoogleAccountError(403, "Google scope verification failed"),
    }).pipe(Effect.catch(rollbackFailure));
    const email = yield* authorizationRequestEffect(account, pending.flowId, () =>
      verifiedEmail(token.access_token, dependencies, cancellation),
    ).pipe(Effect.catch(rollbackFailure));
    yield* requireGoogleAuthorizationFlow(account, pending.flowId).pipe(
      Effect.catch(rollbackFailure),
    );
    yield* authorizationRequestEffect(account, pending.flowId, () =>
      dependencies.verifyAccess(account, token.access_token, cancellation),
    ).pipe(Effect.catch(rollbackFailure));
    yield* requireGoogleAuthorizationFlow(account, pending.flowId).pipe(
      Effect.catch(rollbackFailure),
    );
    const connectionRevision = randomUUID();
    const connection: Connection = {
      email,
      scopes,
      resource: pending.resource,
      connectedAt: new Date(dependencies.now()).toISOString(),
      revision: connectionRevision,
    };
    const updatedSecrets: Secrets = {
      ...(secrets.clientSecret ? { clientSecret: secrets.clientSecret } : {}),
      refreshTokens: { ...secrets.refreshTokens, [account]: refreshToken },
      pendingRevocations: pendingRevocations(secrets),
    };
    const updatedMetadata: Metadata = {
      ...metadata,
      connections: { ...metadata.connections, [account]: connection },
    };
    const commit: AuthorizationCommit = {
      account: accountView(updatedMetadata),
      accountId: account,
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
    if (!ownsGoogleAuthorizationFlow(account, pending.flowId)) {
      yield* rollbackGoogleAuthorization(vault, commit, dependencies);
      return yield* Effect.fail(authorizationFlowError());
    }
    accessTokens.set(account, {
      value: token.access_token,
      expiresAt: dependencies.now() + Math.max(30, (token.expires_in ?? 3600) - 60) * 1000,
    });
    return commit;
  });
}

export function completeGoogleAuthorization(
  account: GoogleWorkspacePluginId,
  input: { state: string; code: string },
  dependencies: GoogleOAuthDependencies = defaultDependencies,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<GoogleAccountView, GoogleAccountError> {
  return accountMutation.withPermit(
    completeGoogleAuthorizationUnlocked(account, input, undefined, dependencies, vault).pipe(
      Effect.map((commit) => commit.account),
    ),
  );
}

export function completeGoogleAuthorizationWithActivation<A>(
  account: GoogleWorkspacePluginId,
  input: { state: string; code: string },
  flowId: string,
  activation: (signal: AbortSignal) => Effect.Effect<A, Error>,
  rollback: Effect.Effect<unknown, Error>,
  dependencies: GoogleOAuthDependencies = defaultDependencies,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<{ account: GoogleAccountView; activation: A }, Error | GoogleAccountError> {
  return authorizationLifecycle.withPermit(
    Effect.gen(function* () {
      const cancellation = googleAuthorizationFlowSignal(account, flowId);
      const commit = yield* accountMutation.withPermit(
        completeGoogleAuthorizationUnlocked(account, input, flowId, dependencies, vault),
      );
      const activated = yield* activation(cancellation);
      if (!ownsGoogleAuthorizationFlow(account, flowId)) {
        yield* accountMutation
          .withPermit(rollbackGoogleAuthorization(vault, commit, dependencies))
          .pipe(
            Effect.ensuring(
              rollback.pipe(
                Effect.catch(() => Effect.void),
                Effect.andThen(Effect.sync(() => accessTokens.delete(account))),
              ),
            ),
          );
        return yield* Effect.fail(authorizationFlowError());
      }
      return { account: commit.account, activation: activated };
    }),
  );
}

export function disconnectGoogleAccount(
  account: GoogleWorkspacePluginId,
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
          const secrets =
            (yield* readVaultJson(vault, secretsKey, Schema.decodeUnknownSync(SecretsSchema))) ??
            emptySecrets();
          const revokeToken =
            secrets.refreshTokens[account] ??
            GOOGLE_WORKSPACE_PLUGIN_IDS.flatMap((id) =>
              secrets.refreshTokens[id] ? [secrets.refreshTokens[id]] : [],
            )[0];
          if (revokeToken) {
            yield* promiseEffect(() => revokeGoogleGrant(revokeToken, dependencies));
          }
          const updatedMetadata: Metadata | null = metadata
            ? { ...metadata, connections: {} }
            : null;
          const updatedSecrets: Secrets = {
            ...(secrets.clientSecret ? { clientSecret: secrets.clientSecret } : {}),
            refreshTokens: {},
            pendingRevocations: pendingRevocations(secrets),
          };
          return yield* Effect.gen(function* () {
            if (updatedMetadata) yield* writeMetadataEffect(updatedMetadata);
            yield* Effect.forEach(GOOGLE_WORKSPACE_PLUGIN_IDS, (id) =>
              removeVaultValue(vault, pendingKey(id)),
            );
            if (metadata) yield* writeVaultJson(vault, secretsKey, updatedSecrets);
            else yield* removeVaultValue(vault, secretsKey);
            return accountView(updatedMetadata);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => accessTokens.clear()).pipe(
                Effect.andThen(disableGoogleWorkspaceConnectors()),
              ),
            ),
          );
        }),
      ),
    );
  });
}

async function refreshAccessToken(
  account: GoogleWorkspacePluginId,
  metadata: Metadata,
  secrets: Secrets,
  dependencies: GoogleOAuthDependencies,
): Promise<TokenResponse> {
  const refreshToken = secrets.refreshTokens[account];
  if (!refreshToken) throw new GoogleAccountError(401, "Google account is not connected");
  const binding = GOOGLE_WORKSPACE_BINDINGS[account];
  const body = new URLSearchParams({
    client_id: metadata.clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    resource: binding.resource,
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
  account: GoogleWorkspacePluginId,
  forceRefresh = false,
  dependencies: GoogleOAuthDependencies = defaultDependencies,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<Record<string, string>, GoogleAccountError> {
  return accountMutation.withPermit(
    Effect.gen(function* () {
      if (forceRefresh) accessTokens.delete(account);
      const cached = accessTokens.get(account);
      if (cached && cached.expiresAt > dependencies.now()) {
        return { Authorization: `Bearer ${cached.value}` };
      }
      const metadata = yield* metadataEffect();
      if (!metadata?.connections[account]) {
        return yield* Effect.fail(new GoogleAccountError(401, "Google account is not connected"));
      }
      const secrets =
        (yield* readVaultJson(vault, secretsKey, Schema.decodeUnknownSync(SecretsSchema))) ??
        emptySecrets();
      const token = yield* promiseEffect(() =>
        refreshAccessToken(account, metadata, secrets, dependencies),
      );
      if (token.refresh_token) {
        yield* writeVaultJson(vault, secretsKey, {
          ...secrets,
          refreshTokens: { ...secrets.refreshTokens, [account]: token.refresh_token },
        });
      }
      const expiresAt = dependencies.now() + Math.max(30, (token.expires_in ?? 3600) - 60) * 1000;
      accessTokens.set(account, { value: token.access_token, expiresAt });
      return { Authorization: `Bearer ${token.access_token}` };
    }),
  );
}

export function clearGoogleAuthorizationCache(): void {
  for (const account of GOOGLE_WORKSPACE_PLUGIN_IDS) accessTokens.delete(account);
}
