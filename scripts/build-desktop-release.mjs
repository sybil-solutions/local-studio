import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
}

function hasNotarizationCredentials() {
  const keychain = Boolean(process.env.APPLE_KEYCHAIN_PROFILE);
  const apiKey = Boolean(
    process.env.APPLE_API_KEY &&
      process.env.APPLE_API_KEY_ID &&
      process.env.APPLE_API_ISSUER,
  );
  const appleId = Boolean(
    process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID,
  );
  return keychain || apiKey || appleId;
}

function notarytoolCredentials() {
  if (process.env.APPLE_KEYCHAIN_PROFILE) {
    const args = ["--keychain-profile", process.env.APPLE_KEYCHAIN_PROFILE];
    if (process.env.APPLE_KEYCHAIN) args.push("--keychain", process.env.APPLE_KEYCHAIN);
    return args;
  }
  if (
    process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER
  ) {
    return [
      "--key",
      process.env.APPLE_API_KEY,
      "--key-id",
      process.env.APPLE_API_KEY_ID,
      "--issuer",
      process.env.APPLE_API_ISSUER,
    ];
  }
  return [
    "--apple-id",
    process.env.APPLE_ID,
    "--password",
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    "--team-id",
    process.env.APPLE_TEAM_ID,
  ];
}

export function buildDesktopRelease(args = process.argv.slice(2)) {
  const version = valueAfter(args, "--version")?.trim();
  const commit = valueAfter(args, "--commit")?.trim().toLowerCase();
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("--version must be a semantic version");
  }
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("--commit must be a full Git commit SHA");
  }
  if (!hasNotarizationCredentials()) {
    throw new Error("Apple notarization credentials are required for a desktop release");
  }

  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .toLowerCase();
  if (head !== commit) {
    throw new Error(`Release commit ${commit} does not match checkout HEAD ${head}`);
  }

  const trackedChanges = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (trackedChanges) {
    throw new Error("Tracked source files must be clean before building a desktop release");
  }

  const output = path.join(frontend, "dist-desktop");
  const staging = path.join(root, "release-staging");
  if (existsSync(output)) rmSync(output, { recursive: true, force: true });
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });

  process.env.LOCAL_STUDIO_RELEASE_VERSION = version;
  process.env.LOCAL_STUDIO_RELEASE_COMMIT = commit;

  run("npm", ["--prefix", "frontend", "run", "desktop:build"]);
  run(path.join(frontend, "node_modules", ".bin", "electron-builder"), [
    "--config",
    "desktop/electron-builder.yml",
    "--config.mac.notarize=true",
    `--config.extraMetadata.version=${version}`,
    `--config.extraMetadata.localStudioCommit=${commit}`,
  ], { cwd: frontend });
  const dmg = path.join(output, `Local Studio-${version}-arm64.dmg`);
  run("xcrun", [
    "notarytool",
    "submit",
    dmg,
    ...notarytoolCredentials(),
    "--wait",
    "--output-format",
    "json",
  ]);
  run("xcrun", ["stapler", "staple", dmg]);
  run("xcrun", ["stapler", "validate", dmg]);
  run("codesign", ["--verify", "--verbose=4", dmg]);
  run("spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=4",
    dmg,
  ]);
  run("node", [
    "scripts/stage-desktop-release.mjs",
    "--version",
    version,
    "--commit",
    commit,
  ]);

  console.log(`Built notarized Local Studio ${version} from ${commit}`);
}

buildDesktopRelease();
