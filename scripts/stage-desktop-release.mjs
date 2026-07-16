import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const output = path.join(frontend, "dist-desktop");
const staging = path.join(root, "release-staging");

function frontendVersion() {
  const manifest = JSON.parse(readFileSync(path.join(frontend, "package.json"), "utf8"));
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error("frontend/package.json must contain a semantic version");
  }
  return manifest.version;
}

function releaseAssetNames(version) {
  const base = `Local Studio-${version}-arm64`;
  return [
    `${base}.dmg`,
    `${base}.dmg.blockmap`,
    `${base}-mac.zip`,
    `${base}-mac.zip.blockmap`,
    "latest-mac.yml",
  ];
}

function requireAsset(name) {
  const file = path.join(output, name);
  if (!existsSync(file)) throw new Error(`Missing desktop release asset: ${file}`);
  return file;
}

const version = frontendVersion();
const names = releaseAssetNames(version);
const assets = names.map((name) => [requireAsset(name), path.join(staging, name)]);

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
for (const [source, destination] of assets) copyFileSync(source, destination);
copyFileSync(requireAsset(`Local Studio-${version}-arm64.dmg`), path.join(staging, "Local-Studio-arm64.dmg"));

console.log(`Staged ${names.length + 1} Local Studio ${version} assets in ${staging}`);
