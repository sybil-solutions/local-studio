import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Effect, Schema } from "effect";
import { closePooledConnection, probeConnector } from "./connector-pool";
import {
  listConnectors,
  replaceConnectorIdentities,
  upsertConnectors,
  type ConnectorConfig,
} from "./connectors-service";
import { getGoogleAccount, type GoogleAccountView } from "./google-account";
import {
  googleWorkspaceConnector,
  trustedGoogleWorkspacePlugin,
  type GoogleWorkspacePluginId,
} from "./google-workspace-adapter";
import { pluginArtifactDigest } from "./plugin-artifact-digest";
import { pluginConnectorConfigurationDigest } from "./plugin-connector-identity";
import { expectedPluginExecutionSnapshot, preparePluginExecutionSnapshot, verifyPluginExecutionSnapshot } from "./plugin-execution-snapshot";
import { discoverPluginBundles, type PluginBundle, type PluginSource } from "./plugin-discovery";
import {
  type PluginActivationResult,
  type PluginRuntimeView,
  type PluginHostCapability,
  type PluginToolsView,
  type PluginToolState,
} from "./plugin-runtime-contract";

export {
  type PluginActivationResult,
  type PluginRuntimeView,
  type PluginHostCapability,
  type PluginToolsView,
  type PluginToolState,
} from "./plugin-runtime-contract";

const StringRecord = Schema.Record(Schema.String, Schema.String);

const StdioServerSchema = Schema.Struct({
  type: Schema.optional(Schema.Literal("stdio")),
  command: Schema.String,
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(StringRecord),
  cwd: Schema.optional(Schema.String),
});

const HttpServerSchema = Schema.Struct({
  type: Schema.Literal("http"),
  url: Schema.String,
  headers: Schema.optional(StringRecord),
  bearer_token_env_var: Schema.optional(Schema.String),
  oauth_resource: Schema.optional(Schema.String),
});

const McpServerSchema = Schema.Union([StdioServerSchema, HttpServerSchema]);
const McpManifestSchema = Schema.Struct({
  mcpServers: Schema.Record(Schema.String, Schema.Unknown),
});

const SpeechHostBindingSchema = Schema.Struct({
  adapter: Schema.Literal("local-studio-controller"),
  capability: Schema.Literal("speech"),
  actions: Schema.Array(Schema.Literal("synthesize")),
});

const AppManifestSchema = Schema.Struct({
  apps: Schema.Record(Schema.String, Schema.Unknown),
});

const EXECUTABLE_ENVIRONMENT_KEYS = new Set([
  "BUN_OPTIONS",
  "DYLD_FALLBACK_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_PATH",
  "NODE_OPTIONS",
]);

function pluginEnvironment(input: Record<string, string>): Record<string, string> {
  for (const key of Object.keys(input)) {
    const normalized = key.toUpperCase();
    if (
      EXECUTABLE_ENVIRONMENT_KEYS.has(normalized) ||
      normalized.startsWith("LD_") ||
      normalized.startsWith("DYLD_")
    ) {
      throw new PluginRuntimeError(422, "Plugin environment may not load external code");
    }
  }
  return {
    ...input,
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  };
}

type ResolvedServer = {
  connector: ConnectorConfig | null;
  blocker?: string;
};

export class PluginRuntimeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function verifyBundleArtifact(bundle: PluginBundle): Effect.Effect<void, PluginRuntimeError> {
  return pluginArtifactDigest(bundle.rootDir).pipe(
    Effect.mapError(() => new PluginRuntimeError(409, "Plugin artifact could not be verified")),
    Effect.flatMap((digest) =>
      digest === bundle.artifactDigest
        ? Effect.void
        : Effect.fail(new PluginRuntimeError(409, "Plugin artifact changed during validation")),
    ),
  );
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

async function containedRealPath(root: string, value: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const canonicalCandidate = await realpath(path.resolve(canonicalRoot, value));
  if (!isContained(canonicalRoot, canonicalCandidate)) {
    throw new PluginRuntimeError(422, "Plugin path escapes its bundle");
  }
  return canonicalCandidate;
}

async function resolvedCommand(root: string, command: string): Promise<string> {
  if (["node", "nodejs"].includes(command) || command === path.basename(process.execPath)) return process.execPath;
  if (path.isAbsolute(command)) {
    const canonical = await realpath(command);
    if (canonical === await realpath(process.execPath)) return process.execPath;
    if (!isContained(await realpath(root), canonical)) throw new PluginRuntimeError(422, "Plugin executable path escapes its bundle");
    return canonical;
  }
  if (command.startsWith(".") || command.includes(path.sep)) {
    return containedRealPath(root, command);
  }
  throw new PluginRuntimeError(422, "Plugin executable must be bundled");
}

async function resolvedArg(root: string, value: string): Promise<string> {
  return path.isAbsolute(value) || value.startsWith(".") || value.includes(path.sep)
    ? containedRealPath(root, value)
    : value;
}

function connectorId(pluginId: string, serverId: string): string {
  const base = `plugin-${pluginId}-${serverId}`.toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
  if (base.length <= 64) return base;
  const digest = createHash("sha256").update(base).digest("hex").slice(0, 8);
  return `${base.slice(0, 55)}-${digest}`;
}

function withPluginOrigin(
  bundle: PluginBundle,
  serverId: string,
  connector: ConnectorConfig,
): ConnectorConfig {
  return {
    ...connector,
    origin: {
      kind: "plugin",
      id: bundle.plugin.id,
      version: bundle.plugin.version,
      binding: serverId,
      artifactDigest: bundle.artifactDigest,
      sourceDigest: bundle.sourceDigest,
      configurationDigest: pluginConnectorConfigurationDigest(connector),
    },
  };
}

async function resolvedServer(
  bundle: PluginBundle,
  serverId: string,
  input: unknown,
): Promise<ResolvedServer> {
  const server = Schema.decodeUnknownSync(McpServerSchema)(input);
  const id = connectorId(bundle.plugin.id, serverId);
  const name =
    serverId === bundle.plugin.id
      ? bundle.plugin.displayName
      : `${bundle.plugin.displayName}: ${serverId}`;

  if ("command" in server) {
    const root = await realpath(bundle.rootDir);
    const command = await resolvedCommand(root, server.command);
    const values = server.args ?? [];
    const entryIndex = command === process.execPath ? values.findIndex((value) => !value.startsWith("-")) : -1;
    if (command === process.execPath && entryIndex === -1) throw new PluginRuntimeError(422, "Plugin runtime entry point is missing");
    const args = await Promise.all(values.map((value, index) => index === entryIndex ? containedRealPath(root, value) : resolvedArg(root, value)));
    return {
      connector: withPluginOrigin(bundle, serverId, {
        id,
        name,
        transport: "stdio",
        command,
        args,
        env: pluginEnvironment({ ...(server.env ?? {}) }),
        cwd: await containedRealPath(root, server.cwd ?? "."),
        enabled: false,
      }),
    };
  }

  if (server.oauth_resource) return { connector: null, blocker: "OAuth connection required" };
  const bearerEnv = server.bearer_token_env_var;
  const bearerToken = bearerEnv ? process.env[bearerEnv]?.trim() : undefined;
  if (bearerEnv && !bearerToken) return { connector: null, blocker: `Set ${bearerEnv}` };
  return {
    connector: withPluginOrigin(bundle, serverId, {
      id,
      name,
      transport: "http",
      url: server.url,
      headers: {
        ...(server.headers ?? {}),
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
      enabled: false,
    }),
  };
}

function loadPluginServers(
  bundle: PluginBundle,
): Effect.Effect<ResolvedServer[], PluginRuntimeError> {
  if (!bundle.manifest.mcpServers) return Effect.succeed([]);
  return Effect.tryPromise({
    try: async () => {
      const manifestPath = await containedRealPath(
        bundle.rootDir,
        bundle.manifest.mcpServers ?? "",
      );
      const manifest = Schema.decodeUnknownSync(McpManifestSchema)(
        JSON.parse(await readFile(manifestPath, "utf8")),
      );
      const servers = await Promise.all(
        Object.entries(manifest.mcpServers).map(([serverId, server]) =>
          resolvedServer(bundle, serverId, server),
        ),
      );
      await Effect.runPromise(verifyBundleArtifact(bundle));
      return servers;
    },
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(422, `Invalid MCP manifest for ${bundle.plugin.displayName}`),
  });
}

function loadHostCapability(
  bundle: PluginBundle,
): Effect.Effect<PluginHostCapability | null, PluginRuntimeError> {
  if (!bundle.trusted || bundle.plugin.id !== "chatterbox-voice" || !bundle.manifest.apps) {
    return Effect.succeed(null);
  }
  return Effect.tryPromise({
    try: async () => {
      const manifestPath = await containedRealPath(bundle.rootDir, bundle.manifest.apps ?? "");
      const manifest = Schema.decodeUnknownSync(AppManifestSchema)(
        JSON.parse(await readFile(manifestPath, "utf8")),
      );
      const binding = Schema.decodeUnknownSync(SpeechHostBindingSchema)(
        manifest.apps["chatterbox-voice"],
      );
      if (binding.actions.length !== 1) {
        throw new PluginRuntimeError(422, "Chatterbox Voice action contract changed");
      }
      return binding;
    },
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(422, "Invalid Chatterbox Voice manifest"),
  });
}

function pluginToolsView(
  bundle: PluginBundle,
  connectors: ConnectorConfig[],
  servers: ResolvedServer[],
  reapprovalRequired: boolean,
  reconciliationError?: string,
): PluginToolsView {
  if (!bundle.manifest.mcpServers) {
    return { state: "none", serverCount: 0, allowedToolCount: 0, mode: null };
  }
  const current = connectors.filter(
    (connector) =>
      connector.origin?.kind === "plugin" &&
      connector.origin.id === bundle.plugin.id &&
      connector.origin.version === bundle.plugin.version,
  );
  const enabled = current.filter((connector) => connector.enabled);
  const blockers = [
    ...new Set(servers.flatMap((server) => (server.blocker ? [server.blocker] : []))),
  ];
  const installable = servers.filter((server) => server.connector !== null);
  const allowedToolCount = enabled.reduce(
    (count, connector) => count + (connector.allowTools?.length ?? 0),
    0,
  );
  if (enabled.length > 0) {
    return {
      state: "enabled",
      serverCount: servers.length,
      allowedToolCount,
      mode: "observe",
    };
  }
  if (reconciliationError) {
    return {
      state: "invalid",
      serverCount: servers.length,
      allowedToolCount: 0,
      mode: null,
      reason: reconciliationError,
    };
  }
  if (reapprovalRequired || current.length > 0) {
    return {
      state: "disabled",
      serverCount: servers.length,
      allowedToolCount: 0,
      mode: "observe",
      ...(reapprovalRequired ? { reason: "Plugin identity changed; reconnect to approve it" } : {}),
    };
  }
  if (installable.length > 0) {
    return {
      state: "available",
      serverCount: servers.length,
      allowedToolCount: 0,
      mode: "observe",
      ...(blockers.length ? { reason: blockers.join(" · ") } : {}),
    };
  }
  return {
    state: "configuration_required",
    serverCount: servers.length,
    allowedToolCount: 0,
    mode: null,
    reason: blockers.join(" · ") || "No executable MCP server",
  };
}

function googleWorkspaceRuntimeView(
  bundle: PluginBundle,
  id: GoogleWorkspacePluginId,
  connectors: ConnectorConfig[],
  account: GoogleAccountView,
): PluginRuntimeView {
  const connection = account.connections[id];
  const current = connectors.filter(
    (connector) =>
      connector.origin?.kind === "account-adapter" &&
      connector.origin.id === id &&
      connector.origin.binding === "google-workspace",
  );
  const enabled = current.filter((connector) => connector.enabled);
  const allowedToolCount = enabled.reduce(
    (count, connector) => count + (connector.allowTools?.length ?? 0),
    0,
  );
  const state: PluginToolState =
    !account.configured || !connection.connected
      ? "configuration_required"
      : enabled.length
        ? "enabled"
        : current.length
          ? "disabled"
          : "available";
  const reason = !account.configured
    ? "Add a Google Desktop OAuth client"
    : !connection.connected
      ? "Finish Google sign-in"
      : undefined;
  return {
    ...bundle.plugin,
    account: {
      provider: "google",
      id,
      configured: account.configured,
      connected: connection.connected,
      email: connection.email,
    },
    tools: {
      state,
      serverCount: 1,
      allowedToolCount,
      mode: connection.connected ? "observe" : null,
      ...(reason ? { reason } : {}),
    },
  };
}

function runtimeView(
  bundle: PluginBundle,
  connectors: ConnectorConfig[],
  account: GoogleAccountView,
  reapprovalRequired: boolean,
  reconciliationError?: string,
): Effect.Effect<PluginRuntimeView, PluginRuntimeError> {
  return Effect.gen(function* () {
    const googleWorkspace = yield* trustedGoogleWorkspacePlugin(bundle);
    if (googleWorkspace) {
      const view = googleWorkspaceRuntimeView(bundle, googleWorkspace, connectors, account);
      const current = connectors.filter(
        (connector) =>
          connector.origin?.kind === "account-adapter" &&
          connector.origin.id === googleWorkspace &&
          connector.origin.binding === "google-workspace",
      );
      return yield* runtimeHealthView(view, current);
    }
    const hostCapability = yield* loadHostCapability(bundle);
    if (hostCapability) {
      return {
        ...bundle.plugin,
        hostCapability,
        tools: { state: "none", serverCount: 0, allowedToolCount: 0, mode: null },
      };
    }
    return yield* Effect.matchEffect(loadPluginServers(bundle), {
      onFailure: (error) =>
        Effect.succeed({
          ...bundle.plugin,
          tools: {
            state: "invalid" as const,
            serverCount: 0,
            allowedToolCount: 0,
            mode: null,
            reason: error.message,
          },
        }),
      onSuccess: (servers) => {
        const current = connectors.filter(
          (connector) =>
            connector.origin?.kind === "plugin" &&
            connector.origin.id === bundle.plugin.id &&
            connector.origin.version === bundle.plugin.version,
        );
        return runtimeHealthView(
          {
            ...bundle.plugin,
            tools: pluginToolsView(
              bundle,
              connectors,
              servers,
              reapprovalRequired,
              reconciliationError,
            ),
          },
          current,
        );
      },
    });
  });
}

function runtimeHealthView(
  view: PluginRuntimeView,
  connectors: ConnectorConfig[],
): Effect.Effect<PluginRuntimeView> {
  if (view.tools.state !== "enabled") return Effect.succeed(view);
  return Effect.promise(() =>
    Promise.all(connectors.map((connector) => probeConnector(connector))),
  ).pipe(
    Effect.map((probes) => {
      const failures = probes.flatMap((probe, index) =>
        probe.ok ? [] : [`${connectors[index]?.name}: MCP probe failed`],
      );
      return failures.length
        ? {
            ...view,
            tools: { ...view.tools, state: "invalid" as const, reason: failures.join(" · ") },
          }
        : view;
    }),
  );
}

type ConnectorReconciliation = {
  connectors: ConnectorConfig[];
  errors: Map<string, string>;
  reapprovalRequired: Set<string>;
};

function hasPluginGrant(connector: ConnectorConfig): boolean {
  return connector.enabled || Boolean(connector.allowTools?.length);
}

async function closePluginConnectorPools(connector: ConnectorConfig): Promise<void> {
  const closures = [closePooledConnection(connector.id)];
  if (connector.origin?.kind === "plugin") {
    closures.push(
      closePooledConnection(
        connectorId(connector.origin.id, connector.origin.binding ?? connector.origin.id),
      ),
    );
  }
  await Promise.all(closures);
}

async function samePluginIdentity(existing: ConnectorConfig, replacement: ConnectorConfig): Promise<boolean> {
  const current = existing.origin;
  const expected = replacement.origin;
  if (!current?.artifactDigest || !current.configurationDigest || !current.sourceDigest || !expected) return false;
  if (existing.transport === "stdio") {
    try {
      await Effect.runPromise(verifyPluginExecutionSnapshot(existing));
    } catch {
      return false;
    }
  }
  return (
    current.kind === "plugin" &&
    expected.kind === "plugin" &&
    current.id === expected.id &&
    current.version === expected.version &&
    current.binding === expected.binding &&
    current.artifactDigest === expected.artifactDigest &&
    current.sourceDigest === expected.sourceDigest &&
    current.configurationDigest === expected.configurationDigest &&
    current.configurationDigest === pluginConnectorConfigurationDigest(existing) &&
    expected.configurationDigest === pluginConnectorConfigurationDigest(replacement)
  );
}

const revokedConnector = (
  existing: ConnectorConfig,
  replacement?: ConnectorConfig,
): ConnectorConfig => ({
  ...(replacement ?? existing),
  allowTools: [],
  enabled: false,
});

async function reconcileEnabledPluginConnectors(
  bundles: PluginBundle[],
  initial: ConnectorConfig[],
): Promise<ConnectorReconciliation> {
  let connectors = initial;
  const errors = new Map<string, string>();
  const reapprovalRequired = new Set<string>();
  const discovered = new Set(bundles.map((bundle) => bundle.plugin.id));
  const unavailable = connectors.filter(
    (connector) =>
      connector.origin?.kind === "plugin" &&
      !discovered.has(connector.origin.id) &&
      hasPluginGrant(connector),
  );
  if (unavailable.length > 0) {
    await Promise.all(unavailable.map(closePluginConnectorPools));
    connectors = await replaceConnectorIdentities(
      unavailable.map((connector) => ({
        existingId: connector.id,
        connector: revokedConnector(connector),
      })),
    );
  }
  for (const bundle of bundles) {
    const approved = connectors.filter(
      (connector) =>
        connector.origin?.kind === "plugin" &&
        connector.origin.id === bundle.plugin.id &&
        hasPluginGrant(connector),
    );
    if (approved.length === 0) continue;
    let servers: ResolvedServer[];
    try {
      servers = await Effect.runPromise(loadPluginServers(bundle));
    } catch {
      await Promise.all(approved.map(closePluginConnectorPools));
      connectors = await replaceConnectorIdentities(
        approved.map((connector) => ({
          existingId: connector.id,
          connector: revokedConnector(connector),
        })),
      );
      errors.set(bundle.plugin.id, "Plugin identity could not be verified");
      continue;
    }
    const changed = (await Promise.all(approved.map(async (connector) => {
      const replacement = servers.find(
        (server) => server.connector?.origin?.binding === connector.origin?.binding,
      )?.connector;
      const expected: ConnectorConfig | undefined = replacement?.transport === "stdio" && connector.origin?.snapshotDigest
        ? await Effect.runPromise(expectedPluginExecutionSnapshot(bundle, replacement, connector))
        : replacement ?? undefined;
      return expected && await samePluginIdentity(connector, expected)
        ? []
        : [
            {
              existingId: connector.id,
              connector: revokedConnector(connector, expected ?? undefined),
            },
          ];
    }))).flat();
    if (changed.length === 0) continue;
    await Promise.all(
      changed.map(({ existingId, connector }) =>
        Promise.all([closePooledConnection(existingId), closePluginConnectorPools(connector)]),
      ),
    );
    connectors = await replaceConnectorIdentities(changed);
    reapprovalRequired.add(bundle.plugin.id);
  }
  return { connectors, errors, reapprovalRequired };
}

function connectorReconciliationEffect(
  bundles: PluginBundle[],
): Effect.Effect<ConnectorReconciliation, PluginRuntimeError> {
  return Effect.gen(function* () {
    const initial = yield* connectorsEffect();
    return yield* Effect.tryPromise({
      try: () => reconcileEnabledPluginConnectors(bundles, initial),
      catch: () => new PluginRuntimeError(500, "Plugin reconciliation failed"),
    });
  });
}

export function refreshEnabledPluginConnectors(
  sources?: PluginSource[],
): Effect.Effect<void, PluginRuntimeError> {
  return Effect.gen(function* () {
    const bundles = yield* discoveredBundlesEffect(sources);
    yield* connectorReconciliationEffect(bundles);
  });
}

function connectorsEffect(): Effect.Effect<ConnectorConfig[], PluginRuntimeError> {
  return Effect.tryPromise({
    try: listConnectors,
    catch: () => new PluginRuntimeError(500, "Failed to read connector state"),
  });
}

function discoveredBundlesEffect(
  sources?: PluginSource[],
): Effect.Effect<PluginBundle[], PluginRuntimeError> {
  return Effect.matchEffect(discoverPluginBundles(sources), {
    onFailure: (error) =>
      Effect.tryPromise({
        try: async () => {
          const sourceDigests = new Set(error.sourceDigests);
          if (sourceDigests.size === 0) return;
          const connectors = await listConnectors();
          const affected = connectors.filter(
            (connector) =>
              connector.origin?.kind === "plugin" &&
              connector.origin.sourceDigest !== undefined &&
              sourceDigests.has(connector.origin.sourceDigest) &&
              hasPluginGrant(connector),
          );
          await Promise.all(affected.map(closePluginConnectorPools));
          if (affected.length > 0) {
            await replaceConnectorIdentities(
              affected.map((connector) => ({
                existingId: connector.id,
                connector: revokedConnector(connector),
              })),
            );
          }
        },
        catch: () => new PluginRuntimeError(500, "Plugin discovery revocation failed"),
      }).pipe(
        Effect.flatMap(() => Effect.fail(new PluginRuntimeError(500, error.message))),
      ),
    onSuccess: Effect.succeed,
  });
}

function googleAccountEffect(): Effect.Effect<GoogleAccountView, PluginRuntimeError> {
  return getGoogleAccount().pipe(
    Effect.mapError(
      (error) => new PluginRuntimeError(error.status, `Google account failed: ${error.message}`),
    ),
  );
}

export function listPluginRuntimeViews(
  sources?: PluginSource[],
): Effect.Effect<PluginRuntimeView[], PluginRuntimeError> {
  return Effect.gen(function* () {
    const bundles = yield* discoveredBundlesEffect(sources);
    const reconciliation = yield* connectorReconciliationEffect(bundles);
    const account = yield* googleAccountEffect();
    return yield* Effect.all(
      bundles.map((bundle) =>
        runtimeView(
          bundle,
          reconciliation.connectors,
          account,
          reconciliation.reapprovalRequired.has(bundle.plugin.id),
          reconciliation.errors.get(bundle.plugin.id),
        ),
      ),
    );
  });
}

function enabledObserveConnectors(
  connectors: ConnectorConfig[],
): Effect.Effect<ConnectorConfig[], PluginRuntimeError> {
  return Effect.tryPromise({
    try: async () => {
      const probed = await Promise.all(
        connectors.map(async (connector) => ({
          connector,
          probe: await probeConnector(connector),
        })),
      );
      return probed.map(({ connector, probe }) => {
        if (!probe.ok) {
          throw new PluginRuntimeError(502, `${connector.name} failed to start`);
        }
        const requested = connector.allowTools ? new Set(connector.allowTools) : null;
        const allowTools = probe.tools
          .filter(
            (tool) =>
              tool.annotations?.readOnlyHint === true && (!requested || requested.has(tool.name)),
          )
          .map((tool) => tool.name);
        if (allowTools.length === 0) {
          throw new PluginRuntimeError(
            409,
            `${connector.name} does not declare any read-only tools`,
          );
        }
        if (requested && allowTools.length !== requested.size) {
          throw new PluginRuntimeError(409, `${connector.name} read-only contract changed`);
        }
        return { ...connector, allowTools, enabled: true };
      });
    },
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(502, "Plugin probe failed"),
  });
}

function pluginIdentityReplacements(
  owned: ConnectorConfig[],
  changed: ConnectorConfig[],
  enabling: boolean,
): { existingId: string; connector: ConnectorConfig }[] {
  if (!enabling) {
    return owned.map((connector, index) => ({
      existingId: connector.id,
      connector: changed[index] ?? { ...connector, enabled: false },
    }));
  }
  const remaining = [...changed];
  const replacements = owned.map((connector) => {
    const index = remaining.findIndex(
      (candidate) => candidate.origin?.binding === connector.origin?.binding,
    );
    if (index === -1) {
      return { existingId: connector.id, connector: revokedConnector(connector) };
    }
    const replacement = remaining.splice(index, 1)[0];
    return {
      existingId: connector.id,
      connector: replacement ?? revokedConnector(connector),
    };
  });
  replacements.push(
    ...remaining.map((connector) => ({ existingId: connector.id, connector })),
  );
  return replacements;
}

export function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
  sources?: PluginSource[],
): Effect.Effect<PluginActivationResult, PluginRuntimeError> {
  return Effect.gen(function* () {
    const bundles = yield* discoveredBundlesEffect(sources);
    const bundle = bundles.find((candidate) => candidate.plugin.id === pluginId);
    if (!bundle) return yield* Effect.fail(new PluginRuntimeError(404, "Plugin not found"));
    const current = yield* connectorsEffect();
    const googleWorkspace = yield* trustedGoogleWorkspacePlugin(bundle);
    if (googleWorkspace) {
      const account = yield* googleAccountEffect();
      if (!account.connections[googleWorkspace].connected) {
        return yield* Effect.fail(new PluginRuntimeError(409, "Finish Google sign-in first"));
      }
      const owned = current.filter(
        (connector) =>
          connector.origin?.kind === "account-adapter" &&
          connector.origin.id === googleWorkspace &&
          connector.origin.binding === "google-workspace",
      );
      const changed = enabled
        ? yield* enabledObserveConnectors([googleWorkspaceConnector(googleWorkspace, false)])
        : owned.map((connector) => ({ ...connector, enabled: false }));
      if (changed.length) {
        yield* Effect.tryPromise({
          try: () => upsertConnectors(changed),
          catch: (error) =>
            new PluginRuntimeError(500, `Failed to save account adapter state: ${error}`),
        });
      }
      return {
        plugins: yield* listPluginRuntimeViews(sources),
        connectorIds: changed.map((connector) => connector.id),
      };
    }
    if (yield* loadHostCapability(bundle)) {
      return {
        plugins: yield* listPluginRuntimeViews(sources),
        connectorIds: [],
      };
    }
    const owned = current.filter(
      (connector) => connector.origin?.kind === "plugin" && connector.origin.id === pluginId,
    );
    let changed: ConnectorConfig[];
    if (enabled) {
      const servers = yield* loadPluginServers(bundle);
      const installable = servers.filter((server) => server.connector !== null);
      if (installable.length === 0) {
        const reason = servers.find((server) => server.blocker)?.blocker;
        return yield* Effect.fail(
          new PluginRuntimeError(409, reason ?? "Plugin has no executable MCP server"),
        );
      }
      const prepared = yield* Effect.all(
        servers.flatMap((server) => server.connector ? [preparePluginExecutionSnapshot(bundle, server.connector).pipe(Effect.mapError(() => new PluginRuntimeError(409, "Plugin execution snapshot failed")))] : []),
        { concurrency: 1 },
      );
      changed = yield* enabledObserveConnectors(prepared);
      yield* verifyBundleArtifact(bundle);
    } else {
      if (owned.length === 0) {
        return {
          plugins: yield* listPluginRuntimeViews(sources),
          connectorIds: [],
        };
      }
      changed = owned.map((connector) => ({ ...connector, enabled: false }));
    }
    const replacements = pluginIdentityReplacements(owned, changed, enabled);
    yield* Effect.promise(() =>
      Promise.all(
        replacements.map(({ existingId, connector }) =>
          Promise.all([closePooledConnection(existingId), closePluginConnectorPools(connector)]),
        ),
      ),
    );
    yield* Effect.tryPromise({
      try: () => replaceConnectorIdentities(replacements),
      catch: (error) => new PluginRuntimeError(500, `Failed to save plugin state: ${error}`),
    });
    return {
      plugins: yield* listPluginRuntimeViews(sources),
      connectorIds: changed.map((connector) => connector.id),
    };
  });
}
