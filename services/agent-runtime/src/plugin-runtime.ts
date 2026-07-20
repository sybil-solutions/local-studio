import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Effect, Schema } from "effect";
import {
  connectorAuthorizationMatches,
  connectorExecutionMatches,
} from "./connector-configuration";
import { connectorInventoryDigest } from "./connector-inventory";
import { beginConnectorSecurityTransition, probeConnector } from "./connector-pool";
import {
  inspectConnectors,
  listConnectors,
  replaceConnectorsIfCurrent,
  type ConnectorConfig,
  type ConnectorStateUpdate,
  type ConnectorStateUpdateResult,
} from "./connectors-service";
import { getGoogleAccount, type GoogleAccountView } from "./google-account";
import {
  googleWorkspaceConnector,
  trustedGoogleWorkspacePlugin,
  type GoogleWorkspacePluginId,
} from "./google-workspace-adapter";
import { discoverPluginBundles, type PluginBundle, type PluginSource } from "./plugin-discovery";
import { pluginArtifactDigest } from "./plugin-artifact-digest";
import { clearedPluginConnector } from "./plugin-connector-identity";
import { resolvePluginExecutable, validatePluginExecutable } from "./plugin-executable";
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
const PLUGIN_PERMISSION_REVIEW_REQUIRED =
  "Review connector tool permissions before enabling this plugin";

type ConnectorSecurityTransitionDependencies = {
  begin?: typeof beginConnectorSecurityTransition;
  read?: typeof listConnectors;
  replace?: (updates: readonly ConnectorStateUpdate[]) => Promise<ConnectorStateUpdateResult>;
};

export async function commitConnectorSecurityTransition(
  updates: readonly ConnectorStateUpdate[],
  enabling: boolean,
  dependencies: ConnectorSecurityTransitionDependencies = {},
): Promise<ConnectorConfig[]> {
  const read = dependencies.read ?? listConnectors;
  const replace = dependencies.replace ?? replaceConnectorsIfCurrent;
  if (updates.length === 0) return read();
  const connectors = updates.map(({ replacement }) => replacement);
  const begin = dependencies.begin ?? beginConnectorSecurityTransition;
  const transition = begin(connectors.map((connector) => connector.id));
  const disabled = updates.map(({ expected, replacement }) => ({
    expected,
    replacement: { ...replacement, enabled: false },
  }));
  let result: ConnectorStateUpdateResult | undefined;
  try {
    if (enabling) {
      await transition.shutdown();
      result = await replace(updates);
    } else {
      const staged = await replace(disabled);
      if (staged.committed) await transition.shutdown();
      else result = staged;
    }
    transition.release();
  } catch (error) {
    const fallback = enabling
      ? disabled
      : disabled.map(({ replacement }) => ({ expected: replacement, replacement }));
    await replace(fallback).catch(() => undefined);
    throw error;
  }
  return result ? connectorStateUpdateConnectors(updates, result) : read();
}

function connectorStateUpdateConnectors(
  updates: readonly ConnectorStateUpdate[],
  result: ConnectorStateUpdateResult,
): ConnectorConfig[] {
  if (result.committed) return result.connectors;
  const collision = updates.find(
    ({ expected, replacement }) =>
      expected === null && result.connectors.some(({ id }) => id === replacement.id),
  );
  if (collision) {
    throw new PluginRuntimeError(409, `Connector "${collision.replacement.id}" already exists`);
  }
  return result.connectors;
}

function managedConnectorOwnerMatches(
  current: ConnectorConfig,
  replacement: ConnectorConfig,
): boolean {
  const origin = replacement.origin;
  return (
    (origin?.kind === "plugin" || origin?.kind === "account-adapter") &&
    current.origin?.kind === origin.kind &&
    current.origin.id === origin.id &&
    current.origin.binding === origin.binding
  );
}

function connectorStateUpdates(
  replacements: readonly ConnectorConfig[],
  current: readonly ConnectorConfig[],
): ConnectorStateUpdate[] {
  return replacements.map((replacement) => {
    const existing = current.find((connector) => connector.id === replacement.id);
    if (existing && !managedConnectorOwnerMatches(existing, replacement)) {
      throw new PluginRuntimeError(409, `Connector "${replacement.id}" already exists`);
    }
    return { expected: existing ?? null, replacement };
  });
}

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
    throw new PluginRuntimeError(422, `Plugin path escapes its bundle: ${value}`);
  }
  return canonicalCandidate;
}

async function resolvedCommand(root: string, command: string): Promise<string> {
  if (path.isAbsolute(command)) return command;
  if (command.startsWith(".") || command.includes(path.sep)) {
    return containedRealPath(root, command);
  }
  return command;
}

async function resolvedArg(root: string, value: string): Promise<string> {
  return value.startsWith(".") ? containedRealPath(root, value) : value;
}

function connectorId(pluginId: string, serverId: string): string {
  const base = `plugin-${pluginId}-${serverId}`.toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
  if (base.length <= 64) return base;
  const digest = createHash("sha256").update(base).digest("hex").slice(0, 8);
  return `${base.slice(0, 55)}-${digest}`;
}

async function resolvedServer(
  bundle: PluginBundle,
  serverId: string,
  input: unknown,
): Promise<ResolvedServer> {
  const server = Schema.decodeUnknownSync(McpServerSchema)(input);
  const origin = {
    kind: "plugin",
    id: bundle.plugin.id,
    version: bundle.plugin.version,
    binding: serverId,
    artifactDigest: bundle.artifactDigest,
  };
  const id = connectorId(bundle.plugin.id, serverId);
  const name =
    serverId === bundle.plugin.id
      ? bundle.plugin.displayName
      : `${bundle.plugin.displayName}: ${serverId}`;

  if ("command" in server) {
    const root = await realpath(bundle.rootDir);
    const args = await Promise.all((server.args ?? []).map((value) => resolvedArg(root, value)));
    const cwd = await containedRealPath(root, server.cwd ?? ".");
    const executable = await Effect.runPromise(
      resolvePluginExecutable({
        command: await resolvedCommand(root, server.command),
        args,
        env: { ...(server.env ?? {}) },
        cwd,
        artifactRoot: root,
        artifactDigest: bundle.artifactDigest,
      }),
    );
    return {
      connector: {
        id,
        name,
        transport: "stdio",
        command: executable.command,
        args: executable.args,
        env: { ...(server.env ?? {}) },
        cwd: executable.cwd,
        allowTools: [],
        permissionReviewed: false,
        origin: { ...origin, executable: executable.binding },
        enabled: false,
      },
    };
  }

  if (server.oauth_resource) return { connector: null, blocker: "OAuth connection required" };
  const bearerEnv = server.bearer_token_env_var;
  const bearerToken = bearerEnv ? process.env[bearerEnv]?.trim() : undefined;
  if (bearerEnv && !bearerToken) return { connector: null, blocker: `Set ${bearerEnv}` };
  return {
    connector: {
      id,
      name,
      transport: "http",
      url: server.url,
      headers: {
        ...(server.headers ?? {}),
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
      allowTools: [],
      permissionReviewed: false,
      origin,
      enabled: false,
    },
  };
}

function loadPluginServers(
  bundle: PluginBundle,
): Effect.Effect<ResolvedServer[], PluginRuntimeError> {
  if (!bundle.manifest.mcpServers) return Effect.succeed([]);
  return Effect.tryPromise({
    try: async () => {
      const before = await Effect.runPromise(pluginArtifactDigest(bundle.rootDir));
      if (before !== bundle.artifactDigest) {
        throw new PluginRuntimeError(409, "Plugin artifact changed before connector resolution");
      }
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
      if ((await Effect.runPromise(pluginArtifactDigest(bundle.rootDir))) !== before) {
        throw new PluginRuntimeError(409, "Plugin artifact changed during connector resolution");
      }
      return servers;
    },
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(
            422,
            `Invalid MCP manifest for ${bundle.plugin.displayName}: ${error}`,
          ),
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
        : new PluginRuntimeError(422, `Invalid Chatterbox Voice manifest: ${error}`),
  });
}

function pluginToolsView(
  bundle: PluginBundle,
  connectors: ConnectorConfig[],
  servers: ResolvedServer[],
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
  if (current.some((connector) => !connector.permissionReviewed)) {
    return {
      state: "configuration_required",
      serverCount: servers.length,
      allowedToolCount: 0,
      mode: null,
      reason: PLUGIN_PERMISSION_REVIEW_REQUIRED,
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
  if (current.length > 0) {
    return {
      state: "disabled",
      serverCount: servers.length,
      allowedToolCount: 0,
      mode: "observe",
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
            tools: pluginToolsView(bundle, connectors, servers, reconciliationError),
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
        probe.ok ? [] : [`${connectors[index]?.name}: ${probe.error ?? "MCP probe failed"}`],
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
};

function candidateWithReviewedInventory(
  candidate: ConnectorConfig,
  current: ConnectorConfig,
): ConnectorConfig {
  const inventoryDigest = current.origin?.inventoryDigest;
  return inventoryDigest && candidate.origin
    ? { ...candidate, origin: { ...candidate.origin, inventoryDigest } }
    : candidate;
}

async function reconciledPluginConnector(
  current: ConnectorConfig,
  servers: ResolvedServer[],
): Promise<ConnectorConfig> {
  const candidate = servers.find(
    (server) => server.connector?.origin?.binding === current.origin?.binding,
  )?.connector;
  if (!candidate) return clearedPluginConnector(current);
  const comparable = candidateWithReviewedInventory(candidate, current);
  if (!connectorExecutionMatches(current, comparable)) {
    return clearedPluginConnector(candidate);
  }
  if (!current.permissionReviewed) return current;
  const inventoryDigest = current.origin?.inventoryDigest;
  if (!current.origin?.artifactDigest || !inventoryDigest) {
    return clearedPluginConnector(current);
  }
  const probe = await probeConnector(current);
  if (!probe.ok || connectorInventoryDigest(probe.tools) !== inventoryDigest) {
    return clearedPluginConnector(current);
  }
  return current;
}

async function reconcileEnabledPluginConnectors(
  bundles: PluginBundle[],
  initial: ConnectorConfig[],
  pluginIds?: ReadonlySet<string>,
): Promise<ConnectorReconciliation> {
  const errors = new Map<string, string>();
  const bundlesById = new Map(bundles.map((bundle) => [bundle.plugin.id, bundle]));
  const serversById = new Map<string, ResolvedServer[]>();
  const changed: ConnectorConfig[] = [];
  for (const connector of initial) {
    if (connector.origin?.kind !== "plugin") continue;
    if (pluginIds && !pluginIds.has(connector.origin.id)) continue;
    const bundle = bundlesById.get(connector.origin.id);
    let reconciled: ConnectorConfig;
    if (!bundle) {
      reconciled = clearedPluginConnector(connector);
    } else {
      try {
        let servers = serversById.get(bundle.plugin.id);
        if (!servers) {
          servers = await Effect.runPromise(loadPluginServers(bundle));
          serversById.set(bundle.plugin.id, servers);
        }
        reconciled = await reconciledPluginConnector(connector, servers);
      } catch {
        reconciled = clearedPluginConnector(connector);
        errors.set(bundle.plugin.id, "Plugin connector update failed");
      }
    }
    if (!connectorAuthorizationMatches(connector, reconciled)) {
      changed.push(reconciled);
      errors.set(connector.origin.id, PLUGIN_PERMISSION_REVIEW_REQUIRED);
    }
  }
  if (changed.length === 0) return { connectors: initial, errors };
  const connectors = await commitConnectorSecurityTransition(
    connectorStateUpdates(changed, initial),
    changed.some((connector) => connector.enabled),
  );
  return { connectors, errors };
}

function connectorReconciliationEffect(
  bundles: PluginBundle[],
  pluginIds?: ReadonlySet<string>,
  readConnectors: () => Promise<ConnectorConfig[]> = listConnectors,
): Effect.Effect<ConnectorReconciliation, PluginRuntimeError> {
  return Effect.gen(function* () {
    const initial = yield* connectorsEffect(readConnectors);
    return yield* Effect.tryPromise({
      try: () => reconcileEnabledPluginConnectors(bundles, initial, pluginIds),
      catch: (error) => new PluginRuntimeError(500, `Plugin reconciliation failed: ${error}`),
    });
  });
}

export function refreshEnabledPluginConnectors(
  sources?: PluginSource[],
  pluginIds?: ReadonlySet<string>,
): Effect.Effect<void, PluginRuntimeError> {
  return Effect.gen(function* () {
    const bundles = yield* discoverPluginBundles(sources, 5, pluginIds).pipe(
      Effect.mapError((error) => new PluginRuntimeError(500, error.message)),
    );
    yield* connectorReconciliationEffect(bundles, pluginIds, inspectConnectors);
  });
}

export function validatePluginConnectorInvocation(
  connector: ConnectorConfig,
  sources?: PluginSource[],
): Effect.Effect<ConnectorConfig, PluginRuntimeError> {
  return Effect.tryPromise({
    try: async () => {
      const origin = connector.origin;
      if (origin?.kind !== "plugin") {
        throw new PluginRuntimeError(409, "Plugin connector identity changed");
      }
      const bundles = await Effect.runPromise(
        discoverPluginBundles(sources, 5, new Set([origin.id])),
      );
      const bundle = bundles.find((candidate) => candidate.plugin.id === origin.id);
      if (!bundle) throw new PluginRuntimeError(409, "Plugin connector identity changed");
      if (
        connector.transport === "stdio" &&
        (connector.origin?.executable?.sourceRoot !== (await realpath(bundle.rootDir)) ||
          connector.origin.executable.artifactDigest !== bundle.artifactDigest)
      ) {
        throw new PluginRuntimeError(409, "Plugin connector identity changed");
      }
      if (connector.transport === "stdio") {
        await Effect.runPromise(validatePluginExecutable(connector));
      }
      const servers = await Effect.runPromise(loadPluginServers(bundle));
      const candidate = servers.find(
        (server) => server.connector?.origin?.binding === origin.binding,
      )?.connector;
      if (
        !candidate ||
        !connectorExecutionMatches(connector, candidateWithReviewedInventory(candidate, connector))
      ) {
        throw new PluginRuntimeError(409, "Plugin connector identity changed");
      }
      if (connector.transport === "stdio") {
        await Effect.runPromise(validatePluginExecutable(connector));
      }
      return connector;
    },
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(409, "Plugin connector identity changed"),
  });
}

type PluginConnectorGrantInput = {
  id: string;
  allowTools: readonly string[];
  permissionReviewed: boolean;
  enabled: boolean;
  reviewedArtifactDigest?: string;
  reviewedInventoryDigest?: string;
};

function sameGrant(left: readonly string[], right: readonly string[]): boolean {
  const normalized = (values: readonly string[]) => [...new Set(values)].sort();
  const leftValues = normalized(left);
  const rightValues = normalized(right);
  return (
    leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index])
  );
}

async function rejectPluginConnectorGrant(
  connector: ConnectorConfig,
  message: string,
): Promise<never> {
  await commitConnectorSecurityTransition(
    [{ expected: connector, replacement: clearedPluginConnector(connector) }],
    false,
  );
  throw new PluginRuntimeError(409, message);
}

export function updatePluginConnectorGrant(
  input: PluginConnectorGrantInput,
  sources?: PluginSource[],
): Effect.Effect<ConnectorConfig[], PluginRuntimeError> {
  return Effect.tryPromise({
    try: async () => {
      const stored = (await listConnectors()).find((connector) => connector.id === input.id);
      if (!stored || stored.origin?.kind !== "plugin") {
        throw new PluginRuntimeError(404, "Plugin connector not found");
      }
      const pluginIds = new Set([stored.origin.id]);
      await Effect.runPromise(refreshEnabledPluginConnectors(sources, pluginIds));
      const current = (await listConnectors()).find((connector) => connector.id === input.id);
      if (!current || current.origin?.kind !== "plugin") {
        throw new PluginRuntimeError(404, "Plugin connector not found");
      }
      const explicitReview = Boolean(input.reviewedArtifactDigest && input.reviewedInventoryDigest);
      if (Boolean(input.reviewedArtifactDigest) !== Boolean(input.reviewedInventoryDigest)) {
        return rejectPluginConnectorGrant(current, PLUGIN_PERMISSION_REVIEW_REQUIRED);
      }
      if (!input.permissionReviewed) {
        return commitConnectorSecurityTransition(
          [{ expected: current, replacement: clearedPluginConnector(current) }],
          false,
        );
      }
      if (!input.enabled && !explicitReview) {
        return commitConnectorSecurityTransition(
          [{ expected: current, replacement: { ...current, enabled: false } }],
          false,
        );
      }
      if (
        (explicitReview && input.reviewedArtifactDigest !== current.origin.artifactDigest) ||
        (!explicitReview &&
          (!current.permissionReviewed || !sameGrant(input.allowTools, current.allowTools)))
      ) {
        return rejectPluginConnectorGrant(current, PLUGIN_PERMISSION_REVIEW_REQUIRED);
      }
      const probe = await probeConnector(current);
      const inventoryDigest = probe.ok ? connectorInventoryDigest(probe.tools) : null;
      await Effect.runPromise(refreshEnabledPluginConnectors(sources, pluginIds));
      const latest = (await listConnectors()).find((connector) => connector.id === input.id);
      if (
        !latest ||
        latest.origin?.kind !== "plugin" ||
        !connectorAuthorizationMatches(current, latest) ||
        !inventoryDigest ||
        (explicitReview && input.reviewedInventoryDigest !== inventoryDigest) ||
        (!explicitReview && latest.origin.inventoryDigest !== inventoryDigest)
      ) {
        return rejectPluginConnectorGrant(current, PLUGIN_PERMISSION_REVIEW_REQUIRED);
      }
      const advertised = new Set(probe.tools.map((tool) => tool.name));
      if (input.allowTools.some((tool) => !advertised.has(tool))) {
        return rejectPluginConnectorGrant(latest, PLUGIN_PERMISSION_REVIEW_REQUIRED);
      }
      const reviewed = {
        ...latest,
        allowTools: [...new Set(input.allowTools)],
        permissionReviewed: true,
        origin: { ...latest.origin, inventoryDigest },
        enabled: input.enabled,
      };
      return commitConnectorSecurityTransition(
        [{ expected: latest, replacement: reviewed }],
        reviewed.enabled,
      );
    },
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(500, "Plugin connector review failed"),
  });
}

function connectorsEffect(
  readConnectors: () => Promise<ConnectorConfig[]> = listConnectors,
): Effect.Effect<ConnectorConfig[], PluginRuntimeError> {
  return Effect.tryPromise({
    try: readConnectors,
    catch: (error) => new PluginRuntimeError(500, `Failed to read connector state: ${error}`),
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
    const bundles = yield* discoverPluginBundles(sources).pipe(
      Effect.mapError((error) => new PluginRuntimeError(500, error.message)),
    );
    const reconciliation = yield* connectorReconciliationEffect(bundles);
    const account = yield* googleAccountEffect();
    return yield* Effect.all(
      bundles.map((bundle) =>
        runtimeView(
          bundle,
          reconciliation.connectors,
          account,
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
        if (!connector.permissionReviewed) {
          throw new PluginRuntimeError(409, PLUGIN_PERMISSION_REVIEW_REQUIRED);
        }
        if (!probe.ok) {
          throw new PluginRuntimeError(
            502,
            `${connector.name} failed to start: Connector probe failed`,
          );
        }
        const advertised = new Map(probe.tools.map((tool) => [tool.name, tool]));
        if (
          connector.allowTools.some(
            (tool) => advertised.get(tool)?.annotations?.readOnlyHint !== true,
          )
        ) {
          throw new PluginRuntimeError(409, `${connector.name} reviewed tool grant changed`);
        }
        return { ...connector, enabled: true };
      });
    },
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(502, "Plugin connector probe failed"),
  });
}

function reviewedPluginConnector(
  connector: ConnectorConfig,
  current: ConnectorConfig[],
): ConnectorConfig {
  const candidate = current.find((currentConnector) => currentConnector.id === connector.id);
  const reviewed =
    candidate?.permissionReviewed &&
    connectorExecutionMatches(candidate, candidateWithReviewedInventory(connector, candidate))
      ? candidate
      : undefined;
  return reviewed
    ? {
        ...candidateWithReviewedInventory(connector, reviewed),
        allowTools: [...reviewed.allowTools],
        permissionReviewed: true,
      }
    : connector;
}

function stagePluginConnectorReview(
  connectors: ConnectorConfig[],
  current: readonly ConnectorConfig[],
): Effect.Effect<never, PluginRuntimeError> {
  return Effect.tryPromise({
    try: () =>
      commitConnectorSecurityTransition(
        connectorStateUpdates(
          connectors.map((connector) => ({ ...connector, enabled: false })),
          current,
        ),
        false,
      ),
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(500, "Failed to stage plugin connector review"),
  }).pipe(
    Effect.flatMap(() =>
      Effect.fail(new PluginRuntimeError(409, PLUGIN_PERMISSION_REVIEW_REQUIRED)),
    ),
  );
}

export function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
  sources?: PluginSource[],
): Effect.Effect<PluginActivationResult, PluginRuntimeError> {
  return Effect.gen(function* () {
    const bundles = yield* discoverPluginBundles(sources, 5, new Set([pluginId])).pipe(
      Effect.mapError((error) => new PluginRuntimeError(500, error.message)),
    );
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
          try: () =>
            commitConnectorSecurityTransition(connectorStateUpdates(changed, current), enabled),
          catch: (error) =>
            error instanceof PluginRuntimeError
              ? error
              : new PluginRuntimeError(
                  500,
                  `Account adapter lifecycle transition failed: ${error}`,
                ),
        });
      }
      return { plugins: yield* listPluginRuntimeViews(sources) };
    }
    if (yield* loadHostCapability(bundle)) {
      return { plugins: yield* listPluginRuntimeViews(sources) };
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
      const candidates = servers
        .flatMap((server) => (server.connector ? [server.connector] : []))
        .map((connector) => reviewedPluginConnector(connector, owned));
      if (candidates.some((connector) => !connector.permissionReviewed)) {
        return yield* stagePluginConnectorReview(candidates, current);
      }
      changed = yield* enabledObserveConnectors(candidates);
    } else {
      if (owned.length === 0) {
        return { plugins: yield* listPluginRuntimeViews(sources) };
      }
      changed = owned.map((connector) => ({ ...connector, enabled: false }));
    }
    yield* Effect.tryPromise({
      try: () =>
        commitConnectorSecurityTransition(connectorStateUpdates(changed, current), enabled),
      catch: (error) =>
        error instanceof PluginRuntimeError
          ? error
          : new PluginRuntimeError(500, `Plugin lifecycle transition failed: ${error}`),
    });
    return { plugins: yield* listPluginRuntimeViews(sources) };
  });
}
