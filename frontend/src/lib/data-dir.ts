//
// Single source of truth for the user-data directory.
//
// Resolution order:
//   1. process.env.VLLM_STUDIO_DATA_DIR (set by the desktop main process to
//      Electron's userData path).
//   2. ~/.vllm-studio (dev/CLI default).
//
// One-time migration: when the resolved dir has no api-settings.json, copy
// the first existing legacy file we can find. After this runs once, the
// resolver never looks at legacy paths again.

import { copyFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const SETTINGS_FILENAME = "api-settings.json";

let cachedDataDir: string | null = null;
let migrated = false;

function legacyDataDirCandidates(): string[] {
  return [
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "..", "data"),
    path.join(process.cwd(), "frontend", "data"),
    path.join(homedir(), ".vllm-studio"),
    path.join(tmpdir(), "vllm-studio"),
    // Past Electron userData siblings.
    path.join(homedir(), "Library", "Application Support", "vllm-studio-app"),
    path.join(homedir(), "Library", "Application Support", "Electron"),
    path.join(homedir(), "Library", "Application Support", "frontend"),
  ];
}

export function resolveDataDir(): string {
  if (cachedDataDir) return cachedDataDir;

  const envDir = process.env.VLLM_STUDIO_DATA_DIR?.trim();
  const dir = envDir && envDir.length > 0 ? envDir : path.join(homedir(), ".vllm-studio");

  mkdirSync(dir, { recursive: true });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort
  }

  cachedDataDir = dir;
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
