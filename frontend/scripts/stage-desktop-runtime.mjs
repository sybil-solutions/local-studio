import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import executableIdentity from "../../services/agent-runtime/src/executable-identity.cjs";

const {
  AUDITED_NODE_IDENTITIES,
  AUDITED_NODE_EXECUTABLE_SHA256,
  AUDITED_WINDOWS_HELPER_BUILD,
  AUDITED_WINDOWS_HELPER_IDENTITY,
  signingStableExecutableIdentity,
} = executableIdentity;

const NODE_VERSION = "24.18.0";
const EXECUTABLE_MODE = 0o555;
const DATA_MODE = 0o444;
const PRIVATE_DIRECTORY_MODE = 0o700;
const EXECUTABLE_ACCESS = "read-execute";
const DATA_ACCESS = "read-only";
const STAGING_PREFIX = ".local-studio-runtime-stage-";
const BACKUP_PREFIX = ".local-studio-runtime-backup-";
const ARCHITECTURES = new Map([
  [1, "x64"],
  [3, "arm64"],
]);
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(frontendRoot, "..");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function architectureName(arch) {
  const name = typeof arch === "number" ? ARCHITECTURES.get(arch) : arch;
  if (name !== "arm64" && name !== "x64") throw new Error("Unsupported desktop runtime target");
  return name;
}

export function desktopRuntimeTarget(platform, arch) {
  const targetPlatform = platform === "mas" ? "darwin" : platform;
  if (targetPlatform !== "darwin" && targetPlatform !== "linux" && targetPlatform !== "win32") {
    throw new Error("Unsupported desktop runtime target");
  }
  const targetArch = architectureName(arch);
  const key = `${targetPlatform}-${targetArch}`;
  if (key === "win32-arm64") throw new Error("Unsupported desktop runtime target");
  return { platform: targetPlatform, arch: targetArch, key };
}

async function sourceFile(entry) {
  const stat = await lstat(entry);
  if (stat.isSymbolicLink() || !stat.isFile() || (await realpath(entry)) !== path.resolve(entry)) {
    throw new Error("Desktop runtime source is invalid");
  }
  return readFile(entry);
}

async function runtimeSources(root) {
  return JSON.parse(await readFile(path.join(root, "desktop", "runtime-sources.json"), "utf8"));
}

async function lockedPackage(root, packageName) {
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  return lock.packages?.[`node_modules/${packageName}`];
}

function rawIdentity(bytes) {
  return { algorithm: "sha256-v1", digest: digest(bytes) };
}

function closureEntry(entryPath, role, identity, mode) {
  return { path: entryPath, role, identity, mode };
}

function exactObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function accessMode(access, platform) {
  if (platform === "win32") return 0o444;
  return access === EXECUTABLE_ACCESS ? EXECUTABLE_MODE : DATA_MODE;
}

function accessMatches(stat, access, platform) {
  return platform === "win32"
    ? (stat.mode & 0o222) === 0
    : (stat.mode & 0o777) === accessMode(access, platform);
}

async function assertClosure(output, manifest) {
  const canonicalOutput = await realpath(output);
  const expected = new Set([
    "runtime-manifest.json",
    ...manifest.closure.map((entry) => entry.path),
  ]);
  const names = await readdir(output);
  if (names.length !== expected.size || names.some((name) => !expected.has(name))) {
    throw new Error("Desktop runtime closure is invalid");
  }
  for (const entry of manifest.closure) {
    const absolute = path.join(output, entry.path);
    const stat = await lstat(absolute);
    const bytes = await readFile(absolute);
    let identity;
    try {
      identity =
        entry.mode === EXECUTABLE_ACCESS
          ? signingStableExecutableIdentity(bytes, manifest.target.platform)
          : rawIdentity(bytes);
    } catch {
      throw new Error("Desktop runtime closure is invalid");
    }
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      !accessMatches(stat, entry.mode, manifest.target.platform) ||
      !exactObject(identity, entry.identity) ||
      (await realpath(absolute)) !== path.join(canonicalOutput, entry.path)
    ) {
      throw new Error("Desktop runtime closure is invalid");
    }
  }
  const manifestPath = path.join(output, "runtime-manifest.json");
  const stat = await lstat(manifestPath);
  const stored = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    !accessMatches(stat, DATA_ACCESS, manifest.target.platform) ||
    JSON.stringify(stored) !== JSON.stringify(manifest)
  ) {
    throw new Error("Desktop runtime manifest is invalid");
  }
}

function runtimeOutput(root, target, configured) {
  if (configured) return path.resolve(configured);
  const platform =
    target.platform === "darwin" ? "mac" : target.platform === "win32" ? "win" : "linux";
  return path.join(root, ".desktop-runtime", `${platform}-${target.arch}`);
}

function stagingPathFailure() {
  return new Error("Desktop runtime staging path is unsafe");
}

function missing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function ownedBy(stat, ownerId) {
  return ownerId === undefined || stat.uid === ownerId;
}

function safeDirectoryMode(stat, ownerId) {
  return ownerId === undefined || (stat.mode & 0o022) === 0;
}

function privateDirectoryMode(stat, ownerId) {
  return ownerId === undefined || (stat.mode & 0o777) === PRIVATE_DIRECTORY_MODE;
}

async function existingEntry(entry) {
  try {
    return await lstat(entry);
  } catch (error) {
    if (missing(error)) return null;
    throw stagingPathFailure();
  }
}

async function verifiedDirectory(entry, ownerId, privateMode = false) {
  const absolute = path.resolve(entry);
  const stat = await existingEntry(absolute);
  let canonical;
  try {
    canonical = stat && (await realpath(absolute));
  } catch {
    throw stagingPathFailure();
  }
  if (
    !stat?.isDirectory() ||
    stat.isSymbolicLink() ||
    !ownedBy(stat, ownerId) ||
    !safeDirectoryMode(stat, ownerId) ||
    (privateMode && !privateDirectoryMode(stat, ownerId)) ||
    canonical !== absolute
  ) {
    throw stagingPathFailure();
  }
  return absolute;
}

async function createDefaultStagingRoot(frontend, ownerId) {
  const stagingRoot = path.join(frontend, ".desktop-runtime");
  if (!(await existingEntry(stagingRoot))) {
    await verifiedDirectory(frontend, ownerId);
    try {
      await mkdir(stagingRoot, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (error) {
      if (
        !missing(error) &&
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw stagingPathFailure();
      }
    }
  }
  return verifiedDirectory(stagingRoot, ownerId, true);
}

async function stagingBoundary(frontend, output, configured, ownerId) {
  const canonicalFrontend = await verifiedDirectory(frontend, ownerId);
  const stagingRoot = configured
    ? await verifiedDirectory(path.dirname(output), ownerId)
    : await createDefaultStagingRoot(canonicalFrontend, ownerId);
  if (
    path.dirname(output) !== stagingRoot ||
    (configured === undefined && !contained(canonicalFrontend, output))
  ) {
    throw stagingPathFailure();
  }
  return {
    frontend: canonicalFrontend,
    output,
    privateRoot: configured === undefined,
    stagingRoot,
  };
}

async function verifyBoundary(boundary, ownerId) {
  await verifiedDirectory(boundary.frontend, ownerId);
  await verifiedDirectory(boundary.stagingRoot, ownerId, boundary.privateRoot);
  if (
    path.dirname(boundary.output) !== boundary.stagingRoot ||
    (boundary.privateRoot && !contained(boundary.frontend, boundary.output))
  ) {
    throw stagingPathFailure();
  }
}

async function verifiedTarget(boundary, ownerId) {
  await verifyBoundary(boundary, ownerId);
  const stat = await existingEntry(boundary.output);
  if (!stat) return false;
  await verifiedDirectory(boundary.output, ownerId, true);
  return true;
}

function privateSibling(boundary, entry, prefix) {
  return path.dirname(entry) === boundary.stagingRoot && path.basename(entry).startsWith(prefix);
}

async function createPrivateSibling(boundary, prefix, ownerId) {
  await verifyBoundary(boundary, ownerId);
  let entry;
  try {
    entry = await mkdtemp(path.join(boundary.stagingRoot, prefix));
    await chmod(entry, PRIVATE_DIRECTORY_MODE);
  } catch {
    throw stagingPathFailure();
  }
  if (!privateSibling(boundary, entry, prefix)) throw stagingPathFailure();
  await verifiedDirectory(entry, ownerId, true);
  return entry;
}

async function removePrivateTree(boundary, entry, prefix, ownerId) {
  await verifyBoundary(boundary, ownerId);
  if (!privateSibling(boundary, entry, prefix)) throw stagingPathFailure();
  await verifiedDirectory(entry, ownerId, true);
  for (const name of await readdir(entry)) {
    const child = path.join(entry, name);
    const stat = await existingEntry(child);
    if (!stat || !ownedBy(stat, ownerId) || (!stat.isFile() && !stat.isSymbolicLink())) {
      throw stagingPathFailure();
    }
    try {
      await unlink(child);
    } catch {
      throw stagingPathFailure();
    }
  }
  await rmdir(entry);
}

async function removePrivateTreeIfPresent(boundary, entry, prefix, ownerId) {
  if (!(await existingEntry(entry))) return;
  await removePrivateTree(boundary, entry, prefix, ownerId);
}

function executableName(target) {
  return target.platform === "win32" ? "node.exe" : "node";
}

async function assertPackageIdentity(root, packageRoot, source, target) {
  const metadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const locked = await lockedPackage(root, source.package?.name);
  if (
    metadata.name !== source.package?.name ||
    metadata.version !== NODE_VERSION ||
    metadata.license !== "MIT" ||
    metadata.os !== target.platform ||
    metadata.cpu !== target.arch ||
    metadata.bin?.node !== `bin/${executableName(target)}` ||
    locked?.version !== NODE_VERSION ||
    locked?.resolved !== source.package?.resolved ||
    locked?.integrity !== source.package?.integrity
  ) {
    throw new Error("Desktop Node runtime package identity is invalid");
  }
}

async function verifiedNodeSource(root, target) {
  const sources = await runtimeSources(root);
  const source = sources.targets?.[target.key];
  if (
    sources.format !== "local-studio-runtime-sources-v2" ||
    sources.nodeVersion !== NODE_VERSION ||
    !source
  ) {
    throw new Error("Desktop runtime source identity is invalid");
  }
  const packageRoot = path.join(root, "node_modules", source.package?.name ?? "");
  await assertPackageIdentity(root, packageRoot, source, target);
  const executable = executableName(target);
  const [runtimeBytes, licenseBytes] = await Promise.all([
    sourceFile(path.join(packageRoot, "bin", executable)),
    sourceFile(path.join(packageRoot, "LICENSE")),
  ]);
  if (
    digest(runtimeBytes) !== source.upstream?.executableSha256 ||
    source.upstream?.executableSha256 !== AUDITED_NODE_EXECUTABLE_SHA256[target.key] ||
    digest(licenseBytes) !== sources.license?.sha256
  ) {
    throw new Error("Desktop Node runtime upstream identity is invalid");
  }
  let codeIdentity;
  try {
    codeIdentity = signingStableExecutableIdentity(runtimeBytes, target.platform);
  } catch {
    throw new Error("Desktop Node runtime upstream identity is invalid");
  }
  if (
    !exactObject(source.upstream?.codeIdentity, AUDITED_NODE_IDENTITIES[target.key]) ||
    !exactObject(codeIdentity, AUDITED_NODE_IDENTITIES[target.key])
  ) {
    throw new Error("Desktop Node runtime upstream identity is invalid");
  }
  return { sources, source, executable, runtimeBytes, licenseBytes, codeIdentity };
}

async function stageNodeClosure(output, target, node) {
  const closure = [
    closureEntry(node.executable, "node-executable", node.codeIdentity, EXECUTABLE_ACCESS),
    closureEntry("LICENSE.node", "node-license", rawIdentity(node.licenseBytes), DATA_ACCESS),
  ];
  await Promise.all([
    writeFile(path.join(output, node.executable), node.runtimeBytes, {
      flag: "wx",
      mode: accessMode(EXECUTABLE_ACCESS, target.platform),
    }),
    writeFile(path.join(output, "LICENSE.node"), node.licenseBytes, {
      flag: "wx",
      mode: accessMode(DATA_ACCESS, target.platform),
    }),
  ]);
  return closure;
}

async function stagedWindowsHelper(repository, output, target) {
  if (target.platform !== "win32") return null;
  const nativeRoot = path.join(repository, "services", "agent-runtime", "native");
  const identity = JSON.parse(
    await readFile(path.join(nativeRoot, "windows-runtime-helper.json"), "utf8"),
  );
  const [bytes, source] = await Promise.all([
    sourceFile(path.join(nativeRoot, "windows-runtime-helper.exe")),
    sourceFile(path.join(nativeRoot, "windows-runtime-helper.c")),
  ]);
  if (
    !exactObject(identity, AUDITED_WINDOWS_HELPER_BUILD) ||
    identity.binarySha256 !== digest(bytes) ||
    identity.sourceSha256 !== digest(source) ||
    !exactObject(identity.codeIdentity, AUDITED_WINDOWS_HELPER_IDENTITY) ||
    !exactObject(signingStableExecutableIdentity(bytes, "win32"), identity.codeIdentity)
  ) {
    throw new Error("Windows runtime helper identity mismatch");
  }
  const name = "windows-runtime-helper.exe";
  await writeFile(path.join(output, name), bytes, {
    flag: "wx",
    mode: accessMode(EXECUTABLE_ACCESS, target.platform),
  });
  return {
    entry: closureEntry(name, "windows-process-helper", identity.codeIdentity, EXECUTABLE_ACCESS),
    identity: { ...identity, executable: name },
  };
}

function runtimeManifest(target, node, closure, windowsHelper) {
  const body = {
    format: "local-studio-desktop-runtime-v2",
    target,
    node: {
      version: NODE_VERSION,
      executable: node.executable,
      license: "LICENSE.node",
      package: node.source.package,
      upstream: node.source.upstream,
    },
    closure,
    ...(windowsHelper ? { windowsHelper: windowsHelper.identity } : {}),
  };
  return {
    ...body,
    digest: `sha256:${digest(Buffer.from(JSON.stringify(body)))}`,
  };
}

async function writeRuntimeManifest(output, manifest) {
  const manifestPath = path.join(output, "runtime-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, {
    flag: "wx",
    mode: accessMode(DATA_ACCESS, manifest.target.platform),
  });
  await Promise.all([
    ...manifest.closure.map((entry) =>
      chmod(path.join(output, entry.path), accessMode(entry.mode, manifest.target.platform)),
    ),
    chmod(manifestPath, accessMode(DATA_ACCESS, manifest.target.platform)),
  ]);
}

async function removeBackupHolder(boundary, holder, ownerId) {
  await verifyBoundary(boundary, ownerId);
  if (!privateSibling(boundary, holder, BACKUP_PREFIX)) throw stagingPathFailure();
  await verifiedDirectory(holder, ownerId, true);
  if ((await readdir(holder)).length !== 0) throw stagingPathFailure();
  await rmdir(holder);
}

async function restorePreviousTarget(boundary, holder, previous, renameEntry, ownerId) {
  await verifyBoundary(boundary, ownerId);
  await verifiedDirectory(holder, ownerId, true);
  await verifiedDirectory(previous, ownerId, true);
  if (await existingEntry(boundary.output)) {
    const interrupted = path.join(holder, "interrupted");
    if (await existingEntry(interrupted)) throw stagingPathFailure();
    await renameEntry(boundary.output, interrupted);
  }
  await renameEntry(previous, boundary.output);
  await verifiedDirectory(boundary.output, ownerId, true);
  if ((await readdir(holder)).length === 0) await removeBackupHolder(boundary, holder, ownerId);
}

async function replaceExistingTarget(boundary, staged, renameEntry, ownerId, verifyOutput) {
  const holder = await createPrivateSibling(boundary, BACKUP_PREFIX, ownerId);
  const previous = path.join(holder, "previous");
  try {
    await verifyBoundary(boundary, ownerId);
    await verifiedDirectory(boundary.output, ownerId, true);
    await renameEntry(boundary.output, previous);
  } catch (error) {
    await removeBackupHolder(boundary, holder, ownerId).catch(() => undefined);
    throw error;
  }
  await verifiedDirectory(previous, ownerId, true);
  try {
    await verifyBoundary(boundary, ownerId);
    if (await existingEntry(boundary.output)) throw stagingPathFailure();
    await renameEntry(staged, boundary.output);
    await verifiedDirectory(boundary.output, ownerId, true);
    await verifyOutput();
  } catch (error) {
    await restorePreviousTarget(boundary, holder, previous, renameEntry, ownerId);
    throw error;
  }
  await removePrivateTree(
    { ...boundary, output: previous, stagingRoot: holder },
    previous,
    "previous",
    ownerId,
  );
  await removeBackupHolder(boundary, holder, ownerId);
}

async function promoteStagedRuntime(boundary, staged, renameEntry, ownerId, verifyOutput) {
  const targetExists = await verifiedTarget(boundary, ownerId);
  if (targetExists) {
    await replaceExistingTarget(boundary, staged, renameEntry, ownerId, verifyOutput);
  } else {
    await verifyBoundary(boundary, ownerId);
    await renameEntry(staged, boundary.output);
    await verifiedDirectory(boundary.output, ownerId, true);
    await verifyOutput();
  }
}

export async function stageDesktopRuntime(context, dependencies = {}) {
  const root = dependencies.frontendRoot ?? frontendRoot;
  const repository = dependencies.repositoryRoot ?? repositoryRoot;
  const target = desktopRuntimeTarget(context.electronPlatformName, context.arch);
  const output = runtimeOutput(root, target, dependencies.output);
  const ownerId = "ownerId" in dependencies ? dependencies.ownerId : process.getuid?.();
  const boundary = await stagingBoundary(root, output, dependencies.output, ownerId);
  await verifiedTarget(boundary, ownerId);
  const node = await verifiedNodeSource(root, target);
  const staged = await createPrivateSibling(boundary, STAGING_PREFIX, ownerId);
  let promoted = false;
  try {
    const closure = await stageNodeClosure(staged, target, node);
    const windowsHelper = await stagedWindowsHelper(repository, staged, target);
    if (windowsHelper) closure.push(windowsHelper.entry);
    const manifest = runtimeManifest(target, node, closure, windowsHelper);
    await writeRuntimeManifest(staged, manifest);
    await verifiedDirectory(staged, ownerId, true);
    await assertClosure(staged, manifest);
    await promoteStagedRuntime(boundary, staged, dependencies.rename ?? rename, ownerId, () =>
      assertClosure(output, manifest),
    );
    promoted = true;
    return manifest;
  } finally {
    if (!promoted) {
      await removePrivateTreeIfPresent(boundary, staged, STAGING_PREFIX, ownerId);
    }
  }
}

export function releaseSigningExpected(context, environment = process.env) {
  const config = context.packager.config ?? {};
  const notarize = context.packager.platformSpecificBuildOptions?.notarize;
  return (
    config.forceCodeSigning === true ||
    Boolean(notarize) ||
    ["1", "true"].includes(
      String(environment.LOCAL_STUDIO_REQUIRE_DESKTOP_SIGNING ?? "").toLowerCase(),
    ) ||
    ["APPLE_KEYCHAIN_PROFILE", "CSC_LINK", "CSC_NAME"].some((key) => environment[key])
  );
}

export function configureLocalMacSigning(
  context,
  environment = process.env,
  hostPlatform = process.platform,
) {
  if (
    hostPlatform !== "darwin" ||
    !["darwin", "mas"].includes(context.electronPlatformName) ||
    releaseSigningExpected(context, environment)
  ) {
    return false;
  }
  const options = context.packager.platformSpecificBuildOptions;
  if (!options || typeof options !== "object") {
    throw new Error("Desktop signing configuration is invalid");
  }
  options.identity = "-";
  return true;
}

export default async function beforePack(context, dependencies = {}) {
  configureLocalMacSigning(context, dependencies.environment, dependencies.hostPlatform);
  await (dependencies.stage ?? stageDesktopRuntime)(context);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stageDesktopRuntime({
    electronPlatformName: process.env.npm_config_platform ?? process.platform,
    arch: process.env.npm_config_arch ?? process.arch,
  });
}
