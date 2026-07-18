import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Effect, Schema } from "effect";
import { closePooledConnection, probeConnector } from "./connector-pool";
import { listConnectors, upsertConnectors, type ConnectorConfig } from "./connectors-service";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  isGoogleWorkspacePlugin,
  type GoogleWorkspacePluginId,
} from "./google-workspace-binding";
import type { PluginBundle } from "./plugin-discovery";

export { GOOGLE_WORKSPACE_PLUGIN_IDS, isGoogleWorkspacePlugin } from "./google-workspace-binding";
export type { GoogleWorkspacePluginId } from "./google-workspace-binding";

const AppsSchema = Schema.Struct({ apps: Schema.Record(Schema.String, Schema.Unknown) });
const GoogleWorkspaceAppSchema = Schema.Struct({
  adapter: Schema.Literal("google-workspace"),
  mode: Schema.Literal("read-only"),
});

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export function trustedGoogleWorkspacePlugin(
  bundle: PluginBundle,
): Effect.Effect<GoogleWorkspacePluginId | null> {
  return Effect.promise(async () => {
    if (!bundle.trusted || !isGoogleWorkspacePlugin(bundle.plugin.id) || !bundle.manifest.apps) {
      return null;
    }
    try {
      const root = await realpath(bundle.rootDir);
      const file = await realpath(path.resolve(root, bundle.manifest.apps));
      if (!isContained(root, file)) return null;
      const manifest = Schema.decodeUnknownSync(AppsSchema)(
        JSON.parse(await readFile(file, "utf8")),
      );
      Schema.decodeUnknownSync(GoogleWorkspaceAppSchema)(manifest.apps[bundle.plugin.id]);
      return bundle.plugin.id;
    } catch {
      return null;
    }
  });
}

export function googleWorkspaceConnector(
  id: GoogleWorkspacePluginId,
  enabled: boolean,
): ConnectorConfig {
  const binding = GOOGLE_WORKSPACE_BINDINGS[id];
  return {
    id: binding.connectorId,
    name: binding.name,
    transport: "http",
    url: binding.endpoint,
    auth: { type: "oauth", provider: "google-workspace", account: id },
    allowTools: [...binding.observeTools],
    permissionReviewed: true,
    origin: { kind: "account-adapter", id, binding: "google-workspace" },
    enabled,
  };
}

export function enableGoogleWorkspaceAdapter(
  id: GoogleWorkspacePluginId,
  signal?: AbortSignal,
): Effect.Effect<ConnectorConfig[], Error> {
  return Effect.tryPromise({
    try: async () => {
      const connector = googleWorkspaceConnector(id, false);
      const probe = await probeConnector(connector, signal);
      if (!probe.ok) throw new Error(probe.error ?? "Remote MCP probe failed");
      const declaredReadOnly = new Set(
        probe.tools
          .filter((tool) => tool.annotations?.readOnlyHint === true)
          .map((tool) => tool.name),
      );
      const allowTools = GOOGLE_WORKSPACE_BINDINGS[id].observeTools.filter((tool) =>
        declaredReadOnly.has(tool),
      );
      if (allowTools.length !== GOOGLE_WORKSPACE_BINDINGS[id].observeTools.length) {
        throw new Error("Remote MCP read-only contract changed");
      }
      const enabled = { ...connector, enabled: true, allowTools };
      const saved = await upsertConnectors([enabled]);
      closePooledConnection(enabled.id);
      return saved;
    },
    catch: (error) => new Error(`Google Workspace adapter failed: ${error}`),
  });
}

function ownedGoogleWorkspaceConnectors(
  connectors: ConnectorConfig[],
  id: GoogleWorkspacePluginId,
): ConnectorConfig[] {
  return connectors.filter(
    (connector) =>
      connector.origin?.kind === "account-adapter" &&
      connector.origin.id === id &&
      connector.origin.binding === "google-workspace",
  );
}

export function googleWorkspaceAdapterEnabled(
  id: GoogleWorkspacePluginId,
): Effect.Effect<boolean, Error> {
  return Effect.tryPromise({
    try: async () =>
      ownedGoogleWorkspaceConnectors(await listConnectors(), id).some(
        (connector) => connector.enabled,
      ),
    catch: (error) => new Error(`Google Workspace adapter state failed: ${error}`),
  });
}

export function restoreGoogleWorkspaceAdapter(
  id: GoogleWorkspacePluginId,
  enabled: boolean,
): Effect.Effect<ConnectorConfig[], Error> {
  return Effect.tryPromise({
    try: async () => {
      const current = await listConnectors();
      const owned = ownedGoogleWorkspaceConnectors(current, id);
      const saved =
        owned.length || enabled
          ? await upsertConnectors([googleWorkspaceConnector(id, enabled)])
          : current;
      closePooledConnection(GOOGLE_WORKSPACE_BINDINGS[id].connectorId);
      return saved;
    },
    catch: (error) => new Error(`Google Workspace adapter restore failed: ${error}`),
  });
}

export function disableGoogleWorkspaceAdapter(
  id: GoogleWorkspacePluginId,
): Effect.Effect<ConnectorConfig[], Error> {
  return Effect.tryPromise({
    try: async () => {
      const current = await listConnectors();
      const owned = ownedGoogleWorkspaceConnectors(current, id);
      const disabled = owned.map((connector) => ({ ...connector, enabled: false }));
      const saved = disabled.length ? await upsertConnectors(disabled) : current;
      owned.forEach((connector) => closePooledConnection(connector.id));
      return saved;
    },
    catch: (error) => new Error(`Google Workspace disconnect failed: ${error}`),
  });
}
