import { randomUUID } from "node:crypto";
import {
  constants,
  createWriteStream,
  existsSync,
  fstatSync,
  lstatSync,
  readdirSync,
  renameSync,
  unlinkSync,
  closeSync,
  readSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import type { WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  createLogPayloadRedactor,
  createLogRecordRedactor,
  type LogPayloadRedactor,
} from "./log-redaction";
import {
  ensurePrivateDirectory,
  isOwned,
  openPrivateFile,
  PRIVATE_DIRECTORY_MODE,
  repairOwnerOnlyFile,
  validatePrivateDirectory,
} from "./private-files";

const LOG_PREFIX = "vllm_";
const LOG_SUFFIX = ".log";
const FALLBACK_LOG_DIR = tmpdir();
const MODE_MASK = 0o777;
const redactedLogIdentities = new Map<string, FileIdentity>();
const LOG_READ_CHUNK_BYTES = 64 * 1024;
const MAX_LOG_RECORD_CHARS = 64 * 1024;
const MAX_FULL_LOG_SCAN_BYTES = 8 * 1024 * 1024;
const LOG_MIGRATION_TEMP_PREFIX = ".log-migration-";
const REDACTED = "[redacted]";

const errorCode = (error: unknown): unknown =>
  error !== null && typeof error === "object" ? Reflect.get(error, "code") : undefined;

const openPrivateLogAppender = (path: string): { fileDescriptor: number; created: boolean } => {
  try {
    return {
      fileDescriptor: openPrivateFile(
        path,
        constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        false,
      ),
      created: true,
    };
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    return {
      fileDescriptor: openPrivateFile(path, constants.O_APPEND | constants.O_WRONLY, false),
      created: false,
    };
  }
};

export const createPrivateLogStream = (path: string): WriteStream => {
  validatePrivateDirectory(dirname(resolve(path)));
  const { fileDescriptor, created } = openPrivateLogAppender(path);
  if (created) {
    rememberRedactedLog(path, identityOf(fstatSync(fileDescriptor)));
  } else {
    descriptorHasTrustedRedaction(path, fileDescriptor);
  }
  try {
    return createWriteStream(path, { fd: fileDescriptor, autoClose: true });
  } catch (error) {
    closeSync(fileDescriptor);
    throw error;
  }
};

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

export const ensureLogsDirectory = (dataDirectory: string): string => {
  ensurePrivateDirectory(resolve(dataDirectory));
  const directory = resolve(dataDirectory, "logs");
  ensurePrivateDirectory(directory);
  recoverPersistedLogArtifacts(directory, LOG_PREFIX);
  for (const name of readdirSync(directory)) {
    if (name.startsWith(LOG_PREFIX) && name.endsWith(LOG_SUFFIX)) {
      const path = join(directory, name);
      if (pathHasTrustedRedaction(path)) continue;
      recordLogMigration(path, migratePersistedLog(path));
    }
  }
  const legacyControllerLog = resolve(dataDirectory, "controller.log");
  recoverPersistedLogArtifacts(dataDirectory, "controller", directory);
  if (existsSync(legacyControllerLog) && !pathHasTrustedRedaction(legacyControllerLog)) {
    recordLogMigration(legacyControllerLog, migratePersistedLog(legacyControllerLog));
  }
  repairLegacyFallbackLogs();
  return directory;
};

type LogMigrationResult =
  | { status: "redacted"; identity: FileIdentity }
  | { status: "removed" }
  | { status: "failed" };

const repairLogFileMode = (path: string): boolean => {
  return repairOwnerOnlyFile(path);
};

interface PersistedLogSanitizer {
  pending: string;
  discarding: boolean;
  redactor: LogPayloadRedactor;
}

interface FileIdentity {
  dev: number;
  ino: number;
  birthtimeMs: number;
}

const identityOf = (stat: FileIdentity): FileIdentity => ({
  dev: stat.dev,
  ino: stat.ino,
  birthtimeMs: stat.birthtimeMs,
});

const sameIdentity = (stat: FileIdentity, identity: FileIdentity): boolean =>
  stat.dev === identity.dev &&
  stat.ino === identity.ino &&
  stat.birthtimeMs === identity.birthtimeMs;

const forgetRedactedLog = (path: string): void => {
  redactedLogIdentities.delete(resolve(path));
};

const rememberRedactedLog = (path: string, identity: FileIdentity): void => {
  redactedLogIdentities.set(resolve(path), identity);
};

const descriptorHasTrustedRedaction = (path: string, fileDescriptor: number): boolean => {
  const resolved = resolve(path);
  const trusted = redactedLogIdentities.get(resolved);
  if (!trusted) return false;
  if (sameIdentity(identityOf(fstatSync(fileDescriptor)), trusted)) return true;
  if (redactedLogIdentities.get(resolved) === trusted) redactedLogIdentities.delete(resolved);
  return false;
};

const pathHasTrustedRedaction = (path: string): boolean => {
  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = openPrivateFile(path, constants.O_RDONLY, false);
    return descriptorHasTrustedRedaction(path, fileDescriptor);
  } catch {
    forgetRedactedLog(path);
    return false;
  } finally {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
  }
};

const recordLogMigration = (path: string, migration: LogMigrationResult): void => {
  if (migration.status === "redacted") {
    rememberRedactedLog(path, migration.identity);
  } else {
    forgetRedactedLog(path);
  }
};

const unlinkOwnedLog = (path: string, identity: FileIdentity): boolean => {
  try {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !isOwned(stat) ||
      !sameIdentity(stat, identity)
    ) {
      return false;
    }
    unlinkSync(path);
    return true;
  } catch (error) {
    return errorCode(error) === "ENOENT";
  }
};

const writeSanitizedRecord = (
  destinationDescriptor: number,
  sanitizer: PersistedLogSanitizer,
  fragment: string,
  ending: string,
): void => {
  const oversized =
    sanitizer.discarding || sanitizer.pending.length + fragment.length > MAX_LOG_RECORD_CHARS;
  if (oversized) sanitizer.redactor.failClosed();
  const value = oversized ? REDACTED : sanitizer.redactor.redactLine(sanitizer.pending + fragment);
  writeFileSync(destinationDescriptor, value + ending);
  sanitizer.pending = "";
  sanitizer.discarding = false;
};

const writeSanitizedContent = (
  destinationDescriptor: number,
  sanitizer: PersistedLogSanitizer,
  content: string,
  final: boolean,
): void => {
  let cursor = 0;
  let newline = content.indexOf("\n");
  while (newline >= 0) {
    writeSanitizedRecord(destinationDescriptor, sanitizer, content.slice(cursor, newline), "\n");
    cursor = newline + 1;
    newline = content.indexOf("\n", cursor);
  }
  const remainder = content.slice(cursor);
  if (final) {
    if (remainder.length > 0 || sanitizer.pending.length > 0 || sanitizer.discarding) {
      writeSanitizedRecord(destinationDescriptor, sanitizer, remainder, "");
    }
    return;
  }
  if (
    !sanitizer.discarding &&
    sanitizer.pending.length + remainder.length <= MAX_LOG_RECORD_CHARS
  ) {
    sanitizer.pending += remainder;
  } else if (remainder.length > 0) {
    sanitizer.pending = "";
    sanitizer.discarding = true;
  }
};

const sanitizePersistedLog = (path: string): LogMigrationResult => {
  let sourceDescriptor: number | null = null;
  let destinationDescriptor: number | null = null;
  let temporaryPath: string | null = null;
  let sourceIdentity: FileIdentity | null = null;

  try {
    sourceDescriptor = openPrivateFile(path, constants.O_RDONLY, false);
    const source = fstatSync(sourceDescriptor);
    sourceIdentity = identityOf(source);
    temporaryPath = join(dirname(path), `${LOG_MIGRATION_TEMP_PREFIX}${randomUUID()}.tmp`);
    destinationDescriptor = openPrivateFile(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      false,
    );
    const decoder = new StringDecoder("utf8");
    const sanitizer: PersistedLogSanitizer = {
      pending: "",
      discarding: false,
      redactor: createLogPayloadRedactor(),
    };
    const buffer = Buffer.allocUnsafe(LOG_READ_CHUNK_BYTES);
    let bytesRead = 0;

    do {
      bytesRead = readSync(sourceDescriptor, buffer, 0, buffer.length, null);
      writeSanitizedContent(
        destinationDescriptor,
        sanitizer,
        decoder.write(buffer.subarray(0, bytesRead)),
        false,
      );
    } while (bytesRead > 0);

    writeSanitizedContent(destinationDescriptor, sanitizer, decoder.end(), true);
    fsyncSync(destinationDescriptor);
    const linked = lstatSync(path);
    if (!sameIdentity(linked, sourceIdentity)) throw new Error("Persisted log identity changed");
    const destinationIdentity = identityOf(fstatSync(destinationDescriptor));
    closeSync(sourceDescriptor);
    sourceDescriptor = null;
    closeSync(destinationDescriptor);
    destinationDescriptor = null;
    renameSync(temporaryPath, path);
    temporaryPath = null;
    const migrated = lstatSync(path);
    if (!sameIdentity(migrated, destinationIdentity) || !repairLogFileMode(path)) {
      return { status: "failed" };
    }
    return { status: "redacted", identity: destinationIdentity };
  } catch {
    if (sourceDescriptor !== null) {
      closeSync(sourceDescriptor);
      sourceDescriptor = null;
    }
    if (destinationDescriptor !== null) {
      closeSync(destinationDescriptor);
      destinationDescriptor = null;
    }
    return {
      status: sourceIdentity && unlinkOwnedLog(path, sourceIdentity) ? "removed" : "failed",
    };
  } finally {
    if (sourceDescriptor !== null) closeSync(sourceDescriptor);
    if (destinationDescriptor !== null) closeSync(destinationDescriptor);
    if (temporaryPath !== null) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        undefined;
      }
    }
  }
};

const migratePersistedLog = (path: string): LogMigrationResult => {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwned(stat)) return { status: "failed" };
  } catch {
    return { status: "failed" };
  }
  return sanitizePersistedLog(path);
};

const migrationArtifactKind = (
  name: string,
  basePrefix: string,
): "temporary" | "unredacted" | null => {
  if (name.startsWith(LOG_MIGRATION_TEMP_PREFIX) && name.endsWith(".tmp")) return "temporary";
  if (!name.startsWith(`.${basePrefix}`) || !name.includes(`${LOG_SUFFIX}.`)) return null;
  if (name.endsWith(".tmp")) return "temporary";
  return name.includes(`${LOG_SUFFIX}.unredacted-`) ? "unredacted" : null;
};

const removeMigrationTemporary = (path: string): boolean => {
  let descriptor: number | null = null;
  try {
    descriptor = openPrivateFile(path, constants.O_RDONLY, false);
    const stat = fstatSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    return unlinkOwnedLog(path, identityOf(stat));
  } catch {
    return false;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
};

const recoverUnredactedLog = (path: string, recoveryDirectory: string): boolean => {
  const migration = migratePersistedLog(path);
  forgetRedactedLog(path);
  if (migration.status === "failed") return false;
  if (migration.status === "removed") return true;
  const recoveredPath = join(
    recoveryDirectory,
    `${LOG_PREFIX}recovered-${randomUUID()}${LOG_SUFFIX}`,
  );
  try {
    renameSync(path, recoveredPath);
    const recovered = lstatSync(recoveredPath);
    if (!sameIdentity(recovered, migration.identity) || !repairLogFileMode(recoveredPath)) {
      return false;
    }
    rememberRedactedLog(recoveredPath, migration.identity);
    return true;
  } catch {
    return false;
  }
};

const recoverPersistedLogArtifacts = (
  directory: string,
  basePrefix: string,
  recoveryDirectory = directory,
): boolean => {
  let complete = true;
  for (const name of readdirSync(directory)) {
    const kind = migrationArtifactKind(name, basePrefix);
    if (!kind) continue;
    const path = join(directory, name);
    const recovered =
      kind === "temporary"
        ? removeMigrationTemporary(path)
        : recoverUnredactedLog(path, recoveryDirectory);
    if (!recovered) complete = false;
  }
  return complete;
};

export const repairLegacyFallbackLogs = (directory = FALLBACK_LOG_DIR): void => {
  let names: string[];
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    names = readdirSync(directory);
  } catch {
    return;
  }

  recoverPersistedLogArtifacts(directory, LOG_PREFIX);
  for (const name of names) {
    if (name.startsWith(LOG_PREFIX) && name.endsWith(LOG_SUFFIX)) {
      const path = join(directory, name);
      try {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || !isOwned(stat)) continue;
      } catch {
        continue;
      }
      if (pathHasTrustedRedaction(path)) continue;
      recordLogMigration(path, migratePersistedLog(path));
    }
  }
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
  if (repairLogFileMode(primary)) return primary;
  const fallback = fallbackLogPathFor(sessionId);
  if (repairLogFileMode(fallback)) return fallback;
  return null;
};

const scanLogDirectory = (directory: string, source: LogFileEntry["source"]): LogFileEntry[] => {
  if (!existsSync(directory)) return [];
  try {
    const directoryStat = lstatSync(directory);
    if (
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      (source === "data_dir" &&
        (!isOwned(directoryStat) ||
          (process.platform !== "win32" &&
            (directoryStat.mode & MODE_MASK) !== PRIVATE_DIRECTORY_MODE)))
    ) {
      return [];
    }
    return readdirSync(directory)
      .filter((name) => name.startsWith(LOG_PREFIX) && name.endsWith(LOG_SUFFIX))
      .map((name) => {
        const path = join(directory, name);
        if (!repairLogFileMode(path)) return null;
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || !isOwned(stat)) return null;
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
      forgetRedactedLog(path);
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

interface RedactedLogRecord {
  value: string;
  ending: string;
}

interface BoundedRecordTail {
  append: (value: string) => void;
  value: () => string;
}

const visitRedactedLogRecords = (
  fileDescriptor: number,
  maxInputBytes: number,
  knownRedacted: boolean,
  visit: (record: RedactedLogRecord) => void,
  observeRead: (bytes: number) => void = () => undefined,
): void => {
  const buffer = Buffer.allocUnsafe(LOG_READ_CHUNK_BYTES);
  const decoder = new StringDecoder("utf8");
  const fileSize = fstatSync(fileDescriptor).size;
  const contextBytes = MAX_LOG_RECORD_CHARS + LOG_READ_CHUNK_BYTES;
  const windowBytes = Math.min(fileSize, Math.max(1, maxInputBytes) + contextBytes);
  const start = fileSize <= MAX_FULL_LOG_SCAN_BYTES ? 0 : Math.max(0, fileSize - windowBytes);
  const redactor = createLogRecordRedactor(start === 0 || knownRedacted);
  let skipPartialRecord = start > 0;
  let pending = "";
  let discarding = false;

  const consume = (input: string): void => {
    let decoded = input;
    if (skipPartialRecord) {
      const firstNewline = decoded.indexOf("\n");
      if (firstNewline < 0) return;
      skipPartialRecord = false;
      decoded = decoded.slice(firstNewline + 1);
    }
    let cursor = 0;
    let newline = decoded.indexOf("\n", cursor);
    while (newline >= 0) {
      const fragment = decoded.slice(cursor, newline);
      const oversized = discarding || pending.length + fragment.length > MAX_LOG_RECORD_CHARS;
      const raw = oversized ? "" : pending + fragment;
      const carriageReturn = raw.endsWith("\r");
      const value = carriageReturn ? raw.slice(0, -1) : raw;
      if (oversized) redactor.failClosed();
      visit({
        value: oversized ? REDACTED : redactor.redactLine(value),
        ending: carriageReturn ? "\r\n" : "\n",
      });
      pending = "";
      discarding = false;
      cursor = newline + 1;
      newline = decoded.indexOf("\n", cursor);
    }

    const remainder = decoded.slice(cursor);
    if (!discarding && pending.length + remainder.length <= MAX_LOG_RECORD_CHARS) {
      pending += remainder;
    } else if (remainder.length > 0) {
      pending = "";
      discarding = true;
    }
  };

  let position = start;
  while (position < fileSize) {
    const length = Math.min(buffer.length, fileSize - position);
    const bytesRead = readSync(fileDescriptor, buffer, 0, length, position);
    if (bytesRead <= 0) break;
    position += bytesRead;
    observeRead(bytesRead);
    consume(decoder.write(buffer.subarray(0, bytesRead)));
  }
  consume(decoder.end());
  if (skipPartialRecord || discarding) {
    if (discarding) redactor.failClosed();
    visit({ value: REDACTED, ending: "" });
  } else if (pending.length > 0) {
    visit({ value: redactor.redactLine(pending), ending: "" });
  }
};

const createBoundedRecordTail = (maxBytes: number): BoundedRecordTail => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  return {
    append(value: string): void {
      const chunk = Buffer.from(value);
      if (chunk.length > maxBytes) {
        chunks.length = 0;
        totalBytes = 0;
        return;
      }
      chunks.push(chunk);
      totalBytes += chunk.length;
      while (totalBytes > maxBytes) {
        const removed = chunks.shift();
        if (removed) totalBytes -= removed.length;
      }
    },
    value(): string {
      return Buffer.concat(chunks, totalBytes).toString("utf8");
    },
  };
};

export const readFileTailBytes = (
  path: string,
  maxBytes: number,
  observeRead: (bytes: number) => void = () => undefined,
): string => {
  if (maxBytes <= 0) return "";
  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = openPrivateFile(path, constants.O_RDONLY, false);
    const tail = createBoundedRecordTail(maxBytes);
    visitRedactedLogRecords(
      fileDescriptor,
      maxBytes,
      descriptorHasTrustedRedaction(path, fileDescriptor),
      ({ value, ending }) => tail.append(value + ending),
      observeRead,
    );
    return tail.value();
  } catch {
    return "";
  } finally {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
  }
};

export const tailFileLines = (
  path: string,
  limit: number,
  maxBytes = 10 * 1024 * 1024,
): string[] => {
  if (limit <= 0 || maxBytes <= 0) return [];
  let fd: number;
  try {
    fd = openPrivateFile(path, constants.O_RDONLY, false);
  } catch {
    return [];
  }
  try {
    const lines: Array<{ value: string; bytes: number }> = [];
    let totalBytes = 0;
    visitRedactedLogRecords(fd, maxBytes, descriptorHasTrustedRedaction(path, fd), ({ value }) => {
      const bytes = Buffer.byteLength(value);
      if (bytes > maxBytes) {
        lines.length = 0;
        totalBytes = 0;
        return;
      }
      lines.push({ value, bytes });
      totalBytes += bytes;
      while (lines.length > limit || totalBytes > maxBytes) {
        const removed = lines.shift();
        if (removed) totalBytes -= removed.bytes;
      }
    });
    return lines.map(({ value }) => value);
  } finally {
    closeSync(fd);
  }
};
