import { Effect } from "effect";
import { closePooledConnection, probeConnector } from "./connector-pool";
import {
  googleWorkspaceConnector,
  listConnectors,
  upsertConnectors,
  type ConnectorConfig,
} from "./connectors-service";
import { getGoogleAccount } from "./google-account";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  googleWorkspaceConnectorId,
  googleWorkspaceConnectorIdentity,
  type GoogleWorkspaceIdentity,
} from "./google-workspace-binding";

/**
 * Turns one signed-in Google account into the one connector that exposes its
 * read-only tools. The binding is fixed in code — there is no manifest to read
 * and no bundle on disk to trust — so the (service, account) pair is the whole
 * identity, and the row is regenerated rather than edited.
 */
function connectorFor(
  identity: GoogleWorkspaceIdentity,
  enabled: boolean,
): Effect.Effect<ConnectorConfig, Error> {
  return getGoogleAccount().pipe(
    Effect.map((account) => {
      const email =
        account.accounts.find((entry) => entry.key === identity.accountKey)?.email ?? "";
      return googleWorkspaceConnector(identity, email, enabled);
    }),
  );
}

export function enableGoogleWorkspaceAdapter(
  identity: GoogleWorkspaceIdentity,
  signal?: AbortSignal,
): Effect.Effect<ConnectorConfig[], Error> {
  return connectorFor(identity, false).pipe(
    Effect.flatMap((connector) =>
      Effect.tryPromise({
        try: async () => {
          const probe = await probeConnector(connector, signal);
          if (!probe.ok) throw new Error(probe.error ?? "Read-only tool probe failed");
          const declaredReadOnly = new Set(
            probe.tools
              .filter((tool) => tool.annotations?.readOnlyHint === true)
              .map((tool) => tool.name),
          );
          const observeTools = GOOGLE_WORKSPACE_BINDINGS[identity.service].observeTools;
          const allowTools = observeTools.filter((tool) => declaredReadOnly.has(tool));
          if (allowTools.length !== observeTools.length) {
            throw new Error("Read-only tool contract changed");
          }
          const enabled = { ...connector, enabled: true, allowTools };
          const saved = await upsertConnectors([enabled]);
          closePooledConnection(enabled.id);
          return saved;
        },
        catch: (error) => new Error(`Google Workspace adapter failed: ${error}`),
      }),
    ),
  );
}

function ownedGoogleWorkspaceConnectors(
  connectors: ConnectorConfig[],
  identity: GoogleWorkspaceIdentity,
): ConnectorConfig[] {
  return connectors.filter((connector) => {
    const owner = googleWorkspaceConnectorIdentity(connector.id);
    return owner?.service === identity.service && owner.accountKey === identity.accountKey;
  });
}

export function googleWorkspaceAdapterEnabled(
  identity: GoogleWorkspaceIdentity,
): Effect.Effect<boolean, Error> {
  return Effect.tryPromise({
    try: async () =>
      ownedGoogleWorkspaceConnectors(await listConnectors(), identity).some(
        (connector) => connector.enabled,
      ),
    catch: (error) => new Error(`Google Workspace adapter state failed: ${error}`),
  });
}

export function restoreGoogleWorkspaceAdapter(
  identity: GoogleWorkspaceIdentity,
  enabled: boolean,
): Effect.Effect<ConnectorConfig[], Error> {
  return connectorFor(identity, enabled).pipe(
    Effect.flatMap((connector) =>
      Effect.tryPromise({
        try: async () => {
          const current = await listConnectors();
          const owned = ownedGoogleWorkspaceConnectors(current, identity);
          const saved = owned.length || enabled ? await upsertConnectors([connector]) : current;
          closePooledConnection(googleWorkspaceConnectorId(identity.service, identity.accountKey));
          return saved;
        },
        catch: (error) => new Error(`Google Workspace adapter restore failed: ${error}`),
      }),
    ),
  );
}

export function disableGoogleWorkspaceAdapter(
  identity: GoogleWorkspaceIdentity,
): Effect.Effect<ConnectorConfig[], Error> {
  return Effect.tryPromise({
    try: async () => {
      const current = await listConnectors();
      const owned = ownedGoogleWorkspaceConnectors(current, identity);
      const disabled = owned.map((connector) => ({ ...connector, enabled: false }));
      const saved = disabled.length ? await upsertConnectors(disabled) : current;
      owned.forEach((connector) => closePooledConnection(connector.id));
      return saved;
    },
    catch: (error) => new Error(`Google Workspace disconnect failed: ${error}`),
  });
}
