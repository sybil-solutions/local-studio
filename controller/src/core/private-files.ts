import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, parse, resolve, sep } from "node:path";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
const MODE_MASK = 0o777;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

const errorCode = (error: unknown): unknown =>
  error !== null && typeof error === "object" ? Reflect.get(error, "code") : undefined;

const lstatOptional = (path: string): Stats | null => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
};

export const isOwned = (stat: Stats): boolean =>
  process.platform === "win32" ||
  typeof process.getuid !== "function" ||
  stat.uid === process.getuid();

const sameFile = (left: Stats, right: Stats): boolean =>
  left.dev === right.dev && left.ino === right.ino;

interface PathIdentity {
  path: string;
  dev: number;
  ino: number;
}

const pathComponents = (path: string): string[] => {
  const root = parse(path).root;
  const names = path.slice(root.length).split(sep).filter(Boolean);
  return names.reduce<string[]>((components, name) => {
    components.push(resolve(components.at(-1) ?? root, name));
    return components;
  }, []);
};

const isRootOwned = (stat: Stats): boolean => process.platform !== "win32" && stat.uid === 0;

const unsafeAncestor = (stat: Stats): boolean => {
  if (process.platform === "win32") return false;
  if (!isOwned(stat) && !isRootOwned(stat)) return true;
  if ((stat.mode & 0o022) === 0) return false;
  return !(isRootOwned(stat) && (stat.mode & 0o1000) !== 0);
};

const trustedSystemSymlink = (path: string, stat: Stats): boolean => {
  if (process.platform === "win32" || stat.uid !== 0) return false;
  const target = lstatSync(realpathSync(path));
  return target.isDirectory() && target.uid === 0 && !unsafeAncestor(target);
};

const validateDirectory = (path: string, stat: Stats, target: boolean): void => {
  if (stat.isSymbolicLink()) {
    if (!target && trustedSystemSymlink(path, stat)) return;
    throw new Error(`Unsafe private directory: ${path}`);
  }
  if (
    !stat.isDirectory() ||
    (target && !isOwned(stat)) ||
    (!target && unsafeAncestor(stat))
  ) {
    throw new Error(`Unsafe private directory: ${path}`);
  }
};

const privateAncestorIdentities = (path: string): PathIdentity[] =>
  pathComponents(resolve(path)).map((component) => {
    const stat = lstatSync(component);
    validateDirectory(component, stat, false);
    return { path: component, dev: stat.dev, ino: stat.ino };
  });

const validatePathIdentities = (identities: readonly PathIdentity[]): void => {
  for (const identity of identities) {
    const stat = lstatSync(identity.path);
    if (stat.dev !== identity.dev || stat.ino !== identity.ino) {
      throw new Error(`Unsafe private directory: ${identity.path}`);
    }
  }
};

export const validatePrivateAncestors = (path: string): string => {
  const target = resolve(path);
  for (const component of pathComponents(target)) {
    const stat = lstatOptional(component);
    if (!stat) throw new Error(`Unsafe private directory: ${component}`);
    validateDirectory(component, stat, false);
  }
  return target;
};

export const ensurePrivateDirectory = (path: string): string => {
  const target = resolve(path);
  if (parse(target).root === target) throw new Error(`Unsafe private directory: ${target}`);
  const components = pathComponents(target);

  for (const component of components) {
    const isTarget = component === target;
    const current = lstatOptional(component);
    if (current) {
      validateDirectory(component, current, isTarget);
      continue;
    }
    mkdirSync(component, { mode: PRIVATE_DIRECTORY_MODE });
    validateDirectory(component, lstatSync(component), true);
  }

  if (process.platform !== "win32") chmodSync(target, PRIVATE_DIRECTORY_MODE);
  const hardened = lstatSync(target);
  validateDirectory(target, hardened, true);
  if (process.platform !== "win32" && (hardened.mode & MODE_MASK) !== PRIVATE_DIRECTORY_MODE) {
    throw new Error(`Unsafe private directory: ${target}`);
  }
  return target;
};

export const validatePrivateDirectory = (path: string): string => {
  const target = resolve(path);
  const stat = lstatSync(target);
  validateDirectory(target, stat, true);
  if (process.platform !== "win32" && (stat.mode & MODE_MASK) !== PRIVATE_DIRECTORY_MODE) {
    throw new Error(`Unsafe private directory: ${target}`);
  }
  return target;
};

const hardenOpenFile = (fileDescriptor: number): void => {
  if (process.platform !== "win32") fchmodSync(fileDescriptor, PRIVATE_FILE_MODE);
};

const verifyOpenFile = (path: string, fileDescriptor: number, before: Stats | null): number => {
  try {
    const opened = fstatSync(fileDescriptor);
    const linked = lstatSync(path);
    if (
      !opened.isFile() ||
      !linked.isFile() ||
      linked.isSymbolicLink() ||
      !isOwned(opened) ||
      !isOwned(linked) ||
      !sameFile(opened, linked) ||
      (before !== null && !sameFile(before, opened))
    ) {
      throw new Error(`Unsafe private file: ${path}`);
    }
    hardenOpenFile(fileDescriptor);
    const hardened = fstatSync(fileDescriptor);
    if (
      !hardened.isFile() ||
      !isOwned(hardened) ||
      (process.platform !== "win32" && (hardened.mode & MODE_MASK) !== PRIVATE_FILE_MODE)
    ) {
      throw new Error(`Unsafe private file: ${path}`);
    }
    return fileDescriptor;
  } catch (error) {
    closeSync(fileDescriptor);
    throw error;
  }
};

export const openPrivateFile = (
  path: string,
  flags: number,
  requirePrivateParent = true,
): number => {
  const resolved = resolve(path);
  if (requirePrivateParent) ensurePrivateDirectory(dirname(resolved));
  const ancestorIdentities = privateAncestorIdentities(dirname(resolved));
  const canCreate = (flags & constants.O_CREAT) === constants.O_CREAT;
  const before = lstatOptional(resolved);
  if (before && (!before.isFile() || before.isSymbolicLink() || !isOwned(before))) {
    throw new Error(`Unsafe private file: ${resolved}`);
  }
  if (!before && !canCreate) throw new Error(`Unsafe private file: ${resolved}`);
  const opened = openSync(
    resolved,
    flags | NO_FOLLOW | (before ? 0 : constants.O_EXCL),
    PRIVATE_FILE_MODE,
  );
  const verified = verifyOpenFile(resolved, opened, before);
  try {
    validatePathIdentities(ancestorIdentities);
    return verified;
  } catch (error) {
    closeSync(verified);
    throw error;
  }
};

export const ensurePrivateFile = (path: string): string => {
  const resolved = resolve(path);
  const fileDescriptor = openPrivateFile(resolved, constants.O_CREAT | constants.O_RDWR);
  closeSync(fileDescriptor);
  return resolved;
};

export const repairOwnerOnlyFile = (path: string): boolean => {
  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = openPrivateFile(path, constants.O_RDONLY, false);
    return true;
  } catch {
    return false;
  } finally {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
  }
};

export const readPrivateTextFile = (path: string): string | null => {
  const resolved = resolve(path);
  ensurePrivateDirectory(dirname(resolved));
  if (!lstatOptional(resolved)) return null;
  const fileDescriptor = openPrivateFile(resolved, constants.O_RDONLY, false);
  try {
    return readFileSync(fileDescriptor, "utf8");
  } finally {
    closeSync(fileDescriptor);
  }
};

export const readOwnerOnlyTextFile = (path: string): string | null => {
  const resolved = resolve(path);
  if (!lstatOptional(resolved)) return null;
  validatePrivateAncestors(dirname(resolved));
  const fileDescriptor = openPrivateFile(resolved, constants.O_RDONLY, false);
  try {
    return readFileSync(fileDescriptor, "utf8");
  } finally {
    closeSync(fileDescriptor);
  }
};

export const writePrivateTextFile = (path: string, content: string): void => {
  const resolved = resolve(path);
  const parent = ensurePrivateDirectory(dirname(resolved));
  if (lstatOptional(resolved)) {
    const existing = openPrivateFile(resolved, constants.O_RDONLY, false);
    closeSync(existing);
  }
  const temporaryPath = resolve(parent, `.${parse(resolved).base}.${randomUUID()}.tmp`);
  const ancestorIdentities = privateAncestorIdentities(parent);
  let temporaryDescriptor: number | null = null;

  try {
    temporaryDescriptor = openPrivateFile(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      false,
    );
    writeFileSync(temporaryDescriptor, content);
    fsyncSync(temporaryDescriptor);
    closeSync(temporaryDescriptor);
    temporaryDescriptor = null;
    validatePathIdentities(ancestorIdentities);
    renameSync(temporaryPath, resolved);
    validatePathIdentities(ancestorIdentities);
    const written = openPrivateFile(resolved, constants.O_RDONLY, false);
    closeSync(written);
  } catch (error) {
    if (temporaryDescriptor !== null) closeSync(temporaryDescriptor);
    try {
      unlinkSync(temporaryPath);
    } catch {
      undefined;
    }
    throw error;
  }
};
