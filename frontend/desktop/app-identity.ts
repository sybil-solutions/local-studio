import { app } from "electron";
import path from "node:path";
import { migrateLegacyUserData } from "./logic/user-data-migration";

const CANONICAL_APP_NAME = "Local Studio";
const LEGACY_BRANDED_APP_NAME = ["v", "LLM Studio"].join("");
const LEGACY_USER_DATA_NAMES = [LEGACY_BRANDED_APP_NAME, "frontend"];
const devAppName = process.env.LOCAL_STUDIO_DESKTOP_APP_NAME?.trim();
const devUserDataDir = process.env.LOCAL_STUDIO_DESKTOP_USER_DATA_DIR?.trim();
const releaseChannel = process.env.LOCAL_STUDIO_DESKTOP_CHANNEL?.trim().toLowerCase();
const nonStablePackagedChannel =
  app.isPackaged && (releaseChannel === "beta" || releaseChannel === "alpha");

if (nonStablePackagedChannel) {
  throw new Error(
    `Packaged ${releaseChannel} desktop builds are disabled in the stable builder config. Use a separate Electron Builder config with its own app id, product name, and user-data path.`,
  );
}

const appName = devAppName || (app.isPackaged ? CANONICAL_APP_NAME : app.getName());
if (devAppName || app.isPackaged) {
  app.setName(appName);
  process.title = appName;
}

const appDataDir = app.getPath("appData");
const userDataDir = devUserDataDir
  ? path.resolve(devUserDataDir)
  : devAppName || app.isPackaged
    ? path.join(appDataDir, appName)
    : app.getPath("userData");

app.setPath("userData", userDataDir);

if (app.isPackaged && appName === CANONICAL_APP_NAME && !devAppName && !devUserDataDir) {
  for (const legacyName of LEGACY_USER_DATA_NAMES) {
    const migrated = migrateLegacyUserData({
      legacyDir: path.join(appDataDir, legacyName),
      targetDir: userDataDir,
    });
    if (migrated.length > 0) {
      console.info(
        `[desktop] Migrated ${migrated.length} legacy user-data paths from ${legacyName}`,
      );
    }
  }
}
