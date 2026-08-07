import { createHash, type Hash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";

export type PluginArtifactLimits = {
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxPathBytes: number;
  maxSymlinkTargetBytes: number;
};

const DEFAULT_LIMITS: PluginArtifactLimits = {
  maxEntries: 50_000,
  maxFileBytes: 256 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxPathBytes: 4_096,
  maxSymlinkTargetBytes: 4_096,
};

type DigestState = { entries: number; bytes: number };

export class PluginArtifactDigestError extends Error {}

const label = (relative: string): string => relative || ".";

const failure = (message: string, relative: string): PluginArtifactDigestError =>
  new PluginArtifactDigestError(`${message} at ${label(relative)}`);

async function artifactOperation<A>(relative: string, operation: () => Promise<A>): Promise<A> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PluginArtifactDigestError) throw error;
    throw failure("Plugin artifact cannot be read", relative);
  }
}

function updateField(hash: Hash, value: string | Buffer): void {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  hash.update(`${bytes.length}:`);
  hash.update(bytes);
}

const updateLength = (hash: Hash, length: number): void => {
  hash.update(`${length}:`);
};

function updateEntry(hash: Hash, relative: string, type: string, mode: number): void {
  updateField(hash, label(relative));
  updateField(hash, type);
  updateField(hash, (mode & 0o7777).toString(8).padStart(4, "0"));
}

function sameEntry(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

const sorted = (names: string[]): string[] =>
  names.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

async function boundedDirectoryNames(
  absolute: string,
  relative: string,
  maximum: number,
  overflowMessage: string,
): Promise<string[]> {
  return artifactOperation(relative, async () => {
    const directory = await opendir(absolute);
    const names: string[] = [];
    for await (const entry of directory) {
      if (names.length >= maximum) throw failure(overflowMessage, relative);
      names.push(entry.name);
    }
    return sorted(names);
  });
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function addEntry(relative: string, state: DigestState, limits: PluginArtifactLimits): void {
  state.entries += 1;
  if (state.entries > limits.maxEntries) throw failure("Plugin artifact is too large", relative);
  if (Buffer.byteLength(label(relative), "utf8") > limits.maxPathBytes) {
    throw failure("Plugin artifact path is too long", relative);
  }
}

async function hashEntry(
  root: string,
  absolute: string,
  relative: string,
  hash: Hash,
  state: DigestState,
  limits: PluginArtifactLimits,
): Promise<void> {
  addEntry(relative, state, limits);
  const before = await artifactOperation(relative, () => lstat(absolute));
  if (before.isFile()) {
    if (before.size > limits.maxFileBytes) throw failure("Plugin file is too large", relative);
    state.bytes += before.size;
    if (state.bytes > limits.maxTotalBytes) throw failure("Plugin artifact is too large", relative);
    const handle = await artifactOperation(relative, () =>
      open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)),
    );
    try {
      const opened = await artifactOperation(relative, () => handle.stat());
      if (!opened.isFile() || !sameEntry(before, opened)) {
        throw failure("Plugin artifact changed while hashing", relative);
      }
      updateEntry(hash, relative, "file", before.mode);
      updateLength(hash, opened.size);
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      while (position < opened.size) {
        const length = Math.min(buffer.length, opened.size - position);
        const { bytesRead } = await artifactOperation(relative, () =>
          handle.read(buffer, 0, length, position),
        );
        if (bytesRead === 0) throw failure("Plugin artifact changed while hashing", relative);
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      const closed = await artifactOperation(relative, () => handle.stat());
      const after = await artifactOperation(relative, () => lstat(absolute));
      if (position !== before.size || !sameEntry(opened, closed) || !sameEntry(opened, after)) {
        throw failure("Plugin artifact changed while hashing", relative);
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
    return;
  }
  if (before.isSymbolicLink()) {
    const target = await artifactOperation(relative, () => readlink(absolute));
    if (Buffer.byteLength(target, "utf8") > limits.maxSymlinkTargetBytes) {
      throw failure("Plugin symlink target is too long", relative);
    }
    const resolved = await artifactOperation(relative, () => realpath(absolute));
    if (!contained(root, resolved) || contained(resolved, path.dirname(absolute))) {
      throw failure("Plugin symlink is unsafe", relative);
    }
    const after = await artifactOperation(relative, () => lstat(absolute));
    const currentTarget = await artifactOperation(relative, () => readlink(absolute));
    if (target !== currentTarget || !sameEntry(before, after)) {
      throw failure("Plugin artifact changed while hashing", relative);
    }
    state.bytes += Buffer.byteLength(target, "utf8");
    if (state.bytes > limits.maxTotalBytes) throw failure("Plugin artifact is too large", relative);
    updateEntry(hash, relative, "symlink", before.mode);
    updateField(hash, target);
    return;
  }
  if (!before.isDirectory()) throw failure("Plugin artifact entry is unsupported", relative);
  const names = await boundedDirectoryNames(
    absolute,
    relative,
    limits.maxEntries - state.entries,
    "Plugin artifact is too large",
  );
  updateEntry(hash, relative, "directory", before.mode);
  for (const name of names) {
    const childRelative = relative ? `${relative}/${name}` : name;
    await hashEntry(root, path.join(absolute, name), childRelative, hash, state, limits);
  }
  const currentNames = await boundedDirectoryNames(
    absolute,
    relative,
    names.length,
    "Plugin artifact changed while hashing",
  );
  const after = await artifactOperation(relative, () => lstat(absolute));
  if (
    !sameEntry(before, after) ||
    names.length !== currentNames.length ||
    names.some((name, index) => currentNames[index] !== name)
  ) {
    throw failure("Plugin artifact changed while hashing", relative);
  }
}

async function calculateDigest(
  rootDirectory: string,
  limits: PluginArtifactLimits,
): Promise<string> {
  const root = await artifactOperation("", () => realpath(rootDirectory));
  const hash = createHash("sha256");
  updateField(hash, "local-studio-plugin-artifact-v1");
  await hashEntry(root, root, "", hash, { entries: 0, bytes: 0 }, limits);
  const current = await artifactOperation("", () => realpath(rootDirectory));
  if (current !== root) throw failure("Plugin artifact changed while hashing", "");
  return `sha256:${hash.digest("hex")}`;
}

export function pluginArtifactDigest(
  root: string,
  overrides: Partial<PluginArtifactLimits> = {},
): Effect.Effect<string, PluginArtifactDigestError> {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  return Effect.tryPromise({
    try: () => calculateDigest(root, limits),
    catch: (error) =>
      error instanceof PluginArtifactDigestError
        ? error
        : new PluginArtifactDigestError("Plugin artifact identity failed at ."),
  });
}
