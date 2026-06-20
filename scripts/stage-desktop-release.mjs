import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function frontendVersion(frontend) {
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

function requireAsset(output, name) {
  const file = path.join(output, name);
  if (!existsSync(file)) throw new Error(`Missing desktop release asset: ${file}`);
  return file;
}

export function stageDesktopRelease(rootDir) {
  const frontend = path.join(rootDir, "frontend");
  const output = path.join(frontend, "dist-desktop");
  const staging = path.join(rootDir, "release-staging");
  const version = frontendVersion(frontend);
  const names = releaseAssetNames(version);
  const aliases = [
    [`Local Studio-${version}-arm64.dmg`, "Local-Studio-arm64.dmg"],
    [`Local Studio-${version}-arm64-mac.zip`, "Local-Studio-arm64-mac.zip"],
  ];

  for (const name of names) requireAsset(output, name);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const name of names) copyFileSync(requireAsset(output, name), path.join(staging, name));
  for (const [source, destination] of aliases) {
    copyFileSync(requireAsset(output, source), path.join(staging, destination));
  }

  return { files: readdirSync(staging).sort(), staging, version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { files, staging, version } = stageDesktopRelease(root);
  console.log(`Staged ${files.length} Local Studio ${version} assets in ${staging}`);
}
