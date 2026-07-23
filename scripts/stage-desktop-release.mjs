import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const output = path.join(frontend, "dist-desktop");
const staging = path.join(root, "release-staging");
const require = createRequire(import.meta.url);

function frontendVersion() {
  const manifest = JSON.parse(readFileSync(path.join(frontend, "package.json"), "utf8"));
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error("frontend/package.json must contain a semantic version");
  }
  return manifest.version;
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
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

function releaseAssetName(name) {
  return name.replaceAll(" ", "-");
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function packagedMetadata() {
  const archive = path.join(
    output,
    "mac-arm64",
    "Local Studio.app",
    "Contents",
    "Resources",
    "app.asar",
  );
  if (!existsSync(archive)) throw new Error(`Missing packaged app archive: ${archive}`);
  const asar = require(path.join(frontend, "node_modules", "@electron", "asar"));
  return JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
}

export function stageDesktopRelease(args = process.argv.slice(2)) {
  const version = valueAfter(args, "--version")?.trim() || frontendVersion();
  const commit = valueAfter(args, "--commit")?.trim().toLowerCase();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("--version must be a semantic version");
  }
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("--commit must be a full Git commit SHA");
  }

  const metadata = packagedMetadata();
  if (metadata.version !== version) {
    throw new Error(`Packaged version ${metadata.version} does not match release ${version}`);
  }
  if (metadata.localStudioCommit !== commit) {
    throw new Error(
      `Packaged commit ${String(metadata.localStudioCommit)} does not match release ${commit}`,
    );
  }

  const names = releaseAssetNames(version);
  const assets = names.map((name) => [
    requireAsset(name),
    path.join(staging, releaseAssetName(name)),
  ]);

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const [source, destination] of assets) copyFileSync(source, destination);
  copyFileSync(
    requireAsset(`Local Studio-${version}-arm64.dmg`),
    path.join(staging, "Local-Studio-arm64.dmg"),
  );

  const stagedNames = [
    ...names.map(releaseAssetName),
    "Local-Studio-arm64.dmg",
  ];
  const manifest = {
    schemaVersion: 1,
    version,
    commit,
    assets: Object.fromEntries(
      stagedNames.map((name) => [
        name,
        { sha256: sha256(path.join(staging, name)) },
      ]),
    ),
  };
  writeFileSync(
    path.join(staging, "Local-Studio-release.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(`Staged ${stagedNames.length + 1} Local Studio ${version} assets in ${staging}`);
  return manifest;
}

stageDesktopRelease();
