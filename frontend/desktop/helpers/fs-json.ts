import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

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
