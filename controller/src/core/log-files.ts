import {
  chmodSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  openSync,
  closeSync,
  lstatSync,
  readSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const LOG_PREFIX = "vllm_";
const LOG_SUFFIX = ".log";
const FALLBACK_LOG_DIR = tmpdir();

export interface LogFileEntry {
  sessionId: string;
  path: string;
  mtimeMs: number;
  sizeBytes: number;
  source: "data_dir" | "tmp";
}

export interface LogCleanupOptions {
  maxAgeMs: number;
  maxFiles: number;
  maxTotalBytes: number;
  excludePaths?: Set<string>;
}

export const getLogCleanupDefaultsFromEnvironment = (): Omit<LogCleanupOptions, "excludePaths"> => {
  const clampInt = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);
  const parseIntOr = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  // 0 means "no cap" for size/files and "no age expiry" for days.
  const days = parseIntOr(process.env["LOCAL_STUDIO_LOG_RETENTION_DAYS"], 30);
  const maxFiles = parseIntOr(process.env["LOCAL_STUDIO_LOG_MAX_FILES"], 200);
  const maxTotalBytes = parseIntOr(process.env["LOCAL_STUDIO_LOG_MAX_TOTAL_BYTES"], 1_000_000_000);

  const maxAgeMs =
    days <= 0 ? Number.POSITIVE_INFINITY : clampInt(days, 1, 3650) * 24 * 60 * 60 * 1000;

  return {
    maxAgeMs,
    maxFiles: maxFiles <= 0 ? Number.MAX_SAFE_INTEGER : clampInt(maxFiles, 1, 100_000),
    maxTotalBytes:
      maxTotalBytes <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1_000_000, maxTotalBytes),
  };
};

export const sanitizeLogSessionId = (sessionId: string): string => {
  const safe = Array.from(sessionId)
    .filter((char) => /[a-zA-Z0-9._-]/.test(char))
    .join("");
  return safe;
};

type FileStat = Stats;

const sameFile = (left: FileStat, right: FileStat): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
const directoryOnly = typeof constants.O_DIRECTORY === "number" ? constants.O_DIRECTORY : 0;

const assertManagedDirectory = (stat: FileStat, directory: string): void => {
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(`Unsafe log directory: ${directory}`);
  }
};

const ensurePrivateDirectory = (directory: string): void => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const before = lstatSync(directory);
  assertManagedDirectory(before, directory);
  if (process.platform === "win32") {
    chmodSync(directory, 0o700);
    const after = lstatSync(directory);
    assertManagedDirectory(after, directory);
    if (!sameFile(before, after)) throw new Error(`Replaced log directory: ${directory}`);
    return;
  }
  const descriptor = openSync(directory, constants.O_RDONLY | noFollow | directoryOnly);
  try {
    const opened = fstatSync(descriptor);
    const after = lstatSync(directory);
    assertManagedDirectory(opened, directory);
    assertManagedDirectory(after, directory);
    if (!sameFile(before, opened) || !sameFile(opened, after)) {
      throw new Error(`Replaced log directory: ${directory}`);
    }
    fchmodSync(descriptor, 0o700);
  } finally {
    closeSync(descriptor);
  }
};

const assertManagedFile = (stat: FileStat, path: string): void => {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(`Unsafe log file: ${path}`);
  }
};

const existingFile = (path: string): FileStat | null => {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const validateDescriptor = (
  path: string,
  descriptor: number,
  before: FileStat | null,
  parent: FileStat,
): void => {
  const opened = fstatSync(descriptor);
  const after = lstatSync(path);
  assertManagedFile(opened, path);
  assertManagedFile(after, path);
  if ((before && !sameFile(before, opened)) || !sameFile(opened, after)) {
    throw new Error(`Replaced log file: ${path}`);
  }
  const currentParent = lstatSync(dirname(path));
  if (
    !currentParent.isDirectory() ||
    currentParent.isSymbolicLink() ||
    !sameFile(parent, currentParent)
  )
    throw new Error(`Replaced log directory: ${dirname(path)}`);
  fchmodSync(descriptor, 0o600);
};

export const openPrivateLogFile = (path: string, truncate = false): number => {
  const parentPath = dirname(path);
  ensurePrivateDirectory(parentPath);
  const parent = lstatSync(parentPath);
  const before = existingFile(path);
  if (before) assertManagedFile(before, path);
  const descriptor = openSync(
    path,
    constants.O_APPEND |
      constants.O_WRONLY |
      noFollow |
      (before ? 0 : constants.O_CREAT | constants.O_EXCL),
    0o600,
  );
  try {
    validateDescriptor(path, descriptor, before, parent);
    if (truncate) ftruncateSync(descriptor, 0);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
};

export const openPrivateLogFileForRead = (path: string): number => {
  const before = lstatSync(path);
  const parent = lstatSync(dirname(path));
  assertManagedFile(before, path);
  const descriptor = openSync(path, constants.O_RDONLY | noFollow);
  try {
    validateDescriptor(path, descriptor, before, parent);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
};

export const readPrivateLogTail = (path: string, bytes: number): string => {
  try {
    const descriptor = openPrivateLogFileForRead(path);
    try {
      const size = fstatSync(descriptor).size;
      const start = Math.max(0, size - bytes);
      const length = size - start;
      if (length <= 0) return "";
      const buffer = Buffer.alloc(length);
      readSync(descriptor, buffer, 0, length, start);
      return buffer.toString("utf8");
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return "";
  }
};

const isReadableLogFile = (path: string): boolean => {
  try {
    closeSync(openPrivateLogFileForRead(path));
    return true;
  } catch {
    return false;
  }
};

const repairExistingLogModes = (directory: string, prefix: string, failClosed: boolean): void => {
  try {
    for (const name of readdirSync(directory)) {
      if (
        name.startsWith(prefix) &&
        name.endsWith(LOG_SUFFIX) &&
        !isReadableLogFile(join(directory, name)) &&
        failClosed
      ) {
        throw new Error(`Unsafe log file: ${join(directory, name)}`);
      }
    }
  } catch (error) {
    if (failClosed) throw error;
  }
};

export const ensurePrivateLogDirectory = (directory: string, prefix = ""): string => {
  ensurePrivateDirectory(directory);
  repairExistingLogModes(directory, prefix, true);
  return directory;
};

export const ensureLogsDirectory = (dataDirectory: string): string => {
  const directory = resolve(dataDirectory, "logs");
  ensurePrivateDirectory(resolve(dataDirectory));
  ensurePrivateLogDirectory(directory, LOG_PREFIX);
  repairExistingLogModes(FALLBACK_LOG_DIR, LOG_PREFIX, false);
  return directory;
};

export const primaryLogPathFor = (dataDirectory: string, sessionId: string): string => {
  const safe = sanitizeLogSessionId(sessionId);
  return join(ensureLogsDirectory(dataDirectory), `${LOG_PREFIX}${safe}${LOG_SUFFIX}`);
};

export const fallbackLogPathFor = (sessionId: string): string => {
  const safe = sanitizeLogSessionId(sessionId);
  return join(FALLBACK_LOG_DIR, `${LOG_PREFIX}${safe}${LOG_SUFFIX}`);
};

export const resolveExistingLogPath = (dataDirectory: string, sessionId: string): string | null => {
  const primary = primaryLogPathFor(dataDirectory, sessionId);
  if (isReadableLogFile(primary)) return primary;
  const fallback = fallbackLogPathFor(sessionId);
  if (isReadableLogFile(fallback)) return fallback;
  return null;
};

const scanLogDirectory = (directory: string, source: LogFileEntry["source"]): LogFileEntry[] => {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory)
      .filter((name) => name.startsWith(LOG_PREFIX) && name.endsWith(LOG_SUFFIX))
      .map((name) => {
        const path = join(directory, name);
        if (!isReadableLogFile(path)) return null;
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) return null;
        const sessionId = name
          .replace(new RegExp(`^${LOG_PREFIX}`), "")
          .replace(new RegExp(`${LOG_SUFFIX}$`), "");
        return {
          sessionId,
          path,
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          source,
        } satisfies LogFileEntry;
      })
      .filter((entry): entry is LogFileEntry => entry !== null);
  } catch {
    return [];
  }
};

export const listLogFiles = (dataDirectory: string): LogFileEntry[] => {
  const primaryDirectory = resolve(dataDirectory, "logs");
  const all = [
    ...scanLogDirectory(primaryDirectory, "data_dir"),
    ...scanLogDirectory(FALLBACK_LOG_DIR, "tmp"),
  ];

  // Deduplicate by session id, preferring the newest mtime.
  const bySession = new Map<string, LogFileEntry>();
  for (const entry of all) {
    const existing = bySession.get(entry.sessionId);
    if (!existing || entry.mtimeMs > existing.mtimeMs) {
      bySession.set(entry.sessionId, entry);
    }
  }

  return Array.from(bySession.values()).sort((a, b) => b.mtimeMs - a.mtimeMs);
};

export const cleanupLogFiles = (
  dataDirectory: string,
  options: LogCleanupOptions,
): { deleted: number } => {
  const { maxAgeMs, maxFiles, maxTotalBytes, excludePaths } = options;
  const now = Date.now();

  const entries = [
    ...scanLogDirectory(resolve(dataDirectory, "logs"), "data_dir"),
    ...scanLogDirectory(FALLBACK_LOG_DIR, "tmp"),
  ]
    .filter((entry) => !(excludePaths && excludePaths.has(entry.path)))
    .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

  const shouldDeleteAge = (entry: LogFileEntry): boolean => now - entry.mtimeMs > maxAgeMs;

  const deletedPaths: string[] = [];
  const safeUnlink = (path: string): void => {
    try {
      unlinkSync(path);
      deletedPaths.push(path);
    } catch {
      // Ignore races or permission issues; retention is best-effort.
    }
  };

  // 1) Age-based retention.
  for (const entry of entries) {
    if (shouldDeleteAge(entry)) safeUnlink(entry.path);
  }

  // 2) Recompute after deletions.
  const remaining = entries.filter((entry) => !deletedPaths.includes(entry.path));

  // 3) File-count cap.
  if (remaining.length > maxFiles) {
    const overflow = remaining.length - maxFiles;
    for (const entry of remaining.slice(0, overflow)) safeUnlink(entry.path);
  }

  // 4) Total-bytes cap.
  const stillRemaining = remaining.filter((entry) => !deletedPaths.includes(entry.path));
  let totalBytes = stillRemaining.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  if (totalBytes > maxTotalBytes) {
    for (const entry of stillRemaining) {
      if (totalBytes <= maxTotalBytes) break;
      safeUnlink(entry.path);
      totalBytes -= entry.sizeBytes;
    }
  }

  return { deleted: deletedPaths.length };
};

export const tailFileLines = (
  path: string,
  limit: number,
  maxBytes = 10 * 1024 * 1024,
): string[] => {
  if (limit <= 0) return [];
  let fd: number;
  try {
    fd = openPrivateLogFileForRead(path);
  } catch {
    return [];
  }
  try {
    const stat = fstatSync(fd);
    let pos = stat.size;
    if (pos <= 0) return [];

    const chunkSize = 64 * 1024;
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let newlineCount = 0;

    while (pos > 0 && newlineCount < limit + 1 && bytesRead < maxBytes) {
      const readSize = Math.min(chunkSize, pos, maxBytes - bytesRead);
      pos -= readSize;
      const buf = Buffer.allocUnsafe(readSize);
      const n = readSync(fd, buf, 0, readSize, pos);
      const slice = buf.slice(0, n);
      chunks.push(slice);
      bytesRead += n;

      // Count newlines in this chunk.
      for (let index = 0; index < slice.length; index++) {
        if (slice[index] === 0x0a) newlineCount += 1;
      }
    }

    const text = Buffer.concat(chunks.reverse()).toString("utf-8");
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.slice(Math.max(0, lines.length - limit));
  } finally {
    closeSync(fd);
  }
};
