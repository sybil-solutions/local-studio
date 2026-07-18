import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import executableIdentity from "./executable-identity.cjs";

const {
  AUDITED_NODE_IDENTITIES,
  AUDITED_NODE_EXECUTABLE_SHA256,
  AUDITED_WINDOWS_HELPER_BUILD,
  AUDITED_WINDOWS_HELPER_IDENTITY,
  signingStableExecutableIdentity,
} = executableIdentity;

const DATA_MODE = 0o444;
const EXECUTABLE_MODE = 0o555;
const EXECUTABLE_ACCESS = "read-execute";
const DATA_ACCESS = "read-only";
const NODE_LICENSE_SHA256 = "148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5";

type RuntimeClosureEntry = {
  path: string;
  role: string;
  identity: ExecutableIdentity;
  mode: typeof EXECUTABLE_ACCESS | typeof DATA_ACCESS;
};

type ExecutableIdentity = {
  algorithm: string;
  digest: string;
};

type PackagedRuntimeIdentity = {
  nodeRuntime: string;
  manifestPath: string;
  manifestDigest: string;
  windowsHelper?: string;
};

type RuntimeManifest = {
  decoded: Record<string, unknown>;
  node: Record<string, unknown>;
  closure: unknown[];
  digest: string;
};

function runtimeFailure(): Error {
  return new Error("Packaged runtime closure is invalid");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactObject(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function decodedIdentity(value: unknown): ExecutableIdentity {
  if (!record(value)) throw runtimeFailure();
  const algorithm = Reflect.get(value, "algorithm");
  const identityDigest = Reflect.get(value, "digest");
  if (
    !exactObject(Object.keys(value).sort(), ["algorithm", "digest"]) ||
    typeof algorithm !== "string" ||
    typeof identityDigest !== "string"
  ) {
    throw runtimeFailure();
  }
  return { algorithm, digest: identityDigest };
}

function fileIdentity(entry: string, mode: string, platform: NodeJS.Platform): ExecutableIdentity {
  const bytes = readFileSync(entry);
  try {
    return mode === EXECUTABLE_ACCESS
      ? signingStableExecutableIdentity(bytes, platform)
      : { algorithm: "sha256-v1", digest: digest(bytes) };
  } catch {
    throw runtimeFailure();
  }
}

function bodyOf(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "digest"));
}

function accessMatches(statMode: number, access: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") return (statMode & 0o222) === 0;
  const expected = access === EXECUTABLE_ACCESS ? EXECUTABLE_MODE : DATA_MODE;
  return (statMode & 0o777) === expected;
}

function closureEntry(value: unknown): RuntimeClosureEntry {
  if (!record(value)) throw runtimeFailure();
  const entryPath = Reflect.get(value, "path");
  const role = Reflect.get(value, "role");
  const identity = decodedIdentity(Reflect.get(value, "identity"));
  const mode = Reflect.get(value, "mode");
  if (
    !exactObject(Object.keys(value).sort(), ["identity", "mode", "path", "role"]) ||
    typeof entryPath !== "string" ||
    typeof role !== "string" ||
    (mode !== EXECUTABLE_ACCESS && mode !== DATA_ACCESS)
  ) {
    throw runtimeFailure();
  }
  return { path: entryPath, role, identity, mode };
}

function runtimeTarget(
  manifest: Record<string, unknown>,
  platform: NodeJS.Platform,
  arch: string,
): void {
  const target = Reflect.get(manifest, "target");
  if (
    !record(target) ||
    !exactObject(Object.keys(target).sort(), ["arch", "key", "platform"]) ||
    Reflect.get(target, "platform") !== platform ||
    Reflect.get(target, "arch") !== arch ||
    Reflect.get(target, "key") !== `${platform}-${arch}`
  ) {
    throw runtimeFailure();
  }
}

function runtimeManifest(manifestPath: string): RuntimeManifest {
  const decoded: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!record(decoded)) throw runtimeFailure();
  const manifestDigest = Reflect.get(decoded, "digest");
  const node = Reflect.get(decoded, "node");
  const closure = Reflect.get(decoded, "closure");
  const topLevelKeys = Object.keys(decoded).sort();
  if (
    (!exactObject(topLevelKeys, ["closure", "digest", "format", "node", "target"]) &&
      !exactObject(topLevelKeys, [
        "closure",
        "digest",
        "format",
        "node",
        "target",
        "windowsHelper",
      ])) ||
    Reflect.get(decoded, "format") !== "local-studio-desktop-runtime-v2" ||
    typeof manifestDigest !== "string" ||
    manifestDigest !== `sha256:${digest(JSON.stringify(bodyOf(decoded)))}` ||
    !record(node) ||
    !exactObject(Object.keys(node).sort(), [
      "executable",
      "license",
      "package",
      "upstream",
      "version",
    ]) ||
    Reflect.get(node, "version") !== "24.18.0" ||
    !Array.isArray(closure)
  ) {
    throw runtimeFailure();
  }
  return { decoded, node, closure, digest: manifestDigest };
}

function nodeIdentity(
  node: Record<string, unknown>,
  platform: NodeJS.Platform,
  arch: string,
): { executableName: string; identity: ExecutableIdentity } {
  const executableName = platform === "win32" ? "node.exe" : "node";
  const expectedDigest = AUDITED_NODE_EXECUTABLE_SHA256[`${platform}-${arch}`];
  const upstream = Reflect.get(node, "upstream");
  if (
    Reflect.get(node, "executable") !== executableName ||
    Reflect.get(node, "license") !== "LICENSE.node" ||
    !record(upstream) ||
    Reflect.get(upstream, "executableSha256") !== expectedDigest ||
    !exactObject(
      Reflect.get(upstream, "codeIdentity"),
      AUDITED_NODE_IDENTITIES[`${platform}-${arch}`],
    )
  ) {
    throw runtimeFailure();
  }
  return { executableName, identity: AUDITED_NODE_IDENTITIES[`${platform}-${arch}`] };
}

function expectedClosurePaths(executableName: string, platform: NodeJS.Platform): string[] {
  const paths = [executableName, "LICENSE.node"];
  if (platform === "win32") paths.push("windows-runtime-helper.exe");
  return paths;
}

function assertClosureInventory(
  runtimeDir: string,
  entries: RuntimeClosureEntry[],
  paths: string[],
) {
  const expectedNames = new Set(["runtime-manifest.json", ...paths]);
  const names = readdirSync(runtimeDir);
  if (
    entries.length !== paths.length ||
    paths.some((entry) => !entries.some((candidate) => candidate.path === entry)) ||
    names.length !== expectedNames.size ||
    names.some((name) => !expectedNames.has(name))
  ) {
    throw runtimeFailure();
  }
}

function assertClosureFiles(
  runtimeDir: string,
  entries: RuntimeClosureEntry[],
  platform: NodeJS.Platform,
): string {
  const canonicalRoot = realpathSync(runtimeDir);
  for (const entry of entries) {
    const absolute = path.join(runtimeDir, entry.path);
    const stat = lstatSync(absolute);
    if (
      path.basename(entry.path) !== entry.path ||
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      realpathSync(absolute) !== path.join(canonicalRoot, entry.path) ||
      !accessMatches(stat.mode, entry.mode, platform) ||
      !exactObject(fileIdentity(absolute, entry.mode, platform), entry.identity)
    ) {
      throw runtimeFailure();
    }
  }
  return canonicalRoot;
}

function assertClosureIdentity(
  entries: RuntimeClosureEntry[],
  executableName: string,
  expectedNodeDigest: ExecutableIdentity,
  platform: NodeJS.Platform,
): RuntimeClosureEntry | undefined {
  const executable = entries.find((entry) => entry.path === executableName);
  const license = entries.find((entry) => entry.path === "LICENSE.node");
  const helper = entries.find((entry) => entry.path === "windows-runtime-helper.exe");
  if (
    executable?.role !== "node-executable" ||
    executable.mode !== EXECUTABLE_ACCESS ||
    !exactObject(executable.identity, expectedNodeDigest) ||
    license?.role !== "node-license" ||
    license.mode !== DATA_ACCESS ||
    !exactObject(license.identity, { algorithm: "sha256-v1", digest: NODE_LICENSE_SHA256 }) ||
    (platform === "win32" &&
      (helper?.role !== "windows-process-helper" ||
        helper.mode !== EXECUTABLE_ACCESS ||
        !exactObject(helper.identity, AUDITED_WINDOWS_HELPER_IDENTITY))) ||
    (platform !== "win32" && helper !== undefined)
  ) {
    throw runtimeFailure();
  }
  return helper;
}

function assertWindowsMetadata(manifest: Record<string, unknown>, platform: NodeJS.Platform): void {
  const value = Reflect.get(manifest, "windowsHelper");
  if (platform !== "win32") {
    if (value !== undefined) throw runtimeFailure();
    return;
  }
  if (
    !record(value) ||
    !exactObject(value, {
      ...AUDITED_WINDOWS_HELPER_BUILD,
      executable: "windows-runtime-helper.exe",
    })
  ) {
    throw runtimeFailure();
  }
}

function assertManifestEntry(
  runtimeDir: string,
  manifestPath: string,
  platform: NodeJS.Platform,
): void {
  const manifestStat = lstatSync(manifestPath);
  const runtimeStat = lstatSync(runtimeDir);
  if (
    runtimeStat.isSymbolicLink() ||
    !runtimeStat.isDirectory() ||
    manifestStat.isSymbolicLink() ||
    !manifestStat.isFile() ||
    !accessMatches(manifestStat.mode, DATA_ACCESS, platform)
  ) {
    throw runtimeFailure();
  }
}

export function verifiedPackagedRuntime(
  runtimeDir: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): PackagedRuntimeIdentity {
  const manifestPath = path.join(runtimeDir, "runtime-manifest.json");
  const manifest = runtimeManifest(manifestPath);
  runtimeTarget(manifest.decoded, platform, arch);
  const node = nodeIdentity(manifest.node, platform, arch);
  const entries = manifest.closure.map(closureEntry);
  assertWindowsMetadata(manifest.decoded, platform);
  assertClosureInventory(runtimeDir, entries, expectedClosurePaths(node.executableName, platform));
  const canonicalRoot = assertClosureFiles(runtimeDir, entries, platform);
  const helper = assertClosureIdentity(entries, node.executableName, node.identity, platform);
  assertManifestEntry(runtimeDir, manifestPath, platform);
  return {
    nodeRuntime: path.join(canonicalRoot, node.executableName),
    manifestPath: path.join(canonicalRoot, "runtime-manifest.json"),
    manifestDigest: manifest.digest,
    ...(helper ? { windowsHelper: path.join(canonicalRoot, helper.path) } : {}),
  };
}
