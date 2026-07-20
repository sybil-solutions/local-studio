import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { Effect, Schema, Semaphore } from "effect";
import type { GitHubConnectorArtifactStatus } from "./connector-contract";
import { connectorInventoryDigest } from "./connector-inventory";
import { dataDirPath } from "./data-dir";
import { connectMcp } from "./mcp-client";
import {
  createWindowsSnapshotSecurity,
  type WindowsSnapshotEntryKind,
  type WindowsSnapshotSecurity,
} from "./windows-runtime-helper";

export const GITHUB_MCP_VERSION = "1.6.0";
export const GITHUB_MCP_ARGS = [
  "stdio",
  "--read-only",
  "--toolsets=repos,issues,pull_requests",
] as const;
export const GITHUB_MCP_TOOLS = [
  "get_commit",
  "get_file_contents",
  "get_label",
  "get_latest_release",
  "get_release_by_tag",
  "get_tag",
  "issue_read",
  "list_branches",
  "list_commits",
  "list_issue_fields",
  "list_issue_types",
  "list_issues",
  "list_pull_requests",
  "list_releases",
  "list_repository_collaborators",
  "list_tags",
  "pull_request_read",
  "search_code",
  "search_commits",
  "search_issues",
  "search_pull_requests",
  "search_repositories",
] as const;
export const GITHUB_MCP_INVENTORY_DIGEST =
  "sha256:c1cf11fc3b7cdf3afd1301bf38bc6c8a9bbd5357ca50baa2ec175ac89c144772";

export type GitHubMcpArtifact = {
  target: string;
  platform: NodeJS.Platform;
  arch: string;
  version: string;
  url: string;
  archiveName: string;
  archiveFormat: "tar.gz" | "zip";
  archiveSize: number;
  archiveSha256: string;
  executableName: string;
  executableSize: number;
  executableSha256: string;
  entries: readonly { name: string; size: number }[];
};

const artifact = (input: Omit<GitHubMcpArtifact, "version" | "entries">): GitHubMcpArtifact => ({
  ...input,
  version: GITHUB_MCP_VERSION,
  entries: [
    { name: "LICENSE", size: 1_063 },
    { name: "README.md", size: 98_313 },
    { name: input.executableName, size: input.executableSize },
  ],
});

export const GITHUB_MCP_ARTIFACTS: Readonly<Record<string, GitHubMcpArtifact>> = {
  "darwin-arm64": artifact({
    target: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Darwin_arm64.tar.gz",
    archiveName: "github-mcp-server_Darwin_arm64.tar.gz",
    archiveFormat: "tar.gz",
    archiveSize: 7_644_753,
    archiveSha256: "cdce71ef6f893d463910678ec298bba76610ca4591bf35263f0ff0ec35928f9e",
    executableName: "github-mcp-server",
    executableSize: 23_627_042,
    executableSha256: "60e178495ae2bcb898eaffc2c21d299d553a259914430c9eaa8b3f5f76f5d129",
  }),
  "darwin-x64": artifact({
    target: "darwin-x64",
    platform: "darwin",
    arch: "x64",
    url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Darwin_x86_64.tar.gz",
    archiveName: "github-mcp-server_Darwin_x86_64.tar.gz",
    archiveFormat: "tar.gz",
    archiveSize: 8_122_888,
    archiveSha256: "75bf4fb2c855a3af5381056b88afdf2e2b67e330906aadfbae9682e8dcacbd3f",
    executableName: "github-mcp-server",
    executableSize: 24_877_744,
    executableSha256: "6a052a0a75b69fe777543039fbdeaab50e2a5262d55e43917661c558bad790d3",
  }),
  "linux-arm64": artifact({
    target: "linux-arm64",
    platform: "linux",
    arch: "arm64",
    url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Linux_arm64.tar.gz",
    archiveName: "github-mcp-server_Linux_arm64.tar.gz",
    archiveFormat: "tar.gz",
    archiveSize: 7_302_795,
    archiveSha256: "25f8028304202674ec2e9977fec3ca0897cac33866dabb51aefd418bc0ce7ef2",
    executableName: "github-mcp-server",
    executableSize: 22_937_784,
    executableSha256: "5d47f9e36850769db8a46c97a7ad1e7a1bd51502c57765a81e697f5740455227",
  }),
  "linux-x64": artifact({
    target: "linux-x64",
    platform: "linux",
    arch: "x64",
    url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Linux_x86_64.tar.gz",
    archiveName: "github-mcp-server_Linux_x86_64.tar.gz",
    archiveFormat: "tar.gz",
    archiveSize: 7_957_825,
    archiveSha256: "27443d173f209e60d4af9777e624bfea3de1af24897d46cc7324f01cf279a41d",
    executableName: "github-mcp-server",
    executableSize: 24_309_944,
    executableSha256: "955fff9cf50ae99ee021871a4782c36360252d82fd03c8307fd7394c44ba3886",
  }),
  "win32-x64": artifact({
    target: "win32-x64",
    platform: "win32",
    arch: "x64",
    url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Windows_x86_64.zip",
    archiveName: "github-mcp-server_Windows_x86_64.zip",
    archiveFormat: "zip",
    archiveSize: 8_147_960,
    archiveSha256: "699d91a1f49897d9c51cef5794cb423401a1ab27e263c76168c133dff0d004e0",
    executableName: "github-mcp-server.exe",
    executableSize: 24_920_576,
    executableSha256: "66702e31cd5577e4c1437337599759256bbc23bed1bb5a76aa5f5525abc0ee1a",
  }),
};

const MAX_ARCHIVE_BYTES = 12 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 16;
const INSTALL_TIMEOUT_MS = 60_000;
const VERIFY_TIMEOUT_MS = 10_000;
const INSTALL_LOCK_POLL_MS = 25;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const EXECUTABLE_MODE = 0o500;
const installSemaphore = Semaphore.makeUnsafe(1);
const InstallLockRecordSchema = Schema.Struct({
  version: Schema.Literal(1),
  pid: Schema.Number,
  claim: Schema.String,
});
const INSTALL_LOCK_NAME = ".install.lock";
const INSTALL_UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const INSTALL_CLAIM_PATTERN =
  /^\.install-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.claim$/i;
const INSTALL_CLEANUP_GUARD_PATTERN = new RegExp(
  `^(\\.install-${INSTALL_UUID_SOURCE}\\.claim)\\.reaping(?:-([1-9][0-9]*)-(${INSTALL_UUID_SOURCE}))?$`,
  "i",
);

export class GitHubConnectorArtifactError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GitHubConnectorArtifactError";
  }
}

function artifactFailure(error: unknown): GitHubConnectorArtifactError {
  return error instanceof GitHubConnectorArtifactError
    ? error
    : new GitHubConnectorArtifactError(502, "GitHub MCP installation failed", { cause: error });
}

type ArchiveEntry = { name: string; bytes: Buffer };

export type GitHubMcpVerificationOptions = {
  prefixArgs?: readonly string[];
  expectedTools?: readonly string[];
  expectedInventoryDigest?: string;
  timeoutMs?: number;
};

export type GitHubMcpArtifactDependencies = {
  platform?: NodeJS.Platform;
  arch?: string;
  dataDir?: string;
  artifact?: GitHubMcpArtifact;
  fetch?: typeof fetch;
  rename?: typeof rename;
  timeoutMs?: number;
  verifyExecutable?: (command: string) => Promise<void>;
  windowsSecurity?: WindowsSnapshotSecurity;
};

function targetKey(platform: NodeJS.Platform, arch: string): string {
  return `${platform}-${arch}`;
}

export function githubMcpArtifactFor(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): GitHubMcpArtifact | null {
  return GITHUB_MCP_ARTIFACTS[targetKey(platform, arch)] ?? null;
}

function selectedArtifact(dependencies: GitHubMcpArtifactDependencies): GitHubMcpArtifact | null {
  return (
    dependencies.artifact ??
    githubMcpArtifactFor(
      dependencies.platform ?? process.platform,
      dependencies.arch ?? process.arch,
    )
  );
}

export function resolvedGitHubMcpDataDir(
  dataDir: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const resolved = paths.resolve(dataDir);
  return paths.relative(paths.parse(resolved).root, resolved) ? resolved : null;
}

function selectedDataDir(dependencies: GitHubMcpArtifactDependencies): string {
  const selected = resolvedGitHubMcpDataDir(dependencies.dataDir ?? dataDirPath());
  if (!selected) throw new GitHubConnectorArtifactError(409, "GitHub MCP data directory is unsafe");
  return selected;
}

function installRoot(dataDir: string): string {
  return path.join(dataDir, "runtime", "connectors", "github-mcp-server");
}

function versionRoot(dataDir: string, selected: GitHubMcpArtifact): string {
  return path.join(installRoot(dataDir), selected.version);
}

export function githubMcpExecutablePath(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  dataDir: string = dataDirPath(),
): string | null {
  const selected = githubMcpArtifactFor(platform, arch);
  const paths = platform === "win32" ? path.win32 : path.posix;
  const resolved = resolvedGitHubMcpDataDir(dataDir, platform);
  return selected && resolved
    ? paths.join(
        resolved,
        "runtime",
        "connectors",
        "github-mcp-server",
        selected.version,
        selected.executableName,
      )
    : null;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function missing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

function errorCode(error: unknown): string | null {
  return error instanceof Error && typeof Reflect.get(error, "code") === "string"
    ? String(Reflect.get(error, "code"))
    : null;
}

function ownerMatches(stat: { uid: number }): boolean {
  const uid = process.geteuid?.();
  return uid === undefined || stat.uid === uid;
}

function installedDirectories(dataDir: string, selected: GitHubMcpArtifact): string[] {
  return [
    dataDir,
    path.join(dataDir, "runtime"),
    path.join(dataDir, "runtime", "connectors"),
    installRoot(dataDir),
    versionRoot(dataDir, selected),
  ];
}

function installedState(
  selected: GitHubMcpArtifact,
  dataDir: string,
  platform: NodeJS.Platform,
): "installed" | "not-installed" | "invalid" {
  const root = versionRoot(dataDir, selected);
  const executable = path.join(root, selected.executableName);
  try {
    lstatSync(root);
  } catch (error) {
    return missing(error) ? "not-installed" : "invalid";
  }
  try {
    for (const entry of installedDirectories(dataDir, selected)) {
      const directory = lstatSync(entry);
      if (
        directory.isSymbolicLink() ||
        !directory.isDirectory() ||
        !ownerMatches(directory) ||
        realpathSync(entry) !== entry ||
        (platform !== "win32" && (directory.mode & 0o777) !== PRIVATE_DIRECTORY_MODE)
      ) {
        return "invalid";
      }
    }
    const entries = readdirSync(root);
    if (entries.length !== 1 || entries[0] !== selected.executableName) {
      return "invalid";
    }
    const file = lstatSync(executable);
    if (
      file.isSymbolicLink() ||
      !file.isFile() ||
      !ownerMatches(file) ||
      file.size !== selected.executableSize
    ) {
      return "invalid";
    }
    if (platform !== "win32" && (file.mode & 0o777) !== EXECUTABLE_MODE) {
      return "invalid";
    }
    return sha256(readFileSync(executable)) === selected.executableSha256 ? "installed" : "invalid";
  } catch {
    return "invalid";
  }
}

async function securedInstalledState(
  selected: GitHubMcpArtifact,
  dataDir: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<"installed" | "not-installed" | "invalid"> {
  const state = installedState(selected, dataDir, platform);
  if (state !== "installed" || !security) return state;
  try {
    for (const entry of installedDirectories(dataDir, selected)) {
      await security.verify(entry, "directory", "private");
    }
    await security.verify(
      path.join(versionRoot(dataDir, selected), selected.executableName),
      "file",
      "private",
    );
    return "installed";
  } catch {
    return "invalid";
  }
}

async function artifactStatus(
  dependencies: GitHubMcpArtifactDependencies,
): Promise<GitHubConnectorArtifactStatus> {
  const platform = dependencies.platform ?? process.platform;
  const arch = dependencies.arch ?? process.arch;
  const selected = selectedArtifact(dependencies);
  if (!selected) {
    return { version: GITHUB_MCP_VERSION, target: targetKey(platform, arch), state: "unsupported" };
  }
  const dataDir = selectedDataDir(dependencies);
  const state = installedState(selected, dataDir, platform);
  let securedState = state;
  if (state === "installed") {
    try {
      securedState = await securedInstalledState(
        selected,
        dataDir,
        platform,
        windowsSecurity(dependencies, platform),
      );
    } catch {
      securedState = "invalid";
    }
  }
  return {
    version: selected.version,
    target: selected.target,
    state: securedState,
  };
}

export function getGitHubConnectorArtifactStatus(
  dependencies: GitHubMcpArtifactDependencies = {},
): Effect.Effect<GitHubConnectorArtifactStatus> {
  return Effect.promise(() => artifactStatus(dependencies));
}

export async function verifiedGitHubMcpExecutablePath(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  dataDir: string = dataDirPath(),
  security?: WindowsSnapshotSecurity,
): Promise<string | null> {
  const selected = githubMcpArtifactFor(platform, arch);
  const resolved = resolvedGitHubMcpDataDir(dataDir);
  if (!selected || !resolved || installedState(selected, resolved, platform) !== "installed") {
    return null;
  }
  try {
    return (await securedInstalledState(
      selected,
      resolved,
      platform,
      windowsSecurity({ windowsSecurity: security }, platform),
    )) === "installed"
      ? path.join(versionRoot(resolved, selected), selected.executableName)
      : null;
  } catch {
    return null;
  }
}

function safeArchiveName(name: string): boolean {
  if (!name || name.includes("\\") || path.posix.isAbsolute(name) || /^[A-Za-z]:/.test(name)) {
    return false;
  }
  const parts = name.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function tarText(bytes: Buffer, offset: number, length: number): string {
  const end = bytes.indexOf(0, offset);
  return bytes
    .subarray(offset, end === -1 || end > offset + length ? offset + length : end)
    .toString();
}

function tarNumber(bytes: Buffer, offset: number, length: number): number {
  const value = tarText(bytes, offset, length).trim();
  if (!/^[0-7]+$/.test(value))
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed))
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  return parsed;
}

function tarHeaderChecksum(bytes: Buffer, offset: number): number {
  let checksum = 0;
  for (let index = 0; index < 512; index += 1) {
    checksum += index >= 148 && index < 156 ? 32 : (bytes[offset + index] ?? 0);
  }
  return checksum;
}

function tarEntries(archive: Buffer): ArchiveEntry[] {
  let expanded: Buffer;
  try {
    expanded = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED_BYTES });
  } catch {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  }
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (offset + 512 <= expanded.length) {
    const header = expanded.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      if (!expanded.subarray(offset).every((value) => value === 0)) {
        throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
      }
      return entries;
    }
    if (tarNumber(expanded, offset + 148, 8) !== tarHeaderChecksum(expanded, offset)) {
      throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
    }
    const name = [tarText(expanded, offset + 345, 155), tarText(expanded, offset, 100)]
      .filter(Boolean)
      .join("/");
    const size = tarNumber(expanded, offset + 124, 12);
    const type = expanded[offset + 156] ?? 0;
    const start = offset + 512;
    const end = start + size;
    if (
      !safeArchiveName(name) ||
      (type !== 0 && type !== 48) ||
      size > MAX_EXPANDED_BYTES ||
      end > expanded.length ||
      entries.length >= MAX_ARCHIVE_ENTRIES
    ) {
      throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is unsafe");
    }
    entries.push({ name, bytes: expanded.subarray(start, end) });
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
}

function zipEndOffset(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
}

function zipEntryBytes(
  archive: Buffer,
  localOffset: number,
  compressedSize: number,
  uncompressedSize: number,
  method: number,
  flags: number,
  checksum: number,
  name: string,
  centralOffset: number,
): Buffer {
  if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  }
  const nameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const dataOffset = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + compressedSize;
  const descriptor = (flags & 8) !== 0;
  const localName = archive.subarray(localOffset + 30, localOffset + 30 + nameLength).toString();
  if (
    archive.readUInt16LE(localOffset + 6) !== flags ||
    archive.readUInt16LE(localOffset + 8) !== method ||
    localName !== name ||
    dataEnd + (descriptor ? 16 : 0) > centralOffset ||
    (descriptor
      ? archive.readUInt32LE(localOffset + 14) !== 0 ||
        archive.readUInt32LE(localOffset + 18) !== 0 ||
        archive.readUInt32LE(localOffset + 22) !== 0 ||
        archive.readUInt32LE(dataEnd) !== 0x08074b50 ||
        archive.readUInt32LE(dataEnd + 4) !== checksum ||
        archive.readUInt32LE(dataEnd + 8) !== compressedSize ||
        archive.readUInt32LE(dataEnd + 12) !== uncompressedSize
      : archive.readUInt32LE(localOffset + 14) !== checksum ||
        archive.readUInt32LE(localOffset + 18) !== compressedSize ||
        archive.readUInt32LE(localOffset + 22) !== uncompressedSize)
  ) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  }
  const compressed = archive.subarray(dataOffset, dataEnd);
  let bytes: Buffer;
  try {
    bytes =
      method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: uncompressedSize });
  } catch {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  }
  if (bytes.length !== uncompressedSize || crc32(bytes) !== checksum) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  }
  return bytes;
}

function zipEntries(archive: Buffer): ArchiveEntry[] {
  const end = zipEndOffset(archive);
  const disk = archive.readUInt16LE(end + 4);
  const centralDisk = archive.readUInt16LE(end + 6);
  const diskEntries = archive.readUInt16LE(end + 8);
  const entries = archive.readUInt16LE(end + 10);
  const centralSize = archive.readUInt32LE(end + 12);
  const centralOffset = archive.readUInt32LE(end + 16);
  const commentLength = archive.readUInt16LE(end + 20);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entries ||
    entries > MAX_ARCHIVE_ENTRIES ||
    end + 22 + commentLength !== archive.length ||
    centralOffset + centralSize !== end
  ) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  }
  const result: ArchiveEntry[] = [];
  let offset = centralOffset;
  let expanded = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
    }
    const madeBy = archive.readUInt16LE(offset + 4);
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const checksum = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const entryCommentLength = archive.readUInt16LE(offset + 32);
    const startDisk = archive.readUInt16LE(offset + 34);
    const external = archive.readUInt32LE(offset + 38);
    const localOffset = archive.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + entryCommentLength;
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString();
    const unixType = external >>> 28;
    expanded += uncompressedSize;
    if (
      next > end ||
      !safeArchiveName(name) ||
      (flags & ~0x0808) !== 0 ||
      (method !== 0 && method !== 8) ||
      startDisk !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      expanded > MAX_EXPANDED_BYTES ||
      (madeBy >>> 8 === 3 && unixType !== 0 && unixType !== 8)
    ) {
      throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is unsafe");
    }
    result.push({
      name,
      bytes: zipEntryBytes(
        archive,
        localOffset,
        compressedSize,
        uncompressedSize,
        method,
        flags,
        checksum,
        name,
        centralOffset,
      ),
    });
    offset = next;
  }
  if (offset !== end) throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  return result;
}

function extractedExecutable(archive: Buffer, selected: GitHubMcpArtifact): Buffer {
  const entries = selected.archiveFormat === "tar.gz" ? tarEntries(archive) : zipEntries(archive);
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name))
      throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is unsafe");
    names.add(entry.name);
  }
  if (
    entries.length !== selected.entries.length ||
    selected.entries.some(
      (expected) =>
        entries.find((entry) => entry.name === expected.name)?.bytes.length !== expected.size,
    )
  ) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive contents are invalid");
  }
  const executable = entries.find((entry) => entry.name === selected.executableName)?.bytes;
  if (
    !executable ||
    executable.length !== selected.executableSize ||
    sha256(executable) !== selected.executableSha256
  ) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP executable integrity check failed");
  }
  return executable;
}

async function privateDirectory(
  entry: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
  recursive = false,
): Promise<string> {
  try {
    await mkdir(entry, { recursive, mode: PRIVATE_DIRECTORY_MODE });
  } catch (error) {
    if (!(error instanceof Error) || Reflect.get(error, "code") !== "EEXIST") throw error;
  }
  const stat = await lstat(entry);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !ownerMatches(stat)) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP install directory is unsafe");
  }
  if (platform !== "win32") await chmod(entry, PRIVATE_DIRECTORY_MODE);
  if (security) {
    await security.protect(entry, "directory", "private");
    await security.verify(entry, "directory", "private");
  }
  const resolved = path.resolve(entry);
  if (realpathSync(entry) !== resolved) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP install directory is unsafe");
  }
  return resolved;
}

function windowsSecurity(
  dependencies: GitHubMcpArtifactDependencies,
  platform: NodeJS.Platform,
): WindowsSnapshotSecurity | null {
  if (platform !== "win32") return null;
  return dependencies.windowsSecurity ?? createWindowsSnapshotSecurity();
}

async function protectWindowsEntry(
  entry: string,
  kind: WindowsSnapshotEntryKind,
  security: WindowsSnapshotSecurity | null,
): Promise<void> {
  if (!security) return;
  await security.protect(entry, kind, "private");
  await security.verify(entry, kind, "private");
}

async function installBase(
  dataDir: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<string> {
  let current = await privateDirectory(dataDir, platform, security, true);
  for (const name of ["runtime", "connectors", "github-mcp-server"]) {
    current = await privateDirectory(path.join(current, name), platform, security);
  }
  return current;
}

type InstallLockRecord = typeof InstallLockRecordSchema.Type;
type FileIdentity = { dev: number; ino: number };
type ArtifactInstallLock = {
  path: string;
  claim: string;
  identity: FileIdentity;
};
type InstallCleanupGuard = {
  path: string;
  identity: FileIdentity;
  cleanerPid: number | null;
  record: InstallLockRecord;
};
type ExistingInstallLock = ArtifactInstallLock & {
  record: InstallLockRecord;
  guard: InstallCleanupGuard | null;
};

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function unsafeInstallLock(cause?: unknown): GitHubConnectorArtifactError {
  return new GitHubConnectorArtifactError(409, "GitHub MCP install lock is unsafe", { cause });
}

async function privateLockFile(
  entry: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<FileIdentity> {
  const metadata = await lstat(entry);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    !ownerMatches(metadata) ||
    realpathSync(path.dirname(entry)) !== path.dirname(path.resolve(entry)) ||
    (platform !== "win32" && (metadata.mode & 0o777) !== PRIVATE_FILE_MODE)
  ) {
    throw unsafeInstallLock();
  }
  try {
    await security?.verify(entry, "file", "private");
  } catch (error) {
    throw unsafeInstallLock(error);
  }
  return { dev: metadata.dev, ino: metadata.ino };
}

async function optionalPrivateLockFile(
  entry: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<FileIdentity | null> {
  try {
    return await privateLockFile(entry, platform, security);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function validInstallLockRecord(value: unknown): InstallLockRecord | null {
  try {
    const record = Schema.decodeUnknownSync(InstallLockRecordSchema)(value);
    return Number.isSafeInteger(record.pid) &&
      record.pid > 0 &&
      INSTALL_CLAIM_PATTERN.test(record.claim)
      ? record
      : null;
  } catch {
    return null;
  }
}

async function optionalInstallLockRecord(entry: string): Promise<InstallLockRecord | null> {
  try {
    const record = validInstallLockRecord(JSON.parse(await readFile(entry, "utf8")));
    if (!record) throw unsafeInstallLock();
    return record;
  } catch (error) {
    if (missing(error)) return null;
    throw error instanceof GitHubConnectorArtifactError ? error : unsafeInstallLock(error);
  }
}

async function unlinkIfPresent(entry: string): Promise<void> {
  try {
    await unlink(entry);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

async function unlinkVerifiedLockFile(
  entry: string,
  expected: FileIdentity,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<void> {
  const identity = await optionalPrivateLockFile(entry, platform, security);
  if (!identity) return;
  if (!sameFile(identity, expected)) throw unsafeInstallLock();
  await unlinkIfPresent(entry);
}

async function installCleanupGuards(
  base: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<InstallCleanupGuard[]> {
  const guards: InstallCleanupGuard[] = [];
  for (const name of await readdir(base)) {
    const match = INSTALL_CLEANUP_GUARD_PATTERN.exec(name);
    if (!match) continue;
    const cleanerPid = match[2] ? Number(match[2]) : null;
    if (cleanerPid !== null && !Number.isSafeInteger(cleanerPid)) throw unsafeInstallLock();
    const guardPath = path.join(base, name);
    const identity = await optionalPrivateLockFile(guardPath, platform, security);
    if (!identity) continue;
    const record = await optionalInstallLockRecord(guardPath);
    if (!record) continue;
    if (record.claim !== match[1]) throw unsafeInstallLock();
    guards.push({ path: guardPath, identity, cleanerPid, record });
  }
  return guards;
}

async function removeInstallCleanupGuard(
  base: string,
  guard: InstallCleanupGuard,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<void> {
  const claimPath = path.join(base, guard.record.claim);
  const claimIdentity = await optionalPrivateLockFile(claimPath, platform, security);
  if (claimIdentity && sameFile(claimIdentity, guard.identity)) {
    await unlinkVerifiedLockFile(claimPath, guard.identity, platform, security);
  }
  await unlinkVerifiedLockFile(guard.path, guard.identity, platform, security);
}

async function installCleanupPending(
  base: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<boolean> {
  const guards = await installCleanupGuards(base, platform, security);
  if (guards.length === 0) return false;
  const lockIdentity = await optionalPrivateLockFile(
    path.join(base, INSTALL_LOCK_NAME),
    platform,
    security,
  );
  for (const guard of guards) {
    if (!lockIdentity || !sameFile(lockIdentity, guard.identity)) {
      await removeInstallCleanupGuard(base, guard, platform, security);
    }
  }
  return true;
}

async function existingInstallLock(
  base: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<ExistingInstallLock | null> {
  const lockPath = path.join(base, INSTALL_LOCK_NAME);
  let identity: FileIdentity;
  try {
    identity = await privateLockFile(lockPath, platform, security);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  const record = await optionalInstallLockRecord(lockPath);
  if (!record) return null;
  const claimPath = path.join(base, record.claim);
  const matchingGuards = (await installCleanupGuards(base, platform, security)).filter(
    (guard) => guard.record.claim === record.claim,
  );
  if (matchingGuards.length > 1) throw unsafeInstallLock();
  const guard = matchingGuards[0] ?? null;
  const current = {
    path: lockPath,
    claim: claimPath,
    identity,
    record,
    guard,
  };
  const claimIdentity = await optionalPrivateLockFile(claimPath, platform, security);
  if (claimIdentity) {
    if (!sameFile(identity, claimIdentity)) {
      const latestIdentity = await optionalPrivateLockFile(lockPath, platform, security);
      if (!latestIdentity || !sameFile(identity, latestIdentity)) return null;
      throw unsafeInstallLock();
    }
    if (guard && !sameFile(identity, guard.identity)) throw unsafeInstallLock();
    return current;
  }
  if (guard) {
    if (!sameFile(identity, guard.identity)) throw unsafeInstallLock();
    return current;
  }
  const legacyGuardPath = `${claimPath}.reaping`;
  try {
    await link(lockPath, legacyGuardPath);
  } catch (error) {
    if (errorCode(error) === "EEXIST" || missing(error)) return null;
    throw error;
  }
  const linkedIdentity = await optionalPrivateLockFile(legacyGuardPath, platform, security);
  if (!linkedIdentity) return null;
  if (!sameFile(identity, linkedIdentity)) {
    await unlinkVerifiedLockFile(legacyGuardPath, linkedIdentity, platform, security);
    return null;
  }
  return null;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

async function reapStaleInstallLock(
  base: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<void> {
  const current = await existingInstallLock(base, platform, security);
  if (!current || processIsAlive(current.record.pid)) return;
  const ownedGuardPath = `${current.claim}.reaping-${process.pid}-${randomUUID()}`;
  let guard: InstallCleanupGuard;
  if (current.guard?.cleanerPid === process.pid) {
    guard = current.guard;
  } else {
    if (current.guard?.cleanerPid && processIsAlive(current.guard.cleanerPid)) return;
    const source = current.guard?.path ?? current.claim;
    try {
      await rename(source, ownedGuardPath);
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
    const identity = await privateLockFile(ownedGuardPath, platform, security);
    if (!sameFile(identity, current.identity)) {
      await unlinkVerifiedLockFile(ownedGuardPath, identity, platform, security);
      return;
    }
    guard = {
      path: ownedGuardPath,
      identity,
      cleanerPid: process.pid,
      record: current.record,
    };
  }
  try {
    const lockIdentity = await privateLockFile(current.path, platform, security);
    if (!sameFile(lockIdentity, current.identity) || !sameFile(guard.identity, current.identity)) {
      await removeInstallCleanupGuard(base, guard, platform, security);
      return;
    }
    await unlink(current.path);
  } catch (error) {
    if (!missing(error)) throw error;
  } finally {
    await removeInstallCleanupGuard(base, guard, platform, security);
  }
}

async function removeUncommittedInstallLock(
  claimPath: string,
  lockPath: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<void> {
  const claimIdentity = await optionalPrivateLockFile(claimPath, platform, security);
  if (!claimIdentity) return;
  const lockIdentity = await optionalPrivateLockFile(lockPath, platform, security);
  if (lockIdentity && sameFile(lockIdentity, claimIdentity)) {
    await unlinkVerifiedLockFile(lockPath, claimIdentity, platform, security);
  }
  await unlinkVerifiedLockFile(claimPath, claimIdentity, platform, security);
}

async function tryAcquireInstallLock(
  base: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<ArtifactInstallLock | null> {
  if (await installCleanupPending(base, platform, security)) {
    await reapStaleInstallLock(base, platform, security);
    return null;
  }
  const claimName = `.install-${randomUUID()}.claim`;
  const claimPath = path.join(base, claimName);
  const lockPath = path.join(base, INSTALL_LOCK_NAME);
  const handle = await open(claimPath, "wx", PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid, claim: claimName }));
  } finally {
    await handle.close();
  }
  let linked = false;
  try {
    if (platform !== "win32") await chmod(claimPath, PRIVATE_FILE_MODE);
    await protectWindowsEntry(claimPath, "file", security);
    try {
      await link(claimPath, lockPath);
      linked = true;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      await unlink(claimPath);
      await reapStaleInstallLock(base, platform, security);
      return null;
    }
    const claimIdentity = await privateLockFile(claimPath, platform, security);
    const lockIdentity = await optionalPrivateLockFile(lockPath, platform, security);
    if (!lockIdentity || !sameFile(claimIdentity, lockIdentity)) {
      await unlinkVerifiedLockFile(claimPath, claimIdentity, platform, security);
      return null;
    }
    return { path: lockPath, claim: claimPath, identity: lockIdentity };
  } catch (error) {
    if (linked) await removeUncommittedInstallLock(claimPath, lockPath, platform, security);
    else await unlinkIfPresent(claimPath);
    throw error;
  }
}

function acquireInstallLock(
  base: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
  deadline: AbortSignal,
): Effect.Effect<ArtifactInstallLock, GitHubConnectorArtifactError> {
  return Effect.gen(function* () {
    while (!deadline.aborted) {
      const lock = yield* Effect.tryPromise({
        try: () => tryAcquireInstallLock(base, platform, security),
        catch: artifactFailure,
      });
      if (lock) return lock;
      yield* Effect.sleep(INSTALL_LOCK_POLL_MS);
    }
    return yield* Effect.fail(
      new GitHubConnectorArtifactError(504, "GitHub MCP installation timed out"),
    );
  });
}

async function releaseInstallLock(
  lock: ArtifactInstallLock,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
): Promise<void> {
  let lockIdentity: FileIdentity;
  try {
    lockIdentity = await privateLockFile(lock.path, platform, security);
  } catch (error) {
    if (missing(error)) {
      await unlink(lock.claim).catch(() => undefined);
      return;
    }
    throw error;
  }
  const claimIdentity = await privateLockFile(lock.claim, platform, security);
  if (!sameFile(lock.identity, lockIdentity) || !sameFile(lockIdentity, claimIdentity)) {
    throw unsafeInstallLock();
  }
  await unlink(lock.path);
  await unlink(lock.claim);
}

async function writeChunk(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    if (bytesWritten === 0)
      throw new GitHubConnectorArtifactError(502, "GitHub MCP download failed");
    offset += bytesWritten;
  }
}

async function downloadArchive(
  selected: GitHubMcpArtifact,
  destination: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetchImpl(selected.url, {
    headers: { Accept: "application/octet-stream" },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new GitHubConnectorArtifactError(502, "GitHub MCP download failed");
  }
  const declaredValue = response.headers.get("content-length");
  if (declaredValue) {
    const declared = Number(declaredValue);
    if (
      !Number.isSafeInteger(declared) ||
      declared !== selected.archiveSize ||
      declared > MAX_ARCHIVE_BYTES
    ) {
      throw new GitHubConnectorArtifactError(502, "GitHub MCP download size is invalid");
    }
  }
  const handle = await open(destination, "wx", 0o600);
  const reader = response.body.getReader();
  const digest = createHash("sha256");
  let size = 0;
  let complete = false;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const next = await reader.read();
      if (next.done) {
        complete = true;
        break;
      }
      size += next.value.byteLength;
      if (size > MAX_ARCHIVE_BYTES || size > selected.archiveSize) {
        throw new GitHubConnectorArtifactError(502, "GitHub MCP download exceeded its byte limit");
      }
      digest.update(next.value);
      await writeChunk(handle, next.value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await handle.close();
  }
  if (size !== selected.archiveSize || digest.digest("hex") !== selected.archiveSha256) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive integrity check failed");
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function verifyGitHubMcpExecutable(
  command: string,
  options: GitHubMcpVerificationOptions = {},
): Effect.Effect<void, GitHubConnectorArtifactError> {
  const expectedTools = [...(options.expectedTools ?? GITHUB_MCP_TOOLS)].sort();
  const expectedInventoryDigest = options.expectedInventoryDigest ?? GITHUB_MCP_INVENTORY_DIGEST;
  return Effect.acquireUseRelease(
    Effect.sync(() =>
      connectMcp({
        transport: "stdio",
        command,
        args: [...(options.prefixArgs ?? []), ...GITHUB_MCP_ARGS],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "local-studio-install-verification" },
      }),
    ),
    (connection) =>
      Effect.tryPromise({
        try: () => connection.listTools(),
        catch: () =>
          new GitHubConnectorArtifactError(409, "GitHub MCP startup verification failed"),
      }).pipe(
        Effect.timeoutOrElse({
          duration: options.timeoutMs ?? VERIFY_TIMEOUT_MS,
          orElse: () =>
            Effect.fail(
              new GitHubConnectorArtifactError(409, "GitHub MCP startup verification timed out"),
            ),
        }),
        Effect.flatMap((tools) => {
          const names = tools.map((tool) => tool.name).sort();
          return sameValues(names, expectedTools) &&
            connectorInventoryDigest(tools) === expectedInventoryDigest
            ? Effect.void
            : Effect.fail(
                new GitHubConnectorArtifactError(409, "GitHub MCP tool inventory is invalid"),
              );
        }),
      ),
    (connection) => Effect.promise(() => connection.close()).pipe(Effect.catch(() => Effect.void)),
  );
}

async function promote(
  staging: string,
  target: string,
  selected: GitHubMcpArtifact,
  dataDir: string,
  platform: NodeJS.Platform,
  security: WindowsSnapshotSecurity | null,
  renameImpl: typeof rename,
): Promise<void> {
  const backup = path.join(path.dirname(target), `.replaced-${randomUUID()}`);
  let replaced = false;
  let promoted = false;
  try {
    try {
      await lstat(target);
      await renameImpl(target, backup);
      replaced = true;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    await renameImpl(staging, target);
    promoted = true;
    if ((await securedInstalledState(selected, dataDir, platform, security)) !== "installed") {
      throw new GitHubConnectorArtifactError(409, "GitHub MCP installed executable is invalid");
    }
    if (replaced) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (promoted) await rm(target, { recursive: true, force: true }).catch(() => undefined);
    if (replaced) await renameImpl(backup, target).catch(() => undefined);
    throw error;
  }
}

async function installArtifact(
  selected: GitHubMcpArtifact,
  dependencies: GitHubMcpArtifactDependencies,
  signal: AbortSignal,
  base: string,
): Promise<GitHubConnectorArtifactStatus> {
  const platform = dependencies.platform ?? process.platform;
  const dataDir = selectedDataDir(dependencies);
  const security = windowsSecurity(dependencies, platform);
  if ((await securedInstalledState(selected, dataDir, platform, security)) === "installed") {
    return artifactStatus(dependencies);
  }
  const staging = await mkdtemp(path.join(base, ".pending-"));
  if (platform !== "win32") await chmod(staging, PRIVATE_DIRECTORY_MODE);
  await protectWindowsEntry(staging, "directory", security);
  const archivePath = path.join(staging, selected.archiveName);
  try {
    await downloadArchive(selected, archivePath, dependencies.fetch ?? fetch, signal);
    signal.throwIfAborted();
    const executable = extractedExecutable(await readFile(archivePath), selected);
    signal.throwIfAborted();
    await unlink(archivePath);
    const executablePath = path.join(staging, selected.executableName);
    const handle = await open(executablePath, "wx", EXECUTABLE_MODE);
    try {
      await handle.writeFile(executable);
    } finally {
      await handle.close();
    }
    if (platform !== "win32") await chmod(executablePath, EXECUTABLE_MODE);
    await protectWindowsEntry(executablePath, "file", security);
    await (
      dependencies.verifyExecutable ??
      ((command) => Effect.runPromise(verifyGitHubMcpExecutable(command), { signal }))
    )(executablePath);
    signal.throwIfAborted();
    await promote(
      staging,
      versionRoot(dataDir, selected),
      selected,
      dataDir,
      platform,
      security,
      dependencies.rename ?? rename,
    );
    return artifactStatus(dependencies);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function installGitHubConnectorArtifact(
  dependencies: GitHubMcpArtifactDependencies = {},
): Effect.Effect<GitHubConnectorArtifactStatus, GitHubConnectorArtifactError> {
  const selected = selectedArtifact(dependencies);
  if (!selected) {
    return Effect.fail(
      new GitHubConnectorArtifactError(409, "GitHub MCP is unavailable on this platform"),
    );
  }
  return installSemaphore.withPermit(
    Effect.suspend(() => {
      const deadline = AbortSignal.timeout(dependencies.timeoutMs ?? INSTALL_TIMEOUT_MS);
      let platform: NodeJS.Platform;
      let dataDir: string;
      let security: WindowsSnapshotSecurity | null;
      try {
        platform = dependencies.platform ?? process.platform;
        dataDir = selectedDataDir(dependencies);
        security = windowsSecurity(dependencies, platform);
      } catch (error) {
        return Effect.fail(artifactFailure(error));
      }
      return Effect.tryPromise({
        try: () => installBase(dataDir, platform, security),
        catch: artifactFailure,
      }).pipe(
        Effect.flatMap((base) =>
          Effect.acquireUseRelease(
            acquireInstallLock(base, platform, security, deadline),
            () =>
              Effect.tryPromise({
                try: async (signal) => {
                  try {
                    return await installArtifact(
                      selected,
                      dependencies,
                      AbortSignal.any([signal, deadline]),
                      base,
                    );
                  } catch (error) {
                    if (deadline.aborted) {
                      throw new GitHubConnectorArtifactError(
                        504,
                        "GitHub MCP installation timed out",
                      );
                    }
                    throw error;
                  }
                },
                catch: artifactFailure,
              }),
            (lock) =>
              Effect.tryPromise({
                try: () => releaseInstallLock(lock, platform, security),
                catch: artifactFailure,
              }),
          ),
        ),
      );
    }),
  );
}
