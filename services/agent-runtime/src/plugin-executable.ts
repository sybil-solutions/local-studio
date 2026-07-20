import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { Effect } from "effect";
import type { ConnectorConfig, ConnectorExecutableBinding } from "./connector-contract";
import {
  pluginArtifactContentDigest,
  pluginArtifactDigest,
  pluginExecutableFileIdentity,
  type PluginExecutableFileIdentity,
} from "./plugin-artifact-digest";
import {
  createWindowsSnapshotSecurity,
  type WindowsSnapshotEntryAccess,
  type WindowsSnapshotEntryKind,
  type WindowsSnapshotSecurity,
} from "./windows-runtime-helper";
import { trustedRuntimeIdentity } from "./runtime-identity";
import executableIdentity from "./executable-identity.cjs";

const { signingStableExecutableIdentity } = executableIdentity;

type PluginExecutableInput = {
  command: string;
  args: readonly string[];
  env?: Record<string, string>;
  cwd: string;
  artifactRoot: string;
  artifactDigest: string;
};

export type PluginExecutableDependencies = {
  copyArtifact?: (source: string, target: string) => Promise<void>;
  platform?: NodeJS.Platform;
  trustedRuntime?: string;
  windowsSecurity?: WindowsSnapshotSecurity;
};

type InspectedFile = PluginExecutableFileIdentity & {
  index: number;
  source: string;
  prefix: string;
};

type ExecutableInspection = {
  input: PluginExecutableInput;
  sourceRoot: string;
  sourceCwd: string;
  artifactContentDigest: string;
  command: PluginExecutableFileIdentity;
  runtimeDigest: string;
  runtimeExecutableDigest?: string;
  files: InspectedFile[];
  bootstrapSource: string;
  bootstrapDigest: string;
  digest: string;
};

type SnapshotState = {
  root: string;
  artifactRoot: string;
  cwd: string;
  command: PluginExecutableFileIdentity;
  files: ConnectorExecutableBinding["files"];
  digest: string;
};

export type ResolvedPluginExecutable = {
  command: string;
  args: string[];
  cwd: string;
  binding: ConnectorExecutableBinding;
};

const NODE_INTERPRETERS = new Set(["bun", "node", "nodejs"]);
const CONNECTOR_DATA_KEY =
  /^(?:[A-Z][A-Z0-9]*_)*(?:TOKEN|API_KEY|ACCESS_KEY_ID|SECRET|SECRET_KEY|PASSWORD|CREDENTIAL|CREDENTIALS|URL|URI|ENDPOINT|HOST|PORT|USER|USERNAME|ACCOUNT_ID|PROJECT_ID|TENANT_ID|CLIENT_ID|ORG_ID|WORKSPACE_ID|REGION)$/;
const MAX_CONNECTOR_DATA_BYTES = 64 * 1024;
const MAX_CONNECTOR_DATA_KEYS = 128;
const SNAPSHOT_DIRECTORY_MODE = 0o500;
const SNAPSHOT_FILE_MODE = 0o400;
const PRIVATE_DIRECTORY_MODE = 0o700;
let snapshotAccess = Promise.resolve();

export class PluginExecutableError extends Error {}

function executableFailure(): PluginExecutableError {
  return new PluginExecutableError("Plugin executable payload cannot be pinned");
}

function changedFailure(): PluginExecutableError {
  return new PluginExecutableError("Plugin executable identity changed");
}

function withSnapshotAccess<A>(operation: () => Promise<A>): Promise<A> {
  const result = snapshotAccess.then(operation);
  snapshotAccess = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function normalizedCommandName(command: string): string {
  return path
    .basename(command)
    .toLowerCase()
    .replace(/\.exe$/, "");
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function connectorDataKeys(environment: Record<string, string> | undefined): string[] {
  const keys = Object.keys(environment ?? {}).sort();
  if (
    keys.length > MAX_CONNECTOR_DATA_KEYS ||
    keys.some((key) => !CONNECTOR_DATA_KEY.test(key)) ||
    Buffer.byteLength(JSON.stringify(environment ?? {})) > MAX_CONNECTOR_DATA_BYTES
  ) {
    throw executableFailure();
  }
  return keys;
}

function trustedRuntimePath(dependencies: PluginExecutableDependencies): string {
  const configured =
    dependencies.trustedRuntime ??
    process.env.LOCAL_STUDIO_NODE_RUNTIME?.trim() ??
    process.execPath;
  if (!path.isAbsolute(configured)) throw executableFailure();
  return path.resolve(configured);
}

function commandCandidates(input: PluginExecutableInput, trustedRuntime: string): string[] {
  if (path.isAbsolute(input.command) || /[\\/]/.test(input.command)) {
    return [path.resolve(input.cwd, input.command)];
  }
  return [trustedRuntime];
}

async function existingIdentity(candidate: string): Promise<PluginExecutableFileIdentity | null> {
  try {
    await lstat(candidate);
  } catch {
    return null;
  }
  return Effect.runPromise(pluginExecutableFileIdentity(candidate));
}

async function resolvedCommandIdentity(
  input: PluginExecutableInput,
  trustedRuntime: string,
  platform: NodeJS.Platform,
): Promise<PluginExecutableFileIdentity> {
  for (const candidate of commandCandidates(input, trustedRuntime)) {
    const identity = await existingIdentity(candidate);
    if (!identity) continue;
    if (platform === "win32" || (identity.mode & 0o111) !== 0) return identity;
  }
  throw executableFailure();
}

function executableDigest(identity: { algorithm: string; digest: string }): string {
  return `${identity.algorithm}:${identity.digest}`;
}

async function snapshotCommandIdentity(
  commandPath: string,
  platform: NodeJS.Platform,
  normalized: boolean,
): Promise<PluginExecutableFileIdentity> {
  const identity = await Effect.runPromise(pluginExecutableFileIdentity(commandPath));
  if (!normalized) return identity;
  return {
    ...identity,
    digest: executableDigest(
      signingStableExecutableIdentity(await readFile(commandPath), platform),
    ),
  };
}

function nodeMainArgument(command: string, args: readonly string[]): number {
  if (!NODE_INTERPRETERS.has(normalizedCommandName(command))) throw executableFailure();
  if (args.length !== 1 || !args[0] || args[0].startsWith("-")) throw executableFailure();
  return 0;
}

async function assertNativeCommand(command: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === "win32" && /\.(?:bat|cmd)$/i.test(command)) {
    throw executableFailure();
  }
  const handle = await open(command, "r");
  try {
    const bytes = Buffer.alloc(2);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead === 2 && bytes[0] === 0x23 && bytes[1] === 0x21) {
      throw executableFailure();
    }
  } finally {
    await handle.close();
  }
}

function bootstrapSource(main: string, environmentKeys: string[]): string {
  const segments = path.relative("/", `/${main}`).split(path.sep).filter(Boolean);
  return [
    'import path from "node:path";',
    'import { fileURLToPath, pathToFileURL } from "node:url";',
    `const environmentKeys = ${JSON.stringify(environmentKeys)};`,
    `const mainSegments = ${JSON.stringify(segments)};`,
    'let buffer = "";',
    'process.stdin.setEncoding("utf8");',
    "process.stdin.pause();",
    "const environment = await new Promise((resolve, reject) => {",
    "  const receive = (chunk) => {",
    "    buffer += chunk;",
    `    if (Buffer.byteLength(buffer) > ${MAX_CONNECTOR_DATA_BYTES}) {`,
    '      reject(new Error("Invalid connector startup data"));',
    "      return;",
    "    }",
    '    const newline = buffer.indexOf("\\n");',
    "    if (newline === -1) return;",
    '    process.stdin.off("data", receive);',
    "    if (buffer.slice(newline + 1).length > 0) {",
    '      reject(new Error("Invalid connector startup data"));',
    "      return;",
    "    }",
    "    try {",
    "      const payload = JSON.parse(buffer.slice(0, newline));",
    '      if (payload.localStudioBootstrap !== "v1") throw new Error();',
    "      resolve(payload.environment);",
    "    } catch {",
    '      reject(new Error("Invalid connector startup data"));',
    "    }",
    "  };",
    '  process.stdin.on("data", receive);',
    "  process.stdin.resume();",
    "});",
    'if (!environment || typeof environment !== "object" || Array.isArray(environment)) {',
    '  throw new Error("Invalid connector startup data");',
    "}",
    "const receivedKeys = Object.keys(environment).sort();",
    "if (receivedKeys.length !== environmentKeys.length || receivedKeys.some((key, index) => key !== environmentKeys[index])) {",
    '  throw new Error("Invalid connector startup data");',
    "}",
    "for (const key of environmentKeys) {",
    "  const value = Reflect.get(environment, key);",
    '  if (typeof value !== "string") throw new Error("Invalid connector startup data");',
    "  process.env[key] = value;",
    "}",
    'const artifactRoot = fileURLToPath(new URL("../artifact/", import.meta.url));',
    "const mainPath = path.join(artifactRoot, ...mainSegments);",
    "process.argv = [process.execPath, mainPath, ...process.argv.slice(2)];",
    "process.stdin.pause();",
    "await import(pathToFileURL(mainPath).href);",
    'process.stdout.write("{\\"localStudioBootstrap\\":\\"ready\\"}\\n");',
    "process.stdin.resume();",
    "",
  ].join("\n");
}

function sourceDigest(source: string): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function payloadDigest(
  artifactDigest: string,
  sourceRoot: string,
  command: PluginExecutableFileIdentity,
  runtimeDigest: string,
  files: InspectedFile[],
  bootstrapDigest: string,
): string {
  const commandLocation = contained(sourceRoot, command.path)
    ? `artifact:${path.relative(sourceRoot, command.path)}`
    : `external:${path.extname(command.path).toLowerCase()}`;
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        format: "local-studio-executable-v1",
        artifactDigest,
        command: { location: commandLocation, digest: command.digest, mode: command.mode },
        runtimeDigest,
        bootstrapDigest,
        files: files.map((file) => ({
          index: file.index,
          path: path.relative(sourceRoot, file.path),
          digest: file.digest,
          mode: file.mode,
        })),
      }),
    )
    .digest("hex")}`;
}

async function inspectExecutable(
  input: PluginExecutableInput,
  dependencies: PluginExecutableDependencies,
): Promise<ExecutableInspection> {
  const platform = dependencies.platform ?? process.platform;
  const trustedRuntime = trustedRuntimePath(dependencies);
  const environmentKeys = connectorDataKeys(input.env);
  const mainIndex = nodeMainArgument(input.command, input.args);
  const sourceRoot = await realpath(input.artifactRoot);
  const sourceCwd = await realpath(input.cwd);
  if (!contained(sourceRoot, sourceCwd) || contained(sourceRoot, path.resolve(snapshotBase()))) {
    throw executableFailure();
  }
  if ((await Effect.runPromise(pluginArtifactDigest(sourceRoot))) !== input.artifactDigest) {
    throw executableFailure();
  }
  const artifactContentDigest = await Effect.runPromise(pluginArtifactContentDigest(sourceRoot));
  const resolvedCommand = await resolvedCommandIdentity(
    { ...input, cwd: sourceCwd },
    trustedRuntime,
    platform,
  );
  await assertNativeCommand(resolvedCommand.path, platform);
  const trustedRuntimeFile = await Effect.runPromise(pluginExecutableFileIdentity(trustedRuntime));
  if (resolvedCommand.digest !== trustedRuntimeFile.digest) throw executableFailure();
  const runtimeIdentity = await trustedRuntimeIdentity(trustedRuntime, platform, process.arch);
  const command = runtimeIdentity
    ? { ...resolvedCommand, digest: executableDigest(runtimeIdentity.executableIdentity) }
    : resolvedCommand;
  const runtimeDigest = runtimeIdentity?.digest ?? trustedRuntimeFile.digest;
  const source = input.args[mainIndex] ?? "";
  const identity = await existingIdentity(path.resolve(sourceCwd, source));
  if (!identity || !contained(sourceRoot, identity.path)) throw executableFailure();
  const files: InspectedFile[] = [{ ...identity, index: mainIndex, source, prefix: "" }];
  const bootstrap = bootstrapSource(path.relative(sourceRoot, identity.path), environmentKeys);
  const bootstrapDigest = sourceDigest(bootstrap);
  if (
    (await Effect.runPromise(pluginArtifactDigest(sourceRoot))) !== input.artifactDigest ||
    (await Effect.runPromise(pluginArtifactContentDigest(sourceRoot))) !== artifactContentDigest
  ) {
    throw executableFailure();
  }
  return {
    input,
    sourceRoot,
    sourceCwd,
    artifactContentDigest,
    command,
    runtimeDigest,
    ...(runtimeIdentity ? { runtimeExecutableDigest: command.digest } : {}),
    files,
    bootstrapSource: bootstrap,
    bootstrapDigest,
    digest: payloadDigest(
      input.artifactDigest,
      sourceRoot,
      command,
      runtimeDigest,
      files,
      bootstrapDigest,
    ),
  };
}

function snapshotBase(): string {
  return path.join(configuredDataDir(), "runtime", "plugin-executables");
}

function configuredDataDir(): string {
  const configured = process.env.LOCAL_STUDIO_DATA_DIR?.trim();
  return path.resolve(configured || path.join(homedir(), ".local-studio"));
}

function snapshotDirectory(inspection: ExecutableInspection, base = snapshotBase()): string {
  return path.join(base, inspection.digest.slice("sha256:".length));
}

function snapshotArtifactPath(root: string, inspection: ExecutableInspection): string {
  return path.join(root, "artifact");
}

function mappedSnapshotPath(
  snapshotArtifactRoot: string,
  inspection: ExecutableInspection,
  source: string,
): string {
  if (!contained(inspection.sourceRoot, source)) throw executableFailure();
  return path.join(snapshotArtifactRoot, path.relative(inspection.sourceRoot, source));
}

function externalCommandName(command: string): string {
  const extension = path.extname(command);
  return `command${/^[.][a-z0-9]{1,8}$/i.test(extension) ? extension : ""}`;
}

function snapshotCommandPath(
  root: string,
  artifactRoot: string,
  inspection: ExecutableInspection,
): string {
  return contained(inspection.sourceRoot, inspection.command.path)
    ? mappedSnapshotPath(artifactRoot, inspection, inspection.command.path)
    : path.join(root, "runtime", externalCommandName(inspection.command.path));
}

function bootstrapPath(root: string): string {
  return path.join(root, "runtime", "bootstrap.mjs");
}

type PrivateDirectory = { path: string; stat: BigIntStats };

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function ownerMatches(stat: BigIntStats): boolean {
  const uid = process.geteuid?.();
  return uid === undefined || stat.uid === BigInt(uid);
}

function exactMode(stat: BigIntStats, mode: number, platform: NodeJS.Platform): boolean {
  return platform === "win32" || Number(stat.mode & BigInt(0o777)) === mode;
}

function windowsSecurity(
  dependencies: PluginExecutableDependencies,
): WindowsSnapshotSecurity | null {
  if ((dependencies.platform ?? process.platform) !== "win32") return null;
  return dependencies.windowsSecurity ?? createWindowsSnapshotSecurity();
}

async function protectWindowsEntry(
  entry: string,
  kind: WindowsSnapshotEntryKind,
  access: WindowsSnapshotEntryAccess,
  dependencies: PluginExecutableDependencies,
): Promise<void> {
  const security = windowsSecurity(dependencies);
  if (!security) return;
  await security.protect(entry, kind, access);
  await security.verify(entry, kind, access);
}

async function verifyWindowsEntry(
  entry: string,
  kind: WindowsSnapshotEntryKind,
  access: WindowsSnapshotEntryAccess,
  dependencies: PluginExecutableDependencies,
): Promise<void> {
  await windowsSecurity(dependencies)?.verify(entry, kind, access);
}

async function inspectedPath(entry: string): Promise<BigIntStats> {
  return lstat(entry, { bigint: true });
}

async function assertStablePath(entry: string, expected: BigIntStats): Promise<BigIntStats> {
  const current = await inspectedPath(entry);
  if (!sameNode(expected, current) || !ownerMatches(current)) throw executableFailure();
  return current;
}

async function privateDataRoot(
  dependencies: PluginExecutableDependencies,
): Promise<PrivateDirectory> {
  const requested = configuredDataDir();
  let created = false;
  try {
    created =
      (await mkdir(requested, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })) !== undefined;
  } catch (error) {
    if (!(error instanceof Error) || Reflect.get(error, "code") !== "EEXIST") throw error;
  }
  const initial = await inspectedPath(requested);
  if (
    initial.isSymbolicLink() ||
    !initial.isDirectory() ||
    !ownerMatches(initial) ||
    !exactMode(initial, PRIVATE_DIRECTORY_MODE, dependencies.platform ?? process.platform)
  ) {
    throw executableFailure();
  }
  if (created) await protectWindowsEntry(requested, "directory", "private", dependencies);
  else await verifyWindowsEntry(requested, "directory", "private", dependencies);
  const canonical = await realpath(requested);
  const current = await inspectedPath(canonical);
  if (!sameNode(initial, current)) throw executableFailure();
  return { path: canonical, stat: current };
}

async function privateChild(
  parent: PrivateDirectory,
  name: string,
  dependencies: PluginExecutableDependencies,
): Promise<PrivateDirectory> {
  await assertStablePath(parent.path, parent.stat);
  const entry = path.join(parent.path, name);
  let created = false;
  try {
    await mkdir(entry, { mode: PRIVATE_DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if (!(error instanceof Error) || Reflect.get(error, "code") !== "EEXIST") throw error;
  }
  const stat = await inspectedPath(entry);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    !ownerMatches(stat) ||
    !exactMode(stat, PRIVATE_DIRECTORY_MODE, dependencies.platform ?? process.platform) ||
    (await realpath(entry)) !== entry
  ) {
    throw executableFailure();
  }
  if (created) await protectWindowsEntry(entry, "directory", "private", dependencies);
  else await verifyWindowsEntry(entry, "directory", "private", dependencies);
  await assertStablePath(entry, stat);
  await assertStablePath(parent.path, parent.stat);
  return { path: entry, stat };
}

async function privateSnapshotBase(
  dependencies: PluginExecutableDependencies,
): Promise<PrivateDirectory> {
  const data = await privateDataRoot(dependencies);
  return privateChild(
    await privateChild(data, "runtime", dependencies),
    "plugin-executables",
    dependencies,
  );
}

async function protectTree(
  root: string,
  dependencies: PluginExecutableDependencies,
  entry = root,
): Promise<void> {
  const initial = await inspectedPath(entry);
  if (!ownerMatches(initial)) throw executableFailure();
  if (initial.isSymbolicLink()) {
    if ((dependencies.platform ?? process.platform) === "win32") throw executableFailure();
    if (!contained(root, await realpath(entry))) throw executableFailure();
    await assertStablePath(entry, initial);
    return;
  }
  if (!initial.isDirectory() && !initial.isFile()) throw executableFailure();
  const flags =
    constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (initial.isDirectory() ? (constants.O_DIRECTORY ?? 0) : 0);
  const handle = await open(entry, flags);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameNode(initial, opened)) throw executableFailure();
    if (initial.isDirectory()) {
      const names = await readdir(entry);
      for (const name of names) {
        await assertStablePath(entry, initial);
        await protectTree(root, dependencies, path.join(entry, name));
      }
    }
    await assertStablePath(entry, initial);
    const mode = initial.isDirectory()
      ? SNAPSHOT_DIRECTORY_MODE
      : Number(initial.mode & BigInt(0o111)) === 0
        ? SNAPSHOT_FILE_MODE
        : SNAPSHOT_DIRECTORY_MODE;
    await handle.chmod(mode);
    await protectWindowsEntry(
      entry,
      initial.isDirectory() ? "directory" : "file",
      "snapshot",
      dependencies,
    );
    const protectedStat = await handle.stat({ bigint: true });
    if (
      !ownerMatches(protectedStat) ||
      !exactMode(protectedStat, mode, dependencies.platform ?? process.platform)
    ) {
      throw executableFailure();
    }
  } finally {
    await handle.close();
  }
}

async function protectedTree(
  root: string,
  dependencies: PluginExecutableDependencies,
  entry = root,
): Promise<boolean> {
  const initial = await inspectedPath(entry);
  if (!ownerMatches(initial)) return false;
  if (initial.isSymbolicLink()) {
    if ((dependencies.platform ?? process.platform) === "win32") return false;
    const target = await realpath(entry);
    return contained(root, target) && sameNode(initial, await inspectedPath(entry));
  }
  if (!initial.isDirectory() && !initial.isFile()) return false;
  const expected = initial.isDirectory()
    ? SNAPSHOT_DIRECTORY_MODE
    : Number(initial.mode & BigInt(0o111)) === 0
      ? SNAPSHOT_FILE_MODE
      : SNAPSHOT_DIRECTORY_MODE;
  if (!exactMode(initial, expected, dependencies.platform ?? process.platform)) return false;
  await verifyWindowsEntry(
    entry,
    initial.isDirectory() ? "directory" : "file",
    "snapshot",
    dependencies,
  );
  if (initial.isDirectory()) {
    const before = await readdir(entry);
    for (const name of before) {
      if (!(await protectedTree(root, dependencies, path.join(entry, name)))) return false;
      if (!sameNode(initial, await inspectedPath(entry))) return false;
    }
    const after = await readdir(entry);
    if (
      before.length !== after.length ||
      [...before].sort().some((name, index) => name !== [...after].sort()[index])
    ) {
      return false;
    }
  }
  return sameNode(initial, await inspectedPath(entry));
}

async function makeWritable(entry: string): Promise<void> {
  const stat = await lstat(entry);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    await chmod(entry, 0o700);
    for (const name of await readdir(entry)) await makeWritable(path.join(entry, name));
    return;
  }
  if (stat.isFile()) await chmod(entry, 0o600);
}

async function removeSnapshot(entry: string): Promise<void> {
  await makeWritable(entry).catch(() => undefined);
  await rm(entry, { recursive: true, force: true });
}

async function copyArtifact(source: string, target: string): Promise<void> {
  await cp(source, target, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
}

async function copySnapshot(
  inspection: ExecutableInspection,
  target: string,
  dependencies: PluginExecutableDependencies,
): Promise<void> {
  const artifactRoot = snapshotArtifactPath(target, inspection);
  await (dependencies.copyArtifact ?? copyArtifact)(inspection.sourceRoot, artifactRoot);
  if (
    (await Effect.runPromise(pluginArtifactContentDigest(artifactRoot))) !==
    inspection.artifactContentDigest
  ) {
    throw executableFailure();
  }
  const runtime = path.join(target, "runtime");
  await mkdir(runtime, { mode: PRIVATE_DIRECTORY_MODE });
  await writeFile(bootstrapPath(target), inspection.bootstrapSource, {
    mode: 0o600,
    flag: "wx",
  });
  if (!contained(inspection.sourceRoot, inspection.command.path)) {
    await copyFile(inspection.command.path, snapshotCommandPath(target, artifactRoot, inspection));
  }
  await protectTree(target, dependencies);
}

async function existingSnapshotTarget(
  base: PrivateDirectory,
  target: string,
  dependencies: PluginExecutableDependencies,
): Promise<string | null> {
  let stat: BigIntStats;
  try {
    stat = await inspectedPath(target);
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return null;
    throw error;
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    !ownerMatches(stat) ||
    !exactMode(stat, SNAPSHOT_DIRECTORY_MODE, dependencies.platform ?? process.platform) ||
    (await realpath(target)) !== target ||
    !contained(base.path, target)
  ) {
    throw executableFailure();
  }
  await verifyWindowsEntry(target, "directory", "snapshot", dependencies);
  await assertStablePath(target, stat);
  await assertStablePath(base.path, base.stat);
  return target;
}

async function ensureSnapshotDirectory(
  inspection: ExecutableInspection,
  dependencies: PluginExecutableDependencies,
): Promise<string> {
  return withSnapshotAccess(async () => {
    const base = await privateSnapshotBase(dependencies);
    const target = snapshotDirectory(inspection, base.path);
    const existing = await existingSnapshotTarget(base, target, dependencies);
    if (existing) return existing;
    const pending = await mkdtemp(path.join(base.path, ".pending-"));
    const pendingInitial = await inspectedPath(pending);
    if (
      !pendingInitial.isDirectory() ||
      !ownerMatches(pendingInitial) ||
      !exactMode(
        pendingInitial,
        PRIVATE_DIRECTORY_MODE,
        dependencies.platform ?? process.platform,
      ) ||
      (await realpath(pending)) !== pending
    ) {
      throw executableFailure();
    }
    try {
      await protectWindowsEntry(pending, "directory", "private", dependencies);
      await copySnapshot(inspection, pending, dependencies);
      const pendingProtected = await inspectedPath(pending);
      if (
        pendingInitial.dev !== pendingProtected.dev ||
        pendingInitial.ino !== pendingProtected.ino ||
        !exactMode(
          pendingProtected,
          SNAPSHOT_DIRECTORY_MODE,
          dependencies.platform ?? process.platform,
        )
      ) {
        throw executableFailure();
      }
      await assertStablePath(base.path, base.stat);
      if (await existingSnapshotTarget(base, target, dependencies)) throw executableFailure();
      await rename(pending, target);
      const promoted = await inspectedPath(target);
      if (
        pendingProtected.dev !== promoted.dev ||
        pendingProtected.ino !== promoted.ino ||
        !ownerMatches(promoted) ||
        !exactMode(promoted, SNAPSHOT_DIRECTORY_MODE, dependencies.platform ?? process.platform) ||
        (await realpath(target)) !== target
      ) {
        throw executableFailure();
      }
      await assertStablePath(base.path, base.stat);
      await verifyWindowsEntry(target, "directory", "snapshot", dependencies);
      return target;
    } catch (copyError) {
      await removeSnapshot(pending).catch(() => undefined);
      const raced = await existingSnapshotTarget(base, target, dependencies).catch(() => null);
      if (raced) return raced;
      throw copyError;
    }
  });
}

async function snapshotState(
  inspection: ExecutableInspection,
  root: string,
  dependencies: PluginExecutableDependencies,
): Promise<SnapshotState> {
  const base = await privateSnapshotBase(dependencies);
  const expectedRoot = snapshotDirectory(inspection, base.path);
  const canonicalRoot = await realpath(root);
  const initial = await inspectedPath(root);
  if (
    root !== expectedRoot ||
    canonicalRoot !== expectedRoot ||
    initial.isSymbolicLink() ||
    !initial.isDirectory() ||
    !ownerMatches(initial) ||
    !exactMode(initial, SNAPSHOT_DIRECTORY_MODE, dependencies.platform ?? process.platform) ||
    !contained(base.path, canonicalRoot) ||
    !(await protectedTree(canonicalRoot, dependencies))
  ) {
    throw executableFailure();
  }
  const artifactRoot = snapshotArtifactPath(canonicalRoot, inspection);
  if (
    (await Effect.runPromise(pluginArtifactContentDigest(artifactRoot))) !==
    inspection.artifactContentDigest
  ) {
    throw executableFailure();
  }
  const commandPath = snapshotCommandPath(canonicalRoot, artifactRoot, inspection);
  const command = await snapshotCommandIdentity(
    commandPath,
    dependencies.platform ?? process.platform,
    inspection.runtimeExecutableDigest !== undefined,
  );
  if (
    command.digest !== inspection.command.digest ||
    ((dependencies.platform ?? process.platform) !== "win32" && (command.mode & 0o111) === 0)
  ) {
    throw executableFailure();
  }
  const bootstrap = await Effect.runPromise(
    pluginExecutableFileIdentity(bootstrapPath(canonicalRoot)),
  );
  if (
    sourceDigest(await readFile(bootstrap.path, "utf8")) !== inspection.bootstrapDigest ||
    !exactMode(
      await inspectedPath(bootstrap.path),
      SNAPSHOT_FILE_MODE,
      dependencies.platform ?? process.platform,
    )
  ) {
    throw executableFailure();
  }
  const files = await Promise.all(
    inspection.files.map(async (file) => {
      const mappedPath = mappedSnapshotPath(artifactRoot, inspection, file.path);
      const identity = await Effect.runPromise(pluginExecutableFileIdentity(mappedPath));
      if (identity.digest !== file.digest) throw executableFailure();
      const snapshotPath = identity.path;
      return {
        index: file.index,
        source: file.source,
        path: file.path,
        snapshotArgument: bootstrap.path,
        snapshotPath,
        digest: file.digest,
        mode: file.mode,
      };
    }),
  );
  const final = await inspectedPath(canonicalRoot);
  if (!sameNode(initial, final)) throw executableFailure();
  await assertStablePath(base.path, base.stat);
  return {
    root: canonicalRoot,
    artifactRoot,
    cwd: mappedSnapshotPath(artifactRoot, inspection, inspection.sourceCwd),
    command,
    files,
    digest: await Effect.runPromise(pluginArtifactDigest(canonicalRoot)),
  };
}

function resolvedExecutable(
  inspection: ExecutableInspection,
  snapshot: SnapshotState,
): ResolvedPluginExecutable {
  const args = [...inspection.input.args];
  for (const file of snapshot.files) args[file.index] = file.snapshotArgument;
  const binding: ConnectorExecutableBinding = {
    format: "local-studio-executable-v1",
    command: inspection.input.command,
    resolvedCommand: inspection.command.path,
    snapshotCommand: snapshot.command.path,
    commandDigest: inspection.command.digest,
    commandMode: inspection.command.mode,
    runtimeDigest: inspection.runtimeDigest,
    sourceRoot: inspection.sourceRoot,
    sourceCwd: inspection.sourceCwd,
    snapshotRoot: snapshot.root,
    snapshotCwd: snapshot.cwd,
    artifactDigest: inspection.input.artifactDigest,
    artifactContentDigest: inspection.artifactContentDigest,
    snapshotDigest: snapshot.digest,
    digest: inspection.digest,
    files: snapshot.files,
  };
  return { command: snapshot.command.path, args, cwd: snapshot.cwd, binding };
}

async function resolveExecutable(
  input: PluginExecutableInput,
  dependencies: PluginExecutableDependencies,
): Promise<ResolvedPluginExecutable> {
  const inspection = await inspectExecutable(input, dependencies);
  const root = await ensureSnapshotDirectory(inspection, dependencies);
  const current = await inspectExecutable(input, dependencies);
  if (
    inspection.sourceRoot !== current.sourceRoot ||
    inspection.sourceCwd !== current.sourceCwd ||
    inspection.artifactContentDigest !== current.artifactContentDigest ||
    inspection.command.path !== current.command.path ||
    inspection.command.digest !== current.command.digest ||
    inspection.command.mode !== current.command.mode ||
    inspection.runtimeDigest !== current.runtimeDigest ||
    inspection.digest !== current.digest ||
    JSON.stringify(inspection.files) !== JSON.stringify(current.files)
  ) {
    throw executableFailure();
  }
  return resolvedExecutable(inspection, await snapshotState(inspection, root, dependencies));
}

export function resolvePluginExecutable(
  input: PluginExecutableInput,
  dependencies: PluginExecutableDependencies = {},
): Effect.Effect<ResolvedPluginExecutable, PluginExecutableError> {
  return Effect.tryPromise({
    try: () => resolveExecutable(input, dependencies),
    catch: (error) => (error instanceof PluginExecutableError ? error : executableFailure()),
  });
}

async function validateExecutable(
  connector: ConnectorConfig,
  dependencies: PluginExecutableDependencies,
): Promise<void> {
  const binding = connector.origin?.executable;
  if (
    connector.transport !== "stdio" ||
    connector.origin?.artifactDigest !== binding?.artifactDigest ||
    !connector.command ||
    !connector.cwd ||
    !binding
  ) {
    throw changedFailure();
  }
  const connectorArgs = connector.args ?? [];
  const indexes = new Set(binding.files.map((file) => file.index));
  if (
    indexes.size !== binding.files.length ||
    binding.files.some(
      (file) =>
        !Number.isSafeInteger(file.index) || file.index < 0 || file.index >= connectorArgs.length,
    )
  ) {
    throw changedFailure();
  }
  const sourceArgs = [...connectorArgs];
  for (const file of binding.files) sourceArgs[file.index] = file.source;
  const inspection = await inspectExecutable(
    {
      command: binding.command,
      args: sourceArgs,
      env: connector.env,
      cwd: binding.sourceCwd,
      artifactRoot: binding.sourceRoot,
      artifactDigest: binding.artifactDigest,
    },
    dependencies,
  );
  const base = await privateSnapshotBase(dependencies);
  if ((await realpath(snapshotDirectory(inspection, base.path))) !== binding.snapshotRoot) {
    throw changedFailure();
  }
  const resolved = resolvedExecutable(
    inspection,
    await snapshotState(inspection, binding.snapshotRoot, dependencies),
  );
  if (
    resolved.command !== connector.command ||
    resolved.cwd !== connector.cwd ||
    resolved.args.length !== (connector.args ?? []).length ||
    resolved.args.some((value, index) => value !== connector.args?.[index]) ||
    JSON.stringify(resolved.binding) !== JSON.stringify(binding)
  ) {
    throw changedFailure();
  }
}

export function validatePluginExecutable(
  connector: ConnectorConfig,
  dependencies: PluginExecutableDependencies = {},
): Effect.Effect<void, PluginExecutableError> {
  return Effect.tryPromise({
    try: () => validateExecutable(connector, dependencies),
    catch: () => changedFailure(),
  });
}
