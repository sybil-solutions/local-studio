//
// Single source of truth for the user-data directory.
//
// Resolution order:
//   1. process.env.LOCAL_STUDIO_DATA_DIR (set by the desktop main process to
//      Electron's userData path).
//   2. ~/.local-studio (dev/CLI default).
//
// One-time migration: when the resolved dir has no api-settings.json, copy
// the first existing legacy file we can find. After this runs once, the
// resolver never looks at legacy paths again.

import { copyFileSync, existsSync, mkdirSync, chmodSync, renameSync, writeFileSync } from "node:fs";
import { chmod, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const SETTINGS_FILENAME = "api-settings.json";
const LEGACY_DOT_DIR = [".v", "llm-studio"].join("");
const LEGACY_APP_DATA_DIR = ["v", "LLM Studio"].join("");
const LEGACY_APP_DATA_SLUG = ["v", "llm-studio-app"].join("");

let cachedDataDir: string | null = null;
// The env value the cache was computed from so an explicit runtime override
// can move the data directory without retaining a stale cached path.
let cachedDataDirEnv: string | undefined;
let migrated = false;

function legacySettingsFileCandidates(): string[] {
  return [
    path.join(process.cwd(), "data", SETTINGS_FILENAME),
    path.join(process.cwd(), "..", "data", SETTINGS_FILENAME),
    path.join(process.cwd(), "frontend", "data", SETTINGS_FILENAME),
    path.join(homedir(), ".local-studio", SETTINGS_FILENAME),
    path.join(homedir(), LEGACY_DOT_DIR, SETTINGS_FILENAME),
    path.join(tmpdir(), "local-studio", SETTINGS_FILENAME),
    // Past Electron userData siblings.
    path.join(
      homedir(),
      "Library",
      "Application Support",
      "local-studio-app",
      SETTINGS_FILENAME,
    ),
    path.join(
      homedir(),
      "Library",
      "Application Support",
      LEGACY_APP_DATA_SLUG,
      SETTINGS_FILENAME,
    ),
    path.join(
      homedir(),
      "Library",
      "Application Support",
      LEGACY_APP_DATA_DIR,
      SETTINGS_FILENAME,
    ),
    path.join(homedir(), "Library", "Application Support", "Electron", SETTINGS_FILENAME),
    path.join(homedir(), "Library", "Application Support", "frontend", SETTINGS_FILENAME),
  ];
}

export function resolveDataDir(): string {
  const envDir = process.env.LOCAL_STUDIO_DATA_DIR?.trim();
  if (cachedDataDir && cachedDataDirEnv === envDir) return cachedDataDir;

  const dir = envDir && envDir.length > 0 ? envDir : path.join(homedir(), ".local-studio");

  mkdirSync(dir, { recursive: true });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort
  }

  cachedDataDir = dir;
  cachedDataDirEnv = envDir;
  migrateLegacySettings(dir);
  return dir;
}

export function resolveSettingsFilePath(): string {
  return path.join(resolveDataDir(), SETTINGS_FILENAME);
}

/** `mode` is applied to the temp file at creation and re-applied after the rename; `compact` skips pretty-printing for large entries. */
type AtomicWriteJsonOptions = { mode?: number; compact?: boolean };

const atomicJsonParts = (file: string, value: unknown, compact?: boolean) =>
  [
    `${file}.tmp-${process.pid}-${randomUUID()}`,
    compact ? JSON.stringify(value) : JSON.stringify(value, null, 2),
  ] as const;

/** Write-then-rename, so a crash mid-write can never leave a torn or truncated file. */
export async function atomicWriteJson(
  file: string,
  value: unknown,
  { mode, compact }: AtomicWriteJsonOptions = {},
): Promise<void> {
  const [temporary, payload] = atomicJsonParts(file, value, compact);
  await writeFile(temporary, payload, { encoding: "utf-8", ...(mode === undefined ? {} : { mode }) });
  if (mode !== undefined) await chmod(temporary, mode);
  await rename(temporary, file);
  if (mode !== undefined) await chmod(file, mode);
}

/** Synchronous twin of {@link atomicWriteJson}. */
export function atomicWriteJsonSync(
  file: string,
  value: unknown,
  { mode, compact }: AtomicWriteJsonOptions = {},
): void {
  const [temporary, payload] = atomicJsonParts(file, value, compact);
  writeFileSync(temporary, payload, { encoding: "utf-8", ...(mode === undefined ? {} : { mode }) });
  if (mode !== undefined) chmodSync(temporary, mode);
  renameSync(temporary, file);
  if (mode !== undefined) chmodSync(file, mode);
}

function migrateLegacySettings(targetDir: string): void {
  if (migrated) return;
  migrated = true;

  const targetFile = path.join(targetDir, SETTINGS_FILENAME);
  if (existsSync(targetFile)) return;

  for (const legacyFile of legacySettingsFileCandidates()) {
    if (path.resolve(legacyFile) === path.resolve(targetFile)) continue;
    if (!existsSync(legacyFile)) continue;
    try {
      copyFileSync(legacyFile, targetFile);
      try {
        chmodSync(targetFile, 0o600);
      } catch {
        // best-effort
      }
      console.log(`[data-dir] Migrated api-settings.json from ${legacyFile} -> ${targetFile}`);
      return;
    } catch (error) {
      console.warn(`[data-dir] Failed to migrate from ${legacyFile}:`, error);
    }
  }
}
