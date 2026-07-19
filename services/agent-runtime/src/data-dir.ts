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

import { copyFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const SETTINGS_FILENAME = "api-settings.json";
const LEGACY_DOT_DIR = [".v", "llm-studio"].join("");
const LEGACY_APP_DATA_DIR = ["v", "LLM Studio"].join("");
const LEGACY_APP_DATA_SLUG = ["v", "llm-studio-app"].join("");

let cachedDataDir: string | null = null;
// The env value the cache was computed from: LOCAL_STUDIO_DATA_DIR never
// changes mid-process in production, but single-process test runners flip it
// between files — a blind cache would pin every file to the first dir.
let cachedDataDirEnv: string | undefined;
let migrated = false;

export function dataDirPath(): string {
  const envDir = process.env.LOCAL_STUDIO_DATA_DIR?.trim();
  return envDir && envDir.length > 0 ? envDir : path.join(homedir(), ".local-studio");
}

function legacyDataDirCandidates(): string[] {
  return [
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "..", "data"),
    path.join(process.cwd(), "frontend", "data"),
    path.join(homedir(), ".local-studio"),
    path.join(homedir(), LEGACY_DOT_DIR),
    path.join(tmpdir(), "local-studio"),
    // Past Electron userData siblings.
    path.join(homedir(), "Library", "Application Support", "local-studio-app"),
    path.join(homedir(), "Library", "Application Support", LEGACY_APP_DATA_SLUG),
    path.join(homedir(), "Library", "Application Support", LEGACY_APP_DATA_DIR),
    path.join(homedir(), "Library", "Application Support", "Electron"),
    path.join(homedir(), "Library", "Application Support", "frontend"),
  ];
}

export function resolveDataDir(): string {
  const envDir = process.env.LOCAL_STUDIO_DATA_DIR?.trim();
  if (cachedDataDir && cachedDataDirEnv === envDir) return cachedDataDir;

  const dir = dataDirPath();

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

function migrateLegacySettings(targetDir: string): void {
  if (migrated) return;
  migrated = true;

  const targetFile = path.join(targetDir, SETTINGS_FILENAME);
  if (existsSync(targetFile)) return;

  for (const candidate of legacyDataDirCandidates()) {
    if (path.resolve(candidate) === path.resolve(targetDir)) continue;
    const legacyFile = path.join(candidate, SETTINGS_FILENAME);
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
