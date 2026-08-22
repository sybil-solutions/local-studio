import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Read a JSON object from disk, falling back to `{}` whenever the file is
 * missing, unreadable, malformed, or holds anything but a plain object. Every
 * main-process store treats a corrupt file as "start over" rather than a crash.
 */
export function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    if (!existsSync(filePath)) return {};
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Write JSON to disk atomically: ensure the parent directory exists, write to
 * a sibling temp file named with pid + timestamp, then rename into place so
 * readers never observe a half-written file.
 *
 * `space` matches JSON.stringify's third argument (omit for compact output).
 *
 * Lives under desktop/ because the desktop build (tsc rootDir = desktop/)
 * cannot import from src/.
 */
export function writeJsonAtomic(filePath: string, payload: unknown, space?: number): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(payload, null, space)}\n`, "utf8");
  renameSync(tempPath, filePath);
}
