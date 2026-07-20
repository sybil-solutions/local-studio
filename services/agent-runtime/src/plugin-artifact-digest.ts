import { createHash, type Hash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, readlink, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";

export type PluginArtifactDigestLimits = {
  maxEntries: number;
  maxFileBytes: bigint;
  maxTotalBytes: bigint;
  maxPathBytes: number;
  maxSymlinkTargetBytes: number;
};

type ArtifactHandle = {
  stat: () => Promise<BigIntStats>;
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number }>;
  close: () => Promise<void>;
};

export type PluginArtifactFileSystem = {
  lstat: (file: string) => Promise<BigIntStats>;
  open: (file: string, flags: number) => Promise<ArtifactHandle>;
  readdir: (directory: string) => Promise<string[]>;
  readlink: (file: string) => Promise<string>;
  realpath: (file: string) => Promise<string>;
};

const handleView = (handle: FileHandle): ArtifactHandle => ({
  stat: () => handle.stat({ bigint: true }),
  read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
  close: () => handle.close(),
});

export const pluginArtifactFileSystem: PluginArtifactFileSystem = {
  lstat: (file) => lstat(file, { bigint: true }),
  open: async (file, flags) => handleView(await open(file, flags)),
  readdir: (directory) => readdir(directory),
  readlink: (file) => readlink(file),
  realpath: (file) => realpath(file),
};

const DEFAULT_LIMITS: PluginArtifactDigestLimits = {
  maxEntries: 50_000,
  maxFileBytes: BigInt(256) * BigInt(1024) * BigInt(1024),
  maxTotalBytes: BigInt(1024) * BigInt(1024) * BigInt(1024),
  maxPathBytes: 4096,
  maxSymlinkTargetBytes: 4096,
};
const READ_BUFFER_BYTES = 64 * 1024;
const HASH_PREFIX = "local-studio-plugin-artifact-v1";
const CONTENT_HASH_PREFIX = "local-studio-plugin-artifact-content-v1";
const FILE_HASH_PREFIX = "local-studio-executable-file-v1";

export class PluginArtifactDigestError extends Error {}

export type PluginExecutableFileIdentity = {
  path: string;
  digest: string;
  mode: number;
};

type DigestState = {
  entries: number;
  totalBytes: bigint;
};

type ArtifactIdentity = {
  prefix: string;
  mode: (stat: BigIntStats) => string;
};

function relativeLabel(relative: string): string {
  return relative || ".";
}

function failure(message: string, relative: string): PluginArtifactDigestError {
  return new PluginArtifactDigestError(`${message} at ${relativeLabel(relative)}`);
}

async function artifactOperation<A>(
  message: string,
  relative: string,
  operation: () => Promise<A>,
): Promise<A> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PluginArtifactDigestError) throw error;
    throw failure(message, relative);
  }
}

function sortedNames(names: string[]): string[] {
  return [...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function normalizedRelative(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function relevantMode(stat: BigIntStats): string {
  return Number(stat.mode & BigInt(0o777))
    .toString(8)
    .padStart(3, "0");
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function updateField(hash: Hash, value: string | Buffer): void {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function updateEntry(hash: Hash, relative: string, type: string, mode: string): void {
  updateField(hash, relativeLabel(relative));
  updateField(hash, type);
  updateField(hash, mode);
}

function addEntry(state: DigestState, relative: string, limits: PluginArtifactDigestLimits): void {
  state.entries += 1;
  if (state.entries > limits.maxEntries) {
    throw failure("Plugin artifact exceeds its entry limit", relative);
  }
  if (Buffer.byteLength(relativeLabel(relative), "utf8") > limits.maxPathBytes) {
    throw failure("Plugin artifact path exceeds its size limit", relative);
  }
}

function addBytes(
  state: DigestState,
  bytes: bigint,
  relative: string,
  limits: PluginArtifactDigestLimits,
): void {
  state.totalBytes += bytes;
  if (state.totalBytes > limits.maxTotalBytes) {
    throw failure("Plugin artifact exceeds its total size limit", relative);
  }
}

async function hashRegularFile(
  absolute: string,
  relative: string,
  initial: BigIntStats,
  hash: Hash,
  state: DigestState,
  limits: PluginArtifactDigestLimits,
  fileSystem: PluginArtifactFileSystem,
  identity: ArtifactIdentity,
): Promise<void> {
  if (initial.size > limits.maxFileBytes) {
    throw failure("Plugin file exceeds its size limit", relative);
  }
  addBytes(state, initial.size, relative, limits);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await artifactOperation("Plugin file cannot be opened", relative, () =>
    fileSystem.open(absolute, flags),
  );
  try {
    const opened = await artifactOperation("Plugin file cannot be inspected", relative, () =>
      handle.stat(),
    );
    if (!opened.isFile() || !sameIdentity(initial, opened)) {
      throw failure("Plugin artifact changed while hashing", relative);
    }
    updateEntry(hash, relative, "file", identity.mode(opened));
    updateField(hash, opened.size.toString());
    const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
    let position = 0;
    while (BigInt(position) < opened.size) {
      const remaining = opened.size - BigInt(position);
      const length = Number(remaining < BigInt(buffer.length) ? remaining : BigInt(buffer.length));
      const { bytesRead } = await artifactOperation("Plugin file cannot be read", relative, () =>
        handle.read(buffer, 0, length, position),
      );
      if (bytesRead === 0) throw failure("Plugin artifact changed while hashing", relative);
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const closed = await artifactOperation("Plugin file cannot be inspected", relative, () =>
      handle.stat(),
    );
    const current = await artifactOperation("Plugin file cannot be inspected", relative, () =>
      fileSystem.lstat(absolute),
    );
    if (!sameIdentity(opened, closed) || !sameIdentity(opened, current)) {
      throw failure("Plugin artifact changed while hashing", relative);
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function hashSymlink(
  root: string,
  absolute: string,
  relative: string,
  initial: BigIntStats,
  hash: Hash,
  state: DigestState,
  limits: PluginArtifactDigestLimits,
  fileSystem: PluginArtifactFileSystem,
  identity: ArtifactIdentity,
): Promise<void> {
  const target = await artifactOperation("Plugin symlink cannot be read", relative, () =>
    fileSystem.readlink(absolute),
  );
  const targetBytes = Buffer.byteLength(target, "utf8");
  if (targetBytes > limits.maxSymlinkTargetBytes) {
    throw failure("Plugin symlink target exceeds its size limit", relative);
  }
  const resolved = await artifactOperation("Plugin symlink is invalid", relative, () =>
    fileSystem.realpath(absolute),
  );
  if (!contained(root, resolved)) throw failure("Plugin symlink escapes its artifact", relative);
  const currentTarget = await artifactOperation("Plugin symlink cannot be read", relative, () =>
    fileSystem.readlink(absolute),
  );
  const current = await artifactOperation("Plugin symlink cannot be inspected", relative, () =>
    fileSystem.lstat(absolute),
  );
  if (target !== currentTarget || !sameIdentity(initial, current)) {
    throw failure("Plugin artifact changed while hashing", relative);
  }
  addBytes(state, BigInt(targetBytes), relative, limits);
  updateEntry(hash, relative, "symlink", identity.mode(current));
  updateField(hash, target);
}

async function hashDirectory(
  root: string,
  absolute: string,
  relative: string,
  initial: BigIntStats,
  hash: Hash,
  state: DigestState,
  limits: PluginArtifactDigestLimits,
  fileSystem: PluginArtifactFileSystem,
  identity: ArtifactIdentity,
): Promise<void> {
  updateEntry(hash, relative, "directory", identity.mode(initial));
  const before = sortedNames(
    await artifactOperation("Plugin directory cannot be read", relative, () =>
      fileSystem.readdir(absolute),
    ),
  );
  for (const name of before) {
    await hashEntry(
      root,
      path.join(absolute, name),
      normalizedRelative(relative, name),
      hash,
      state,
      limits,
      fileSystem,
      identity,
    );
  }
  const after = sortedNames(
    await artifactOperation("Plugin directory cannot be read", relative, () =>
      fileSystem.readdir(absolute),
    ),
  );
  const current = await artifactOperation("Plugin directory cannot be inspected", relative, () =>
    fileSystem.lstat(absolute),
  );
  if (before.length !== after.length || before.some((name, index) => name !== after[index])) {
    throw failure("Plugin artifact changed while hashing", relative);
  }
  if (!sameIdentity(initial, current)) {
    throw failure("Plugin artifact changed while hashing", relative);
  }
}

async function hashEntry(
  root: string,
  absolute: string,
  relative: string,
  hash: Hash,
  state: DigestState,
  limits: PluginArtifactDigestLimits,
  fileSystem: PluginArtifactFileSystem,
  identity: ArtifactIdentity,
): Promise<void> {
  addEntry(state, relative, limits);
  const initial = await artifactOperation("Plugin artifact cannot be inspected", relative, () =>
    fileSystem.lstat(absolute),
  );
  if (initial.isFile()) {
    await hashRegularFile(absolute, relative, initial, hash, state, limits, fileSystem, identity);
    return;
  }
  if (initial.isDirectory()) {
    await hashDirectory(
      root,
      absolute,
      relative,
      initial,
      hash,
      state,
      limits,
      fileSystem,
      identity,
    );
    return;
  }
  if (initial.isSymbolicLink()) {
    await hashSymlink(root, absolute, relative, initial, hash, state, limits, fileSystem, identity);
    return;
  }
  throw failure("Plugin artifact contains an unsupported entry", relative);
}

async function calculateDigest(
  inputRoot: string,
  limits: PluginArtifactDigestLimits,
  fileSystem: PluginArtifactFileSystem,
  identity: ArtifactIdentity,
): Promise<string> {
  const root = await artifactOperation("Plugin artifact root is invalid", "", () =>
    fileSystem.realpath(inputRoot),
  );
  const hash = createHash("sha256");
  updateField(hash, identity.prefix);
  await hashEntry(
    root,
    root,
    "",
    hash,
    { entries: 0, totalBytes: BigInt(0) },
    limits,
    fileSystem,
    identity,
  );
  const currentRoot = await artifactOperation("Plugin artifact root is invalid", "", () =>
    fileSystem.realpath(inputRoot),
  );
  if (currentRoot !== root) throw failure("Plugin artifact changed while hashing", "");
  return `sha256:${hash.digest("hex")}`;
}

async function calculateFileIdentity(
  input: string,
  fileSystem: PluginArtifactFileSystem,
): Promise<PluginExecutableFileIdentity> {
  const label = path.basename(input) || ".";
  const canonical = await artifactOperation("Plugin executable is invalid", label, () =>
    fileSystem.realpath(input),
  );
  const initial = await artifactOperation("Plugin executable cannot be inspected", label, () =>
    fileSystem.lstat(canonical),
  );
  if (!initial.isFile()) throw failure("Plugin executable is not a regular file", label);
  const hash = createHash("sha256");
  updateField(hash, FILE_HASH_PREFIX);
  await hashRegularFile(
    canonical,
    "",
    initial,
    hash,
    { entries: 1, totalBytes: BigInt(0) },
    DEFAULT_LIMITS,
    fileSystem,
    { prefix: FILE_HASH_PREFIX, mode: () => "" },
  );
  const current = await artifactOperation("Plugin executable is invalid", label, () =>
    fileSystem.realpath(input),
  );
  if (current !== canonical) throw failure("Plugin executable changed while hashing", label);
  return {
    path: canonical,
    digest: `sha256:${hash.digest("hex")}`,
    mode: Number(initial.mode & BigInt(0o777)),
  };
}

export function pluginArtifactDigest(
  root: string,
  overrides: Partial<PluginArtifactDigestLimits> = {},
  fileSystem: PluginArtifactFileSystem = pluginArtifactFileSystem,
): Effect.Effect<string, PluginArtifactDigestError> {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  return Effect.tryPromise({
    try: () =>
      calculateDigest(root, limits, fileSystem, { prefix: HASH_PREFIX, mode: relevantMode }),
    catch: (error) =>
      error instanceof PluginArtifactDigestError
        ? error
        : new PluginArtifactDigestError("Plugin artifact identity failed at ."),
  });
}

export function pluginArtifactContentDigest(
  root: string,
  overrides: Partial<PluginArtifactDigestLimits> = {},
  fileSystem: PluginArtifactFileSystem = pluginArtifactFileSystem,
): Effect.Effect<string, PluginArtifactDigestError> {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  return Effect.tryPromise({
    try: () =>
      calculateDigest(root, limits, fileSystem, {
        prefix: CONTENT_HASH_PREFIX,
        mode: () => "",
      }),
    catch: (error) =>
      error instanceof PluginArtifactDigestError
        ? error
        : new PluginArtifactDigestError("Plugin artifact content identity failed at ."),
  });
}

export function pluginExecutableFileIdentity(
  file: string,
  fileSystem: PluginArtifactFileSystem = pluginArtifactFileSystem,
): Effect.Effect<PluginExecutableFileIdentity, PluginArtifactDigestError> {
  return Effect.tryPromise({
    try: () => calculateFileIdentity(file, fileSystem),
    catch: (error) =>
      error instanceof PluginArtifactDigestError
        ? error
        : new PluginArtifactDigestError("Plugin executable identity failed at ."),
  });
}
