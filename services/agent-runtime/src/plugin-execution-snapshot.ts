import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, cp, lstat, mkdir, open, opendir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type { ConnectorConfig } from "./connector-contract";
import { resolveDataDir } from "./data-dir";
import { pluginArtifactDigest } from "./plugin-artifact-digest";
import { pluginConnectorConfigurationDigest } from "./plugin-connector-identity";
import type { PluginBundle } from "./plugin-discovery";

export class PluginExecutionSnapshotError extends Error {}

const snapshotRoot = (artifactDigest: string): string =>
  path.join(resolveDataDir(), "runtime", "plugin-executables", artifactDigest.replace("sha256:", ""));

const contained = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

async function fileDigest(file: string): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    const before = await handle.stat();
    if (!before.isFile()) throw new PluginExecutionSnapshotError("Plugin runtime is invalid");
    while (position < before.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (bytesRead === 0) throw new PluginExecutionSnapshotError("Plugin runtime changed while copying");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new PluginExecutionSnapshotError("Plugin runtime changed while copying");
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function hardenTree(root: string): Promise<void> {
  const visit = async (entryPath: string): Promise<void> => {
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
      const directory = await opendir(entryPath);
      for await (const entry of directory) await visit(path.join(entryPath, entry.name));
      await chmod(entryPath, 0o500);
      return;
    }
    if (!stats.isFile()) throw new PluginExecutionSnapshotError("Plugin snapshot contains an unsupported entry");
    await chmod(entryPath, stats.mode & 0o111 ? 0o500 : 0o400);
  };
  await visit(root);
}

async function assertHardened(root: string): Promise<void> {
  const visit = async (entryPath: string): Promise<void> => {
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) return;
    if ((stats.mode & 0o0222) !== 0) throw new PluginExecutionSnapshotError("Plugin snapshot is writable");
    if (stats.isDirectory()) {
      const directory = await opendir(entryPath);
      for await (const entry of directory) await visit(path.join(entryPath, entry.name));
      return;
    }
    if (!stats.isFile()) throw new PluginExecutionSnapshotError("Plugin snapshot contains an unsupported entry");
  };
  await visit(root);
}

async function assertSnapshotPath(root: string, value: string): Promise<void> {
  if (!path.isAbsolute(value) || !contained(root, value)) {
    throw new PluginExecutionSnapshotError("Plugin snapshot path changed");
  }
  const { realpath } = await import("node:fs/promises");
  const [canonicalRoot, canonical] = await Promise.all([realpath(root), realpath(value)]);
  if (!contained(canonicalRoot, canonical)) throw new PluginExecutionSnapshotError("Plugin snapshot path changed");
}

async function removeTree(root: string): Promise<void> {
  try {
    const stats = await lstat(root);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      await chmod(root, 0o700);
      const directory = await opendir(root);
      for await (const entry of directory) await removeTree(path.join(root, entry.name));
    } else if (!stats.isSymbolicLink()) {
      await chmod(root, 0o600);
    }
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

const mapIntoSnapshot = (sourceRoot: string, artifactRoot: string, value: string): string => {
  if (!contained(sourceRoot, value)) throw new PluginExecutionSnapshotError("Plugin executable path escapes its bundle");
  return path.join(artifactRoot, path.relative(sourceRoot, value));
};

async function snapshotConnector(bundle: PluginBundle, connector: ConnectorConfig): Promise<ConnectorConfig> {
  if (connector.transport !== "stdio" || !connector.command) return connector;
  const destination = snapshotRoot(bundle.artifactDigest);
  const artifactRoot = path.join(destination, "artifact");
  const sourceRoot = await import("node:fs/promises").then(({ realpath }) => realpath(bundle.rootDir));
  const runtimeCommand = connector.command === process.execPath;
  const temp = `${destination}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await removeTree(temp);
  try {
    await mkdir(temp, { recursive: true, mode: 0o700 });
    await cp(sourceRoot, path.join(temp, "artifact"), { recursive: true, dereference: false, verbatimSymlinks: true });
    const copiedDigest = await Effect.runPromise(pluginArtifactDigest(path.join(temp, "artifact")));
    if (copiedDigest !== bundle.artifactDigest) throw new PluginExecutionSnapshotError("Plugin artifact changed while snapshotting");
    let runtimeDigest: string | undefined;
    if (runtimeCommand) {
      runtimeDigest = await fileDigest(process.execPath);
    }
    await hardenTree(temp);
    await removeTree(destination);
    await rename(temp, destination);
    const snapshotDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    const prepared: ConnectorConfig = {
      ...connector,
      command: runtimeCommand ? process.execPath : mapIntoSnapshot(sourceRoot, artifactRoot, connector.command),
      args: connector.args?.map((value) => contained(sourceRoot, value) ? mapIntoSnapshot(sourceRoot, artifactRoot, value) : value),
      cwd: connector.cwd ? mapIntoSnapshot(sourceRoot, artifactRoot, connector.cwd) : artifactRoot,
      origin: connector.origin ? { ...connector.origin, snapshotDigest, ...(runtimeDigest ? { runtimeDigest } : {}) } : connector.origin,
    };
    return prepared.origin
      ? { ...prepared, origin: { ...prepared.origin, configurationDigest: pluginConnectorConfigurationDigest(prepared) } }
      : prepared;
  } finally {
    await removeTree(temp).catch(() => undefined);
  }
}

export function preparePluginExecutionSnapshot(bundle: PluginBundle, connector: ConnectorConfig): Effect.Effect<ConnectorConfig, PluginExecutionSnapshotError> {
  return Effect.tryPromise({ try: () => snapshotConnector(bundle, connector), catch: (error) => error instanceof PluginExecutionSnapshotError ? error : new PluginExecutionSnapshotError("Plugin execution snapshot failed") });
}

export function expectedPluginExecutionSnapshot(
  bundle: PluginBundle,
  connector: ConnectorConfig,
  existing: ConnectorConfig,
): Effect.Effect<ConnectorConfig, PluginExecutionSnapshotError> {
  return Effect.tryPromise({
    try: async () => {
      if (!connector.origin || !existing.origin?.snapshotDigest || connector.transport !== "stdio" || !connector.command) {
        throw new PluginExecutionSnapshotError("Plugin execution snapshot identity is missing");
      }
      const connectorOrigin = connector.origin;
      const sourceRoot = await import("node:fs/promises").then(({ realpath }) => realpath(bundle.rootDir));
      const artifactRoot = path.join(snapshotRoot(bundle.artifactDigest), "artifact");
      const mapped: ConnectorConfig = {
        ...connector,
        command: connector.command === process.execPath
          ? process.execPath
          : mapIntoSnapshot(sourceRoot, artifactRoot, connector.command),
        args: connector.args?.map((value) =>
          contained(sourceRoot, value) ? mapIntoSnapshot(sourceRoot, artifactRoot, value) : value,
        ),
        cwd: connector.cwd
          ? mapIntoSnapshot(sourceRoot, artifactRoot, connector.cwd)
          : artifactRoot,
        origin: {
          ...connectorOrigin,
          snapshotDigest: existing.origin.snapshotDigest,
          ...(existing.origin.runtimeDigest ? { runtimeDigest: existing.origin.runtimeDigest } : {}),
        },
      };
      return {
        ...mapped,
        origin: {
          ...connectorOrigin,
          snapshotDigest: existing.origin.snapshotDigest,
          ...(existing.origin.runtimeDigest ? { runtimeDigest: existing.origin.runtimeDigest } : {}),
          configurationDigest: pluginConnectorConfigurationDigest(mapped),
        },
      };
    },
    catch: (error) =>
      error instanceof PluginExecutionSnapshotError
        ? error
        : new PluginExecutionSnapshotError("Plugin execution snapshot identity failed"),
  });
}

export function verifyPluginExecutionSnapshot(connector: ConnectorConfig): Effect.Effect<void, PluginExecutionSnapshotError> {
  return Effect.tryPromise({
    try: async () => {
      if (connector.transport !== "stdio" || connector.origin?.kind !== "plugin" || !connector.origin.artifactDigest || !connector.origin.snapshotDigest) throw new PluginExecutionSnapshotError("Plugin execution snapshot is missing");
      const root = snapshotRoot(connector.origin.artifactDigest);
      const artifactRoot = path.join(root, "artifact");
      await assertHardened(root);
      if ((await Effect.runPromise(pluginArtifactDigest(artifactRoot))) !== connector.origin.snapshotDigest) throw new PluginExecutionSnapshotError("Plugin execution snapshot changed");
      if (connector.command === process.execPath && !connector.origin.runtimeDigest) throw new PluginExecutionSnapshotError("Plugin runtime identity is missing");
      if (connector.origin.runtimeDigest && connector.command !== process.execPath) throw new PluginExecutionSnapshotError("Plugin runtime path changed");
      if (connector.origin.runtimeDigest && (await fileDigest(process.execPath)) !== connector.origin.runtimeDigest) throw new PluginExecutionSnapshotError("Plugin runtime changed");
      if (!connector.origin.runtimeDigest) await assertSnapshotPath(artifactRoot, connector.command ?? "");
      await assertSnapshotPath(artifactRoot, connector.cwd ?? "");
      for (const value of connector.args ?? []) {
        if (path.isAbsolute(value)) await assertSnapshotPath(artifactRoot, value);
        else if (value.includes(path.sep)) throw new PluginExecutionSnapshotError("Plugin argument path changed");
      }
    },
    catch: (error) => error instanceof PluginExecutionSnapshotError ? error : new PluginExecutionSnapshotError("Plugin execution snapshot could not be verified"),
  });
}
