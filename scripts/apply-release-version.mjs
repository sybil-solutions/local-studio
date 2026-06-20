import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

const PACKAGE_FILES = [
  "package.json",
  "package-lock.json",
  "frontend/package.json",
  "frontend/package-lock.json",
];

export function isValidReleaseVersion(version) {
  return RELEASE_VERSION_PATTERN.test(version);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function updatePackageFile(filePath, version) {
  const json = await readJson(filePath);
  json.version = version;

  if (json.packages?.[""] && typeof json.packages[""] === "object") {
    json.packages[""].version = version;
  }

  await writeJson(filePath, json);
}

export async function applyReleaseVersion({ rootDir, version }) {
  if (!isValidReleaseVersion(version)) {
    throw new Error(
      `Release version must be a plain semver string without a leading "v"; received ${JSON.stringify(version)}`,
    );
  }

  for (const relativePath of PACKAGE_FILES) {
    await updatePackageFile(path.join(rootDir, relativePath), version);
  }
}

async function main() {
  const version = process.argv[2];
  if (!version) {
    throw new Error("Usage: node scripts/apply-release-version.mjs <version>");
  }

  await applyReleaseVersion({ rootDir: process.cwd(), version });
  console.log(`Applied release version ${version} to package metadata.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
