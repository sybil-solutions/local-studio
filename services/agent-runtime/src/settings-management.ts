import { Effect, Schema } from "effect";
import {
  ConnectorTestResponseSchema,
  GitHubConnectorArtifactStatusSchema,
  type ConnectorConfig,
  type ConnectorTestResponse,
  type GitHubConnectorArtifactStatus,
} from "./connector-contract";
import {
  getGitHubConnectorArtifactStatus,
  GitHubConnectorArtifactError,
  installGitHubConnectorArtifact,
} from "./connector-artifacts";
import { connectorInventoryDigest } from "./connector-inventory";
import { connectorToolPermissions } from "./connector-policy";
import { closePooledConnection, probeConnector } from "./connector-pool";
import {
  inspectConnectors,
  upsertConnectorInput,
  type ConnectorUpsertInput,
} from "./connectors-service";
import {
  GoogleAccountResponseSchema,
  GoogleAuthorizationResponseSchema,
  GoogleCancellationResponseSchema,
  type GoogleAccountInput,
  type GoogleAccountResponse,
  type GoogleAuthorizationResponse,
  type GoogleCancellationResponse,
  type GoogleClientInput,
} from "./google-account-contract";
import {
  disconnectGoogleAccount,
  getGoogleAccount,
  GoogleAccountError,
  saveGoogleClient,
} from "./google-account";
import {
  beginGoogleLoopbackAuthorization,
  cancelGoogleLoopbackAuthorization,
} from "./google-oauth-loopback";
import { GOOGLE_WORKSPACE_BINDINGS, GOOGLE_WORKSPACE_PLUGIN_IDS } from "./google-workspace-binding";
import {
  PluginRuntimeResponseSchema,
  type PluginActivationInput,
  type PluginRuntimeResponse,
} from "./plugin-runtime-contract";
import {
  listPluginRuntimeViews,
  PluginRuntimeError,
  refreshEnabledPluginConnectors,
  setPluginEnabled,
  updatePluginConnectorGrant,
} from "./plugin-runtime";

export class SettingsManagementError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SettingsManagementError";
  }
}

const exact = { onExcessProperty: "error" } as const;
const decodeConnectorTest = Schema.decodeUnknownSync(ConnectorTestResponseSchema, exact);
const decodeGitHubArtifactStatus = Schema.decodeUnknownSync(
  GitHubConnectorArtifactStatusSchema,
  exact,
);
const decodePlugins = Schema.decodeUnknownSync(PluginRuntimeResponseSchema, exact);
const decodeGoogleAccount = Schema.decodeUnknownSync(GoogleAccountResponseSchema, exact);
const decodeGoogleAuthorization = Schema.decodeUnknownSync(
  GoogleAuthorizationResponseSchema,
  exact,
);
const decodeGoogleCancellation = Schema.decodeUnknownSync(GoogleCancellationResponseSchema, exact);

function settingsError(error: unknown, fallback: string): SettingsManagementError {
  if (error instanceof SettingsManagementError) return error;
  if (error instanceof GitHubConnectorArtifactError) {
    return new SettingsManagementError(error.status, error.message);
  }
  if (error instanceof GoogleAccountError) {
    return new SettingsManagementError(error.status, error.message);
  }
  if (error instanceof PluginRuntimeError) {
    return new SettingsManagementError(error.status, error.status < 500 ? error.message : fallback);
  }
  return new SettingsManagementError(500, fallback);
}

export function getManagedGitHubConnectorArtifactStatus(): Effect.Effect<
  GitHubConnectorArtifactStatus,
  SettingsManagementError
> {
  return getGitHubConnectorArtifactStatus().pipe(
    Effect.map(decodeGitHubArtifactStatus),
    Effect.mapError((error) => settingsError(error, "GitHub MCP status failed")),
  );
}

export function installManagedGitHubConnectorArtifact(): Effect.Effect<
  GitHubConnectorArtifactStatus,
  SettingsManagementError
> {
  return installGitHubConnectorArtifact().pipe(
    Effect.map(decodeGitHubArtifactStatus),
    Effect.mapError((error) => settingsError(error, "GitHub MCP installation failed")),
  );
}

function closeGoogleConnections(): void {
  GOOGLE_WORKSPACE_PLUGIN_IDS.forEach((id) =>
    closePooledConnection(GOOGLE_WORKSPACE_BINDINGS[id].connectorId),
  );
}

export function probeManagedConnector(
  id: string,
): Effect.Effect<ConnectorTestResponse, SettingsManagementError> {
  return Effect.tryPromise({
    try: async () => {
      let connector = (await inspectConnectors()).find((entry) => entry.id === id);
      if (!connector) throw new SettingsManagementError(404, "unknown connector");
      if (connector.origin?.kind === "plugin") {
        await Effect.runPromise(
          refreshEnabledPluginConnectors(undefined, new Set([connector.origin.id])),
        );
        connector = (await inspectConnectors()).find((entry) => entry.id === id);
        if (!connector) throw new SettingsManagementError(404, "unknown connector");
      }
      const result = await probeConnector(connector);
      const tools = connectorToolPermissions(connector, result.tools);
      return decodeConnectorTest({
        ok: result.ok,
        tool_count: tools.length,
        tool_names: tools.map((tool) => tool.name).slice(0, 40),
        tools,
        ...(connector.origin?.kind === "plugin" && connector.origin.artifactDigest
          ? { artifact_digest: connector.origin.artifactDigest }
          : {}),
        inventory_digest: connectorInventoryDigest(result.tools),
        ...(result.error ? { error: result.error } : {}),
      });
    },
    catch: (error) => settingsError(error, "Connector discovery failed"),
  });
}

function pluginGrantInput(input: ConnectorUpsertInput) {
  if ("catalogId" in input) {
    throw new SettingsManagementError(409, "Plugin connector review is invalid");
  }
  return {
    id: input.id,
    allowTools: input.allowTools ?? [],
    permissionReviewed: input.permissionReviewed === true,
    enabled: input.enabled ?? false,
    ...(input.reviewedArtifactDigest
      ? { reviewedArtifactDigest: input.reviewedArtifactDigest }
      : {}),
    ...(input.reviewedInventoryDigest
      ? { reviewedInventoryDigest: input.reviewedInventoryDigest }
      : {}),
  };
}

export function saveManagedConnector(
  input: ConnectorUpsertInput,
): Effect.Effect<ConnectorConfig[], SettingsManagementError> {
  return Effect.tryPromise({
    try: async () => {
      const stored = (await inspectConnectors()).find((connector) => connector.id === input.id);
      return stored?.origin?.kind === "plugin"
        ? Effect.runPromise(updatePluginConnectorGrant(pluginGrantInput(input)))
        : upsertConnectorInput(input);
    },
    catch: (error) => settingsError(error, "Connector could not be saved"),
  }).pipe(
    Effect.ensuring(Effect.promise(() => closePooledConnection(input.id).catch(() => undefined))),
  );
}

export function listManagedPlugins(): Effect.Effect<
  PluginRuntimeResponse,
  SettingsManagementError
> {
  return listPluginRuntimeViews().pipe(
    Effect.map((plugins) => decodePlugins({ plugins })),
    Effect.mapError((error) => settingsError(error, "Plugin discovery failed")),
  );
}

export function setManagedPluginEnabled(
  input: PluginActivationInput,
): Effect.Effect<PluginRuntimeResponse, SettingsManagementError> {
  return setPluginEnabled(input.id, input.enabled).pipe(
    Effect.map((result) => decodePlugins({ plugins: result.plugins })),
    Effect.mapError((error) => settingsError(error, "Plugin activation failed")),
  );
}

export function getManagedGoogleAccount(): Effect.Effect<
  GoogleAccountResponse,
  SettingsManagementError
> {
  return getGoogleAccount().pipe(
    Effect.map((account) => decodeGoogleAccount({ account })),
    Effect.mapError((error) => settingsError(error, "Google account failed")),
  );
}

export function saveManagedGoogleClient(
  input: GoogleClientInput,
): Effect.Effect<GoogleAccountResponse, SettingsManagementError> {
  return saveGoogleClient(input).pipe(
    Effect.map((account) => decodeGoogleAccount({ account })),
    Effect.mapError((error) => settingsError(error, "Google account failed")),
    Effect.ensuring(Effect.sync(closeGoogleConnections)),
  );
}

export function disconnectManagedGoogleAccount(
  input: GoogleAccountInput,
): Effect.Effect<GoogleAccountResponse, SettingsManagementError> {
  return disconnectGoogleAccount(input.account).pipe(
    Effect.map((account) => decodeGoogleAccount({ account })),
    Effect.mapError((error) => settingsError(error, "Google account failed")),
    Effect.ensuring(Effect.sync(closeGoogleConnections)),
  );
}

export function beginManagedGoogleAuthorization(
  input: GoogleAccountInput,
): Effect.Effect<GoogleAuthorizationResponse, SettingsManagementError> {
  return beginGoogleLoopbackAuthorization(input.account).pipe(
    Effect.map(decodeGoogleAuthorization),
    Effect.mapError((error) => settingsError(error, "Google sign-in failed")),
  );
}

export function cancelManagedGoogleAuthorization(
  input: GoogleAccountInput,
): Effect.Effect<GoogleCancellationResponse, SettingsManagementError> {
  return cancelGoogleLoopbackAuthorization(input.account).pipe(
    Effect.as(decodeGoogleCancellation({ cancelled: true })),
    Effect.mapError((error) => settingsError(error, "Google sign-in cancellation failed")),
  );
}
