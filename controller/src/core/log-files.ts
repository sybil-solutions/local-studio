import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, openSync, closeSync, readSync } from "node:fs";
import { join, resolve } from "node:path";

const LOG_PREFIX = "vllm_";
const LOG_SUFFIX = ".log";
const FALLBACK_LOG_DIR = "/tmp";

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
  const clampInt = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
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
    maxTotalBytes: maxTotalBytes <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1_000_000, maxTotalBytes),
  };
};

export const sanitizeLogSessionId = (sessionId: string): string => {
  const safe = Array.from(sessionId).filter((char) => /[a-zA-Z0-9._-]/.test(char)).join("");
  return safe;
};

export const ensureLogsDirectory = (dataDirectory: string): string => {
  const directory = resolve(dataDirectory, "logs");
  mkdirSync(directory, { recursive: true });
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
  if (existsSync(primary)) return primary;
  const fallback = fallbackLogPathFor(sessionId);
  if (existsSync(fallback)) return fallback;
  return null;
};

const scanLogDirectory = (directory: string, source: LogFileEntry["source"]): LogFileEntry[] => {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory)
      .filter((name) => name.startsWith(LOG_PREFIX) && name.endsWith(LOG_SUFFIX))
      .map((name) => {
        const path = join(directory, name);
        const stat = statSync(path);
        const sessionId = name.replace(new RegExp(`^${LOG_PREFIX}`), "").replace(new RegExp(`${LOG_SUFFIX}$`), "");
        return {
          sessionId,
          path,
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          source,
        } satisfies LogFileEntry;
      });
  } catch {
    return [];
  }
};

export const listLogFiles = (dataDirectory: string): LogFileEntry[] => {
  const primaryDirectory = resolve(dataDirectory, "logs");
  const all = [...scanLogDirectory(primaryDirectory, "data_dir"), ...scanLogDirectory(FALLBACK_LOG_DIR, "tmp")];

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

export const cleanupLogFiles = (dataDirectory: string, options: LogCleanupOptions): { deleted: number } => {
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

export const readFileTailBytes = (path: string, maxBytes: number): string => {
  try {
    const stat = statSync(path);
    const size = stat.size;
    if (size <= 0) return "";

    const toRead = Math.min(size, maxBytes);
    const offset = Math.max(0, size - toRead);
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.allocUnsafe(toRead);
      const read = readSync(fd, buf, 0, toRead, offset);
      return buf.slice(0, read).toString("utf-8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
};

export const tailFileLines = (path: string, limit: number, maxBytes = 10 * 1024 * 1024): string[] => {
  if (limit <= 0) return [];
  if (!existsSync(path)) return [];

  // Read from the end until we have enough newlines or hit maxBytes.
  const fd = openSync(path, "r");
  try {
    const stat = statSync(path);
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
