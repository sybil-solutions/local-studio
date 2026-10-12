// Release pipeline steps, run by .github/workflows/release.yml on macOS:
// assert the revision is still origin/main, sign + notarize the prepackaged
// app, and stage the verified assets for the publish job.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frontendDir, repoRoot, valueAfter } from "./lib.mjs";

const output = path.join(frontendDir, "dist-desktop");
const requireFromHere = createRequire(import.meta.url);

export function assertReleaseMain(args = process.argv.slice(2)) {
  const expected = valueAfter(args, "--commit")?.trim().toLowerCase();
  if (!expected || !/^[0-9a-f]{40}$/.test(expected)) {
    throw Error("--commit must be a full Git commit SHA");
  }
  const current = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], {
    encoding: "utf8",
  })
    .trim()
    .split(/\s+/, 1)[0]
    ?.toLowerCase();
  if (!current || !/^[0-9a-f]{40}$/.test(current)) throw Error("Could not resolve origin/main");
  if (current !== expected) {
    throw Error(`Refusing stale release: origin/main is ${current}, build is ${expected}`);
  }
  console.log(`Release source is current origin/main: ${expected}`);
  return expected;
}

function envValue(env, name) {
  const candidate = env[name];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function resolveNotarytoolCredentials(env, apiKeyPath) {
  const apiKey = envValue(env, "APPLE_API_KEY_BASE64");
  const apiKeyId = envValue(env, "APPLE_API_KEY_ID");
  const apiIssuer = envValue(env, "APPLE_API_ISSUER");
  if (apiKey && apiKeyId && apiIssuer) {
    return {
      kind: "api-key",
      apiKey,
      args: ["--key", apiKeyPath, "--key-id", apiKeyId, "--issuer", apiIssuer],
    };
  }
  const appleId = envValue(env, "APPLE_ID");
  const password = envValue(env, "APPLE_APP_SPECIFIC_PASSWORD");
  const teamId = envValue(env, "APPLE_TEAM_ID");
  if (appleId && password && teamId) {
    return {
      kind: "apple-id",
      args: ["--apple-id", appleId, "--password", password, "--team-id", teamId],
    };
  }
  throw Error("Apple notarization requires either the API key secret trio or the Apple ID secret trio");
}

const releasePackageArguments = ({ app, version, commit }) => [
  "--prepackaged",
  app,
  "--config",
  "desktop/electron-builder.yml",
  "--config.mac.identity=null",
  "--config.mac.notarize=false",
  "--config.dmg.sign=false",
  `--config.extraMetadata.version=${version}`,
  `--config.extraMetadata.localStudioCommit=${commit}`,
  "--publish",
  "never",
];

function requireValue(name) {
  const value = process.env[name];
  if (!value) throw Error(`Repo secret ${name} is missing`);
  return value;
}

function runInRepo(command, args, options = {}) {
  execFileSync(command, args, { cwd: repoRoot, env: process.env, stdio: "inherit", ...options });
}

function repoCommandOutput(command, args) {
  return execFileSync(command, args, { cwd: repoRoot, env: process.env, encoding: "utf8" }).trim();
}

function keychainList() {
  return [...repoCommandOutput("security", ["list-keychains", "-d", "user"]).matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
}

function writeCertificate(link, destination) {
  const value = link.trim();
  if (value.startsWith("file://")) {
    writeFileSync(destination, readFileSync(fileURLToPath(value)), { mode: 0o600, flag: "wx" });
    return;
  }
  if (existsSync(value)) {
    writeFileSync(destination, readFileSync(value), { mode: 0o600, flag: "wx" });
    return;
  }
  const encoded = value.replace(/^data:[^;]+;base64,/, "");
  writeFileSync(destination, Buffer.from(encoded, "base64"), { mode: 0o600, flag: "wx" });
}

function notarizeApplication(app, archive, credentials, execute = runInRepo) {
  execute("ditto", ["-c", "-k", "--keepParent", app, archive]);
  execute("xcrun", ["notarytool", "submit", archive, ...credentials, "--wait", "--output-format", "json"]);
  execute("xcrun", ["stapler", "staple", app]);
  execute("xcrun", ["stapler", "validate", app]);
  execute("spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
}

async function refreshUpdateMetadata(outputDir, version) {
  const { buildBlockMap } = requireFromHere(
    path.join(frontendDir, "node_modules", "app-builder-lib", "out", "targets", "blockmap", "blockmap.js"),
  );
  const YAML = requireFromHere(path.join(frontendDir, "node_modules", "yaml"));
  const zipName = `Local Studio-${version}-arm64-mac.zip`;
  const dmgName = `Local Studio-${version}-arm64.dmg`;
  const zipInfo = await buildBlockMap(
    path.join(outputDir, zipName),
    "gzip",
    path.join(outputDir, `${zipName}.blockmap`),
  );
  const dmgInfo = await buildBlockMap(
    path.join(outputDir, dmgName),
    "gzip",
    path.join(outputDir, `${dmgName}.blockmap`),
  );
  const updatePath = path.join(outputDir, "latest-mac.yml");
  const current = YAML.parse(readFileSync(updatePath, "utf8"));
  writeFileSync(
    updatePath,
    YAML.stringify({
      version,
      files: [
        { url: zipName.replaceAll(" ", "-"), sha512: zipInfo.sha512, size: zipInfo.size },
        { url: dmgName.replaceAll(" ", "-"), sha512: dmgInfo.sha512, size: dmgInfo.size },
      ],
      path: zipName.replaceAll(" ", "-"),
      sha512: zipInfo.sha512,
      releaseDate: current.releaseDate,
    }),
  );
}

export async function signDesktopRelease(args = process.argv.slice(2)) {
  const version = valueAfter(args, "--version")?.trim();
  const commit = valueAfter(args, "--commit")?.trim().toLowerCase();
  const prepackaged = valueAfter(args, "--prepackaged")?.trim();
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw Error("--version must be a semantic version");
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw Error("--commit must be a full Git commit SHA");
  if (!prepackaged || !existsSync(prepackaged)) {
    throw Error("--prepackaged must point to an unsigned app bundle");
  }

  const certificate = requireValue("CSC_LINK");
  const certificatePassword = requireValue("CSC_KEY_PASSWORD");
  const temporary = path.join(os.tmpdir(), `local-studio-release-${process.pid}`);
  const apiKeyPath = path.join(temporary, "AuthKey_notary.p8");
  const notaryCredentials = resolveNotarytoolCredentials(process.env, apiKeyPath);
  const certificatePath = path.join(temporary, "developer-id.p12");
  const keychainPath = path.join(temporary, "release-signing.keychain-db");
  const keychainPassword = randomBytes(32).toString("hex");
  const originalKeychains = keychainList();
  const dmg = path.join(output, `Local Studio-${version}-arm64.dmg`);
  const resolvedApp = path.resolve(prepackaged);
  const appNotaryArchive = path.join(temporary, "Local Studio.app.zip");
  const entitlements = path.join(frontendDir, "desktop", "resources", "entitlements.mac.plist");

  try {
    rmSync(temporary, { recursive: true, force: true });
    mkdirSync(temporary, { recursive: true, mode: 0o700 });
    if (notaryCredentials.kind === "api-key") {
      writeFileSync(apiKeyPath, Buffer.from(notaryCredentials.apiKey, "base64"), {
        mode: 0o600,
        flag: "wx",
      });
    }
    writeCertificate(certificate, certificatePath);
    runInRepo("security", ["create-keychain", "-p", keychainPassword, keychainPath]);
    runInRepo("security", ["set-keychain-settings", "-lut", "21600", keychainPath]);
    runInRepo("security", ["unlock-keychain", "-p", keychainPassword, keychainPath]);
    runInRepo("security", [
      "import",
      certificatePath,
      "-k",
      keychainPath,
      "-P",
      certificatePassword,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ]);
    runInRepo("security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychainPath,
    ]);
    runInRepo("security", ["list-keychains", "-d", "user", "-s", keychainPath, ...originalKeychains]);

    const identity = repoCommandOutput("security", [
      "find-identity",
      "-v",
      "-p",
      "codesigning",
      keychainPath,
    ]).match(/"([^"]*Developer ID Application:[^"]*)"/)?.[1];
    if (!identity) {
      throw Error("Imported certificate does not contain a Developer ID Application identity");
    }

    const { signAsync } = requireFromHere(path.join(frontendDir, "node_modules", "@electron", "osx-sign"));
    await signAsync({
      app: resolvedApp,
      platform: "darwin",
      type: "distribution",
      identity,
      keychain: keychainPath,
      hardenedRuntime: true,
      preAutoEntitlements: false,
    });
    runInRepo("codesign", [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--entitlements",
      entitlements,
      "--sign",
      identity,
      "--keychain",
      keychainPath,
      resolvedApp,
    ]);
    runInRepo("codesign", ["--verify", "--deep", "--strict", "--verbose=4", resolvedApp]);
    notarizeApplication(resolvedApp, appNotaryArchive, notaryCredentials.args);

    process.env.LOCAL_STUDIO_RELEASE_VERSION = version;
    process.env.LOCAL_STUDIO_RELEASE_COMMIT = commit;
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    runInRepo(
      path.join(frontendDir, "node_modules", ".bin", "electron-builder"),
      releasePackageArguments({ app: resolvedApp, version, commit }),
      { cwd: frontendDir },
    );
    runInRepo("codesign", ["--force", "--timestamp", "--sign", identity, "--keychain", keychainPath, dmg]);
    runInRepo("xcrun", [
      "notarytool",
      "submit",
      dmg,
      ...notaryCredentials.args,
      "--wait",
      "--output-format",
      "json",
    ]);
    runInRepo("xcrun", ["stapler", "staple", dmg]);
    await refreshUpdateMetadata(output, version);
    runInRepo("xcrun", ["stapler", "validate", dmg]);
    runInRepo("codesign", ["--verify", "--verbose=4", dmg]);
    runInRepo("spctl", [
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      "--verbose=4",
      dmg,
    ]);

    const packagedApp = path.join(output, "mac-arm64", "Local Studio.app");
    mkdirSync(path.dirname(packagedApp), { recursive: true });
    rmSync(packagedApp, { recursive: true, force: true });
    symlinkSync(resolvedApp, packagedApp, "dir");
    console.log(`Signed and notarized Local Studio ${version} from ${commit}`);
  } finally {
    if (originalKeychains.length > 0) {
      runInRepo("security", ["list-keychains", "-d", "user", "-s", ...originalKeychains]);
    }
    if (existsSync(keychainPath)) runInRepo("security", ["delete-keychain", keychainPath]);
    rmSync(temporary, { recursive: true, force: true });
  }
}

function frontendVersion() {
  const manifest = JSON.parse(readFileSync(path.join(frontendDir, "package.json"), "utf8"));
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw Error("frontend/package.json must contain a semantic version");
  }
  return manifest.version;
}

function releaseAssetNames(version) {
  const base = `Local Studio-${version}-arm64`;
  return [`${base}.dmg`, `${base}.dmg.blockmap`, `${base}-mac.zip`, `${base}-mac.zip.blockmap`, "latest-mac.yml"];
}

export function stageDesktopRelease(args = process.argv.slice(2)) {
  const staging = path.join(repoRoot, "release-staging");
  const version = valueAfter(args, "--version")?.trim() || frontendVersion();
  const commit = valueAfter(args, "--commit")?.trim().toLowerCase();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("--version must be a semantic version");
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw Error("--commit must be a full Git commit SHA");

  const requireAsset = (name) => {
    const file = path.join(output, name);
    if (!existsSync(file)) throw Error(`Missing desktop release asset: ${file}`);
    return file;
  };
  const releaseAssetName = (name) => name.replaceAll(" ", "-");
  const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

  const archive = path.join(output, "mac-arm64", "Local Studio.app", "Contents", "Resources", "app.asar");
  if (!existsSync(archive)) throw Error(`Missing packaged app archive: ${archive}`);
  const asar = requireFromHere(path.join(frontendDir, "node_modules", "@electron", "asar"));
  const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
  if (metadata.version !== version) {
    throw Error(`Packaged version ${metadata.version} does not match release ${version}`);
  }
  if (metadata.localStudioCommit !== commit) {
    throw Error(`Packaged commit ${String(metadata.localStudioCommit)} does not match release ${commit}`);
  }

  const names = releaseAssetNames(version);
  const assets = names.map((name) => [requireAsset(name), path.join(staging, releaseAssetName(name))]);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const [source, destination] of assets) copyFileSync(source, destination);
  copyFileSync(
    requireAsset(`Local Studio-${version}-arm64.dmg`),
    path.join(staging, "Local-Studio-arm64.dmg"),
  );

  const stagedNames = [...names.map(releaseAssetName), "Local-Studio-arm64.dmg"];
  const manifest = {
    schemaVersion: 1,
    version,
    commit,
    assets: Object.fromEntries(
      stagedNames.map((name) => [name, { sha256: sha256(path.join(staging, name)) }]),
    ),
  };
  writeFileSync(path.join(staging, "Local-Studio-release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Staged ${stagedNames.length + 1} Local Studio ${version} assets in ${staging}`);
  return manifest;
}
