import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import {
  chmod,
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
import { Effect, Semaphore } from "effect";
import lockfile from "proper-lockfile";
import {
  GITHUB_CONNECTOR_TOKEN_KEY,
  type ConnectorConfig,
  type GitHubConnectorArtifactStatus,
} from "./connector-contract";
import { resolveDataDir } from "./data-dir";
import { connectMcp } from "./mcp-client";

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

export type WindowsArtifactSecurity = {
  protect(entry: string, kind: "directory" | "file"): Promise<void>;
  verify(entry: string, kind: "directory" | "file"): Promise<void>;
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
  windowsSecurity?: WindowsArtifactSecurity;
};

export type GitHubMcpVerificationOptions = {
  prefixArgs?: readonly string[];
  expectedTools?: readonly string[];
  timeoutMs?: number;
  closeTimeoutMs?: number;
  connect?: typeof connectMcp;
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
const VERIFY_CLOSE_TIMEOUT_MS = 6_000;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const EXECUTABLE_MODE = 0o500;
const installSemaphore = Semaphore.makeUnsafe(1);

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

const artifactFailure = (error: unknown): GitHubConnectorArtifactError =>
  error instanceof GitHubConnectorArtifactError
    ? error
    : new GitHubConnectorArtifactError(502, "GitHub MCP installation failed", { cause: error });

const targetKey = (platform: NodeJS.Platform, arch: string): string => `${platform}-${arch}`;

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
  const candidate = dependencies.dataDir ?? resolveDataDir();
  const resolved = path.resolve(candidate);
  if (!path.relative(path.parse(resolved).root, resolved)) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP data directory is unsafe");
  }
  return resolved;
}

const installRoot = (dataDir: string): string =>
  path.join(dataDir, "runtime", "connectors", "github-mcp-server");

const versionRoot = (dataDir: string, selected: GitHubMcpArtifact): string =>
  path.join(installRoot(dataDir), selected.version);

export function githubMcpExecutablePath(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  dataDir: string = resolveDataDir(),
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

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function ownerMatches(stat: { uid: number }): boolean {
  const uid = process.geteuid?.();
  return uid === undefined || stat.uid === uid;
}

function sameResolvedPath(actual: string, expected: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    return (
      path.win32.normalize(actual).toLowerCase() === path.win32.normalize(expected).toLowerCase()
    );
  }
  return actual === path.resolve(expected);
}

function missing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
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
        !sameResolvedPath(realpathSync(entry), entry, platform) ||
        (platform !== "win32" && (directory.mode & 0o777) !== PRIVATE_DIRECTORY_MODE)
      ) {
        return "invalid";
      }
    }
    const entries = readdirSync(root);
    if (entries.length !== 1 || entries[0] !== selected.executableName) return "invalid";
    const file = lstatSync(executable);
    if (
      file.isSymbolicLink() ||
      !file.isFile() ||
      !ownerMatches(file) ||
      file.size !== selected.executableSize ||
      (platform !== "win32" && (file.mode & 0o777) !== EXECUTABLE_MODE)
    ) {
      return "invalid";
    }
    return sha256(readFileSync(executable)) === selected.executableSha256 ? "installed" : "invalid";
  } catch {
    return "invalid";
  }
}

const POWERSHELL_ACL_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$action=[Environment]::GetEnvironmentVariable('LOCAL_STUDIO_ACL_ACTION')",
  "$kind=[Environment]::GetEnvironmentVariable('LOCAL_STUDIO_ACL_KIND')",
  "$entry=[Environment]::GetEnvironmentVariable('LOCAL_STUDIO_ACL_ENTRY')",
  "if(($action -ne 'protect' -and $action -ne 'verify') -or ($kind -ne 'directory' -and $kind -ne 'file') -or [String]::IsNullOrWhiteSpace($entry)){throw 'ACL input is invalid'}",
  "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
  "$isDirectory=$kind -eq 'directory'",
  "if($action -eq 'protect') {",
  "  $acl=if($isDirectory){New-Object Security.AccessControl.DirectorySecurity}else{New-Object Security.AccessControl.FileSecurity}",
  "  $acl.SetOwner($sid)",
  "  $acl.SetAccessRuleProtection($true,$false)",
  "  $inherit=if($isDirectory){[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit}else{[Security.AccessControl.InheritanceFlags]::None}",
  "  $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)",
  "  [void]$acl.AddAccessRule($rule)",
  "  if($isDirectory){[IO.Directory]::SetAccessControl($entry,$acl)}else{[IO.File]::SetAccessControl($entry,$acl)}",
  "}",
  "$current=if($isDirectory){[IO.Directory]::GetAccessControl($entry)}else{[IO.File]::GetAccessControl($entry)}",
  "$rules=@($current.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))",
  "$expectedInheritance=if($isDirectory){[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit}else{[Security.AccessControl.InheritanceFlags]::None}",
  "$valid=$current.AreAccessRulesProtected -and $current.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid.Value -and $rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $sid.Value -and $rules[0].AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rules[0].InheritanceFlags -eq $expectedInheritance -and (($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)",
  "if(-not $valid){throw 'ACL verification failed'}",
  "[Console]::Out.Write('{\"ok\":true}')",
].join(";");

export const WINDOWS_POWERSHELL_PATH =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

type WindowsPowerShellIdentity = {
  readonly file: boolean;
  readonly symbolicLink: boolean;
  readonly realPath: string;
};

const inspectWindowsPowerShell = (candidate: string): WindowsPowerShellIdentity => {
  const info = lstatSync(candidate);
  return {
    file: info.isFile(),
    symbolicLink: info.isSymbolicLink(),
    realPath: realpathSync(candidate),
  };
};

export function trustedPowerShellPath(
  inspect: (candidate: string) => WindowsPowerShellIdentity = inspectWindowsPowerShell,
): string {
  const identity = inspect(WINDOWS_POWERSHELL_PATH);
  if (
    identity.symbolicLink ||
    !identity.file ||
    identity.realPath.toLowerCase() !== WINDOWS_POWERSHELL_PATH.toLowerCase()
  ) {
    throw new Error("Windows ACL verifier is unavailable");
  }
  return WINDOWS_POWERSHELL_PATH;
}

function invokeWindowsAcl(action: "protect" | "verify", entry: string, kind: "directory" | "file") {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    let settled = false;
    const environment = Object.fromEntries([
      ["SystemRoot", "C:\\Windows"],
      ["WINDIR", "C:\\Windows"],
      ["LOCAL_STUDIO_ACL_ACTION", action],
      ["LOCAL_STUDIO_ACL_KIND", kind],
      ["LOCAL_STUDIO_ACL_ENTRY", entry],
    ]) as NodeJS.ProcessEnv;
    const child = spawn(
      trustedPowerShellPath(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(POWERSHELL_ACL_SCRIPT, "utf16le").toString("base64"),
      ],
      {
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"] as const,
        windowsHide: true,
      },
    );
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Windows ACL verifier timed out"));
    }, 5_000);
    child.stdout.on("data", (chunk: Buffer | string) => {
      output += String(chunk);
      if (Buffer.byteLength(output) <= 4_096) return;
      child.kill();
      finish(new Error("Windows ACL verifier output is invalid"));
    });
    child.once("error", () => finish(new Error("Windows ACL verifier failed")));
    child.once("close", (code) =>
      finish(
        code === 0 && output.trim() === '{"ok":true}'
          ? undefined
          : new Error("Windows ACL verifier failed"),
      ),
    );
  });
}

function windowsSecurity(
  dependencies: GitHubMcpArtifactDependencies,
  platform: NodeJS.Platform,
): WindowsArtifactSecurity | null {
  if (platform !== "win32") return null;
  return (
    dependencies.windowsSecurity ?? {
      protect: (entry, kind) => invokeWindowsAcl("protect", entry, kind),
      verify: (entry, kind) => invokeWindowsAcl("verify", entry, kind),
    }
  );
}

async function securedInstalledState(
  selected: GitHubMcpArtifact,
  dataDir: string,
  platform: NodeJS.Platform,
  security: WindowsArtifactSecurity | null,
): Promise<"installed" | "not-installed" | "invalid"> {
  const state = installedState(selected, dataDir, platform);
  if (state !== "installed" || !security) return state;
  try {
    for (const entry of installedDirectories(dataDir, selected)) {
      await security.verify(entry, "directory");
    }
    await security.verify(
      path.join(versionRoot(dataDir, selected), selected.executableName),
      "file",
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
  return {
    version: selected.version,
    target: selected.target,
    state: await securedInstalledState(
      selected,
      dataDir,
      platform,
      windowsSecurity(dependencies, platform),
    ),
  };
}

export function getGitHubConnectorArtifactStatus(
  dependencies: GitHubMcpArtifactDependencies = {},
): Effect.Effect<GitHubConnectorArtifactStatus> {
  return Effect.promise(() => artifactStatus(dependencies));
}

function safeArchiveName(name: string): boolean {
  if (!name || name.includes("\\") || path.posix.isAbsolute(name) || /^[A-Za-z]:/.test(name)) {
    return false;
  }
  return name.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function tarText(bytes: Buffer, offset: number, length: number): string {
  const end = bytes.indexOf(0, offset);
  return bytes
    .subarray(offset, end === -1 || end > offset + length ? offset + length : end)
    .toString();
}

function tarNumber(bytes: Buffer, offset: number, length: number): number {
  const value = tarText(bytes, offset, length).trim();
  if (!/^[0-7]+$/.test(value)) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  }
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed)) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is invalid");
  }
  return parsed;
}

function tarHeaderChecksum(bytes: Buffer, offset: number): number {
  let checksum = 0;
  for (let index = 0; index < 512; index += 1) {
    checksum += index >= 148 && index < 156 ? 32 : (bytes[offset + index] ?? 0);
  }
  return checksum;
}

type ArchiveEntry = { name: string; bytes: Buffer };

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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
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
    if (names.has(entry.name)) {
      throw new GitHubConnectorArtifactError(409, "GitHub MCP archive is unsafe");
    }
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
  security: WindowsArtifactSecurity | null,
): Promise<string> {
  await mkdir(entry, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const info = await lstat(entry);
  if (info.isSymbolicLink() || !info.isDirectory() || !ownerMatches(info)) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP install directory is unsafe");
  }
  if (platform !== "win32") await chmod(entry, PRIVATE_DIRECTORY_MODE);
  if (security) {
    await security.protect(entry, "directory");
    await security.verify(entry, "directory");
  }
  const resolved = path.resolve(entry);
  if (!sameResolvedPath(realpathSync(entry), resolved, platform)) {
    throw new GitHubConnectorArtifactError(409, "GitHub MCP install directory is unsafe");
  }
  return resolved;
}

async function installBase(
  dataDir: string,
  platform: NodeJS.Platform,
  security: WindowsArtifactSecurity | null,
): Promise<string> {
  let current = await privateDirectory(dataDir, platform, security);
  for (const name of ["runtime", "connectors", "github-mcp-server"]) {
    current = await privateDirectory(path.join(current, name), platform, security);
  }
  return current;
}

async function writeChunk(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    if (bytesWritten === 0) {
      throw new GitHubConnectorArtifactError(502, "GitHub MCP download failed");
    }
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
  const handle = await open(destination, "wx", PRIVATE_FILE_MODE);
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

export function verifyGitHubMcpExecutable(
  command: string,
  options: GitHubMcpVerificationOptions = {},
): Effect.Effect<void, GitHubConnectorArtifactError> {
  const expected = [...(options.expectedTools ?? GITHUB_MCP_TOOLS)].sort();
  return Effect.acquireUseRelease(
    Effect.sync(() =>
      (options.connect ?? connectMcp)({
        transport: "stdio",
        command,
        args: [...(options.prefixArgs ?? []), ...GITHUB_MCP_ARGS],
        env: { [GITHUB_CONNECTOR_TOKEN_KEY]: "local-studio-install-verification" },
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
          const actual = tools.map((tool) => tool.name).sort();
          return actual.length === expected.length &&
            actual.every((name, index) => name === expected[index])
            ? Effect.void
            : Effect.fail(
                new GitHubConnectorArtifactError(409, "GitHub MCP tool inventory is invalid"),
              );
        }),
      ),
    (connection) =>
      Effect.tryPromise({
        try: () => connection.close(),
        catch: () =>
          new GitHubConnectorArtifactError(409, "GitHub MCP shutdown verification failed"),
      }).pipe(
        Effect.timeoutOrElse({
          duration: options.closeTimeoutMs ?? VERIFY_CLOSE_TIMEOUT_MS,
          orElse: () =>
            Effect.fail(
              new GitHubConnectorArtifactError(409, "GitHub MCP shutdown verification timed out"),
            ),
        }),
      ),
  );
}

async function promote(
  staging: string,
  target: string,
  selected: GitHubMcpArtifact,
  dataDir: string,
  platform: NodeJS.Platform,
  security: WindowsArtifactSecurity | null,
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
  if (security) {
    await security.protect(staging, "directory");
    await security.verify(staging, "directory");
  }
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
    if (security) {
      await security.protect(executablePath, "file");
      await security.verify(executablePath, "file");
    }
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
  const timeoutMs = dependencies.timeoutMs ?? INSTALL_TIMEOUT_MS;
  return installSemaphore
    .withPermit(
      Effect.tryPromise({
        try: async (signal) => {
          const platform = dependencies.platform ?? process.platform;
          const dataDir = selectedDataDir(dependencies);
          const security = windowsSecurity(dependencies, platform);
          const base = await installBase(dataDir, platform, security);
          const release = await lockfile.lock(base, {
            realpath: true,
            stale: 10_000,
            update: 2_000,
            retries: { retries: 80, factor: 1.15, minTimeout: 25, maxTimeout: 250 },
          });
          try {
            return await installArtifact(selected, dependencies, signal, base);
          } finally {
            await release();
          }
        },
        catch: artifactFailure,
      }),
    )
    .pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () =>
          Effect.fail(new GitHubConnectorArtifactError(504, "GitHub MCP installation timed out")),
      }),
    );
}

function exactValues(left: readonly string[] | undefined, right: readonly string[]): boolean {
  return left?.length === right.length && right.every((value, index) => left[index] === value);
}

function allowedEnvironment(env: Readonly<Record<string, string>> | undefined): boolean {
  return !env || Object.keys(env).every((key) => key === GITHUB_CONNECTOR_TOKEN_KEY);
}

function artifactBinding(selected: GitHubMcpArtifact): string {
  return `sha256:${selected.executableSha256}`;
}

export function githubMcpConnectorConfiguration(
  input: { env?: Readonly<Record<string, string>>; enabled?: boolean } = {},
  dependencies: GitHubMcpArtifactDependencies = {},
): ConnectorConfig {
  const selected = selectedArtifact(dependencies);
  if (!selected || !allowedEnvironment(input.env)) {
    throw new Error(
      selected ? "GitHub connector environment is invalid" : "GitHub connector is unavailable",
    );
  }
  const dataDir = selectedDataDir(dependencies);
  const command = path.join(versionRoot(dataDir, selected), selected.executableName);
  return {
    id: "github",
    name: "GitHub",
    transport: "stdio",
    command,
    args: [...GITHUB_MCP_ARGS],
    ...(input.env ? { env: { ...input.env } } : {}),
    allowTools: [...GITHUB_MCP_TOOLS],
    origin: {
      kind: "catalog",
      id: "github",
      version: selected.version,
      binding: artifactBinding(selected),
    },
    enabled: input.enabled ?? false,
  };
}

export function isManagedGitHubConnector(connector: ConnectorConfig): boolean {
  return connector.origin?.kind === "catalog" && connector.origin.id === "github";
}

export function managedGitHubConnectorMatches(
  connector: ConnectorConfig,
  dependencies: GitHubMcpArtifactDependencies = {},
): boolean {
  const selected = selectedArtifact(dependencies);
  if (!selected) return false;
  let expected: ConnectorConfig;
  try {
    expected = githubMcpConnectorConfiguration(
      { env: connector.env, enabled: connector.enabled },
      dependencies,
    );
  } catch {
    return false;
  }
  return (
    connector.id === expected.id &&
    connector.name === expected.name &&
    connector.transport === expected.transport &&
    connector.command === expected.command &&
    exactValues(connector.args, GITHUB_MCP_ARGS) &&
    exactValues(connector.allowTools, GITHUB_MCP_TOOLS) &&
    allowedEnvironment(connector.env) &&
    !connector.cwd &&
    !connector.url &&
    !connector.headers &&
    !connector.auth &&
    connector.origin?.kind === "catalog" &&
    connector.origin.id === "github" &&
    connector.origin.version === selected.version &&
    connector.origin.binding === artifactBinding(selected)
  );
}

function exactLegacyGitHubConnector(connector: ConnectorConfig): boolean {
  return (
    connector.id === "github" &&
    connector.name === "GitHub" &&
    connector.transport === "stdio" &&
    connector.command === "npx" &&
    exactValues(connector.args, ["-y", "@modelcontextprotocol/server-github"]) &&
    allowedEnvironment(connector.env) &&
    connector.allowTools === undefined &&
    !connector.cwd &&
    !connector.url &&
    !connector.headers &&
    !connector.auth &&
    !connector.origin
  );
}

export function migrateLegacyGitHubConnector(
  connector: ConnectorConfig,
  dependencies: GitHubMcpArtifactDependencies = {},
): { connector: ConnectorConfig; migrated: boolean } {
  if (!exactLegacyGitHubConnector(connector)) return { connector, migrated: false };
  return {
    connector: githubMcpConnectorConfiguration(
      { env: connector.env, enabled: false },
      dependencies,
    ),
    migrated: true,
  };
}

export function assertGitHubConnectorReady(
  connector: ConnectorConfig,
  dependencies: GitHubMcpArtifactDependencies = {},
): Effect.Effect<void, GitHubConnectorArtifactError> {
  if (!managedGitHubConnectorMatches(connector, dependencies)) {
    return Effect.fail(
      new GitHubConnectorArtifactError(409, "GitHub connector configuration is invalid"),
    );
  }
  return Effect.tryPromise({
    try: async () => {
      const selected = selectedArtifact(dependencies);
      if (!selected) throw new Error("unsupported");
      const platform = dependencies.platform ?? process.platform;
      const dataDir = selectedDataDir(dependencies);
      const state = await securedInstalledState(
        selected,
        dataDir,
        platform,
        windowsSecurity(dependencies, platform),
      );
      if (state !== "installed") {
        throw new GitHubConnectorArtifactError(409, "GitHub MCP integrity check failed");
      }
    },
    catch: (error) =>
      error instanceof GitHubConnectorArtifactError
        ? error
        : new GitHubConnectorArtifactError(409, "GitHub MCP integrity check failed", {
            cause: error,
          }),
  });
}
