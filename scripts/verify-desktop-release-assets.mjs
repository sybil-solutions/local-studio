import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function hasVersionedArm64Asset(files, version, extension) {
  return files.some(
    (file) =>
      file.endsWith(extension) &&
      file.includes(version) &&
      file.toLowerCase().includes("arm64"),
  );
}

export async function missingDesktopReleaseAssets({ distDir, version }) {
  const files = await readdir(distDir);
  const missing = [];

  if (!hasVersionedArm64Asset(files, version, ".dmg")) {
    missing.push("versioned arm64 DMG");
  }

  if (!hasVersionedArm64Asset(files, version, ".dmg.blockmap")) {
    missing.push("versioned arm64 DMG blockmap");
  }

  if (!hasVersionedArm64Asset(files, version, ".zip")) {
    missing.push("versioned arm64 ZIP");
  }

  if (!hasVersionedArm64Asset(files, version, ".zip.blockmap")) {
    missing.push("versioned arm64 ZIP blockmap");
  }

  if (!files.includes("latest-mac.yml")) {
    missing.push("latest-mac.yml");
  }

  return missing;
}

async function main() {
  const version = process.argv[2];
  if (!version) {
    throw new Error("Usage: node scripts/verify-desktop-release-assets.mjs <version>");
  }

  const distDir = path.join(process.cwd(), "frontend", "dist-desktop");
  const missing = await missingDesktopReleaseAssets({ distDir, version });

  if (missing.length === 0) {
    console.log(`Verified versioned macOS release assets for ${version}.`);
    return;
  }

  throw new Error(`Missing desktop release artifacts: ${missing.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
