import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
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
const RuntimeTargetSchema = Schema.Struct({
  platform: Schema.Union([
    Schema.Literal("darwin"),
    Schema.Literal("linux"),
    Schema.Literal("win32"),
  ]),
  arch: Schema.Union([Schema.Literal("arm64"), Schema.Literal("x64")]),
  key: Schema.String,
});
const ExecutableIdentitySchema = Schema.Struct({
  algorithm: Schema.Union([
    Schema.Literal("macho-unsigned-v1"),
    Schema.Literal("pe-authenticode-v1"),
    Schema.Literal("sha256-v1"),
  ]),
  digest: Schema.String,
});
const RuntimeClosureEntrySchema = Schema.Struct({
  path: Schema.String,
  role: Schema.String,
  identity: ExecutableIdentitySchema,
  mode: Schema.Union([Schema.Literal(EXECUTABLE_ACCESS), Schema.Literal(DATA_ACCESS)]),
});
const RuntimeManifestSchema = Schema.Struct({
  format: Schema.Literal("local-studio-desktop-runtime-v2"),
  target: RuntimeTargetSchema,
  node: Schema.Struct({
    version: Schema.Literal("24.18.0"),
    executable: Schema.String,
    license: Schema.Literal("LICENSE.node"),
    package: Schema.Unknown,
    upstream: Schema.Unknown,
  }),
  closure: Schema.Array(RuntimeClosureEntrySchema),
  windowsHelper: Schema.optional(Schema.Unknown),
  digest: Schema.String,
});

type TrustedRuntimeIdentity = {
  digest: string;
  executableIdentity: typeof ExecutableIdentitySchema.Type;
  manifestPath: string;
};

function runtimeFailure(): Error {
  return new Error("Trusted Node runtime closure is invalid");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function valueDigest(value: unknown): string {
  return `sha256:${digest(JSON.stringify(value))}`;
}

function exactObject(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fileIdentity(
  bytes: Buffer,
  access: string,
  platform: NodeJS.Platform,
): typeof ExecutableIdentitySchema.Type {
  try {
    return access === EXECUTABLE_ACCESS
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

async function verifiedClosure(
  runtimeDir: string,
  manifest: typeof RuntimeManifestSchema.Type,
  platform: NodeJS.Platform,
): Promise<void> {
  const executable = platform === "win32" ? "node.exe" : "node";
  const expectedPaths = [executable, "LICENSE.node"];
  if (platform === "win32") expectedPaths.push("windows-runtime-helper.exe");
  if (
    manifest.closure.length !== expectedPaths.length ||
    expectedPaths.some((entry) => !manifest.closure.some((candidate) => candidate.path === entry))
  ) {
    throw runtimeFailure();
  }
  const names = await readdir(runtimeDir);
  const expectedNames = new Set(["runtime-manifest.json", ...expectedPaths]);
  if (names.length !== expectedNames.size || names.some((name) => !expectedNames.has(name))) {
    throw runtimeFailure();
  }
  const canonicalRoot = await realpath(runtimeDir);
  for (const entry of manifest.closure) {
    if (path.basename(entry.path) !== entry.path) throw runtimeFailure();
    const absolute = path.join(runtimeDir, entry.path);
    const stat = await lstat(absolute);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      (await realpath(absolute)) !== path.join(canonicalRoot, entry.path) ||
      !accessMatches(stat.mode, entry.mode, platform) ||
      !exactObject(fileIdentity(await readFile(absolute), entry.mode, platform), entry.identity)
    ) {
      throw runtimeFailure();
    }
  }
  const node = manifest.closure.find((entry) => entry.path === executable);
  const license = manifest.closure.find((entry) => entry.path === "LICENSE.node");
  const targetKey = `${platform}-${manifest.target.arch}`;
  const expectedNodeDigest = AUDITED_NODE_EXECUTABLE_SHA256[targetKey];
  const expectedNodeIdentity = AUDITED_NODE_IDENTITIES[targetKey];
  if (
    manifest.node.executable !== executable ||
    node?.role !== "node-executable" ||
    node.mode !== EXECUTABLE_ACCESS ||
    !exactObject(node.identity, expectedNodeIdentity) ||
    !record(manifest.node.upstream) ||
    Reflect.get(manifest.node.upstream, "executableSha256") !== expectedNodeDigest ||
    !exactObject(Reflect.get(manifest.node.upstream, "codeIdentity"), expectedNodeIdentity) ||
    license?.role !== "node-license" ||
    license.mode !== DATA_ACCESS ||
    !exactObject(license.identity, { algorithm: "sha256-v1", digest: NODE_LICENSE_SHA256 })
  ) {
    throw runtimeFailure();
  }
  const helper = manifest.closure.find((entry) => entry.path === "windows-runtime-helper.exe");
  if (
    (platform === "win32" &&
      (helper?.role !== "windows-process-helper" ||
        helper.mode !== EXECUTABLE_ACCESS ||
        !exactObject(helper.identity, AUDITED_WINDOWS_HELPER_IDENTITY))) ||
    (platform !== "win32" && (helper !== undefined || manifest.windowsHelper !== undefined))
  ) {
    throw runtimeFailure();
  }
  const helperMetadata = manifest.windowsHelper;
  if (
    platform === "win32" &&
    (!record(helperMetadata) ||
      !exactObject(helperMetadata, {
        ...AUDITED_WINDOWS_HELPER_BUILD,
        executable: "windows-runtime-helper.exe",
      }))
  ) {
    throw runtimeFailure();
  }
}

export async function trustedRuntimeIdentity(
  runtime: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<TrustedRuntimeIdentity | null> {
  const configured = process.env.LOCAL_STUDIO_NODE_RUNTIME_MANIFEST?.trim();
  const sibling = path.join(path.dirname(runtime), "runtime-manifest.json");
  const manifestPath = path.resolve(configured || sibling);
  try {
    await lstat(manifestPath);
  } catch {
    if (!configured) return null;
    throw runtimeFailure();
  }
  if (manifestPath !== sibling) throw runtimeFailure();
  const decoded: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!record(decoded)) throw runtimeFailure();
  const manifest = Schema.decodeUnknownSync(RuntimeManifestSchema, {
    onExcessProperty: "error",
  })(decoded);
  const body = bodyOf(decoded);
  const manifestStat = await lstat(manifestPath);
  const runtimeDir = path.dirname(manifestPath);
  const runtimeDirStat = await lstat(runtimeDir);
  if (
    manifest.digest !== valueDigest(body) ||
    manifest.target.platform !== platform ||
    manifest.target.arch !== arch ||
    manifest.target.key !== `${platform}-${arch}` ||
    manifestStat.isSymbolicLink() ||
    !manifestStat.isFile() ||
    !accessMatches(manifestStat.mode, DATA_ACCESS, platform) ||
    runtimeDirStat.isSymbolicLink() ||
    !runtimeDirStat.isDirectory() ||
    (await realpath(runtime)) !== path.join(await realpath(runtimeDir), manifest.node.executable)
  ) {
    throw runtimeFailure();
  }
  await verifiedClosure(runtimeDir, manifest, platform);
  return {
    digest: manifest.digest,
    executableIdentity: AUDITED_NODE_IDENTITIES[`${platform}-${arch}`],
    manifestPath,
  };
}
