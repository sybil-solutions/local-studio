import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const MIGRATION_MARKER = "legacy-user-data-migration-v1.json";
const MIGRATED_USER_DATA_PATHS = [
  "Local Storage",
  "Cookies",
  "Cookies-journal",
  "DIPS",
  "DIPS-shm",
  "DIPS-wal",
  "IndexedDB",
  "Network Persistent State",
  "Preferences",
  "Session Storage",
  "SharedStorage",
  "SharedStorage-shm",
  "SharedStorage-wal",
  "TransportSecurity",
  "Trust Tokens",
  "Trust Tokens-journal",
  "WebStorage",
  "agent-canvas",
  "agent-canvas.json",
  "agent-session-metadata.json",
  "api-settings.json",
  "chats.db",
  "computer-use",
  "controllers.json",
  "embedded-frontend.port",
  "list-1-to-5000.txt",
  "logs",
  "mcp",
  "pi-agent",
  "projects.json",
  "session-prefs.json",
  "ui-preferences.json",
  "vekor",
] as const;

export function migrateLegacyUserData({
  legacyDir,
  targetDir,
}: {
  legacyDir: string;
  targetDir: string;
}): string[] {
  const sourceRoot = path.resolve(legacyDir);
  const targetRoot = path.resolve(targetDir);
  if (sourceRoot === targetRoot || !existsSync(sourceRoot)) return [];
  const markerPath = path.join(targetRoot, MIGRATION_MARKER);
  if (existsSync(markerPath)) return [];

  try {
    mkdirSync(targetRoot, { recursive: true });
  } catch (error) {
    console.warn(`[desktop] Failed to prepare user-data migration target: ${String(error)}`);
    return [];
  }

  const migrated: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const relativePath of MIGRATED_USER_DATA_PATHS) {
    const sourcePath = path.join(sourceRoot, relativePath);
    if (!existsSync(sourcePath)) continue;
    try {
      const targetPath = path.join(targetRoot, relativePath);
      const copied = copyMissingPath(sourcePath, targetPath);
      (copied ? migrated : skipped).push(relativePath);
    } catch (error) {
      failed.push(relativePath);
      console.warn(`[desktop] Failed to migrate ${relativePath}: ${String(error)}`);
    }
  }
  if (failed.length === 0) {
    writeMigrationMarker(markerPath, { legacyDir: sourceRoot, migrated, skipped });
  } else {
    console.warn(
      `[desktop] Legacy user-data migration left ${failed.length} paths pending; will retry next launch`,
    );
  }
  return migrated;
}

function copyMissingPath(sourcePath: string, targetPath: string): boolean {
  if (existsSync(targetPath)) {
    const sourceStat = statSync(sourcePath);
    const targetStat = statSync(targetPath);
    if (!sourceStat.isDirectory() || !targetStat.isDirectory()) return false;

    let copied = false;
    for (const entry of readdirSync(sourcePath)) {
      copied =
        copyMissingPath(path.join(sourcePath, entry), path.join(targetPath, entry)) || copied;
    }
    return copied;
  }

  const stat = statSync(sourcePath);
  if (!stat.isDirectory()) {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath, { force: false });
    return true;
  }

  mkdirSync(targetPath, { recursive: true });
  let copied = true;
  for (const entry of readdirSync(sourcePath)) {
    copied = copyMissingPath(path.join(sourcePath, entry), path.join(targetPath, entry)) || copied;
  }
  return copied;
}

function writeMigrationMarker(
  markerPath: string,
  details: { legacyDir: string; migrated: string[]; skipped: string[] },
): void {
  try {
    writeFileSync(
      markerPath,
      `${JSON.stringify({ ...details, migratedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.warn(`[desktop] Failed to write user-data migration marker: ${String(error)}`);
  }
}
