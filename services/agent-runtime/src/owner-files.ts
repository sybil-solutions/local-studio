import {
  accessSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  type Stats,
} from "node:fs";
import path from "node:path";

export type OwnerFileSnapshot = {
  content: Buffer;
  modifiedAt: number;
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

function currentUid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function assertOwned(stats: Stats, filePath: string): void {
  const uid = currentUid();
  if (uid !== null && stats.uid !== uid) {
    throw new Error(`Owner mismatch for Local Studio path: ${filePath}`);
  }
}

function assertSafeDirectory(stats: Stats, directory: string, target: boolean): void {
  if (stats.isSymbolicLink()) {
    throw new Error(`Symbolic links are not allowed for Local Studio directories: ${directory}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Local Studio directory path is not a directory: ${directory}`);
  }
  if (target) assertOwned(stats, directory);
}

function assertSafeAncestor(stats: Stats, directory: string): void {
  const uid = currentUid();
  if (stats.isSymbolicLink()) {
    if (uid === null || stats.uid !== 0) {
      throw new Error(`Unsafe symbolic-link ancestor for Local Studio path: ${directory}`);
    }
    const target = statSync(directory);
    if (!target.isDirectory()) {
      throw new Error(`Local Studio path ancestor is not a directory: ${directory}`);
    }
    assertSafeAncestor(target, directory);
    return;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Local Studio path ancestor is not a directory: ${directory}`);
  }
  if (uid === null) return;
  if (stats.uid !== uid && stats.uid !== 0) {
    throw new Error(`Untrusted owner for Local Studio path ancestor: ${directory}`);
  }
  const sharedWrite = (stats.mode & 0o022) !== 0;
  const protectedTemporaryDirectory = stats.uid === 0 && (stats.mode & 0o1000) !== 0;
  if (sharedWrite && !protectedTemporaryDirectory) {
    throw new Error(`Writable Local Studio path ancestor is not protected: ${directory}`);
  }
}

function pathPrefixes(target: string): string[] {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  const relative = absolute.slice(root.length);
  const segments = relative.split(path.sep).filter(Boolean);
  const prefixes = [root];
  for (const segment of segments) {
    prefixes.push(path.join(prefixes[prefixes.length - 1] ?? root, segment));
  }
  return prefixes;
}

function lstatIfPresent(filePath: string): Stats | null {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function ensureDirectoryEntries(directory: string): void {
  const prefixes = pathPrefixes(directory);
  for (let index = 0; index < prefixes.length; index += 1) {
    const prefix = prefixes[index] ?? directory;
    const target = index === prefixes.length - 1;
    let stats = lstatIfPresent(prefix);
    if (!stats) {
      const parent = path.dirname(prefix);
      accessSync(parent, constants.W_OK | constants.X_OK);
      try {
        mkdirSync(prefix, { mode: 0o700 });
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      stats = lstatSync(prefix);
    }
    if (target) assertSafeDirectory(stats, prefix, true);
    else assertSafeAncestor(stats, prefix);
  }
}

function existingDirectory(
  directory: string,
  assertDirectory: (stats: Stats, directory: string) => void,
): boolean {
  for (const prefix of pathPrefixes(directory)) {
    const stats = lstatIfPresent(prefix);
    if (!stats) return false;
    assertDirectory(stats, prefix);
  }
  return true;
}

function safeExistingDirectory(directory: string): boolean {
  return existingDirectory(directory, assertSafeAncestor);
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
}

function directoryFlag(): number {
  return typeof constants.O_DIRECTORY === "number" ? constants.O_DIRECTORY : 0;
}

function openOwnerDirectory(directory: string): number {
  if (!safeExistingDirectory(path.dirname(directory))) {
    throw new Error(`Local Studio directory parent does not exist: ${directory}`);
  }
  const descriptor = openSync(directory, constants.O_RDONLY | directoryFlag() | noFollowFlag());
  try {
    const stats = fstatSync(descriptor);
    assertSafeDirectory(stats, directory, true);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function assertOwnerFile(stats: Stats, filePath: string): void {
  if (stats.isSymbolicLink()) {
    throw new Error(`Symbolic links are not allowed for Local Studio files: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Local Studio file path is not a regular file: ${filePath}`);
  }
  assertOwned(stats, filePath);
}

function assertSourceFile(stats: Stats, filePath: string): void {
  if (stats.isSymbolicLink()) {
    throw new Error(`Symbolic links are not allowed for Local Studio files: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Local Studio file path is not a regular file: ${filePath}`);
  }
}

function openValidatedOwnerFile(
  filePath: string,
  parentExists: (directory: string) => boolean,
): number {
  if (!parentExists(path.dirname(filePath))) {
    throw new Error(`Local Studio file parent does not exist: ${filePath}`);
  }
  const entry = lstatSync(filePath);
  assertOwnerFile(entry, filePath);
  const descriptor = openSync(filePath, constants.O_RDONLY | noFollowFlag());
  try {
    assertOwnerFile(fstatSync(descriptor), filePath);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function openOwnerFile(filePath: string): number {
  return openValidatedOwnerFile(filePath, safeExistingDirectory);
}

function openSourceFile(filePath: string): number {
  assertSourceFile(lstatSync(filePath), filePath);
  const descriptor = openSync(filePath, constants.O_RDONLY | noFollowFlag());
  try {
    assertSourceFile(fstatSync(descriptor), filePath);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function validatedOwnerFileExists(
  filePath: string,
  parentExists: (directory: string) => boolean,
): boolean {
  const stats = lstatIfPresent(filePath);
  if (!stats) return false;
  if (!parentExists(path.dirname(filePath))) {
    throw new Error(`Local Studio file parent does not exist: ${filePath}`);
  }
  assertOwnerFile(stats, filePath);
  return true;
}

function readValidatedOwnerFile(
  filePath: string,
  openFile: (filePath: string) => number,
): OwnerFileSnapshot {
  const descriptor = openFile(filePath);
  try {
    const stats = fstatSync(descriptor);
    return { content: readFileSync(descriptor), modifiedAt: stats.mtimeMs };
  } finally {
    closeSync(descriptor);
  }
}

export function ensureOwnerDirectory(directory: string): void {
  ensureDirectoryEntries(directory);
  const descriptor = openOwnerDirectory(directory);
  try {
    fchmodSync(descriptor, 0o700);
  } finally {
    closeSync(descriptor);
  }
}

export function ownerFileExists(filePath: string): boolean {
  return validatedOwnerFileExists(filePath, safeExistingDirectory);
}

export function sourceFileExists(filePath: string): boolean {
  const stats = lstatIfPresent(filePath);
  if (!stats) return false;
  assertSourceFile(stats, filePath);
  return true;
}

export function readOwnerFile(filePath: string): OwnerFileSnapshot {
  return readValidatedOwnerFile(filePath, openOwnerFile);
}

export function readSourceFile(filePath: string): OwnerFileSnapshot {
  return readValidatedOwnerFile(filePath, openSourceFile);
}

export function restrictOwnerFile(filePath: string): void {
  const descriptor = openOwnerFile(filePath);
  try {
    fchmodSync(descriptor, 0o600);
  } finally {
    closeSync(descriptor);
  }
}

export function syncOwnerDirectory(directory: string): void {
  const descriptor = openOwnerDirectory(directory);
  try {
    try {
      fsyncSync(descriptor);
    } catch {}
  } finally {
    closeSync(descriptor);
  }
}
